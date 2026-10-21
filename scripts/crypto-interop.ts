/** Owns a disposable AVD and loopback forwarding only. Never selects a phone. */
import { execFileSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, open, writeFile } from "node:fs/promises";
import { createServer as netServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createServer } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const state = path.join(root, ".local/crypto-proof");
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Android/Sdk");
const adbPath = path.join(sdk, "platform-tools/adb");
const emulatorPort = 5592;
const imageArch = os.arch() === "arm64" ? "arm64-v8a" : "x86_64";
const serial = `emulator-${emulatorPort}`;
const appId = "com.yepcontrol.app";
const adb = (...args: string[]) =>
  execFileSync(adbPath, ["-s", serial, ...args], {
    encoding: "utf8",
    timeout: 15000,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(
  work: () => T | Promise<T>,
  timeout = 120000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try {
      const result = await work();
      if (result) return result;
    } catch {}
    await delay(500);
  }
  throw new Error("Timed out waiting for owned crypto fixture");
}
async function unused(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = netServer();
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
}
await mkdir(state, { recursive: true, mode: 0o700 });
// Refuse any existing emulator at this selector instead of adopting it.
const devices = execFileSync(adbPath, ["devices"], { encoding: "utf8" });
if (devices.includes(`${serial}\t`))
  throw new Error("Crypto emulator selector already in use");
await unused(emulatorPort);
await unused(emulatorPort + 1);
const env = {
  ...process.env,
  ANDROID_HOME: sdk,
  ANDROID_AVD_HOME: path.join(state, "avd"),
  ANDROID_EMULATOR_HOME: path.join(state, "emulator"),
};
await mkdir(env.ANDROID_AVD_HOME, { recursive: true });
await mkdir(env.ANDROID_EMULATOR_HOME, { recursive: true });
const avd = "remote-access-crypto-api35";
if (!existsSync(path.join(env.ANDROID_AVD_HOME, `${avd}.ini`))) {
  execFileSync(
    path.join(sdk, "cmdline-tools/latest/bin/avdmanager"),
    [
      "create",
      "avd",
      "--name",
      avd,
      "--package",
      `system-images;android-35;google_apis;${imageArch}`,
      "--device",
      "pixel_7",
      "--path",
      path.join(env.ANDROID_AVD_HOME, `${avd}.avd`),
    ],
    { env, input: "no\n", stdio: ["pipe", "pipe", "pipe"], timeout: 60000 },
  );
}
const log = await open(path.join(state, "emulator.log"), "w", 0o600);
const emulator = spawn(
  path.join(sdk, "emulator/emulator"),
  [
    "-avd",
    avd,
    "-port",
    String(emulatorPort),
    "-no-window",
    "-no-audio",
    "-no-snapshot",
    "-gpu",
    "swiftshader",
    "-no-boot-anim",
  ],
  { env, stdio: ["ignore", log.fd, log.fd] },
);
let forward: string | undefined;
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let vite: Awaited<ReturnType<typeof createServer>> | undefined;
let instrumentation: ReturnType<typeof spawn> | undefined;
let instrumentationLog: Awaited<ReturnType<typeof open>> | undefined;
let relayFrames = 0;
let relayBytes = 0;
let canarySeen = false;
try {
  await until(() => adb("shell", "getprop", "sys.boot_completed") === "1");
  if (adb("shell", "getprop", "ro.kernel.qemu") !== "1")
    throw new Error("Refusing non-emulator");
  for (const apk of ["app-debug.apk", "app-debug-androidTest.apk"]) {
    const folder = apk.includes("androidTest")
      ? "androidTest/debug"
      : "apk/debug";
    const apkPath = apk.includes("androidTest")
      ? path.join(root, "android/app/build/outputs/apk", folder, apk)
      : path.join(root, "android/app/build/outputs", folder, apk);
    adb("install", "-r", apkPath);
  }
  adb(
    "shell",
    "run-as",
    appId,
    "rm",
    "-f",
    "files/interop-port",
    "files/interop-public",
  );
  instrumentationLog = await open(
    path.join(state, "instrumentation.log"),
    "w",
    0o600,
  );
  instrumentation = spawn(
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
      "dev.remoteaccess.app.CryptoInteropTest",
      `${appId}.test/androidx.test.runner.AndroidJUnitRunner`,
    ],
    { stdio: ["ignore", instrumentationLog.fd, instrumentationLog.fd] },
  );
  const completed = new Promise<number | null>((resolve) =>
    instrumentation?.once("exit", resolve),
  );
  const devicePort = await until(() =>
    adb("shell", "run-as", appId, "cat", "files/interop-port"),
  );
  if (!/^\d+$/.test(devicePort)) throw new Error("Invalid bridge port");
  const phonePin = adb("shell", "run-as", appId, "cat", "files/interop-public");
  forward = adb("forward", "tcp:0", `tcp:${devicePort}`);
  vite = await createServer({
    root: path.join(root, "web"),
    configFile: path.join(root, "web/vite.config.ts"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [
      {
        name: "opaque-test-forwarder",
        configureServer(server) {
          server.middlewares.use("/native", async (req, res) => {
            try {
              if (req.method !== "POST") {
                res.statusCode = 405;
                res.end();
                return;
              }
              const parts: Buffer[] = [];
              let size = 0;
              for await (const part of req) {
                const bytes = Buffer.from(part);
                size += bytes.length;
                if (size > 65536) throw new Error("Frame limit");
                parts.push(bytes);
              }
              const body = Buffer.concat(parts);
              relayFrames++;
              relayBytes += body.length;
              if (
                req.url === "/record" &&
                body.includes(Buffer.from("crypto-proof canary"))
              )
                canarySeen = true;
              const result = await fetch(
                `http://127.0.0.1:${forward}${req.url}`,
                { method: "POST", body, signal: AbortSignal.timeout(5000) },
              );
              res.statusCode = result.status;
              res.end(Buffer.from(await result.arrayBuffer()));
            } catch {
              res.statusCode = 502;
              res.end();
            }
          });
        },
      },
    ],
  });
  await vite.listen();
  const address = vite.httpServer?.address();
  if (!address || typeof address === "string")
    throw new Error("Missing harness server");
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(`http://127.0.0.1:${address.port}/crypto.html`);
  await page.getByRole("button", { name: "Check browser crypto" }).click();
  await page
    .getByRole("status")
    .filter({ hasText: "Browser crypto passed" })
    .waitFor();
  const result = await page.evaluate(
    (pin) => window.cryptoProof(pin),
    phonePin,
  );
  if (canarySeen || !result.freshSession || result.rejected.length !== 6)
    throw new Error("Interop acceptance failed");
  const code = await until(async () => {
    const value = await Promise.race([
      completed,
      delay(100).then(() => undefined),
    ]);
    return value === 0
      ? true
      : value === undefined
        ? false
        : Promise.reject(new Error("Instrumentation failed"));
  }, 15000);
  if (!code) throw new Error("Instrumentation did not exit");
  const { readFile } = await import("node:fs/promises");
  const nativeLog = await readFile(
    path.join(state, "instrumentation.log"),
    "utf8",
  );
  if (!nativeLog.includes("OK (1 test)") || nativeLog.includes("FAILURES!!!"))
    throw new Error(
      "Native assertions failed; see private instrumentation.log",
    );
  const report = {
    ...result,
    relayFrames,
    relayBytes,
    canarySeen,
    nativeKeystore: true,
    androidApi: 35,
  };
  await writeFile(
    path.join(state, "result.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
} finally {
  await browser?.close();
  await vite?.close();
  if (forward) {
    try {
      adb("forward", "--remove", `tcp:${forward}`);
    } catch {}
  }
  if (instrumentation && instrumentation.exitCode === null) {
    try {
      adb("shell", "am", "force-stop", appId);
    } catch {}
    instrumentation.kill("SIGTERM");
  }
  if (emulator.exitCode === null) {
    emulator.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => emulator.once("exit", resolve)),
      delay(10000),
    ]);
    if (emulator.exitCode === null) emulator.kill("SIGKILL");
  }
  await instrumentationLog?.close();
  await log.close();
}
