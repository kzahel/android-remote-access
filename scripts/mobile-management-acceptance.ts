/** Full native UI management with two independent browser identities and real hosted traffic. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser, BrowserContext, Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { decodeInvitation } from "../protocol/src/enrollment.js";

type Fixture = {
  browser: Browser;
  origin: string;
  state: string;
  adbPath: string;
  serial: string;
  adb: (...args: string[]) => string;
  privateWrite: (file: string, value: string) => unknown;
};
type State = {
  action: string;
  armed: boolean;
  active?: string;
  browsers: {
    id: string;
    nickname: string;
    enabled: boolean;
    generation: string;
    lastConnected: number;
    wakeReady: boolean;
  }[];
};
class FixtureExited extends Error {}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(
  work: () => T | Promise<T>,
  timeout = 90000,
): Promise<NonNullable<T>> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await work();
      if (result) return result as NonNullable<T>;
    } catch (error) {
      if (error instanceof FixtureExited) throw error;
    }
    await delay(300);
  }
  throw new Error("Mobile acceptance timed out; see private native logs");
}
export async function mobileAcceptance(f: Fixture) {
  const app = "dev.remoteaccess.host";
  const { adb, privateWrite } = f;
  const log = await open(path.join(f.state, "mobile-native.log"), "w", 0o600);
  let native: ReturnType<typeof spawn> | undefined;
  let enrolled = false;
  const contexts: BrowserContext[] = [];
  async function startNative() {
    adb(
      "shell",
      "run-as",
      app,
      "rm",
      "-f",
      "files/hosted-stage",
      "files/hosted-command",
    );
    native = spawn(
      f.adbPath,
      [
        "-s",
        f.serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-e",
        "class",
        "dev.remoteaccess.app.HostedPairingTest#manageMultipleBrowsers",
        `${app}.test/androidx.test.runner.AndroidJUnitRunner`,
      ],
      { stdio: ["ignore", log.fd, log.fd] },
    );
    await until(() => {
      if (native?.exitCode !== null)
        throw new FixtureExited("Native fixture exited during startup");
      return (
        adb("shell", "run-as", app, "cat", "files/hosted-stage") === "ready"
      );
    });
  }
  async function command(
    action: string,
    extra: Record<string, unknown> = {},
  ): Promise<State> {
    adb("shell", "run-as", app, "rm", "-f", "files/hosted-stage");
    privateWrite("hosted-command", JSON.stringify({ action, ...extra }));
    return until(() => {
      if (native?.exitCode !== null)
        throw new FixtureExited("Native fixture exited; see mobile-native.log");
      const raw = adb("shell", "run-as", app, "cat", "files/hosted-stage");
      if (action === "stop" && raw === "stopped")
        return { action, browsers: [], armed: false };
      const state = JSON.parse(raw) as State;
      return state.action === action ? state : undefined;
    });
  }
  async function stopNative() {
    await command("stop");
    await until(() => native?.exitCode !== null);
    assert.equal(native?.exitCode, 0);
  }
  async function shot(name: string) {
    await delay(400);
    await writeFile(
      path.join(f.state, `${name}.png`),
      execFileSync(f.adbPath, ["-s", f.serial, "exec-out", "screencap", "-p"], {
        maxBuffer: 10000000,
      }),
    );
  }
  async function pair() {
    const context = await f.browser.newContext({
      viewport: { width: 900, height: 850 },
      deviceScaleFactor: 2,
    });
    contexts.push(context);
    const page = await context.newPage();
    await page.goto(f.origin);
    await page.getByRole("button", { name: "Create pairing code" }).click();
    const qr = await page
      .getByRole("img", { name: "Scan to pair this browser" })
      .screenshot();
    const image = PNG.sync.read(qr);
    const decoded = jsQR(
      new Uint8ClampedArray(image.data),
      image.width,
      image.height,
    );
    assert.ok(decoded, "Rendered QR did not decode");
    const invitation = decodeInvitation(decoded.data);
    privateWrite("hosted-pair-uri", decoded.data);
    enrolled = true;
    const state = await command("pair");
    assert.ok(state.browsers.find((b) => b.id === invitation.id));
    await page
      .getByRole("button", { name: "Check encrypted connection" })
      .waitFor();
    return { page, id: invitation.id };
  }
  async function check(page: Page, success = true) {
    await page
      .getByRole("button", { name: "Check encrypted connection" })
      .click();
    await page
      .getByRole("status")
      .filter({
        hasText: success
          ? "Encrypted connection passed."
          : "Phone is unavailable",
      })
      .waitFor({ timeout: success ? 80000 : 15000 });
  }
  async function manual(peer: { page: Page; id: string }) {
    await command("connect", { id: peer.id });
    await check(peer.page);
    await delay(400);
  }
  async function probe(page: Page) {
    return page.evaluate(async () => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const r = indexedDB.open("remote-access-v1", 1);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      const stored = await Promise.all(
        ["identity", "grant"].map(
          (key) =>
            new Promise<unknown>((resolve, reject) => {
              const request = db
                .transaction("state")
                .objectStore("state")
                .get(key);
              request.onsuccess = () => resolve(request.result);
              request.onerror = () => reject(request.error);
            }),
        ),
      );
      const keys = stored[0] as CryptoKeyPair;
      const grant = stored[1] as { id: string };
      const state = { ready: false, closed: false, authenticated: false };
      (window as unknown as { mobileProbe: typeof state }).mobileProbe = state;
      const ws = new WebSocket(
        `${location.origin.replace("https:", "wss:")}/api/socket`,
      );
      ws.onclose = () => {
        state.closed = true;
      };
      ws.onmessage = async (event) => {
        const message = JSON.parse(String(event.data)) as {
          type: string;
          nonce?: string;
        };
        if (message.type === "challenge") {
          const bytes = new TextEncoder().encode(
            [
              "ara/relay/auth/v1",
              location.origin,
              grant.id,
              "viewer",
              message.nonce,
            ].join("\n"),
          );
          const signature = new Uint8Array(
            await crypto.subtle.sign(
              { name: "ECDSA", hash: "SHA-256" },
              keys.privateKey,
              bytes,
            ),
          );
          ws.send(
            JSON.stringify({
              id: grant.id,
              role: "viewer",
              signature: btoa(String.fromCharCode(...signature)),
            }),
          );
        }
        if (message.type === "authenticated") state.authenticated = true;
        if (message.type === "ready") state.ready = true;
      };
    });
  }
  async function probeState(page: Page) {
    return page.evaluate(
      () =>
        (
          window as unknown as {
            mobileProbe: { ready: boolean; closed: boolean };
          }
        ).mobileProbe,
    );
  }
  try {
    const dbTests = adb(
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "class",
      "dev.remoteaccess.app.HostStoreTest",
      `${app}.test/androidx.test.runner.AndroidJUnitRunner`,
    );
    await writeFile(path.join(f.state, "database-tests.log"), dbTests, {
      mode: 0o600,
    });
    assert.match(dbTests, /OK \(3 tests\)/);
    await startNative();
    console.log("Native Room tests passed");
    const a = await pair();
    const b = await pair();
    assert.notEqual(a.id, b.id);
    console.log("Both independent browsers paired");
    await command("rename", { id: a.id, name: "Work laptop" });
    await command("rename", { id: b.id, name: "Home desktop" });
    await manual(a);
    await manual(b);
    console.log("Both browsers passed encrypted checks");
    await command("home");
    await shot("home-two-browsers");
    await command("details", { id: a.id });
    await shot("browser-details");
    await command("automatic", { enabled: true });
    await shot("settings");
    await stopNative();
    adb("shell", "input", "keyevent", "KEYCODE_HOME");
    const wakeProof = [];
    for (const peer of [a, b]) {
      await until(() => {
        adb("shell", "am", "kill", "--user", "current", app);
        return (
          adb(
            "shell",
            `if pidof ${app} >/dev/null; then echo present; else echo absent; fi`,
          ) === "absent"
        );
      }, 20000);
      const readTimes = () => {
        const raw = adb(
          "shell",
          "run-as",
          app,
          "cat",
          "shared_prefs/paired-browser-v1.xml",
        );
        return {
          receipt: Number(
            raw.match(/<long name="lastPushReceipt" value="([0-9]+)"/)?.[1] ??
              0,
          ),
          exchange: Number(
            raw.match(/<long name="lastWakeExchange" value="([0-9]+)"/)?.[1] ??
              0,
          ),
        };
      };
      const before = readTimes();
      await check(peer.page);
      const after = await until(() => {
        const t = readTimes();
        return t.receipt > before.receipt && t.exchange > before.exchange
          ? t
          : undefined;
      });
      wakeProof.push({
        processAbsent: true,
        freshFirebaseReceipt: true,
        freshEncryptedExchange: true,
        receiptToExchangeMs: after.exchange - after.receipt,
      });
    }
    console.log("Both browsers passed process-absent FCM wake");
    await a.page.reload();
    await b.page.reload();
    await startNative();
    const restored = await command("home");
    assert.deepEqual(
      restored.browsers.map((x) => x.nickname),
      ["Work laptop", "Home desktop"],
    );
    assert.ok(restored.browsers.every((x) => x.lastConnected > 0));
    await command("connect", { id: a.id });
    await probe(a.page);
    await until(async () => (await probeState(a.page)).ready);
    const beforeGlobal = restored.browsers.map((x) => x.generation);
    await command("global", { enabled: false });
    await until(async () => (await probeState(a.page)).closed);
    await check(b.page, false);
    await shot("global-off");
    await stopNative();
    adb("shell", "am", "force-stop", app);
    await startNative();
    assert.equal((await command("home")).armed, false);
    await check(b.page, false);
    const rearmed = await command("global", { enabled: true });
    assert.ok(
      rearmed.browsers.every((x, i) => x.generation !== beforeGlobal[i]),
    );
    await command("enable", { id: a.id, enabled: false });
    await check(a.page, false);
    await manual(b);
    await command("enable", { id: a.id, enabled: true });
    await command("connect", { id: b.id });
    await probe(b.page);
    await until(async () => (await probeState(b.page)).ready);
    await command("enable", { id: a.id, enabled: false });
    assert.equal((await probeState(b.page)).closed, false);
    await command("disconnect", { id: b.id });
    await until(async () => (await probeState(b.page)).closed);
    await command("enable", { id: a.id, enabled: true });
    await command("connect", { id: a.id });
    await probe(a.page);
    await until(async () => (await probeState(a.page)).ready);
    await command("disconnect", { id: a.id });
    await until(async () => (await probeState(a.page)).closed);
    await manual(a);
    await command("connect", { id: a.id });
    await probe(a.page);
    await until(async () => (await probeState(a.page)).ready);
    await command("enable", { id: a.id, enabled: false });
    await until(async () => (await probeState(a.page)).closed);
    await manual(b);
    await command("home");
    await shot("browser-disabled");
    await command("remove", { id: a.id });
    await check(a.page, false);
    await manual(b);
    await command("activity");
    await shot("activity");
    await command("remove", { id: b.id });
    await check(b.page, false);
    await command("home");
    await shot("home-unpaired");
    enrolled = false;
    await stopNative();
    const nativeLog = await readFile(
      path.join(f.state, "mobile-native.log"),
      "utf8",
    );
    assert.ok(!nativeLog.includes("FAILURES!!!"));
    const report = {
      databaseTests: 3,
      independentBrowsers: 2,
      renamedThroughUI: true,
      encryptedChecksBothBrowsers: true,
      wakeProof,
      persistedAfterProcessRestart: true,
      globalDisableClosesActiveAndRejectsNew: true,
      globalDisablePersistsAfterRestart: true,
      pauseDoesNotDisplaceOtherActiveBrowser: true,
      perBrowserPauseIsolated: true,
      oldGenerationsInvalidated: true,
      disconnectRetainsPairing: true,
      revocationIsolated: true,
      removedBothFixtures: true,
    };
    await writeFile(
      path.join(f.state, "result.json"),
      JSON.stringify(report, null, 2),
      { mode: 0o600 },
    );
    console.log(JSON.stringify(report));
  } finally {
    if (native?.exitCode === null) {
      adb("shell", "am", "force-stop", app);
      native.kill("SIGTERM");
      await until(() => native?.exitCode !== null, 10000);
      await delay(500);
    }
    if (enrolled) {
      privateWrite("hosted-stage", "cleanup");
      const cleanup = adb(
        "shell",
        "am",
        "instrument",
        "-w",
        "-e",
        "class",
        "dev.remoteaccess.app.HostedPairingTest#revokeFixture",
        `${app}.test/androidx.test.runner.AndroidJUnitRunner`,
      );
      await writeFile(path.join(f.state, "cleanup.log"), cleanup, {
        mode: 0o600,
      });
      if (!cleanup.includes("OK (1 test)"))
        console.error(
          "Fixture cleanup failed; preserve the owned AVD for repair",
        );
    }
    await log.close();
    for (const context of contexts) await context.close();
  }
}
