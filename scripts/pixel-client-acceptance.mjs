/** Physical Chrome client trial; the controlled Android host stays the owned AVD.
 * No APK installation, lock/debugging change, credential, or physical-finger claim.
 */
import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const config = JSON.parse(await readFile(".local/server.json", "utf8"));
const receipt = JSON.parse(await readFile(".local/demo.json", "utf8"));
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
if (!/^emulator-\d+$/.test(receipt.serial))
  throw new Error("Owned emulator host required");
const inventory = (await exec(config.adb, ["devices", "-l"])).stdout;
const matches = inventory
  .split("\n")
  .filter((l) => /\bmodel:Pixel_7a\b/.test(l) && /\sdevice\s/.test(l));
if (matches.length !== 1)
  throw new Error("Exactly one attached authorized Pixel 7a required");
const serial = matches[0].split(/\s/)[0];
const adb = (...args) => exec(config.adb, ["-s", serial, ...args]);
const doctor = await exec(
  "../machine-control/platforms/android/bin/android-device",
  ["doctor", "--json"],
  { env: { ...process.env, ANDROID_TESTBED_SERIAL: serial } },
);
const readiness = JSON.parse(doctor.stdout);
if (
  !readiness.ready ||
  readiness.extensions?.keyguard?.showing ||
  readiness.states.interaction !== "unlocked"
)
  throw new Error(
    "Physical client must already be unlocked and ready; no credential/settings changes made",
  );
const report = {
  client:
    "Attached Pixel 7a Chrome, automated CDP touch; no physical-finger trial",
  hostApi: receipt.api,
  clientApi: readiness.extensions.apiLevel,
  checks: [],
};
const port = new URL(url).port;
const remote = `tcp:${port}`;
let madeReverse = false,
  forward,
  browser,
  page,
  previous;
const marker = `pixel-client-${crypto.randomUUID()}`;
const witness = async () =>
  JSON.parse(
    (
      await exec(config.adb, [
        "-s",
        receipt.serial,
        "shell",
        "run-as",
        "dev.remoteaccess.spike",
        "cat",
        "files/touch-fixture.json",
      ])
    ).stdout,
  );
