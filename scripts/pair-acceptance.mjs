// QR pairing on the attached phone: a fresh browser pairs, reaches the phone
// with its own key, and loses access when the phone removes it. Opening the
// code's link over ADB stands in for the camera; Grant is tapped like an owner.
import { chromium } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";

const run = promisify(execFile);
const running = JSON.parse(await readFile(".local/phone/running.json", "utf8"));
const phone = (code) =>
  run("python3", ["-c", `import sys; sys.path.insert(0,'scripts'); import phone; ${code}`]);
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) throw new Error(name);
};
const until = async (fn, ms, what) => {
  for (const end = Date.now() + ms; Date.now() < end; ) {
    try {
      const value = await fn();
      if (value) return value;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

// Removal below must only ever touch the browser this run pairs.
const pairings = JSON.parse(await readFile(".local/phone/pairings.json", "utf8").catch(() => "{}"));
if (Object.values(pairings.phones || {}).some((p) => Object.keys(p.viewers).length))
  throw new Error("A browser is already paired with this phone; remove it on the phone first");

const browser = await chromium.launch();
try {
  const page = await (await browser.newContext()).newPage();
  await page.goto(running.url);
  check("An unpaired browser is sent to pairing", new URL(page.url()).pathname === "/pair");
  const link = await until(() => page.locator("#pair-code").getAttribute("data-link"), 10000, "pairing code");
  const api = (path) => page.evaluate(async (p) => (await fetch(p)).status, path);
  check("An unpaired browser cannot read phone state", (await api("/api/state")) === 401);

  await phone(`phone.adb('shell','am','start','-a','android.intent.action.VIEW','-d',"'"+${JSON.stringify(link)}+"'")`);
  await until(async () => (await phone("print(phone.click('Grant'))")).stdout.includes("True"), 15000, "Grant button");
  await page.waitForURL((url) => url.pathname === "/", { timeout: 30000 });
  check("Grant on the phone pairs the browser", true);

  const state = await until(async () => {
    const s = await page.evaluate(async () => (await fetch("/api/state")).json());
    return s.connected && s.deviceName && s.deviceName !== "Demo phone" ? s : null;
  }, 20000, "the phone to reconnect with its key");
  check(`The phone reconnects with its own key as “${state.deviceName}”`, true);
  // The first still after a reconnect can be refused as rate limited or changed.
  const frame = await until(async () => (await page.evaluate(async () => (await fetch("/api/frame")).json())).ok, 10000, "a screenshot");
  check("The paired browser sees the screen", frame === true);

  // A new session in the same profile proves the stored key, not a cookie.
  await page.context().clearCookies();
  const fresh = await page.context().newPage();
  await fresh.goto(running.url);
  await fresh.waitForURL((url) => url.pathname === "/", { timeout: 10000 });
  const status = (path) => fresh.evaluate(async (p) => (await fetch(p)).status, path);
  check("The same browser profile signs in again without a code", (await status("/api/state")) === 200);

  await phone("phone.adb('shell','am','start','-n',phone.PACKAGE+'/.SetupActivity','--activity-clear-top')");
  await until(async () => (await phone("print(phone.click('Remove'))")).stdout.includes("True"), 15000, "Remove button");
  await until(async () => (await status("/api/state")) === 401, 15000, "revocation");
  check("Removing the browser on the phone revokes it", true);
  const saved = JSON.parse(await readFile(".local/phone/pairings.json", "utf8"));
  check("The relay no longer lists it", Object.values(saved.phones).every((p) => !Object.keys(p.viewers).length));
} finally {
  await browser.close();
}
