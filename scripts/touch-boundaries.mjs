/** Real native refusal, ordinary Android scrolling, protected video and Stop. */
import { chromium, expect } from "@playwright/test";
import { WebSocket } from "ws";
import { once } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
const receipt = JSON.parse(await readFile(".local/demo.json", "utf8"));
const config = JSON.parse(await readFile(".local/server.json", "utf8"));
if (!/^emulator-\d+$/.test(receipt.serial))
  throw new Error("Owned emulator required");
const adb = (...args) => exec(config.adb, ["-s", receipt.serial, ...args]);
const witness = async () =>
  JSON.parse(
    (
      await adb(
        "shell",
        "run-as",
        "dev.remoteaccess.spike",
        "cat",
        "files/touch-fixture.json",
      )
    ).stdout,
  );
const report = { api: receipt.api, checks: [] };
const browser = await chromium.launch({ headless: true });
let ws, page;
try {
  page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    hasTouch: true,
  });
  page.setDefaultTimeout(20000);
  await page.goto(url);
  const call = async (op, data = {}) =>
    (
      await page.request.post(url + "/api/action", {
        headers: { Origin: url },
        data: { op, ...data },
      })
    ).json();
  const ready = () =>
    page.waitForFunction(
      () =>
        window.demoLive?.ws.readyState === 1 &&
        document.getElementById("screen-cover").hidden &&
        window.demoLive.getFrame() &&
        window.demoLive.allowed(),
    );
  await call("openTouchLab");
  await ready();
  await page.waitForTimeout(700);
  const cookie = (await page.context().cookies())
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  ws = new WebSocket(url.replace("http:", "ws:") + "/api/live", {
    origin: url,
    headers: { Cookie: cookie },
  });
  await once(ws, "open");
  const send = async (data) => {
    const response = once(ws, "message");
    ws.send(JSON.stringify(data));
    return JSON.parse((await response)[0]);
  };
  const packet = async () => ({
    op: "touch",
    request: 1,
    gesture: crypto.randomUUID(),
    sequence: 0,
    duration: 40,
    frame: (await (await page.request.get(url + "/api/frame")).json()).data
      .frame,
    points: [{ id: 1, path: [[400, 700]], held: true }],
  });
  const baseline = await witness();
  for (const mutate of [
    (p) => (p.duration = 40.5),
    (p) => (p.points[0].id = 1.5),
    (p) => (p.points[0].held = "true"),
    (p) => (p.points[0].path = [[1e8, 0]]),
  ]) {
    const p = await packet();
    mutate(p);
    const result = await send(p);
    if (result.ok) throw new Error("Malformed native touch was accepted");
    await page.waitForTimeout(120);
  }
  if ((await witness()).downs !== baseline.downs)
    throw new Error("Malformed input reached native touch consumer");
  report.checks.push(
    "Native parser refuses fractional duration/identity, non-boolean hold and out-of-screen paths before input",
  );
  let p = await packet();
  if (!(await send(p)).ok) throw new Error("Valid hold refused");
  await expect.poll(async () => (await witness()).held).toBe(1);
  const skipped = await send({ ...p, sequence: 2, request: 2 });
  if (skipped.ok) throw new Error("Skipped sequence was accepted");
  await expect.poll(async () => (await witness()).held).toBe(0);
  report.checks.push(
    "Out-of-order continuation is refused and releases the existing native contact",
  );
  ws.close();
  ws = null;
  await call("openApp", { package: "com.android.settings" });
  await expect
    .poll(async () => (await call("state")).state.package)
    .toBe("com.android.settings");
  const settingsScene = (await call("state")).state.scene;
  await page.waitForFunction(
    (scene) => window.demoLive.getFrame()?.scene === scene,
    settingsScene,
  );
  await ready();
  const texts = async () =>
    (await call("inspect")).data.nodes.filter((n) => n.text).map((n) => n.text);
  const before = await texts();
  const cdp = await page.context().newCDPSession(page);
  const touch = (type, touchPoints) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints });
  const bounds = await page.locator("#screen").boundingBox();
  const f = await page.evaluate(() => window.demoLive.getFrame());
  const point = (id, x, y) => ({
    id,
    x: bounds.x + (x / f.width) * bounds.width,
    y: bounds.y + (y / f.height) * bounds.height,
    radiusX: 5,
    radiusY: 5,
    force: 0.5,
  });
  await touch("touchStart", [point(1, f.width * 0.5, f.height * 0.8)]);
  for (let i = 1; i <= 18; i++) {
    await touch("touchMove", [
      point(
        1,
        f.width * (0.5 + Math.sin(i / 4) * 0.04),
        f.height * (0.8 - i * 0.023),
      ),
    ]);
    await page.waitForTimeout(50);
  }
  const after = await texts();
  if (JSON.stringify(before) === JSON.stringify(after))
    throw new Error("Ordinary Android Settings did not scroll before lift");
  if (!(await call("state")).state.touchActive)
    throw new Error("Settings gesture ended before its effect was observed");
  await touch("touchEnd", []);
  await expect
    .poll(async () => (await call("state")).state.touchActive)
    .toBe(false);
  report.checks.push(
    "Curved held gesture scrolls ordinary Android Settings, observed in native visible nodes before lift",
  );
  await call("openFixture");
  await page.waitForTimeout(900);
  await page.waitForFunction(() => window.demoLive.videoActive);
  await page.evaluate(() => {
    const live = window.demoLive;
    live.savedVideo = live.video;
    live.video = () => {}; // Isolate decoder failure from new valid native frames.
    live.savedVideo({
      codec: "unsupported-codec",
      key: true,
      width: 16,
      height: 16,
      data: "AA==",
      timestamp: 1,
    });
  });
  await page.waitForFunction(
    () =>
      !window.demoLive.decoder &&
      document.getElementById("video-screen").hidden,
  );
  await page.evaluate(() => {
    const live = window.demoLive;
    live.video = live.savedVideo;
    delete live.savedVideo;
  });
  await page.waitForFunction(() => window.demoLive.videoActive);
  report.checks.push(
    "Unsupported video configuration falls back cleanly and a valid native keyframe restores video",
  );
  const inspection = await call("inspect"),
    button = inspection.data.nodes.find(
      (n) => n.text === "Test protected screen",
    );
  const b = button.bounds,
    frame = (await (await page.request.get(url + "/api/frame")).json()).data;
  const tap = await call("tap", {
    x: (b[0] + b[2]) / 2,
    y: (b[1] + b[3]) / 2,
    frame: frame.frame,
  });
  if (!tap.ok) throw new Error(tap.message);
  await expect(page.locator("#cover-title")).toHaveText(
    "This screen is protected",
    { timeout: 10000 },
  );
  if (!(await page.locator("#video-screen").evaluate((c) => c.hidden)))
    throw new Error("Protected-screen video remained visible");
  const decoded = await page.evaluate(() => window.demoLive.stats.decoded);
  await page.waitForTimeout(1000);
  if ((await page.evaluate(() => window.demoLive.stats.decoded)) !== decoded)
    throw new Error("Protected screen continued decoding");
  report.checks.push(
    "Protected native window covers the viewer and stops browser video decoding",
  );
  await adb(
    "shell",
    "am",
    "start",
    "-n",
    "dev.remoteaccess.spike/.StationActivity",
    "--activity-clear-top",
  );
  await ready();
  await page.waitForFunction(() => window.demoLive.videoActive);
  report.checks.push(
    "Leaving the protected window restores smooth viewing under the same visible consent",
  );
  await call("openTouchLab");
  await page.reload();
  await ready();
  await page.waitForTimeout(700);
  const rect = await page.locator("#screen").boundingBox();
  await touch("touchStart", [
    {
      id: 1,
      x: rect.x + rect.width * 0.5,
      y: rect.y + rect.height * 0.4,
      radiusX: 5,
      radiusY: 5,
      force: 0.5,
    },
  ]);
  await expect.poll(async () => (await witness()).held).toBe(1);
  if (!(await call("stop")).ok) throw new Error("Native Stop not acknowledged");
  await expect.poll(async () => (await witness()).held).toBe(0);
  await page.waitForFunction(
    () => document.getElementById("video-screen").hidden,
  );
  await expect
    .poll(
      async () =>
        !(
          await adb(
            "shell",
            "dumpsys",
            "activity",
            "services",
            "dev.remoteaccess.spike",
          )
        ).stdout.includes(".VideoService"),
      { timeout: 5000 },
    )
    .toBe(true);
  await touch("touchCancel", []);
  await page.waitForTimeout(1500);
  if ((await (await page.request.get(url + "/api/state")).json()).connected)
    throw new Error("Stop reconnected itself");
  report.checks.push(
    "Stop releases held native touch, ends the projection service, hides video and stays stopped",
  );
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  report.error = error.message;
  report.diagnostics = await page?.evaluate(() => ({
    allowed: window.demoLive.allowed(),
    cover: document.getElementById("cover-title").textContent,
    notice: document.getElementById("notice").textContent,
    stats: window.demoLive.stats,
    contacts: [...window.demoLive.contacts.keys()],
    notes: [...document.querySelectorAll("#activity li")]
      .slice(0, 8)
      .map((n) => n.textContent),
  }));
  throw error;
} finally {
  ws?.terminate();
  await browser.close();
  await writeFile(
    `.local/touch-boundaries-api${receipt.api}.json`,
    JSON.stringify(report, null, 2),
  );
}
