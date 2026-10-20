/** Public-origin acceptance. Own emulator + browser, no physical phone or credentials. */
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
const state = path.join(root, ".local/hosted-proof");
const sdk = process.env.ANDROID_HOME ?? path.join(os.homedir(), "Android/Sdk");
const adbPath = path.join(sdk, "platform-tools/adb");
const port = 5594;
const serial = `emulator-${port}`;
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
await mkdir(state, { recursive: true, mode: 0o700 });
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
    "-gpu",
    "swiftshader",
    "-no-boot-anim",
  ],
  { env, stdio: ["ignore", log.fd, log.fd] },
);
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
let invitationId: string | undefined;
let revoked = false;
try {
  await until(() => adb("shell", "getprop", "sys.boot_completed") === "1");
  if (adb("shell", "getprop", "ro.kernel.qemu") !== "1")
    throw new Error("Refusing non-emulator");
  for (const apk of [
    "debug/app-debug.apk",
    "androidTest/debug/app-debug-androidTest.apk",
  ])
    adb("install", "-r", path.join(root, "android/app/build/outputs/apk", apk));
  // This AVD is owned by this runner, so clear only our host's old fixture state.
  adb("shell", "pm", "clear", appId);
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
        "dev.remoteaccess.app.HostedPairingTest",
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
    await until(() => instrument?.exitCode !== null, 30000);
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
      .waitFor({ timeout: 30000 });
  }
  await runNative("pair");
  await check();
  await finishNative("pair", "finish");
  // A fresh Android process and a page reload must retain exact paired identities.
  adb("shell", "am", "force-stop", appId);
  await page.reload();
  await runNative("reconnect");
  await check();
  await finishNative("reconnect", "revoke");
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
    encryptedExchanges: 2,
    persistedAfterAndroidProcessRestart: true,
    persistedAfterBrowserReload: true,
    revoked: true,
    rejectedAfterRevocation: true,
    publicHttpsWss: true,
    androidApi: 35,
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
  await browser?.close();
  if (instrument && instrument.exitCode === null) {
    try {
      adb("shell", "am", "force-stop", appId);
    } catch {}
    instrument.kill("SIGTERM");
  }
  if (emulator.exitCode === null) {
    emulator.kill("SIGTERM");
    await Promise.race([
      new Promise((resolve) => emulator.once("exit", resolve)),
      delay(10000),
    ]);
    if (emulator.exitCode === null) emulator.kill("SIGKILL");
  }
  for (const handle of logs) await handle.close();
  await log.close();
}
