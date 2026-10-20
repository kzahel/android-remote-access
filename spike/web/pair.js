// Pairs this browser with a phone by QR code, without an account. The private
// key never leaves this browser; the code's secret never reaches the relay.
import { renderSVG } from "/vendor/uqr.mjs";

const $ = (id) => document.getElementById(id);
const enc = new TextEncoder();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const b64url = (bytes) =>
  b64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text) =>
  Uint8Array.from(atob(text.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );

async function api(path, data) {
  const response = await fetch(
    path,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Request failed");
  return value;
}

function store(mode, action) {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open("remote-access", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("keys");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const request = action(
        open.result.transaction("keys", mode).objectStore("keys"),
      );
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    };
  });
}

/** One non-extractable P-256 key per browser profile; it is the credential. */
async function browserKey() {
  let key = await store("readonly", (s) => s.get("viewer"));
  if (!key) {
    const pair = await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    );
    key = {
      privateKey: pair.privateKey,
      spki: b64(await crypto.subtle.exportKey("spki", pair.publicKey)),
    };
    await store("readwrite", (s) => s.put(key, "viewer"));
  }
  return key;
}
const sign = async (key, message) =>
  b64(
    await crypto.subtle.sign(
      { name: "ECDSA", hash: "SHA-256" },
      key.privateKey,
      enc.encode(message),
    ),
  );
const fingerprint = async (spki) =>
  b64url(
    await crypto.subtle.digest(
      "SHA-256",
      Uint8Array.from(atob(spki), (c) => c.charCodeAt(0)),
    ),
  );

function browserName() {
  const ua = navigator.userAgent;
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /Firefox\//.test(ua)
      ? "Firefox"
      : /Chrome\//.test(ua)
        ? "Chrome"
        : /Safari\//.test(ua)
          ? "Safari"
          : "Browser";
  const os = /Mac OS X/.test(ua)
    ? "Mac"
    : /Windows/.test(ua)
      ? "Windows"
      : /Android/.test(ua)
        ? "Android"
        : /iPhone|iPad/.test(ua)
          ? "iPhone"
          : /Linux/.test(ua)
            ? "Linux"
            : "computer";
  return `${browser} on ${os}`;
}

function say(title, lead = "", status = "") {
  $("pair-title").textContent = title;
  $("pair-lead").textContent = lead;
  $("pair-status").textContent = status;
}

async function login(key) {
  const { nonce } = await api("/api/viewer/challenge", {});
  const { ok } = await api("/api/viewer/login", {
    key: key.spki,
    signature: await sign(key, `rap1-viewer-login|${nonce}`),
  });
  return ok;
}

let polling = 0;
async function showCode(key) {
  const run = ++polling;
  $("pair-again").hidden = true;
  const viewerFpr = await fingerprint(key.spki);
  const name = browserName();
  const secret = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const { id, routes, expiresAt } = await api("/api/pair/start", {
    key: key.spki,
    name,
  });
  const fields = new URLSearchParams({
    v: "1",
    i: id,
    r: routes.map((r) => `${r.host}:${r.port}`).join(","),
    s: secret,
    f: viewerFpr,
    n: name,
  });
  const link = `rapair://pair#${fields}`;
  $("pair-qr").src =
    "data:image/svg+xml;charset=utf-8," +
    encodeURIComponent(renderSVG(link, { ecc: "M", border: 2 }));
  $("pair-link").textContent = link;
  $("pair-code").hidden = false;
  $("pair-code").dataset.link = link;
  say(
    "Add a phone",
    `Scan this code with the phone you want to reach. This browser will be named “${name}” on the phone.`,
    "Waiting for the phone…",
  );
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    fromB64url(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  while (run === polling) {
    const left = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
    $("pair-expiry").textContent = `This code works once and expires in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}.`;
    const status = await api(`/api/pair/status?id=${encodeURIComponent(id)}`);
    if (status.state === "expired") {
      $("pair-code").hidden = true;
      say("The code expired", "Show a new code when the phone is ready.");
      $("pair-again").hidden = false;
      return;
    }
    if (status.state === "phone") {
      // Only a phone that read this code knows the secret behind its MAC.
      const expected = b64url(
        await crypto.subtle.sign(
          "HMAC",
          hmacKey,
          enc.encode(
            `rap1-pair-mac|${id}|${status.phoneKey}|${viewerFpr}`,
          ),
        ),
      );
      if (expected !== status.mac) {
        $("pair-code").hidden = true;
        say(
          "Pairing refused",
          "The phone that answered could not prove it scanned this code. Nothing was paired.",
        );
        $("pair-again").hidden = false;
        return;
      }
      const phoneFpr = await fingerprint(status.phoneKey);
      const result = await api("/api/pair/confirm", {
        id,
        signature: await sign(key, `rap1-pair-confirm|${id}|${phoneFpr}`),
      });
      $("pair-code").hidden = true;
      say(
        `Paired with ${result.phoneName}`,
        "Opening the phone…",
      );
      location.replace("/");
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

async function main() {
  try {
    if (!globalThis.crypto?.subtle || !globalThis.indexedDB)
      throw new Error("This browser cannot keep a pairing key here");
    const key = await browserKey();
    if (await login(key)) {
      location.replace("/");
      return;
    }
    await showCode(key);
  } catch (error) {
    say("Pairing is unavailable", error.message);
    $("pair-again").hidden = false;
  }
}
$("pair-again").addEventListener("click", main);
main();
