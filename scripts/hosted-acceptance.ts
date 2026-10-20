/** Public-origin acceptance with an owned emulator or explicitly selected physical fixture. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { decodeInvitation } from "../protocol/src/enrollment.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const origin = process.env.HOSTED_ORIGIN;
if (
  !origin ||
  new URL(origin).origin !== origin ||
  !origin.startsWith("https://")
)
  throw new Error("Set HOSTED_ORIGIN to the HTTPS development relay origin");
const physical = process.env.HOSTED_DEVICE;
const expectedModel = process.env.HOSTED_DEVICE_MODEL;
const doze = process.env.HOSTED_DOZE === "1";
if (physical && (!expectedModel || physical.startsWith("emulator-")))
  throw new Error(
    "Physical acceptance requires an exact device and expected model",
  );
if (doze && (!physical || process.env.HOSTED_FCM !== "1"))
  throw new Error("Doze acceptance requires physical FCM mode");
const state = path.join(
  root,
  physical ? ".local/physical-hosted-proof" : ".local/hosted-proof",
);
const fcm = process.env.HOSTED_FCM === "1";
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Android/Sdk");
const adbPath = path.join(sdk, "platform-tools/adb");
const port = 5594;
const serial = physical ?? `emulator-${port}`;
const appId = "dev.remoteaccess.host";
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_AVD_HOME: path.join(state, "avd"),
  ANDROID_EMULATOR_HOME: path.join(state, "emulator"),
};
const adb = (...args: string[]) =>
  execFileSync(adbPath, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: 20000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(
  work: () => T | Promise<T>,
  timeout = 120000,
): Promise<T> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try {
      const result = await work();
      if (result) return result;
    } catch {}
    await delay(400);
  }
  throw new Error("Hosted acceptance timed out; see private fixture logs");
}
async function unused(value: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(value, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
let previousActivity: string | undefined;
if (physical) {
  if (
    adb("shell", "getprop", "ro.kernel.qemu") === "1" ||
    adb("shell", "getprop", "ro.product.model") !== expectedModel ||
    adb("shell", "am", "get-current-user") !== "0"
  )
    throw new Error("Physical target identity/user mismatch");
  const keyguard = adb("shell", "dumpsys", "window", "policy").match(
    /KeyguardServiceDelegate[\s\S]*?\bshowing=(true|false)/,
  )?.[1];
  if (
    keyguard !== "false" ||
    !adb("shell", "dumpsys", "power").includes("mWakefulness=Awake")
  )
    throw new Error(
      "Unlock the selected physical phone locally before acceptance",
    );
  for (const pkg of [appId, `${appId}.test`]) {
    if (
      !adb("shell", "dumpsys", "package", pkg).includes(
        "Unable to find package",
      )
    )
      throw new Error("Refusing to replace an existing physical test package");
  }
  previousActivity = adb("shell", "dumpsys", "activity", "activities").match(
    /topResumedActivity=ActivityRecord\{[^}]* u0 ([A-Za-z0-9_.$]+\/[A-Za-z0-9_.$]+)/,
  )?.[1];
  const idle = adb("shell", "dumpsys", "deviceidle");
  const battery = adb("shell", "dumpsys", "battery");
  if (
    doze &&
    (!idle.includes("mForceIdle=false") ||
      !idle.includes("mState=ACTIVE") ||
      battery.includes("UPDATES STOPPED"))
  )
    throw new Error("Refusing to replace existing battery/idle overrides");
}
await mkdir(state, { recursive: true, mode: 0o700 });
let log: Awaited<ReturnType<typeof open>> | undefined;
let emulator: ReturnType<typeof spawn> | undefined;
if (!physical) {
  await mkdir(env.ANDROID_AVD_HOME, { recursive: true });
  await mkdir(env.ANDROID_EMULATOR_HOME, { recursive: true });
  if (
    execFileSync(adbPath, ["devices"], { encoding: "utf8" }).includes(
      `${serial}\t`,
    )
  )
    throw new Error("Refusing occupied emulator selector");
  await unused(port);
  await unused(port + 1);
  const avd = "remote-hosted-api35";
  if (!existsSync(path.join(env.ANDROID_AVD_HOME, `${avd}.ini`)))
    execFileSync(
      path.join(sdk, "cmdline-tools/latest/bin/avdmanager"),
      [
        "create",
        "avd",
        "--name",
        avd,
        "--package",
        `system-images;android-35;google_apis;${os.arch() === "arm64" ? "arm64-v8a" : "x86_64"}`,
        "--device",
        "pixel_7",
        "--path",
        path.join(env.ANDROID_AVD_HOME, `${avd}.avd`),
      ],
      { env, input: "no\n", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] },
    );
  log = await open(path.join(state, "emulator.log"), "w", 0o600);
  emulator = spawn(
    path.join(sdk, "emulator/emulator"),
    [
      "-avd",
      avd,
      "-port",
      String(port),
      "-no-window",
      "-no-audio",
      "-no-snapshot",
      "-gpu",
      "swiftshader",
      "-no-boot-anim",
    ],
    { env, stdio: ["ignore", log.fd, log.fd] },
  );
}
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let instrument: ReturnType<typeof spawn> | undefined;
const logs: Awaited<ReturnType<typeof open>>[] = [];
const privateWrite = (file: string, value: string) => {
  if (!/^[a-z-]+$/.test(file)) throw new Error("Invalid fixture filename");
  return execFileSync(
    adbPath,
    ["-s", serial, "shell", `run-as ${appId} sh -c 'cat > files/${file}'`],
    { input: value, timeout: 10000, stdio: ["pipe", "pipe", "pipe"] },
  );
};
const installed: string[] = [];
let idleChanged = false;
let batteryChanged = false;
let displayChanged = false;
let invitationId: string | undefined;
let revoked = false;
try {
  await until(() => adb("shell", "getprop", "sys.boot_completed") === "1");
  if (!physical && adb("shell", "getprop", "ro.kernel.qemu") !== "1")
    throw new Error("Refusing non-emulator");
  for (const [pkg, apk] of [
    [appId, "debug/app-debug.apk"],
    [`${appId}.test`, "androidTest/debug/app-debug-androidTest.apk"],
  ] as const) {
    adb(
      "install",
      "--user",
      "0",
      "-r",
      path.join(root, "android/app/build/outputs/apk", apk),
    );
    installed.push(pkg);
  }
  // Physical mode only installs absent packages and never clears existing data.
  if (!physical) adb("shell", "pm", "clear", appId);
  if (fcm && !physical)
    adb("shell", "pm", "grant", appId, "android.permission.POST_NOTIFICATIONS");
  adb("shell", "run-as", appId, "mkdir", "-p", "files");
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 3,
  });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByRole("button", { name: "Create pairing code" }).click();
  const qr = page.getByRole("img", { name: "Scan to pair this browser" });
  await qr.waitFor();
  const image = await qr.screenshot({ path: path.join(state, "qr.png") });
  const png = PNG.sync.read(image);
  const decoded = jsQR(new Uint8ClampedArray(png.data), png.width, png.height);
  if (!decoded) throw new Error("Rendered QR did not decode");
  const invitation = decodeInvitation(decoded.data);
  invitationId = invitation.id;
  if (invitation.origin !== origin) throw new Error("Wrong origin in QR");
  privateWrite("hosted-pair-uri", decoded.data);
  async function runNative(label: string) {
    adb(
      "shell",
      "run-as",
      appId,
      "rm",
      "-f",
      "files/hosted-stage",
      "files/hosted-command",
    );
    const logFile = await open(path.join(state, `${label}.log`), "w", 0o600);
    logs.push(logFile);
    instrument = spawn(
      adbPath,
      [
        "-s",
        serial,
        "shell",
        "am",
        "instrument",
        "-w",
        "-e",
        "class",
        "dev.remoteaccess.app.HostedPairingTest#pairOrReconnectAndRevoke",
        `${appId}.test/androidx.test.runner.AndroidJUnitRunner`,
      ],
      { stdio: ["ignore", logFile.fd, logFile.fd] },
    );
    const deadline = Date.now() + 120000;
    let connected = false;
    while (Date.now() < deadline) {
      if (instrument.exitCode !== null)
        throw new Error(
          "Native fixture exited before connection; see private log",
        );
      try {
        connected =
          adb("shell", "run-as", appId, "cat", "files/hosted-stage") ===
          "connected";
      } catch {}
      if (connected) break;
      await delay(400);
    }
    if (!connected)
      throw new Error("Native fixture did not connect; see private log");
  }
  async function finishNative(label: string, action: string) {
    privateWrite("hosted-command", action);
    await until(() => instrument?.exitCode !== null, fcm ? 90000 : 30000);
    const nativeLog = await readFile(path.join(state, `${label}.log`), "utf8");
    if (!nativeLog.includes("OK (1 test)") || nativeLog.includes("FAILURES!!!"))
      throw new Error("Native acceptance failed; see private log");
  }
  async function check() {
    await page
      .getByRole("button", { name: "Check encrypted connection" })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "Encrypted connection passed." })
      .waitFor({ timeout: fcm ? 80000 : 30000 });
  }
  await runNative("pair");
  await check();
  await finishNative("pair", fcm ? "wake" : "finish");
  const readCheckpoints = () => {
    const settings = adb(
      "shell",
      "run-as",
      appId,
      "cat",
      "shared_prefs/paired-browser-v1.xml",
    );
    const timestamp = (key: string) =>
      Number(
        settings.match(
          new RegExp(`<long name="${key}" value="([0-9]+)"`),
        )?.[1] ?? 0,
      );
    return {
      receipt: timestamp("lastPushReceipt"),
      exchange: timestamp("lastWakeExchange"),
    };
  };
  async function wakeCheck() {
    // Process reclamation, not force-stop: Firebase must be allowed to restart it.
    await until(() => {
      adb("shell", "am", "kill", "--user", "current", appId);
      // A disconnected ADB target must never count as an absent process.
      return (
        adb(
          "shell",
          `if pidof ${appId} >/dev/null; then echo present; else echo absent; fi`,
        ) === "absent"
      );
    }, 20000);
    await page.reload();
    const before = readCheckpoints();
    const clockStart = Date.now();
    const phoneTime = Number(adb("shell", "date", "+%s%3N"));
    const clockEnd = Date.now();
    if (!Number.isSafeInteger(phoneTime) || phoneTime <= 0)
      throw new Error("Invalid device clock");
    const clockOffset = phoneTime - (clockStart + clockEnd) / 2;
    const requestedAt = Date.now() + clockOffset;
    await check();
    const checkpoints = await until(() => {
      const current = readCheckpoints();
      return current.receipt > before.receipt &&
        current.exchange > before.exchange &&
        current.exchange >= current.receipt
        ? current
        : undefined;
    }, 10000);
    if (!checkpoints) throw new Error("Missing fresh native FCM checkpoints");
    return {
      processAbsentBeforeWake: true,
      noApplicationSocketBeforeWake: true,
      firebaseReceived: true,
      nativeEncryptedExchange: true,
      requestToReceiptMs: Math.round(checkpoints.receipt - requestedAt),
      requestToExchangeMs: Math.round(checkpoints.exchange - requestedAt),
      clockEstimateUncertaintyMs: Math.ceil((clockEnd - clockStart) / 2),
    };
  }
  let wakeEvidence = {};
  if (fcm) {
    if (
      adb("shell", "run-as", appId, "cat", "files/hosted-stage") !==
      "wake-ready"
    )
      throw new Error("Native FCM opt-in did not complete");
    wakeEvidence = await wakeCheck();
    console.log("Background FCM wake passed");
  }
  // A fresh Android process and a page reload must retain exact paired identities.
  adb("shell", "am", "force-stop", appId);
  await page.reload();
  await runNative("reconnect");
  await check();
  await finishNative("reconnect", doze ? "wake" : "revoke");
  let dozeEvidence = {};
  if (doze) {
    batteryChanged = true;
    adb("shell", "dumpsys", "battery", "unplug");
    displayChanged = true;
    adb("shell", "input", "keyevent", "KEYCODE_SLEEP");
    idleChanged = true;
    adb("shell", "dumpsys", "deviceidle", "force-idle");
    if (adb("shell", "dumpsys", "deviceidle", "get", "deep") !== "IDLE")
      throw new Error("Phone did not enter deep idle");
    console.log(
      "Deep IDLE verified; allowing push cooldown with no ADB polling",
    );
    await delay(31000);
    if (adb("shell", "dumpsys", "deviceidle", "get", "deep") !== "IDLE")
      throw new Error("Phone left deep idle before wake request");
    const screenOff = /mWakefulness=(Asleep|Dozing)\b/.test(
      adb("shell", "dumpsys", "power"),
    );
    const exempt = adb("shell", "dumpsys", "deviceidle", "whitelist")
      .split("\n")
      .some((line) => line.split(",").includes(appId));
    if (!screenOff || exempt)
      throw new Error(
        "Doze test requires screen off and no host battery exemption",
      );
    dozeEvidence = {
      forcedDeepIdleBeforeWake: true,
      screenOffBeforeWake: true,
      hostBatteryExempt: false,
      dozeWake: await wakeCheck(),
    };
    console.log("Forced-Doze FCM wake passed");
    adb("shell", "dumpsys", "deviceidle", "unforce");
    idleChanged = false;
    adb("shell", "dumpsys", "battery", "reset");
    batteryChanged = false;
    // Cleanup uses the owned fixture's native signing key; no unlock/PIN is needed.
    const result = adb(
      "shell",
      "am",
      "instrument",
      "-w",
      "-e",
      "class",
      "dev.remoteaccess.app.HostedPairingTest#revokeFixture",
      `${appId}.test/androidx.test.runner.AndroidJUnitRunner`,
    );
    if (!result.includes("OK (1 test)"))
      throw new Error("Locked fixture revocation failed");
  }
  const response = await fetch(`${origin}/api/pair/${invitation.id}`);
  if (response.status !== 410)
    throw new Error("Revocation not durable at relay");
  revoked = true;
  await page
    .getByRole("button", { name: "Check encrypted connection" })
    .click();
  await page
    .getByRole("status")
    .filter({ hasText: "Phone is unavailable" })
    .waitFor({ timeout: 30000 });
  const report = {
    renderedQrDecoded: true,
    normalGrantUI: true,
    encryptedExchanges: doze ? 4 : fcm ? 3 : 2,
    physicalDevice: Boolean(physical),
    ...wakeEvidence,
    ...dozeEvidence,
    persistedAfterAndroidProcessRestart: true,
    persistedAfterBrowserReload: true,
    revoked: true,
    rejectedAfterRevocation: true,
    publicHttpsWss: true,
    androidApi: Number(adb("shell", "getprop", "ro.build.version.sdk")),
  };
  await writeFile(
    path.join(state, "result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  if (invitationId && !revoked)
    console.error(
      "Acceptance did not reach revocation; retain the disposable fixture for cleanup.",
    );
  const cleanupErrors: unknown[] = [];
  async function cleanup(
    label: string,
    action: () => unknown | Promise<unknown>,
  ) {
    try {
      await action();
    } catch (error) {
      cleanupErrors.push(error);
      console.error(
        `Cleanup failed: ${label}; preserve private evidence for repair`,
      );
    }
  }
  // Attempt every restoration even if an earlier cleanup operation fails.
  if (idleChanged)
    await cleanup("idle override", () =>
      adb("shell", "dumpsys", "deviceidle", "unforce"),
    );
  if (batteryChanged)
    await cleanup("battery override", () =>
      adb("shell", "dumpsys", "battery", "reset"),
    );
  if (displayChanged)
    await cleanup("display wake", () =>
      adb("shell", "input", "keyevent", "KEYCODE_WAKEUP"),
    );
  await cleanup("browser", () => browser?.close());
  if (instrument && instrument.exitCode === null) {
    await cleanup("owned instrumentation", () => {
      try {
        adb("shell", "am", "force-stop", appId);
      } finally {
        instrument?.kill("SIGTERM");
      }
    });
  }
  if (emulator && emulator.exitCode === null) {
    emulator.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => emulator?.once("exit", resolve)),
      delay(10000),
    ]);
    if (emulator.exitCode === null) emulator.kill("SIGKILL");
  }
  for (const handle of logs) await cleanup("native log", () => handle.close());
  await cleanup("emulator log", () => log?.close());
  if (physical && (!invitationId || revoked)) {
    for (const pkg of installed.reverse())
      await cleanup("owned package", () => {
        adb("uninstall", pkg);
        if (
          !adb("shell", "dumpsys", "package", pkg).includes(
            "Unable to find package",
          )
        )
          throw new Error("Owned test package remains installed");
      });
  }
  if (physical && previousActivity)
    await cleanup("previous task", () =>
      adb("shell", "am", "start", "--user", "0", "-n", previousActivity),
    );
  if (cleanupErrors.length) process.exitCode = 1;
  if (physical && revoked && !cleanupErrors.length)
    console.log(
      "Owned test packages removed; previous task requested (normal keyguard may remain)",
    );
}
