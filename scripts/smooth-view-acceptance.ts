/** Capture lifecycle regressions on a fresh, runner-owned emulator. No relay or physical phone. */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { smoothViewBrowser } from "./smooth-view-browser.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const api = Number(process.env.ANDROID_TEST_API || 35);
assert.ok(api === 35 || api === 36, "Choose installed API 35 or 36 image");
const state = path.join(root, `.local/smooth-view-proof/api${api}`);
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Android/Sdk");
const adbPath = path.join(sdk, "platform-tools/adb");
const port = api === 35 ? 5610 : 5612;
const serial = `emulator-${port}`;
const app = "com.yepcontrol.app";
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
    maxBuffer: 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check: () => boolean, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try {
      if (check()) return;
    } catch {}
    await delay(200);
  }
  throw Error("Smooth-view acceptance timed out; see private evidence");
}
async function unused(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
assert.ok(
  !execFileSync(adbPath, ["devices"], { encoding: "utf8" }).includes(
    `${serial}\t`,
  ),
  "Refusing occupied emulator selector",
);
await unused(port);
await unused(port + 1);
await mkdir(env.ANDROID_AVD_HOME, { recursive: true, mode: 0o700 });
await mkdir(env.ANDROID_EMULATOR_HOME, { recursive: true, mode: 0o700 });
const avd = `smooth-view-api${api}`;
if (!existsSync(path.join(env.ANDROID_AVD_HOME, `${avd}.ini`)))
  execFileSync(
    path.join(sdk, "cmdline-tools/latest/bin/avdmanager"),
    [
      "create",
      "avd",
      "--name",
      avd,
      "--package",
      `system-images;android-${api};google_apis;${os.arch() === "arm64" ? "arm64-v8a" : "x86_64"}`,
      "--device",
      "pixel_7",
      "--path",
      path.join(env.ANDROID_AVD_HOME, `${avd}.avd`),
    ],
    { env, input: "no\n", timeout: 60000, stdio: ["pipe", "pipe", "pipe"] },
  );
const log = await open(path.join(state, "emulator.log"), "w", 0o600);
const emulator = spawn(
  path.join(sdk, "emulator/emulator"),
  [
    "-avd",
    avd,
    "-port",
    String(port),
    "-no-window",
    "-no-audio",
    "-no-snapshot",
    "-no-boot-anim",
    "-gpu",
    "swiftshader",
  ],
  { env, stdio: ["ignore", log.fd, log.fd] },
);
const scenarios = (
  process.env.SMOOTH_SCENARIOS ||
  [
    "cancel",
    "back",
    "pending-off",
    "rapid-toggle",
    "stale-service",
    "rotation",
    "recreate",
    "timeout",
    "active",
    "owner",
    "policy",
    "owner-active",
    "policy-active",
    "lock",
    "lock-pending",
    "permission",
    "permission-pending",
    "system-stop",
    "remote-consent",
    "kill-pending",
    "kill-active",
    "browser",
    "cancel",
  ].join(",")
).split(",");
const results: unknown[] = [];
let instrument: ReturnType<typeof spawn> | undefined;
try {
  await until(() => {
    assert.equal(emulator.exitCode, null, "Owned emulator exited");
    return adb("shell", "getprop", "sys.boot_completed") === "1";
  }, 120000);
  assert.equal(adb("shell", "getprop", "ro.kernel.qemu"), "1");
  adb("shell", "input", "keyevent", "KEYCODE_WAKEUP");
  adb("shell", "wm", "dismiss-keyguard");
  for (const apk of [
    "debug/app-debug.apk",
    "androidTest/debug/app-debug-androidTest.apk",
  ])
    adb(
      "install",
      "-r",
      "-t",
      path.join(root, "android/app/build/outputs/apk", apk),
    );
  adb("shell", "pm", "grant", app, "android.permission.POST_NOTIFICATIONS");
  try {
    if (
      adb("shell", "run-as", app, "cat", "files/smooth-view-synthetic-lock") ===
      "owned-emulator"
    ) {
      assert.match(
        adb("shell", "locksettings", "clear", "--old", "314159"),
        /cleared/,
      );
      adb(
        "shell",
        "run-as",
        app,
        "rm",
        "-f",
        "files/smooth-view-synthetic-lock",
      );
      adb("shell", "wm", "dismiss-keyguard");
    }
  } catch (error) {
    // A missing marker is the ordinary fresh-fixture state; never clear an unmarked credential.
    if (!(error instanceof Error && error.message.includes("No such file")))
      throw error;
  }

  for (const [index, scenario] of scenarios.entries()) {
    console.log(`API ${api}: ${scenario}`);
    adb("shell", "am", "force-stop", app);
    adb(
      "shell",
      "am",
      "start",
      "-W",
      "-n",
      `${app}/dev.remoteaccess.app.MainActivity`,
    );
    adb("shell", "run-as", app, "rm", "-f", "files/smooth-view-result.json");
    const output = await open(
      path.join(state, `${index}-${scenario}.log`),
      "w",
      0o600,
    );
    try {
      // Every case owns a fresh target process. Default instrumentation startup also
      // clears the SDK's stale attachment after an intentionally killed test run.
      instrument = spawn(
        adbPath,
        [
          "-s",
          serial,
          "shell",
          "am",
          "instrument",
          "-w",
          "-r",
          "-e",
          "class",
          "dev.remoteaccess.app.SmoothViewLifecycleTest",
          "-e",
          "scenario",
          scenario,
          `${app}.test/androidx.test.runner.AndroidJUnitRunner`,
        ],
        { stdio: ["ignore", output.fd, output.fd] },
      );
      const completion = new Promise<number | null>((resolve, reject) => {
        instrument?.once("exit", resolve);
        instrument?.once("error", reject);
      });
      if (scenario === "browser") {
        await until(
          () =>
            JSON.parse(
              adb(
                "shell",
                "run-as",
                app,
                "cat",
                "files/smooth-view-result.json",
              ),
            ).stage === "browser-ready",
        );
        let id = 0;
        let pending: Promise<unknown> = Promise.resolve();
        const exchange = (request: { action?: string; payload?: string }) => {
          const work = pending.then(async () => {
            const key = ++id;
            execFileSync(
              adbPath,
              [
                "-s",
                serial,
                "shell",
                `run-as ${app} sh -c 'cat > files/smooth-view-command.next && mv files/smooth-view-command.next files/smooth-view-command'`,
              ],
              {
                input: JSON.stringify({ ...request, id: key }),
                timeout: 10000,
                stdio: ["pipe", "pipe", "pipe"],
              },
            );
            if (request.action === "finish") return {};
            let reply:
              | {
                  id: number;
                  payload?: string;
                  video?: { phase: string };
                  prompt?: boolean;
                }
              | undefined;
            await until(() => {
              reply = JSON.parse(
                adb("shell", "run-as", app, "cat", "files/smooth-view-reply"),
              );
              return reply?.id === key;
            });
            assert.ok(reply);
            return reply;
          });
          pending = work.catch(() => {});
          return work;
        };
        await smoothViewBrowser(root, state, exchange);
        await exchange({ action: "finish" });
      }
      if (scenario.startsWith("kill-")) {
        await until(
          () =>
            JSON.parse(
              adb(
                "shell",
                "run-as",
                app,
                "cat",
                "files/smooth-view-result.json",
              ),
            ).stage === "ready-for-kill",
        );
        const before = adb("shell", "dumpsys", "media_projection");
        assert.equal(
          before.includes("TYPE_SCREEN_CAPTURE"),
          scenario === "kill-active",
        );
        adb("shell", "am", "force-stop", app);
        await until(
          () =>
            !adb("shell", "dumpsys", "media_projection").includes(
              "TYPE_SCREEN_CAPTURE",
            ),
        );
      }
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          completion,
          new Promise<never>((_, reject) => {
            timeout = setTimeout(
              () => reject(Error("Native scenario timed out")),
              100000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
      if (!scenario.startsWith("kill-")) {
        assert.match(
          await readFile(path.join(state, `${index}-${scenario}.log`), "utf8"),
          /OK \(1 test\)/,
          "Native regression failed; see private log",
        );
      }
      const result = JSON.parse(
        adb("shell", "run-as", app, "cat", "files/smooth-view-result.json"),
      ) as { stage: string; skipped: boolean };
      assert.equal(
        result.stage,
        scenario.startsWith("kill-") ? "ready-for-kill" : "complete",
      );
      results.push({ scenario, ...result });
      await writeFile(
        path.join(state, `${scenario}-result.json`),
        JSON.stringify({ scenario, ...result }),
        { mode: 0o600 },
      );
      await writeFile(
        path.join(state, "result.json"),
        JSON.stringify(results, null, 2),
        { mode: 0o600 },
      );
    } finally {
      instrument?.kill();
      instrument = undefined;
      await output.close();
    }
  }
  console.log(
    `API ${api}: ${results.length} lifecycle scenarios passed (unavailable system UI is recorded as skipped)`,
  );
} finally {
  instrument?.kill();
  for (const file of ["smooth-view-failure.png", "smooth-view-failure.xml"]) {
    try {
      const data = execFileSync(
        adbPath,
        ["-s", serial, "exec-out", "run-as", app, "cat", `files/${file}`],
        { timeout: 10000 },
      );
      await writeFile(path.join(state, file), data, { mode: 0o600 });
    } catch {}
  }
  try {
    await writeFile(
      path.join(state, "logcat.log"),
      adb("logcat", "-b", "crash", "-d", "-v", "brief"),
      { mode: 0o600 },
    );
  } catch {}
  try {
    adb("emu", "kill");
  } catch {
    emulator.kill("SIGTERM");
  }
  if (emulator.exitCode === null)
    await new Promise<void>((resolve) =>
      emulator.once("exit", () => resolve()),
    );
  await log.close();
}
