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
            `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><script src="/appearance.js"></script><div id="root"></div><script type="module" src="/@fs/${path.join(root, "web/test/layout-fixture.tsx")}"></script>`,
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
    ["wide-desktop", 1728, 997],
    ["mobile", 390, 844],
    ["small-mobile", 320, 680],
    ["landscape", 844, 390],
  ] as const) {
    const context = await browser.newContext({
      viewport: { width, height },
      colorScheme: "light",
    });
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const dialogs: string[] = [];
    page.on("dialog", (dialog) => {
      dialogs.push(dialog.type());
      void dialog.dismiss();
    });
    await page.goto(`http://127.0.0.1:${address.port}/layout-proof`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Test phone",
    );
    await expect(page.getByRole("status")).toHaveCount(1);
    const baseline = await geometry(page);
    assert.equal(baseline.scroll.y, 0);
    const stage = baseline.boxes[2];
    const rail = baseline.boxes[3];
    assert.ok(
      stage && rail && rail.x >= stage.x + stage.width,
      "Controls sit to the right of the screen",
    );
    assert.ok(stage.y + stage.height <= height, "Screen fits the viewport");
    await page.getByRole("button", { name: "Toggle navigation" }).click();
    if (width >= 900) {
      await expect(page.locator(".app-sidebar")).toBeHidden();
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(page.locator(".app-sidebar")).toBeVisible();
    } else {
      await expect(
        page.getByRole("dialog", { name: "Navigation", exact: true }),
      ).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(
        page.getByRole("button", { name: "Toggle navigation" }),
      ).toBeFocused();
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await page.mouse.click(width - 8, height / 2);
      await expect(
        page.getByRole("dialog", { name: "Navigation", exact: true }),
      ).toBeHidden();
    }
    await stable(page, baseline);
    await page.screenshot({
      path: path.join(artifacts, `${name}-locked.png`),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "Use saved PIN", exact: true })
      .click();
    assert.deepEqual(
      dialogs,
      [],
      "Saved PIN unlock acts without a confirmation dialog",
    );
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
    if (width >= 900) {
      const screen = await page.locator("canvas").boundingBox();
      assert.ok(screen && rail);
      assert.ok(
        rail.x - screen.x - screen.width <= 16,
        "Controls stay beside the portrait phone on wide desktops",
      );
    }
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
    await expect(
      page.getByRole("button", { name: "Use saved PIN", exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Unlock phone", exact: true }),
    ).toBeDisabled();
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
    await expect(
      page.getByRole("heading", { name: "Enable screen access" }),
    ).toBeHidden();
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
          .pressSequentially("Synthetic fixture text", { delay: 12 });
        await expect(page.getByLabel("Text for the focused field")).toHaveValue(
          "Synthetic fixture text",
        );
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
    // Settings overlay preserves the existing canvas and running session.
    await page
      .locator("canvas")
      .evaluate((c) => c.setAttribute("data-original", "yes"));
    if (width < 900)
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", {
      name: "Settings",
      exact: true,
    });
    await expect(settings).toBeVisible();
    await stable(page, baseline);
    await page.getByLabel("Dark", { exact: true }).check();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await page.getByLabel("Show control labels").check();
    await page.getByRole("button", { name: "Close settings" }).click();
    await expect(page.locator(".viewer-workspace")).toHaveAttribute(
      "data-labels",
      "true",
    );
    await expect(page.locator("canvas")).toHaveAttribute(
      "data-original",
      "yes",
    );
    await page.screenshot({
      path: path.join(artifacts, `${name}-dark-labels.png`),
      fullPage: true,
    });
    if (width < 900)
      await page.getByRole("button", { name: "Toggle navigation" }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Show control labels").uncheck();
    await page.getByLabel("System", { exact: true }).check();
    await page.getByRole("button", { name: "Close settings" }).click();
    await stable(page, baseline);
    await page.emulateMedia({ colorScheme: "dark" });
    await expect
      .poll(() =>
        page
          .locator("html")
          .evaluate((html) => getComputedStyle(html).backgroundColor),
      )
      .toBe("rgb(20, 26, 24)");
    await page.emulateMedia({ colorScheme: "light" });
    await expect
      .poll(() =>
        page
          .locator("html")
          .evaluate((html) => getComputedStyle(html).backgroundColor),
      )
      .toBe("rgb(246, 248, 247)");
    await stable(page, baseline);
    if (name === "desktop") {
      const peer = await page.context().newPage();
      await peer.goto(page.url());
      await peer.getByRole("button", { name: "Settings", exact: true }).click();
      await peer.getByLabel("Dark", { exact: true }).check();
      await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
      await peer.reload();
      await expect(peer.locator("html")).toHaveAttribute("data-theme", "dark");
      await peer.getByRole("button", { name: "Settings", exact: true }).click();
      await peer.getByLabel("System", { exact: true }).check();
      await expect(page.locator("html")).not.toHaveAttribute("data-theme");
      await peer.close();
      // Crossing the breakpoint closes the drawer and keeps the same canvas.
      await page.setViewportSize({ width: 390, height: 844 });
      await page.getByRole("button", { name: "Toggle navigation" }).click();
      await expect(
        page.getByRole("dialog", { name: "Navigation", exact: true }),
      ).toBeVisible();
      await page.setViewportSize({ width, height });
      await expect(page.locator(".app-sidebar")).toBeVisible();
      await expect(page.locator("canvas")).toHaveAttribute(
        "data-original",
        "yes",
      );
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
    await context.close();
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
