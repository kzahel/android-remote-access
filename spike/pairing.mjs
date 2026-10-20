// QR pairing without accounts. The browser and the phone each hold a P-256
// key; the QR code carries a one-time secret the relay never sees, so the
// browser can check that the phone key it receives belongs to the phone that
// scanned its screen, and the phone can check the browser key against the
// fingerprint in the code. The relay only records which keys are paired.
import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  verify,
} from "node:crypto";
import { readFile, writeFile, rename } from "node:fs/promises";

export const PAIRING_TTL_MS = 5 * 60 * 1000;
const MAX_PENDING = 8;
const nonce = () => randomBytes(24).toString("base64url");

export const fingerprint = (spki) =>
  createHash("sha256").update(Buffer.from(spki, "base64")).digest("base64url");

/** Phones sign DER (Java); browsers sign IEEE P1363 (WebCrypto). */
export function verifySignature(spki, message, signature, dsaEncoding) {
  try {
    if (typeof spki !== "string" || typeof signature !== "string") return false;
    const key = createPublicKey({
      key: Buffer.from(spki, "base64"),
      format: "der",
      type: "spki",
    });
    if (key.asymmetricKeyDetails?.namedCurve !== "prime256v1") return false;
    return verify(
      "sha256",
      Buffer.from(message),
      { key, dsaEncoding },
      Buffer.from(signature, "base64"),
    );
  } catch {
    return false;
  }
}

/** What the browser checks before confirming; exported for tests and fakes. */
export const pairMac = (secret, id, phoneKey, viewerFpr) =>
  createHmac("sha256", Buffer.from(secret, "base64url"))
    .update(`rap1-pair-mac|${id}|${phoneKey}|${viewerFpr}`)
    .digest("base64url");

export const messages = {
  viewerLogin: (n) => `rap1-viewer-login|${n}`,
  phoneHello: (n, generation) => `rap1-phone-hello|${n}|${generation}`,
  phonePair: (n, id) => `rap1-phone-pair|${n}|${id}`,
  confirm: (id, phoneFpr) => `rap1-pair-confirm|${id}|${phoneFpr}`,
};

const text = (value, max) =>
  typeof value === "string" && value.length > 0 && value.length <= max;

