import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import { createServer } from "vite";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, ".local/viewer-layout-proof");
await mkdir(artifacts, { recursive: true });
const server = await createServer({
  configFile: false,
  root: path.join(root, "web"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  plugins: [
    {
      name: "layout-proof",
      configureServer(vite) {
        vite.middlewares.use("/layout-proof", (_req, res) => {
          res.setHeader("Content-Type", "text/html");
          res.end(
            `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script type="module" src="/@fs/${path.join(root, "web/test/layout-fixture.tsx")}"></script>`,
          );
        });
      },
    },
  ],
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function geometry(page: Page) {
  return page.evaluate(() => ({
    scroll: { x: scrollX, y: scrollY },
    boxes: [
      ".viewer-heading h1",
      ".viewer-status",
      ".screen-stage",
      ".control-dock",
    ].map((selector) => {
      const rect = document.querySelector(selector)?.getBoundingClientRect();
      if (!rect) throw Error(`Missing ${selector}`);
      return {
        selector,
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      };
    }),
  }));
}
type Geometry = Awaited<ReturnType<typeof geometry>>;
async function stable(page: Page, baseline: Geometry) {
  const current = await geometry(page);
  assert.deepEqual(
    current,
    baseline,
    "Viewer geometry and page scroll must remain unchanged",
  );
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
    "No horizontal page overflow",
  );
}
const results: unknown[] = [];
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw Error("No fixture address");
  browser = await chromium.launch({ headless: true });
  for (const [name, width, height] of [
    ["desktop", 1280, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 680],
    ["landscape", 844, 390],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height } });
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("dialog", (dialog) => void dialog.accept()); // Synthetic fixture only.
    await page.goto(`http://127.0.0.1:${address.port}/layout-proof`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Test phone",
    );
    await expect(page.getByRole("status")).toHaveCount(1);
    const baseline = await geometry(page);
    assert.equal(baseline.scroll.y, 0);
    await page.screenshot({
      path: path.join(artifacts, `${name}-locked.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Use saved PIN", exact: true })
      .click();
    await expect(page.getByLabel("Phone PIN", { exact: true })).toBeHidden();
    await stable(page, baseline);
    await expect
      .poll(() =>
        page
          .locator("canvas")
          .evaluate(
            (c) =>
              (c as HTMLCanvasElement)
                .getContext("2d")
                ?.getImageData(0, 0, 1, 1).data[1] ?? 0,
          ),
      )
      .toBeGreaterThan(10);
    await stable(page, baseline); // First decoded still cannot resize the stage.
    await page.screenshot({
      path: path.join(artifacts, `${name}-unlocked.png`),
      fullPage: true,
    });
    for (const button of ["Back", "Home", "Recents", "Wake screen"]) {
      await page.getByRole("button", { name: button, exact: true }).click();
      await stable(page, baseline);
    }
    await page.getByRole("button", { name: "Lock phone", exact: true }).click();
    await expect(page.getByLabel("Phone PIN", { exact: true })).toBeVisible();
    await stable(page, baseline);
    await page.getByLabel("Phone PIN", { exact: true }).fill("1234");
    await page
      .getByRole("button", { name: "Unlock phone", exact: true })
      .click();
    await expect(page.getByLabel("Phone PIN", { exact: true })).toBeHidden();
    await stable(page, baseline);
    await page.evaluate(() => window.layoutFixture.failNext());
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("deliberately long");
    await stable(page, baseline);
    await page.evaluate(() =>
      window.layoutFixture.patch({ locked: true, unlockBlocked: true }),
    );
    await expect(
      page.getByText("Unlock was already attempted.", { exact: false }),
    ).toBeVisible();
    await stable(page, baseline);
    await page.evaluate(() =>
      window.layoutFixture.patch({ accessibility: false }),
    );
    await expect(
      page.getByRole("heading", { name: "Enable screen access" }),
    ).toBeVisible();
    await stable(page, baseline);
    await page.evaluate(() =>
      window.layoutFixture.patch({
        locked: false,
        unlockBlocked: false,
        accessibility: true,
        width: 2400,
        height: 1080,
        scene: 2,
      }),
    );
    await expect
      .poll(() =>
        page.locator("canvas").evaluate((c) => (c as HTMLCanvasElement).width),
      )
      .toBe(2400);
    await stable(page, baseline); // Rotation changes only the contained image.
    const canvas = await page.locator("canvas").boundingBox();
    assert.ok(canvas);
    assert.ok(
      Math.abs(canvas.width / canvas.height - 2400 / 1080) < 0.01,
      "Displayed canvas preserves touch coordinate aspect ratio",
    );
    for (const [open, close] of [
      ["Viewing quality", "Close viewing quality"],
      ["Type or open an app", "Close typing controls"],
    ] as const) {
      await page.getByRole("button", { name: open, exact: true }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await stable(page, baseline);
      if (open === "Type or open an app") {
        await page
          .getByLabel("Text for the focused field")
          .fill("Synthetic fixture text");
        await page
          .getByRole("button", { name: "Send text", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Choose an app", exact: true })
          .click();
        await page
          .getByRole("combobox", { name: "Open app", exact: true })
          .selectOption("test.fixture.app");
        await stable(page, baseline);
      }
      await page.getByRole("button", { name: close, exact: true }).click();
      await stable(page, baseline);
    }
    await page.screenshot({
      path: path.join(artifacts, `${name}.png`),
      fullPage: true,
    });
    assert.deepEqual(errors, []);
    results.push({
      name,
      width,
      height,
      stableGeometry: true,
      unchangedScroll: true,
      singleStatus: true,
      errors,
    });
    console.log(
      `${name}: lock/unlock, messages, permission loss, rotation and dialogs keep geometry and scroll stable`,
    );
    await page.close();
  }
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(results, null, 2),
    { mode: 0o600 },
  );
} finally {
  await browser?.close();
  await server.close();
}
