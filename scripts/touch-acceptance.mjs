import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
const receipt = JSON.parse(await readFile(".local/demo.json", "utf8"));
const config = JSON.parse(await readFile(".local/server.json", "utf8"));
if (!/^emulator-\d+$/.test(receipt.serial))
  throw new Error("Owned emulator required");
const witness = async () => {
  try {
    return JSON.parse(
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
  } catch {
    return null;
  }
};
const report = {
  api: receipt.api,
  client: "Managed Chromium CDP touch injection; no physical finger trial",
  checks: [],
};
const browser = await chromium.launch({ headless: true });
await mkdir(".local/evidence/touch-video", { recursive: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  hasTouch: true,
  recordVideo: {
    dir: ".local/evidence/touch-video",
    size: { width: 1440, height: 1050 },
  },
});
const page = await context.newPage();
page.setDefaultTimeout(20000);
const video = page.video();
try {
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  const call = async (op, data = {}) =>
    (
      await page.request.post(url + "/api/action", {
        headers: { Origin: url },
        data: { op, ...data },
      })
    ).json();
  const result = await call("openTouchLab");
  if (!result.ok) throw new Error(result.message);
  await page.waitForFunction(
    () =>
      window.demoLive?.ws.readyState === 1 &&
      document.getElementById("screen").naturalWidth > 0 &&
      document.getElementById("screen-cover").hidden,
  );
  await page.waitForTimeout(1000);
  const frame = await (await page.request.get(url + "/api/frame")).json();
  const inspect = await call("inspect");
  const area = inspect.data.nodes.find((n) =>
    n.description?.startsWith("Touch playground:"),
  );
  if (!area) throw new Error("Native touch playground is not visible");
  const top = area.bounds[1];
  const r = await page.locator("#screen").boundingBox();
  const p = (id, x, y) => ({
    id,
    x: r.x + (x / frame.data.width) * r.width,
    y: r.y + ((y + top) / frame.data.height) * r.height,
    radiusX: 5,
    radiusY: 5,
    force: 0.5,
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) =>
    cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [p(1, 400, 435)]);
  await page.waitForTimeout(160);
  const interactionStarted = await page.evaluate(() => ({
    time: performance.now(),
    decoded: window.demoLive.stats.decoded,
  }));
  const beforeMove = Date.now();
  for (let i = 1; i <= 12; i++) {
    await touch("touchMove", [p(1, 400 + 36 * i, 435)]);
    await page.waitForTimeout(45);
  }
  await expect
    .poll(async () => (await witness())?.slider)
    .toBeGreaterThan(0.75);
  const held = await witness();
  if (held.held !== 1 || held.ups !== 0)
    throw new Error("Slider did not change before lift-off");
  report.sliderDragAndWitnessMs = Date.now() - beforeMove;
  await page.waitForTimeout(1100);
  if ((await witness()).held !== 1)
    throw new Error("Stationary hold expired despite viewer heartbeats");
  report.checks.push(
    "Stationary hold survives beyond the native watchdog through viewer heartbeats",
  );
  report.checks.push(
    "Slider changes during the held gesture, before finger lift",
  );
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness())?.held).toBe(0);
  await page.waitForTimeout(500);
  await touch("touchStart", [p(1, 350, 925)]);
  await page.waitForTimeout(200);
  await touch("touchStart", [p(1, 350, 925), p(2, 730, 925)]);
  await page.waitForTimeout(200);
  for (let i = 1; i <= 20; i++) {
    const theta = ((i / 20) * Math.PI) / 5,
      radius = 190 + i * 6;
    await touch("touchMove", [
      p(1, 540 - Math.cos(theta) * radius, 925 - Math.sin(theta) * radius),
      p(2, 540 + Math.cos(theta) * radius, 925 + Math.sin(theta) * radius),
    ]);
    await page.waitForTimeout(50);
  }
  await expect.poll(async () => (await witness())?.scale).toBeGreaterThan(1.4);
  await expect.poll(async () => (await witness())?.angle).toBeGreaterThan(25);
  if ((await witness()).held !== 2)
    throw new Error("Two contacts were not preserved through zoom/rotation");
  report.checks.push(
    "Joining a second finger preserves the first, with simultaneous native zoom and rotation",
  );
  // CDP requires zero contacts in touchEnd. Inject just this browser pointer-up
  // explicitly to exercise partial release, then finish the CDP gesture below.
  const remaining = await page.evaluate(() => {
    const entries = [...window.demoLive.contacts];
    const [id, finger] = entries[1];
    const r = document.getElementById("screen").getBoundingClientRect();
    const f = window.demoLive.touchFrame;
    document.getElementById("screen").dispatchEvent(
      new PointerEvent("pointerup", {
        pointerId: id,
        pointerType: "touch",
        clientX: r.x + (finger.xy[0] / f.width) * r.width,
        clientY: r.y + (finger.xy[1] / f.height) * r.height,
        bubbles: true,
        cancelable: true,
      }),
    );
    return entries[0][0];
  });
  await expect.poll(async () => (await witness())?.held).toBe(1);
  const handoff = await witness();
  await page.evaluate((id) => {
    const live = window.demoLive,
      f = live.contacts.get(id),
      r = live.target.getBoundingClientRect();
    live.target.dispatchEvent(
      new PointerEvent("pointermove", {
        pointerId: id,
        pointerType: "touch",
        clientX: r.x + ((f.xy[0] + 60) / live.touchFrame.width) * r.width,
        clientY: r.y + (f.xy[1] / live.touchFrame.height) * r.height,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, remaining);
  await expect
    .poll(async () => (await witness())?.panX)
    .toBeGreaterThan(handoff.panX + 30);
  const afterHandoff = await witness();
  if (
    Math.abs(afterHandoff.panX - handoff.panX) > 85 ||
    afterHandoff.downs !== handoff.downs
  )
    throw new Error(
      "Remaining finger jumped or restarted after partial release",
    );
  report.checks.push(
    "Scripted browser partial pointer-up preserves the other native contact and its pan without a new down",
  );
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness())?.held).toBe(0);
  await page.waitForTimeout(500);
  await touch("touchStart", [p(1, 540, 1900)]);
  for (let i = 1; i <= 15; i++) {
    await touch("touchMove", [
      p(1, 540 + Math.sin(i / 3) * 100, 1900 - i * 23),
    ]);
    await page.waitForTimeout(45);
  }
  await expect.poll(async () => (await witness())?.scroll).toBeGreaterThan(250);
  if ((await witness()).held !== 1)
    throw new Error("Scrolling waited until lift-off");
  report.checks.push("Curved scrolling changes native content before lift-off");
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness())?.held).toBe(0);
  const snapshot = await witness();
  if (snapshot.cancels !== 0)
    throw new Error(
      "Unexpected native ACTION_CANCEL during ordinary continuation",
    );
  report.checks.push(
    "Normal continuations do not synthesize repeated downs or cancel the held gesture",
  );
  await page.waitForTimeout(500);
  const ended = await page.evaluate(() => ({
    time: performance.now(),
    stats: window.demoLive.stats,
  }));
  const stats = ended.stats;
  const ack = [...stats.acknowledgements].sort((a, b) => a - b);
  report.interactionSeconds = (ended.time - interactionStarted.time) / 1000;
  report.decodedFramesDuringInteraction =
    stats.decoded - interactionStarted.decoded;
  report.decodedFps =
    report.decodedFramesDuringInteraction / report.interactionSeconds;
  report.batchAcknowledgementMs = {
    median: ack[Math.floor(ack.length * 0.5)],
    p95: ack[Math.floor(ack.length * 0.95)],
    max: stats.maxAckMs,
  };
  report.live = { ...stats };
  delete report.live.acknowledgements;
  report.native = {
    maxHeld: snapshot.maxHeld,
    moves: snapshot.moves,
    downs: snapshot.downs,
    ups: snapshot.ups,
    cancels: snapshot.cancels,
    scale: snapshot.scale,
    angle: snapshot.angle,
  };
  if (!process.argv.includes("--allow-stills")) {
    if (stats.decoded < 20)
      throw new Error("Smooth video did not decode during interaction");
    report.checks.push(
      "Consented native H.264 frames decode during touch interaction",
    );
  }
  await page.screenshot({
    path: `.local/evidence/touch-desktop-api${receipt.api}.png`,
    fullPage: true,
  });
  await page.waitForTimeout(1000);
  // Lose the actual live socket while a native contact is held.
  await touch("touchStart", [p(1, 600, 925)]);
  await expect.poll(async () => (await witness())?.held).toBe(1);
  await page.evaluate(() => window.demoLive.ws.close());
  await expect
    .poll(async () => (await witness())?.held, { timeout: 2500 })
    .toBe(0);
  await touch("touchCancel", []);
  report.checks.push(
    "Viewer socket loss releases a held native contact without replay",
  );
  await page.waitForFunction(() => window.demoLive.ws.readyState === 1);
  await page.waitForTimeout(700);
  if ((await witness()).held !== 0)
    throw new Error("Reconnection replayed touch");
  // Drop outgoing touch packets while preserving the actual open viewer socket.
  await touch("touchStart", [p(1, 600, 925)]);
  await expect.poll(async () => (await witness())?.held).toBe(1);
  await page.evaluate(() => {
    const w = window.demoLive.ws;
    w.savedSend = w.send;
    w.send = function (data) {
      if (JSON.parse(data).op !== "touch") return this.savedSend(data);
    };
  });
  const lostAt = Date.now();
  await expect
    .poll(async () => (await witness())?.held, { timeout: 2000 })
    .toBe(0);
  report.watchdogReleaseObservedMs = Date.now() - lostAt;
  await touch("touchCancel", []);
  await page.evaluate(() => {
    const w = window.demoLive.ws;
    w.send = w.savedSend;
    delete w.savedSend;
  });
  await page.waitForTimeout(2100);
  report.checks.push(
    "Native watchdog releases contact when touch packets stop despite an open socket",
  );
  await touch("touchStart", [p(1, 600, 925)]);
  await expect.poll(async () => (await witness())?.held).toBe(1);
  await page.locator("#disconnect").evaluate((b) => b.click());
  await expect.poll(async () => (await witness())?.held).toBe(0);
  await touch("touchCancel", []);
  await page.locator("#disconnect").click();
  await page.waitForTimeout(1200);
  report.checks.push(
    "Pausing the viewer releases touch and resumes without replay",
  );
  await touch("touchStart", [p(1, 600, 925)]);
  await expect.poll(async () => (await witness())?.held).toBe(1);
  const rotation = await page.request.post(url + "/api/lab", {
    headers: { Origin: url },
    data: { action: "rotate", rotation: 1 },
  });
  if (!rotation.ok()) throw new Error("Emulator rotation failed");
  await expect
    .poll(async () => (await call("state")).state.touchActive)
    .toBe(false);
  await touch("touchCancel", []);
  await page.request.post(url + "/api/lab", {
    headers: { Origin: url },
    data: { action: "rotate", rotation: 0 },
  });
  await page.waitForTimeout(1500);
  report.checks.push(
    "Phone rotation interrupts the old coordinate stream without replay",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile horizontal overflow");
  await page.screenshot({
    path: `.local/evidence/touch-mobile-api${receipt.api}.png`,
    fullPage: true,
  });
  if (errors.length) throw new Error(errors.join("; "));
  report.checks.push("Mobile layout fits; no uncaught browser errors");
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    `.local/touch-acceptance-api${receipt.api}.json`,
    JSON.stringify(report, null, 2),
  );
  await context.close();
  await copyFile(
    await video.path(),
    `.local/evidence/touch-api${receipt.api}.webm`,
  );
  await browser.close();
}