try {
  const activities = (await adb("shell", "dumpsys", "activity", "activities"))
    .stdout;
  previous = activities.match(
    /(?:mResumedActivity|topResumedActivity).*?\su\d+\s+([A-Za-z0-9_.]+\/[A-Za-z0-9_.$]+)/,
  )?.[1];
  const reverses = (await adb("reverse", "--list")).stdout
    .split("\n")
    .map((l) => l.trim().split(/\s+/));
  const existing = reverses.find((fields) => fields[1] === remote);
  if (existing && existing[2] !== remote)
    throw new Error(
      "Client port already has a different reverse; preserving it",
    );
  if (!existing) {
    await adb("reverse", remote, remote);
    madeReverse = true;
  }
  await adb(
    "shell",
    "am",
    "start",
    "-a",
    "android.intent.action.VIEW",
    "-d",
    `${url}/?${marker}`,
    "-p",
    "com.android.chrome",
    "--ez",
    "create_new_tab",
    "true",
    "-f",
    "0x10000000",
  );
  forward = (
    await adb("forward", "tcp:0", "localabstract:chrome_devtools_remote")
  ).stdout.trim();
  if (!/^\d+$/.test(forward))
    throw new Error("Unexpected temporary CDP transport");
  browser = await chromium.connectOverCDP(`http://127.0.0.1:${forward}`, {
    timeout: 15000,
  });
  for (let i = 0; i < 30 && !page; i++) {
    page = browser
      .contexts()
      .flatMap((c) => c.pages())
      .find((p) => p.url().includes(marker));
    if (!page) await new Promise((r) => setTimeout(r, 200));
  }
  if (!page)
    throw new Error(
      "Own new browser tab was not found; other tabs are untouched",
    );
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const call = async (op, data = {}) =>
    page.evaluate(
      async ({ op, data }) => {
        const r = await fetch("/api/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ op, ...data }),
        });
        return r.json();
      },
      { op, data },
    );
  if (!(await call("openTouchLab")).ok)
    throw new Error("Native fixture did not open");
  await page.waitForFunction(
    () =>
      window.demoLive?.ws.readyState === 1 &&
      document.getElementById("screen-cover").hidden &&
      window.demoLive.stats.decoded > 5,
  );
  await page.locator("#screen").scrollIntoViewIfNeeded();
  await page.waitForTimeout(700);
  const geometry = await page.evaluate(() => {
    const r = document.getElementById("screen").getBoundingClientRect(),
      f = window.demoLive.getFrame();
    return {
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      phoneWidth: f.width,
      phoneHeight: f.height,
      client: navigator.userAgent,
    };
  });
  report.browser = geometry.client;
  const inspection = await call("inspect");
  const top = inspection.data.nodes.find((n) =>
    n.description?.startsWith("Touch playground:"),
  ).bounds[1];
  const point = (id, x, y) => ({
    id,
    x: geometry.x + (x / geometry.phoneWidth) * geometry.width,
    y: geometry.y + ((y + top) / geometry.phoneHeight) * geometry.height,
    radiusX: 5,
    radiusY: 5,
    force: 0.5,
  });
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const initial = await page.evaluate(() => ({
    decoded: window.demoLive.stats.decoded,
    time: performance.now(),
  }));
  await touch("touchStart", [point(1, 400, 435)]);
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", [point(1, 400 + 36 * i, 435)]);
    await page.waitForTimeout(60);
  }
  await expect.poll(async () => (await witness()).slider).toBeGreaterThan(0.75);
  if ((await witness()).held !== 1)
    throw new Error("Slider effect waited for lift-off");
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness()).held).toBe(0);
  await page.waitForTimeout(650);
  report.checks.push(
    "Physical Chrome client drives native slider before lift-off",
  );
  await touch("touchStart", [point(1, 350, 925), point(2, 730, 925)]);
  for (let i = 1; i <= 20; i++) {
    const a = ((i / 20) * Math.PI) / 5,
      r = 190 + i * 6;
    await touch("touchMove", [
      point(1, 540 - Math.cos(a) * r, 925 - Math.sin(a) * r),
      point(2, 540 + Math.cos(a) * r, 925 + Math.sin(a) * r),
    ]);
    await page.waitForTimeout(60);
  }
  await expect.poll(async () => (await witness()).scale).toBeGreaterThan(1.4);
  await expect.poll(async () => (await witness()).angle).toBeGreaterThan(25);
  if ((await witness()).held !== 2)
    throw new Error("Native contacts not preserved");
  report.checks.push(
    "Two simultaneous browser contacts zoom and rotate the native target",
  );
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness()).held).toBe(0);
  const final = await page.evaluate(() => ({
    stats: window.demoLive.stats,
    time: performance.now(),
    overflow: document.documentElement.scrollWidth > innerWidth,
  }));
  report.decodedFps =
    (final.stats.decoded - initial.decoded) /
    ((final.time - initial.time) / 1000);
  report.decodedFrames = final.stats.decoded - initial.decoded;
  report.native = await witness();
  delete report.native.events;
  const ack = final.stats.acknowledgements.sort((a, b) => a - b);
  report.batchAcknowledgementMs = {
    median: ack[Math.floor(ack.length * 0.5)],
    p95: ack[Math.floor(ack.length * 0.95)],
    max: Math.max(...ack),
  };
  if (report.decodedFrames < 20 || final.overflow || errors.length)
    throw new Error("Client video, layout or runtime check failed");
  report.checks.push(
    "Hardware Chrome decodes H.264 during interaction with no layout overflow or uncaught errors",
  );
  await mkdir(".local/evidence", { recursive: true });
  await page.screenshot({
    path: ".local/evidence/pixel-browser.png",
    fullPage: false,
  });
  report.passed = true;
} finally {
  if (page && !report.passed) {
    report.finalDiagnostics = await page
      .evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        contacts: [...window.demoLive.contacts.keys()],
        stats: window.demoLive.stats,
        notes: [...document.querySelectorAll("#activity li")]
          .slice(0, 5)
          .map((n) => n.textContent),
      }))
      .catch(() => null);
    report.finalWitness = await witness().catch(() => null);
    await page
      .screenshot({
        path: ".local/evidence/pixel-browser.png",
        fullPage: false,
      })
      .catch(() => {});
  }
  await page?.close().catch(() => {});
  // connectOverCDP close disconnects its transport; it does not close Chrome.
  await browser?.close().catch(() => {});
  if (forward)
    await adb("forward", "--remove", `tcp:${forward}`).catch(() => {});
  if (madeReverse) await adb("reverse", "--remove", remote).catch(() => {});
  if (previous)
    await adb(
      "shell",
      "am",
      "start",
      "-n",
      previous,
      "--activity-reorder-to-front",
    ).catch(() => {});
  await writeFile(
    ".local/pixel-client-acceptance.json",
    JSON.stringify(report, null, 2),
  );
}
console.log(JSON.stringify(report, null, 2));
