import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, expect, type Page } from "@playwright/test";
import jsQR from "jsqr";
import { PNG } from "pngjs";
import { createServer } from "vite";
import {
  type Grant,
  grantBytes,
  grantMac,
  hex,
  type Invitation,
  verifySignature,
} from "../protocol/src/enrollment.js";
import { b64, createIdentity, unb64 } from "../protocol/src/index.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const artifacts = path.join(root, ".local/viewer-phones-proof");
await mkdir(artifacts, { recursive: true });
const first = await createIdentity();
const second = await createIdentity();
const models = {
  [b64(first.publicKey)]: "Pixel 9",
  [b64(second.publicKey)]: "Pixel 7a",
};
const server = await createServer({
  configFile: false,
  root: path.join(root, "web"),
  logLevel: "error",
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
  plugins: [
    {
      name: "phones-proof",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (req.url === "/fixture-models") {
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify(models));
            return;
          }
          if (req.url === "/fixture-bootstrap") {
            res.setHeader("Content-Type", "text/html");
            res.end("<!doctype html><title>Fixture bootstrap</title>");
            return;
          }
          if (
            req.url === "/" ||
            req.url === "/pair" ||
            req.url?.startsWith("/phones/")
          ) {
            res.setHeader("Content-Type", "text/html");
            res.end(
              `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div><script type="module" src="/@fs/${path.join(root, "web/test/phones-fixture.tsx")}"></script></body></html>`,
            );
            return;
          }
          next();
        });
      },
    },
  ],
});
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
async function records(page: Page) {
  return page.evaluate(async () => {
    const module = "/src/store.ts";
    return (await import(module)).savedPhones() as Promise<
      {
        id: string;
        alias?: string;
        model?: string;
        lastContactAt?: number;
        grant: Grant;
      }[]
    >;
  });
}
async function manage(page: Page, name: string) {
  await page
    .getByRole("button", { name: `Manage ${name}`, exact: true })
    .click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function rename(page: Page, name: string, alias: string) {
  await manage(page, name);
  await page.getByLabel("Phone name", { exact: true }).fill(alias);
  await page.getByRole("button", { name: "Save name", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
}
try {
  await server.listen();
  const address = server.httpServer?.address();
  if (!address || typeof address === "string")
    throw Error("Missing fixture address");
  const origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  const errors: string[] = [];
  context.on("page", (page) =>
    page.on("pageerror", (error) => errors.push(error.message)),
  );
  const home = await context.newPage();
  await home.goto(`${origin}/fixture-bootstrap`);
  // Real v1 database and structured-cloned non-exportable keys, as deployed.
  const legacy = await home.evaluate(async (phone) => {
    const keys = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    const viewer = btoa(
      String.fromCharCode(
        ...new Uint8Array(await crypto.subtle.exportKey("raw", keys.publicKey)),
      ),
    );
    const grant: Grant = {
      id: "a".repeat(32),
      phone,
      viewer,
      expires: 1,
      mac: "fixture",
      phoneSignature: "fixture",
      viewerSignature: "fixture",
    };
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("remote-access-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("state");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("state", "readwrite");
      tx.objectStore("state").put(keys, "identity");
      tx.objectStore("state").put(grant, "grant");
      tx.oncomplete = () => resolve();
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return grant;
  }, b64(first.publicKey));
  const other = await context.newPage();
  await Promise.all([home.goto(origin), other.goto(origin)]);
  await expect(
    home.getByRole("link", { name: "Open Your phone", exact: true }),
  ).toBeVisible();
  const migrated = await records(home);
  assert.equal(migrated.length, 1);
  assert.deepEqual(migrated[0]?.grant, legacy);
  const firstId = migrated[0]?.id;
  assert.ok(firstId);
  const keyPreserved = await home.evaluate(async (viewer) => {
    const module = "/src/store.ts";
    const identity = await (await import(module)).browserIdentity();
    return btoa(String.fromCharCode(...identity.publicKey)) === viewer;
  }, legacy.viewer);
  assert.equal(keyPreserved, true);
  console.log("Concurrent v1 migration preserved the pairing and browser key");
  const a = await context.newPage();
  await a.goto(`${origin}/phones/${firstId}`);
  await a
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(a.getByRole("region", { name: "Remote screen" })).toBeVisible();
  await expect(
    home.getByRole("link", { name: "Pixel 9", exact: true }),
  ).toBeVisible();
  await expect(home.locator("time")).toHaveCount(1);
  await a.getByRole("button", { name: "Disconnect", exact: true }).click();
  // A failed check cannot change the successful-contact timestamp.
  const beforeFailure = (await records(a))[0]?.lastContactAt;
  await a.evaluate(() => {
    window.phonesFixture.fail = true;
  });
  await a
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(a.getByRole("status")).toHaveText(
    "Fixture phone is unavailable",
  );
  assert.equal((await records(a))[0]?.lastContactAt, beforeFailure);
  await a.evaluate(() => {
    window.phonesFixture.fail = false;
  });
  await rename(home, "Pixel 9", "RV phone");
  await expect(a.getByRole("heading", { level: 1 })).toHaveText("RV phone");
  await expect(a).toHaveTitle("RV phone · Remote access");
  // Pair another phone through the real QR/signature/receipt UI.
  const offered = new Map<string, Grant>();
  await context.route("**/api/pair/**", async (route) => {
    const request = route.request();
    const parts = new URL(request.url()).pathname.split("/");
    const id = parts[3] ?? "";
    if (parts[4] === "complete") {
      const grant = offered.get(id);
      assert.ok(grant);
      const body = request.postDataJSON() as { viewerSignature: string };
      await verifySignature(
        grant.viewer,
        grantBytes(origin, grant),
        body.viewerSignature,
      );
      await route.fulfill({ json: { state: "paired" } });
    } else
      await route.fulfill({
        json: offered.has(id)
          ? { state: "offered", grant: offered.get(id) }
          : { state: "pending" },
      });
  });
  await other.getByRole("link", { name: "Add phone", exact: true }).click();
  await other
    .getByRole("button", { name: "Create pairing code", exact: true })
    .click();
  const qr = PNG.sync.read(
    await other
      .getByRole("img", { name: "Scan to pair this browser" })
      .screenshot(),
  );
  const decoded = jsQR(new Uint8ClampedArray(qr.data), qr.width, qr.height);
  assert.ok(decoded);
  const invitation = JSON.parse(
    new TextDecoder().decode(unb64(decoded.data.slice(18))),
  ) as Invitation;
  const grant: Grant = {
    id: invitation.id,
    viewer: invitation.viewer,
    phone: b64(second.publicKey),
    expires: invitation.expires,
    phoneSignature: "",
    mac: "",
  };
  const bytes = grantBytes(origin, grant);
  grant.phoneSignature = b64(await second.sign(bytes));
  grant.mac = hex(await grantMac(invitation.secret, bytes));
  offered.set(grant.id, grant);
  await expect(other).toHaveURL(/\/phones\/[a-f0-9]{64}$/);
  const both = await records(home);
  assert.equal(both.length, 2);
  const secondId = both.find((phone) => phone.grant.phone === grant.phone)?.id;
  assert.ok(secondId);
  assert.equal(both.find((phone) => phone.id === firstId)?.alias, "RV phone");
  console.log("Pairing a second phone preserved the first phone and its alias");
  await other
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await a
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(
    other.getByRole("region", { name: "Remote screen" }),
  ).toBeVisible();
  await expect(a.getByRole("region", { name: "Remote screen" })).toBeVisible();
  await expect(other.getByRole("heading", { level: 1 })).toHaveText("Pixel 7a");
  await expect(a.getByRole("heading", { level: 1 })).toHaveText("RV phone");
  assert.deepEqual(
    await a.evaluate(() => window.phonesFixture.calls.slice(-1)),
    [legacy.id],
  );
  assert.deepEqual(await other.evaluate(() => window.phonesFixture.calls), [
    grant.id,
  ]);
  const competing = await context.newPage();
  await competing.goto(a.url());
  await competing
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(competing.getByRole("status")).toContainText(
    "already in use in another tab",
  );
  assert.deepEqual(
    await competing.evaluate(() => window.phonesFixture.calls),
    [],
  );
  await a.getByRole("button", { name: "Disconnect", exact: true }).click();
  await competing
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(
    competing.getByRole("region", { name: "Remote screen" }),
  ).toBeVisible();
  await competing
    .getByRole("button", { name: "Disconnect", exact: true })
    .click();
  console.log(
    "Two phones connected independently; same-phone contention sent no extra request",
  );
  // Cancellation must release only its own lease, allowing a fresh connection.
  await a.evaluate(() => {
    window.phonesFixture.delay = true;
  });
  await a
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect
    .poll(() => a.evaluate(() => window.phonesFixture.calls.length))
    .toBe(4);
  await a
    .getByRole("button", { name: "Cancel connection", exact: true })
    .click();
  await a.evaluate(() => {
    window.phonesFixture.delay = false;
  });
  await a
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(a.getByRole("region", { name: "Remote screen" })).toBeVisible();
  // Concurrent transactions edit different fields of the same record.
  await Promise.all([
    home.evaluate(async (id) => {
      const module = "/src/store.ts";
      await (await import(module)).renamePhone(id, "Travel phone");
    }, firstId),
    other.evaluate(async (id) => {
      const module = "/src/store.ts";
      await (await import(module)).contactedPhone(id, "Pixel 9");
    }, firstId),
  ]);
  await expect(a.getByRole("heading", { level: 1 })).toHaveText("Travel phone");
  const updated = (await records(home)).find((phone) => phone.id === firstId);
  assert.equal(updated?.alias, "Travel phone");
  assert.equal(updated?.model, "Pixel 9");
  assert.ok(updated.lastContactAt);
  await home.reload();
  await expect(
    home.getByRole("link", { name: "Open Travel phone", exact: true }),
  ).toBeVisible();
  await other.reload();
  await expect(other).toHaveURL(`${origin}/phones/${secondId}`);
  await expect(other.getByRole("heading", { level: 1 })).toHaveText("Pixel 7a");
  // Unknown URLs never select a different saved phone or send a request.
  await competing.goto(`${origin}/phones/${"0".repeat(64)}`);
  await expect(competing.getByRole("heading", { level: 1 })).toHaveText(
    "Phone not saved",
  );
  assert.deepEqual(
    await competing.evaluate(() => window.phonesFixture.calls),
    [],
  );
  // A fresh browser cannot use the URL as an authorization token.
  const fresh = await browser.newContext();
  const unpaired = await fresh.newPage();
  await unpaired.goto(`${origin}/phones/${secondId}`);
  await expect(unpaired.getByRole("heading", { level: 1 })).toHaveText(
    "Phone not saved",
  );
  assert.deepEqual(
    await unpaired.evaluate(() => window.phonesFixture.calls),
    [],
  );
  await fresh.close();
  // Re-pair the same identity without creating a duplicate or losing metadata.
  const repaired = await home.evaluate(async (id) => {
    const module = "/src/store.ts";
    const store = await import(module);
    const existing = (await store.savedPhones()).find(
      (phone: { id: string }) => phone.id === id,
    );
    await store.rememberPhone({ ...existing.grant, id: "b".repeat(32) });
    return store.savedPhones() as Promise<
      { id: string; alias?: string; lastContactAt?: number; grant: Grant }[]
    >;
  }, firstId);
  assert.equal(repaired.length, 2);
  assert.equal(
    repaired.find((phone) => phone.id === firstId)?.alias,
    "Travel phone",
  );
  assert.equal(
    repaired.find((phone) => phone.id === firstId)?.grant.id,
    "b".repeat(32),
  );
  assert.ok(repaired.find((phone) => phone.id === firstId)?.lastContactAt);
  await expect(
    a.getByRole("button", { name: "Connect to phone", exact: true }),
  ).toBeVisible();
  await a
    .getByRole("button", { name: "Connect to phone", exact: true })
    .click();
  await expect(a.getByRole("region", { name: "Remote screen" })).toBeVisible();
  for (const [name, width, height] of [
    ["desktop", 1280, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 680],
  ] as const) {
    await home.setViewportSize({ width, height });
    assert.equal(
      await home.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await home.screenshot({
      path: path.join(artifacts, `${name}-two-phones.png`),
      fullPage: true,
    });
  }
  await manage(home, "Travel phone");
  await home
    .getByRole("button", { name: "Forget this phone", exact: true })
    .click();
  await home.getByRole("button", { name: "Forget phone", exact: true }).click();
  await expect(a.getByRole("heading", { level: 1 })).toHaveText(
    "Phone not saved",
  );
  assert.equal(await a.evaluate(() => window.phonesFixture.closed), 4);
  const remaining = await records(home);
  assert.equal(remaining.length, 1);
  assert.equal(remaining[0]?.id, secondId);
  await other
    .getByRole("button", { name: "Check connection", exact: true })
    .click();
  await expect(other.getByRole("status")).toHaveText(
    "Secure connection verified.",
  );
  console.log(
    "Rename/contact updates, refresh, unknown URLs and cross-tab forgetting passed",
  );
  for (const [name, width, height] of [
    ["desktop", 1280, 1000],
    ["mobile", 390, 844],
    ["small-mobile", 320, 680],
  ] as const) {
    await home.setViewportSize({ width, height });
    assert.equal(
      await home.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
    );
    await home.screenshot({
      path: path.join(artifacts, `${name}.png`),
      fullPage: true,
    });
  }
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(artifacts, "result.json"),
    JSON.stringify(
      {
        migration: true,
        pairingPreserved: true,
        independentPhones: true,
        samePhoneLease: true,
        cancellation: true,
        sharedMetadata: true,
        deepLinks: true,
        forgetClosesSession: true,
        responsive: true,
        errors,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  await context.close();
} finally {
  await browser?.close();
  await server.close();
}
