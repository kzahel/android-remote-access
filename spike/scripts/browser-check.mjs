import { chromium } from "@playwright/test";
import { mkdir, readFile } from "node:fs/promises";
const { url } = JSON.parse(await readFile(".local/running.json", "utf8"));
await mkdir(".local/evidence", { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1050 },
    deviceScaleFactor: 1,
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(url);
  await page.waitForFunction(
    () => document.getElementById("screen").naturalWidth > 0,
    { timeout: 30000 },
  );
  await page.screenshot({
    path: ".local/evidence/viewer-desktop.png",
    fullPage: true,
  });
  console.log(
    JSON.stringify({
      title: await page.title(),
      status: await page.locator("#connection-label").textContent(),
      errors,
    }),
  );
} finally {
  await browser.close();
}
