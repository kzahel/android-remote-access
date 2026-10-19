import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
const receipt = JSON.parse(await readFile(".local/demo.json", "utf8"));
const config = JSON.parse(await readFile(".local/server.json", "utf8"));
if (!/^emulator-\d+$/.test(receipt.serial)) throw new Error("Owned emulator required");
const witness = async () => {
  try { return JSON.parse((await exec(config.adb, ["-s", receipt.serial, "shell", "run-as", "dev.remoteaccess.spike", "cat", "files/touch-fixture.json"])).stdout); }
  catch { return null; }
};
const report = { api: receipt.api, client: "Managed Chromium CDP touch injection; no physical finger trial", checks: [] };
const browser = await chromium.launch({ headless: true });
await mkdir(".local/evidence/touch-video", { recursive: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, hasTouch: true,
  recordVideo: { dir: ".local/evidence/touch-video", size: { width: 1440, height: 1050 } } });
const page = await context.newPage(); const video = page.video();
try {
  const errors = []; page.on("pageerror", e => errors.push(e.message));
  await page.goto(url);
  const call = async (op, data = {}) => (await page.request.post(url + "/api/action", { headers: { Origin: url }, data: { op, ...data } })).json();
  const result = await call("openTouchLab"); if (!result.ok) throw new Error(result.message);
  await page.waitForFunction(() => window.demoLive?.ws.readyState === 1 && document.getElementById("screen").naturalWidth > 0 && document.getElementById("screen-cover").hidden);
  await page.waitForTimeout(1000);
  const frame = await (await page.request.get(url + "/api/frame")).json();
  const inspect = await call("inspect");
  const area = inspect.data.nodes.find(n => n.description?.startsWith("Touch playground:"));
  if (!area) throw new Error("Native touch playground is not visible");
  const top = area.bounds[1];
  const r = await page.locator("#screen").boundingBox();
  const p = (id, x, y) => ({ id, x: r.x + x / frame.data.width * r.width, y: r.y + (y + top) / frame.data.height * r.height, radiusX: 5, radiusY: 5, force: .5 });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: points });
  await touch("touchStart", [p(1, 400, 435)]);
  await page.waitForTimeout(160);
  const beforeMove = Date.now();
  for (let i = 1; i <= 12; i++) { await touch("touchMove", [p(1, 400 + 36 * i, 435)]); await page.waitForTimeout(45); }
  await expect.poll(async () => (await witness())?.slider).toBeGreaterThan(.75);
  const held = await witness();
  if (held.held !== 1 || held.ups !== 0) throw new Error("Slider did not change before lift-off");
  report.sliderEffectBeforeLiftMs = Date.now() - beforeMove;
  report.checks.push("Slider changes during the held gesture, before finger lift");
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness())?.held).toBe(0);
  await page.waitForTimeout(500);
  await touch("touchStart", [p(1, 350, 925)]);
  await page.waitForTimeout(200);
  await touch("touchStart", [p(1, 350, 925), p(2, 730, 925)]);
  await page.waitForTimeout(200);
  for (let i = 1; i <= 20; i++) {
    const theta = i / 20 * Math.PI / 5, radius = 190 + i * 6;
    await touch("touchMove", [p(1, 540 - Math.cos(theta)*radius, 925 - Math.sin(theta)*radius), p(2, 540 + Math.cos(theta)*radius, 925 + Math.sin(theta)*radius)]);
    await page.waitForTimeout(50);
  }
  await expect.poll(async () => (await witness())?.scale).toBeGreaterThan(1.4);
  await expect.poll(async () => (await witness())?.angle).toBeGreaterThan(25);
  if ((await witness()).held !== 2) throw new Error("Two contacts were not preserved through zoom/rotation");
  report.checks.push("Joining a second finger preserves the first, with simultaneous native zoom and rotation");
  await touch("touchEnd", []);
  await expect.poll(async () => (await witness())?.held).toBe(0);
  await page.waitForTimeout(500);
  await touch("touchStart", [p(1, 540, 1900)]);
  for (let i=1;i<=15;i++) {await touch("touchMove", [p(1, 540 + Math.sin(i/3)*100, 1900-i*23)]);await page.waitForTimeout(45);}
  await expect.poll(async () => (await witness())?.scroll).toBeGreaterThan(250);
  if((await witness()).held!==1)throw new Error("Scrolling waited until lift-off");
  report.checks.push("Curved scrolling changes native content before lift-off");
  await touch("touchEnd", []);await expect.poll(async () => (await witness())?.held).toBe(0);
  const snapshot=await witness();
  if(snapshot.cancels!==0)throw new Error("Unexpected native ACTION_CANCEL during ordinary continuation");
  report.checks.push("Normal continuations do not synthesize repeated downs or cancel the held gesture");
  await page.waitForTimeout(500);
  const stats=await page.evaluate(()=>window.demoLive.stats);
  report.live=stats;report.native={maxHeld:snapshot.maxHeld,moves:snapshot.moves,downs:snapshot.downs,ups:snapshot.ups,cancels:snapshot.cancels,scale:snapshot.scale,angle:snapshot.angle};
  if(!process.argv.includes("--allow-stills")) {
    if(stats.decoded<20)throw new Error("Smooth video did not decode during interaction");
    report.checks.push("Consented native H.264 frames decode during touch interaction");
  }
  await page.screenshot({path:`.local/evidence/touch-desktop-api${receipt.api}.png`,fullPage:true});
  await page.waitForTimeout(1000);
  // Lose the actual live socket while a native contact is held.
  await touch("touchStart", [p(1, 600, 925)]);
  await expect.poll(async () => (await witness())?.held).toBe(1);
  await page.evaluate(()=>window.demoLive.ws.close());
  await expect.poll(async () => (await witness())?.held,{timeout:2500}).toBe(0);
  await touch("touchCancel", []);
  report.checks.push("Viewer socket loss releases a held native contact without replay");
  await page.waitForFunction(()=>window.demoLive.ws.readyState===1);await page.waitForTimeout(700);
  if((await witness()).held!==0)throw new Error("Reconnection replayed touch");
  await page.setViewportSize({width:390,height:844});await page.waitForTimeout(500);
  if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error("Mobile horizontal overflow");
  await page.screenshot({path:`.local/evidence/touch-mobile-api${receipt.api}.png`,fullPage:true});
  if(errors.length)throw new Error(errors.join("; "));
  report.checks.push("Mobile layout fits; no uncaught browser errors");report.passed=true;
  console.log(JSON.stringify(report,null,2));
} finally {
  await writeFile(`.local/touch-acceptance-api${receipt.api}.json`,JSON.stringify(report,null,2));
  await context.close();await copyFile(await video.path(),`.local/evidence/touch-api${receipt.api}.webm`);await browser.close();
}
