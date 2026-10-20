import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
const physical = process.argv.includes("--phone");
const local = physical ? ".local/phone" : ".local";
const evidence = physical ? ".local/phone/evidence" : ".local/evidence";
const running = JSON.parse(await readFile(`${local}/running.json`, "utf8"));
const receipt = JSON.parse(await readFile(`${local}/${physical ? "device" : "demo"}.json`, "utf8"));
const config = JSON.parse(await readFile(`${local}/server.json`, "utf8"));
if (physical) {
  if (config.profile !== "usb-phone" || receipt.serial.startsWith("emulator-") || !receipt.installedByUs)
    throw new Error("Explicit owned phone setup receipt required");
  const { stdout: model } = await exec(config.adb, ["-s", receipt.serial, "shell", "getprop", "ro.product.model"]);
  if (model.trim() !== receipt.model) throw new Error("Phone identity changed");
} else if (!/^emulator-\d+$/.test(receipt.serial)) {
  throw new Error("Owned emulator required");
}
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
        "files/fixture.json",
      ])
    ).stdout,
  );
const report = { checks: [] };
const browser = await chromium.launch({ headless: true });
await mkdir(evidence, { recursive: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(running.url);
  await expect(page.locator("#connection-label")).toHaveText("Phone connected");
  await page.waitForFunction(
    () =>
      document.getElementById("screen").naturalWidth > 0 &&
      !document.getElementById("screen-cover").hidden === false,
  );
  const call = async (op, data = {}) =>
    (
      await page.request.post(running.url + "/api/action", {
        headers: { Origin: running.url },
        data: { op, ...data },
      })
    ).json();
  const control = async (text, id) => {
    const state = await call("inspect");
    const n = state.data.nodes.find((n) =>
      id ? n.id === id : n.text === text,
    );
    if (!n) throw new Error("Expected native control is not visible");
    const f = await (await page.request.get(running.url + "/api/frame")).json();
    if (!f.ok) throw new Error(f.message);
    await page.waitForTimeout(100);
    const r = await page.locator("#screen").boundingBox();
    const [x, y, x2, y2] = n.bounds;
    await page.mouse.click(
      r.x + ((x + x2) / 2 / f.data.width) * r.width,
      r.y + ((y + y2) / 2 / f.data.height) * r.height,
    );
  };
  await call("openFixture");
  await page.waitForTimeout(1000);
  const before = await witness();
  await control("Refresh solar reading");
  await expect
    .poll(async () => (await witness()).watts, { timeout: 8000 })
    .toBe(before.watts + 7);
  report.checks.push(
    "Browser pointer mapping has independent Android task effect",
  );
  await control(null, "dev.remoteaccess.spike:id/station_name");
  await page.waitForTimeout(700);
  await expect(page.locator("#typing")).toBeEnabled();
  let delayRead = true;
  await page.route("**/api/action", async (route) => {
    if (delayRead && route.request().postDataJSON()?.op === "inspect") {
      delayRead = false;
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve, 900));
      await route.fulfill({ response });
    } else await route.continue();
  });
  await page.locator("#read-field").click();
  await expect(page.locator("#typing")).toBeEnabled();
  await page.locator("#typing").focus();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.press("Backspace");
  await page.evaluate(() => {
    window.keyLatencies = [];
    let at = 0;
    document.getElementById("typing").addEventListener("keydown", () => {
      at = performance.now();
    });
    document.getElementById("typing").addEventListener("input", () => {
      if (at) window.keyLatencies.push(performance.now() - at);
    });
  });
  const sequential = "Solar station beside the RV";
  let expected = "";
  for (const key of sequential) {
    await page.keyboard.type(key);
    expected += key;
    await expect(page.locator("#typing")).toHaveValue(expected);
    await page.waitForTimeout(35);
  }
  await page.keyboard.insertText(" · café ☀ 🔋 日本語");
  expected += " · café ☀ 🔋 日本語";
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Delete");
  expected = expected[0] + expected.slice(2);
  await page.keyboard.press("End");
  await page.keyboard.press("Backspace");
  expected = expected.slice(0, -1);
  await expect(page.locator("#typing")).toHaveValue(expected);
  await expect
    .poll(async () => (await witness()).name, { timeout: 10000 })
    .toBe(expected);
  const latency = await page.evaluate(() => Math.max(...window.keyLatencies));
  if (latency >= 100)
    throw new Error(
      `Local keyboard acknowledgement exceeded 100 ms: ${latency}`,
    );
  await page.waitForTimeout(1800);
  await expect(page.locator("#typing")).toHaveValue(expected);
  report.checks.push(
    "Sequential typing, cursor Delete, Backspace and Unicode match independent Android data during live refresh",
  );
  report.checks.push(
    "A deliberately delayed native field read cannot overwrite newer local keystrokes",
  );
  report.maxLocalKeyboardAcknowledgementMs = latency;
  await page.keyboard.press("Tab");
  await page.screenshot({
    path: `${evidence}/viewer-desktop.png`,
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > innerWidth,
  );
  if (overflow) throw new Error("Mobile layout overflows horizontally");
  await page.screenshot({
    path: `${evidence}/viewer-mobile.png`,
    fullPage: true,
  });
  report.checks.push(
    "Desktop and mobile layouts render without horizontal overflow",
  );
  if (errors.length) throw new Error(errors.join("\n"));
  report.checks.push("No uncaught browser errors");
  report.passed = true;
  console.log(JSON.stringify(report, null, 2));
} finally {
  await writeFile(
    `${local}/browser-acceptance-api${receipt.api}.json`,
    JSON.stringify(report, null, 2),
  );
  await browser.close();
}
