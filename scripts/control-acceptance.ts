/** Independent browser -> public relay -> native Android effects, on an owned emulator. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Browser } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";

type Fixture = {
  browser: Browser;
  origin: string;
  state: string;
  adbPath: string;
  serial: string;
  adb: (...args: string[]) => string;
  privateWrite: (file: string, value: string) => unknown;
};
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
export async function controlAcceptance(f: Fixture) {
  const app = "dev.remoteaccess.host";
  const { adb, privateWrite } = f;
  if (adb("shell", "getprop", "ro.kernel.qemu") !== "1")
    throw new Error("Control acceptance requires its owned emulator");
  const log = await open(path.join(f.state, "control-native.log"), "w", 0o600);
  const context = await f.browser.newContext({
    viewport: { width: 1280, height: 1000 },
    deviceScaleFactor: 1,
  });
  await context.addInitScript(() => {
    const counts = window as unknown as {
      __videoFrames: number;
      __videoBytes: number;
    };
    counts.__videoFrames = 0;
    CanvasRenderingContext2D.prototype.drawImage = new Proxy(
      CanvasRenderingContext2D.prototype.drawImage,
      {
        apply(target, self, args) {
          if (
            typeof VideoFrame !== "undefined" &&
            args[0] instanceof VideoFrame
          )
            counts.__videoFrames++;
          return Reflect.apply(target, self, args);
        },
      },
    );
  });
  const page = await context.newPage();
  const traffic = await context.newCDPSession(page);
  await traffic.send("Network.enable");
  let receivedBytes = 0;
  traffic.on("Network.webSocketFrameReceived", ({ response }) => {
    if (response.opcode === 2)
      receivedBytes += Buffer.from(response.payloadData, "base64").length;
  });
  let videoMeasurement:
    | { seconds: number; receivedBytes: number; decodedFrames: number }
    | undefined;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  let native: ReturnType<typeof spawn> | undefined;
  let syntheticLock = false;
  async function until<T>(
    work: () => T | Promise<T>,
    timeout = 60000,
  ): Promise<NonNullable<T>> {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      try {
        const result = await work();
        if (result) return result as NonNullable<T>;
      } catch (error) {
        if (error instanceof assert.AssertionError) throw error;
      }
      if (native && native.exitCode !== null)
        throw new Error("Native fixture exited; see private log");
      await delay(250);
    }
    throw new Error("Control acceptance timed out");
  }
  async function command(action: string, extra: Record<string, unknown> = {}) {
    adb("shell", "run-as", app, "rm", "-f", "files/hosted-stage");
    console.log(`Native step: ${action}`);
    privateWrite("hosted-command", JSON.stringify({ action, ...extra }));
    return until(() => {
      const raw = adb("shell", "run-as", app, "cat", "files/hosted-stage");
      if (action === "stop" && raw === "stopped") return true;
      const value = JSON.parse(raw) as {
        action: string;
        browsers: { id: string }[];
      };
      return value.action === action ? value : undefined;
    });
  }
  const witness = () =>
    JSON.parse(
      adb(
        "shell",
        "run-as",
        `${app}.test`,
        "cat",
        "files/control-witness.json",
      ),
    ) as {
      taps: number;
      text: string;
      scroll: number;
      target: { x: number; y: number };
      field: { x: number; y: number };
      slider: { x: number; y: number };
      sliderProgress: number;
      sliderHeld: boolean;
      longPresses: number;
      multi: { x: number; y: number };
      maxPointers: number;
      multiMoves: number;
      distanceChange: number;
      angleChange: number;
    };
  try {
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
    await until(
      () =>
        adb("shell", "run-as", app, "cat", "files/hosted-stage") === "ready",
    );
    await page.goto(f.origin);
    await page.getByRole("button", { name: "Create pairing code" }).click();
    const qr = PNG.sync.read(
      await page
        .getByRole("img", { name: "Scan to pair this browser" })
        .screenshot(),
    );
    const decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
    assert.ok(decoded);
    privateWrite("hosted-pair-uri", decoded.data);
    const paired = await command("pair");
    assert.ok(typeof paired !== "boolean");
    const id = paired.browsers[0]?.id;
    assert.ok(id);
    const service = `${app}/dev.remoteaccess.app.control.ScreenAccessService`;
    const others = adb(
      "shell",
      "settings",
      "get",
      "secure",
      "enabled_accessibility_services",
    )
      .split(":")
      .filter((v) => v !== "null" && v && !v.startsWith(`${app}/`));
    adb(
      "shell",
      "settings",
      "put",
      "secure",
      "enabled_accessibility_services",
      others.join(":") || "null",
    );
    adb(
      "shell",
      "settings",
      "put",
      "secure",
      "enabled_accessibility_services",
      [...others, service].join(":"),
    );
    adb("shell", "settings", "put", "secure", "accessibility_enabled", "1");
    if (process.env.HOSTED_UNLOCK === "1") {
      await command("save-fixture-pin");
      await command("allow-unlock", { id, enabled: true });
      // This credential belongs only to the runner's disposable emulator.
      await writeFile(
        path.join(f.state, "synthetic-lock"),
        "owned-emulator-fixture\n",
        { mode: 0o600 },
      );
      const result = adb("shell", "locksettings", "set-pin", "314159");
      assert.match(result, /Pin set/);
      syntheticLock = true;
    }
    await command("control-ready", { id });
    await page.getByRole("button", { name: "Connect to phone" }).click();
    await page
      .getByRole("region", { name: "Remote screen" })
      .waitFor({ timeout: 80000 });
    const canvas = page.getByLabel("Phone screen");
    await until(() =>
      canvas.evaluate((c) => c instanceof HTMLCanvasElement && c.width > 500),
    );
    if (process.env.HOSTED_UNLOCK === "1") {
      await page
        .getByRole("button", { name: "Lock phone", exact: true })
        .click();
      await page
        .getByLabel("Phone PIN", { exact: true })
        .waitFor({ timeout: 15000 });
      page.once("dialog", (dialog) => void dialog.accept());
      await page
        .getByRole("button", { name: "Use saved PIN", exact: true })
        .click();
      await until(
        () =>
          adb("shell", "dumpsys", "window", "policy").match(
            /KeyguardServiceDelegate[\s\S]*?\bshowing=false/,
          ),
        20000,
      );
      await page
        .getByLabel("Phone PIN", { exact: true })
        .waitFor({ state: "hidden", timeout: 20000 });
      await page
        .getByRole("button", { name: "Lock phone", exact: true })
        .click();
      await page.getByLabel("Phone PIN", { exact: true }).fill("314159");
      await page
        .getByRole("button", { name: "Unlock phone", exact: true })
        .click();
      await until(
        () =>
          adb("shell", "dumpsys", "window", "policy").match(
            /KeyguardServiceDelegate[\s\S]*?\bshowing=false/,
          ),
        20000,
      );
      await page
        .getByLabel("Phone PIN", { exact: true })
        .waitFor({ state: "hidden", timeout: 20000 });
      console.log(
        "Saved and manual PIN unlock passed on the synthetic emulator lock",
      );
    }
    await command("control-fixture");
    await until(() => witness().taps === 0);
    if (process.env.HOSTED_VIDEO === "1") {
      await page.getByText("Viewing quality", { exact: true }).click();
      await page
        .getByLabel("Viewing quality", { exact: true })
        .selectOption("2");
      await command("approve-video");
      // Return from the consent activity to an independent animated native view.
      await command("control-fixture");
      await until(
        () =>
          page.evaluate(
            () =>
              (window as unknown as { __videoFrames: number }).__videoFrames >
              15,
          ),
        20000,
      );
      console.log("H264 frames decoded from the encrypted hosted relay");
      await page
        .getByLabel("Viewing quality", { exact: true })
        .selectOption("1");
      const before = await page.evaluate(
        () => (window as unknown as { __videoFrames: number }).__videoFrames,
      );
      await until(
        async () =>
          (await page.evaluate(
            () =>
              (window as unknown as { __videoFrames: number }).__videoFrames,
          )) >
          before + 10,
        20000,
      );
      console.log("Live video quality change recovered with fresh keyframes");
      const begin = Date.now(),
        bytesBefore = receivedBytes;
      const framesBefore = await page.evaluate(
        () => (window as unknown as { __videoFrames: number }).__videoFrames,
      );
      await delay(5000);
      videoMeasurement = {
        seconds: (Date.now() - begin) / 1000,
        receivedBytes: receivedBytes - bytesBefore,
        decodedFrames:
          (await page.evaluate(
            () =>
              (window as unknown as { __videoFrames: number }).__videoFrames,
          )) - framesBefore,
      };
      assert.ok(
        videoMeasurement.decodedFrames >= 10,
        "Video must continue decoding during the measurement",
      );
      console.log(`Measured video: ${JSON.stringify(videoMeasurement)}`);
    }
    await delay(1500);
    async function at(p: { x: number; y: number }) {
      await canvas.scrollIntoViewIfNeeded();
      const rect = await canvas.boundingBox();
      assert.ok(rect);
      const size = await canvas.evaluate((c) => ({
        width: (c as HTMLCanvasElement).width,
        height: (c as HTMLCanvasElement).height,
      }));
      return {
        x: rect.x + (p.x * rect.width) / size.width,
        y: rect.y + (p.y * rect.height) / size.height,
      };
    }
    const target = await at(witness().target);
    await page.mouse.click(target.x, target.y);
    await until(() => witness().taps === 1);
    const field = await at(witness().field);
    await delay(800);
    await page.mouse.click(field.x, field.y);
    await page.getByText("Type or open an app", { exact: true }).click();
    await page
      .getByLabel("Text for the focused field")
      .fill("Relay 🌞 verified");
    await page.getByRole("button", { name: "Send text" }).click();
    await until(() => witness().text === "Relay 🌞 verified");
    await page.getByRole("button", { name: "Back", exact: true }).click(); // dismiss native keyboard
    await delay(1000);
    if (process.env.HOSTED_TOUCH === "1") {
      const hold = await at(witness().target);
      await page.mouse.move(hold.x, hold.y);
      await page.mouse.down();
      await until(() => witness().longPresses === 1, 5000);
      await page.mouse.up();
      await delay(1000);
      assert.equal(
        witness().taps,
        1,
        "Long press must not turn into a second tap",
      );
      const slider = witness().slider;
      const begin = await at({ x: 100, y: slider.y }),
        end = await at({ x: 900, y: slider.y });
      await page.mouse.move(begin.x, begin.y);
      await page.mouse.down();
      await page.mouse.move(end.x, end.y, { steps: 12 });
      await until(
        () => witness().sliderProgress > 650 && witness().sliderHeld,
        5000,
      );
      await page.mouse.up();
      await until(() => !witness().sliderHeld, 3000);
      console.log("Held native slider and long press passed");
      await delay(1000);
      const middle = witness().multi;
      const cdp = await context.newCDPSession(page);
      const points = async (spread: number, angle: number) => {
        const a = await at({
          x: middle.x - spread * Math.cos(angle),
          y: middle.y - spread * Math.sin(angle),
        });
        const b = await at({
          x: middle.x + spread * Math.cos(angle),
          y: middle.y + spread * Math.sin(angle),
        });
        return [
          { id: 1, ...a },
          { id: 2, ...b },
        ];
      };
      try {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: await points(60, 0),
        });
        for (let n = 1; n <= 12; n++) {
          await cdp.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: await points(60 + n * 8, n * 0.05),
          });
          await delay(60);
        }
        await until(
          () =>
            witness().maxPointers === 2 &&
            witness().multiMoves > 2 &&
            witness().distanceChange > 100 &&
            Math.abs(witness().angleChange) > 0.3,
          5000,
        );
      } finally {
        await cdp.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await cdp.detach();
      }
      console.log("Two-finger pinch and rotation reached native input");
      await delay(1000);
    }
    const size = await canvas.evaluate((c) => ({
      width: (c as HTMLCanvasElement).width,
      height: (c as HTMLCanvasElement).height,
    }));
    const start = await at({
      x: Math.floor(size.width / 2),
      y: Math.floor(size.height * 0.75),
    });
    const end = await at({
      x: Math.floor(size.width / 2),
      y: Math.floor(size.height * 0.4),
    });
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
    await until(() => witness().scroll > 100);
    await page.screenshot({ path: path.join(f.state, "remote-control.png") });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await until(
      () =>
        !adb("shell", "dumpsys", "activity", "activities").match(
          /topResumedActivity=.*ControlFixtureActivity/,
        ),
    );
    await page.getByRole("button", { name: "Choose an app" }).click();
    await page
      .getByRole("combobox", { name: "Open app" })
      .selectOption("com.android.settings");
    await until(() =>
      adb("shell", "dumpsys", "activity", "activities").match(
        /topResumedActivity=.*com.android.settings/,
      ),
    );
    if (process.env.HOSTED_TOUCH === "1") {
      await command("control-fixture");
      await delay(1200);
      const slider = await at(witness().slider);
      await page.mouse.move(slider.x, slider.y);
      await page.mouse.down();
      await page.mouse.move(slider.x + 35, slider.y, { steps: 3 });
      await until(() => witness().sliderHeld, 3000);
      const debug = await context.newCDPSession(page);
      await debug.send("Debugger.enable");
      await debug.send("Debugger.pause");
      try {
        await until(() => !witness().sliderHeld, 3000);
      } finally {
        await debug.send("Debugger.resume");
        await debug.detach();
      }
      await page.mouse.up();
      await delay(1000);
      console.log("Native lost-packet watchdog released held input");
    }
    if (process.env.HOSTED_UNLOCK === "1") {
      await page
        .getByRole("button", { name: "Lock phone", exact: true })
        .click();
      await page.getByLabel("Phone PIN", { exact: true }).fill("314158");
      await page
        .getByRole("button", { name: "Unlock phone", exact: true })
        .click();
      await page
        .getByText("Unlock was already attempted.", { exact: false })
        .waitFor({ timeout: 20000 });
      assert.equal(
        await page
          .getByRole("button", { name: "Unlock phone", exact: true })
          .isDisabled(),
        true,
      );
      assert.equal(
        await page
          .getByRole("button", { name: "Use saved PIN", exact: true })
          .count(),
        0,
      );
      await command("assert-unlock-blocked");
      console.log(
        "Wrong synthetic PIN latched local recovery and forgot the saved PIN",
      );
      assert.match(
        adb("shell", "locksettings", "clear", "--old", "314159"),
        /Lock credential cleared/,
      );
      syntheticLock = false;
      await rm(path.join(f.state, "synthetic-lock"), { force: true });
      adb("shell", "input", "keyevent", "KEYCODE_SLEEP");
      adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      adb("shell", "input", "keyevent", "KEYCODE_BACK");
      adb("shell", "wm", "dismiss-keyguard");
      await until(
        () =>
          adb("shell", "dumpsys", "window", "policy").match(
            /KeyguardServiceDelegate[\s\S]*?\bshowing=false/,
          ),
        10000,
      );
    }
    await command("global", { enabled: false });
    await page
      .getByRole("region", { name: "Remote screen" })
      .getByRole("status")
      .filter({ hasText: /Connection ended/ })
      .waitFor({ timeout: 20000 });
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await command("enable", { id, enabled: false });
    await command("remove", { id });
    await command("stop");
    await new Promise<void>((resolve) => {
      if (native?.exitCode !== null) resolve();
      else native.once("exit", () => resolve());
    });
    assert.match(
      await readFile(path.join(f.state, "control-native.log"), "utf8"),
      /OK \(1 test\)/,
    );
    assert.deepEqual(errors, []);
    await writeFile(
      path.join(f.state, "result.json"),
      `${JSON.stringify(
        {
          hostedEncryptedScreen: true,
          nativeTap: true,
          nativeUnicodeText: true,
          nativeSwipe: true,
          heldTouch: process.env.HOSTED_TOUCH === "1",
          videoMeasurement,
          smoothVideo: process.env.HOSTED_VIDEO === "1",
          savedAndManualPin: process.env.HOSTED_UNLOCK === "1",
          navigation: true,
          appLaunch: true,
          globalDisarmClosesSession: true,
          revoked: true,
          pageErrors: errors,
        },
        null,
        2,
      )}\n`,
      { mode: 0o600 },
    );
    console.log("Hosted control effects passed");
  } finally {
    if (native?.exitCode === null && syntheticLock) {
      await command("inspect-lock").catch(() => {});
      try {
        await writeFile(
          path.join(f.state, "lock-hierarchy.xml"),
          adb("shell", "run-as", app, "cat", "files/lock-hierarchy.xml"),
          { mode: 0o600 },
        );
      } catch {}
    }
    if (syntheticLock) {
      try {
        await writeFile(
          path.join(f.state, "service-nodes.txt"),
          adb("shell", "run-as", app, "cat", "files/service-nodes.txt"),
          { mode: 0o600 },
        );
      } catch {}
    }
    await page
      .screenshot({ path: path.join(f.state, "last-browser.png") })
      .catch(() => {});
    try {
      await writeFile(
        path.join(f.state, "last-native.txt"),
        adb("logcat", "-d", "-t", "2500"),
        { mode: 0o600 },
      );
    } catch {}
    try {
      await writeFile(
        path.join(f.state, "last-phone.png"),
        execFileSync(
          f.adbPath,
          ["-s", f.serial, "exec-out", "screencap", "-p"],
          { timeout: 10000, maxBuffer: 10000000 },
        ),
      );
    } catch {}
    await traffic.detach().catch(() => {});
    await context.close();
    if (native?.exitCode === null) {
      adb("shell", "am", "force-stop", app);
      native.kill("SIGTERM");
    }
    if (syntheticLock) {
      assert.match(
        adb("shell", "locksettings", "clear", "--old", "314159"),
        /Lock credential cleared/,
      );
      adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
      adb("shell", "wm", "dismiss-keyguard");
      await rm(path.join(f.state, "synthetic-lock"), { force: true });
    }
    await log.close();
  }
}
