import { chromium, expect } from "@playwright/test";
import { readFile, mkdir, copyFile } from "node:fs/promises";
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
const receipt = JSON.parse(await readFile(".local/demo.json", "utf8"));
await mkdir(".local/evidence/video", { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1440, height: 1050 },
  recordVideo: {
    dir: ".local/evidence/video",
    size: { width: 1440, height: 1050 },
  },
});
const page = await context.newPage();
const video = page.video();
try {
  await page.goto(url);
  await expect(page.locator("#connection-label")).toHaveText("Phone connected");
  await page.waitForFunction(
    () =>
      document.getElementById("screen").naturalWidth > 0 &&
      document.getElementById("screen-cover").hidden,
  );
  const call = async (op, data = {}) =>
    (
      await page.request.post(url + "/api/action", {
        headers: { Origin: url },
        data: { op, ...data },
      })
    ).json();
  const tap = async (text, id) => {
    const snapshot = await call("inspect");
    const n = snapshot.data.nodes.find((n) =>
      id ? n.id === id : n.text === text,
    );
    if (!n) throw new Error("Expected demo control is not visible");
    const f = await (await page.request.get(url + "/api/frame")).json();
    if (!f.ok) throw new Error(f.message);
    const r = await page.locator("#screen").boundingBox();
    const [a, b, x, y] = n.bounds;
    await page.mouse.click(
      r.x + ((a + x) / 2 / f.data.width) * r.width,
      r.y + ((b + y) / 2 / f.data.height) * r.height,
    );
    await page.waitForTimeout(1000);
  };
  await page.waitForTimeout(1500);
  await tap("Refresh solar reading");
  await tap("AC output");
  await tap(null, "dev.remoteaccess.spike:id/station_name");
  await page.locator("#read-field").click();
  await page.locator("#typing").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("RV solar station", { delay: 70 });
  await page.waitForTimeout(1200);
  const keyboard = await call("inspect");
  if (keyboard.data.nodes.some((n) => /inputmethod/.test(n.id || ""))) {
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.waitForTimeout(500);
  }
  await tap("Save name");
  await expect
    .poll(async () =>
      (await call("inspect")).data.nodes.some(
        (n) => n.text === "Saved · RV solar station",
      ),
    )
    .toBe(true);
  await page.locator("#lock").click();
  await page.waitForTimeout(1500);
  await page.locator("#wake").click();
  await page.waitForTimeout(1800);
  await page.locator("#advanced").evaluate((e) => (e.open = true));
  await page.locator("#dismiss").click();
  await page.waitForTimeout(1500);
  await page.locator("#test-pin").click();
  await expect(page.locator("#lock-state")).toHaveText("Lock · unlocked", {
    timeout: 15000,
  });
  await page.waitForTimeout(3200);
  await page.locator("#list-apps").click();
  await page.locator("#app-select").selectOption("com.android.settings");
  await page.locator("#launch-app").click();
  await page.waitForTimeout(1800);
  const s = await call("state");
  if (s.state.package !== "com.android.settings")
    throw new Error("Settings launch did not take effect");
  await page.locator("#advanced").evaluate((e) => (e.open = false));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator("#open-fixture").click();
  await page.waitForTimeout(1800);
  await page.screenshot({
    path: ".local/evidence/demo-desktop.png",
    fullPage: true,
  });
  await page.waitForTimeout(2000);
  console.log(
    "Recorded manual control, native secure unlock and real Android Settings launch. No credential enters the browser.",
  );
} finally {
  await context.close();
  const location = await video.path();
  await copyFile(location, `.local/evidence/demo-api${receipt.api}.webm`);
  await browser.close();
}