export async function createPairing({ file, routes = [] }) {
  let data = { phones: {} };
  try {
    data = JSON.parse(await readFile(file, "utf8"));
  } catch {}
  data.phones ||= {};
  const pending = new Map();
  let saving = Promise.resolve();
  const save = () =>
    (saving = saving.then(async () => {
      await writeFile(file + ".tmp", JSON.stringify(data, null, 2), {
        mode: 0o600,
      });
      await rename(file + ".tmp", file);
    }));
  const prune = () => {
    for (const [id, p] of pending)
      if (Date.now() > p.expires) {
        p.phone?.socket.destroy();
        pending.delete(id);
      }
  };

  return {
    challenge: nonce,
    routes: () => routes,
    phones: () => data.phones,

    /** A paired phone's hello; returns its fingerprint or null. */
    phoneHello(hello, challenge) {
      if (!text(hello.phoneKey, 512)) return null;
      const fpr = fingerprint(hello.phoneKey);
      const phone = data.phones[fpr];
      if (!phone || phone.key !== hello.phoneKey) return null;
      if (
        !verifySignature(
          hello.phoneKey,
          messages.phoneHello(challenge, hello.generation),
          hello.signature,
          "der",
        )
      )
        return null;
      return fpr;
    },

    /** The phone's list is authoritative for removals; it cannot add viewers. */
    async reconcile(phoneFpr, viewers) {
      const phone = data.phones[phoneFpr];
      if (!phone || !Array.isArray(viewers)) return;
      let changed = false;
      for (const fpr of Object.keys(phone.viewers))
        if (!viewers.includes(fpr)) {
          delete phone.viewers[fpr];
          changed = true;
        }
      if (changed) await save();
    },

    viewerPaired(viewerFpr, phoneFpr) {
      if (!viewerFpr) return false;
      if (phoneFpr) return !!data.phones[phoneFpr]?.viewers[viewerFpr];
      return Object.values(data.phones).some((p) => p.viewers[viewerFpr]);
    },

    viewerLogin(session, body) {
      const challenge = session.challenge;
      session.challenge = null;
      if (!challenge || !text(body.key, 512)) return false;
      if (
        !verifySignature(
          body.key,
          messages.viewerLogin(challenge),
          body.signature,
          "ieee-p1363",
        )
      )
        return false;
      const fpr = fingerprint(body.key);
      if (!this.viewerPaired(fpr)) return false;
      session.viewer = fpr;
      return true;
    },

    start(session, body) {
      prune();
      if (pending.size >= MAX_PENDING)
        throw new Error("Too many pairing codes are open; try again shortly");
      if (!text(body.key, 512) || !text(body.name, 60))
        throw new Error("A browser key and name are required");
      if (!createPublicKey({ key: Buffer.from(body.key, "base64"), format: "der", type: "spki" }))
        throw new Error("Invalid browser key");
      if (!routes.length) throw new Error("No phone route is configured");
      const id = nonce();
      const expires = Date.now() + PAIRING_TTL_MS;
      pending.set(id, {
        session,
        viewerKey: body.key,
        viewerFpr: fingerprint(body.key),
        viewerName: body.name,
        expires,
        phone: null,
      });
      return { id, routes, expiresAt: expires };
    },

    status(session, id) {
      prune();
      const p = pending.get(id);
      if (!p || p.session !== session) return { state: "expired" };
      if (!p.phone) return { state: "waiting", expiresAt: p.expires };
      const { key, name, mac } = p.phone;
      return { state: "phone", phoneKey: key, phoneName: name, mac };
    },

    /** The browser checked the phone's MAC and signs the phone key it accepts. */
    async confirm(session, body) {
      const p = pending.get(body.id);
      if (!p || p.session !== session || !p.phone)
        throw new Error("This pairing code is no longer waiting");
      const phoneFpr = fingerprint(p.phone.key);
      if (
        !verifySignature(
          p.viewerKey,
          messages.confirm(body.id, phoneFpr),
          body.signature,
          "ieee-p1363",
        )
      )
        throw new Error("Browser confirmation failed");
      pending.delete(body.id);
      const phone = (data.phones[phoneFpr] ||= {
        key: p.phone.key,
        name: p.phone.name,
        viewers: {},
      });
      phone.name = p.phone.name;
      phone.viewers[p.viewerFpr] = {
        key: p.viewerKey,
        name: p.viewerName,
        pairedAt: Date.now(),
      };
      await save();
      const socket = p.phone.socket;
      socket.end(
        JSON.stringify({
          type: "paired",
          viewerKey: p.viewerKey,
          viewerName: p.viewerName,
        }) + "\n",
      );
      session.viewer = p.viewerFpr;
      return { ok: true, phoneName: phone.name };
    },

    /** A phone that scanned a code and pressed Grant. */
    phonePair(socket, msg, challenge) {
      prune();
      const p = pending.get(msg.id);
      if (
        !p ||
        p.phone ||
        !text(msg.phoneKey, 512) ||
        !text(msg.mac, 64) ||
        !text(msg.name, 60) ||
        !verifySignature(
          msg.phoneKey,
          messages.phonePair(challenge, msg.id),
          msg.signature,
          "der",
        )
      ) {
        socket.end(
          JSON.stringify({
            type: "pairRefused",
            message: "This pairing code expired or was already used",
          }) + "\n",
        );
        return false;
      }
      p.phone = { socket, key: msg.phoneKey, name: msg.name, mac: msg.mac };
      socket.on("close", () => {
        if (pending.get(msg.id)?.phone?.socket === socket)
          pending.delete(msg.id);
      });
      return true;
    },
    saved: () => saving,
  };
}
