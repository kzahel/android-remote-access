import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import type { Authority, Bytes, Identity } from "../src/index.js";
import {
  b64,
  Channel,
  concat,
  createIdentity,
  deriveMaterial,
  equal,
  hash,
  PhoneHandshake,
  unb64,
  utf8,
  ViewerHandshake,
} from "../src/index.js";

const vectors = JSON.parse(
  await readFile(
    new URL("../vectors/session-v1.json", import.meta.url),
    "utf8",
  ),
);
const mutate = (bytes: Bytes, at: number) => {
  const copy = bytes.slice();
  copy[at] = (copy[at] ?? 0) ^ 1;
  return copy;
};
async function setup() {
  const viewer = await createIdentity();
  const phone = await createIdentity();
  let active = true;
  const va: Authority = {
    id: new Uint8Array(16),
    generation: 1,
    peer: phone.publicKey,
    current: () => active,
  };
  const pa: Authority = { ...va, peer: viewer.publicKey };
  return {
    viewer,
    phone,
    va,
    pa,
    revoke: () => {
      active = false;
    },
  };
}
async function exchange(s: Awaited<ReturnType<typeof setup>>) {
  const v = await ViewerHandshake.start(s.viewer, s.va);
  const p = await PhoneHandshake.start(s.phone, s.pa, v.hello);
  const proof = await v.answer(p.offer);
  const accepted = await p.finish(proof);
  return {
    v: await v.finish(accepted.finish),
    p: accepted.channel,
    hello: v.hello,
    offer: p.offer,
  };
}
describe("shared vectors", () => {
  it("matches transcript, ECDH, HKDF, signatures and exact directional record bytes", async () => {
    const hello = unb64(vectors.hello);
    const offer = unb64(vectors.offer);
    const transcript = await hash(
      concat(
        utf8("ara/session/transcript/v1\0"),
        hello,
        offer.subarray(0, 105),
      ),
    );
    expect(b64(transcript)).toBe(vectors.transcript);
    const privateKey = await crypto.subtle.importKey(
      "pkcs8",
      unb64(vectors.viewerEphemeral.privatePkcs8),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      ["deriveBits"],
    );
    const publicKey = await crypto.subtle.importKey(
      "raw",
      unb64(vectors.phoneEphemeral.publicKey),
      { name: "ECDH", namedCurve: "P-256" },
      false,
      [],
    );
    const secret = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "ECDH", public: publicKey },
        privateKey,
        256,
      ),
    );
    expect(b64(secret)).toBe(vectors.secret);
    const material = await deriveMaterial(secret, transcript);
    expect(material.map(b64)).toEqual(vectors.material);
    const pub = await crypto.subtle.importKey(
      "raw",
      unb64(vectors.phone.publicKey),
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["verify"],
    );
    expect(
      await crypto.subtle.verify(
        { name: "ECDSA", hash: "SHA-256" },
        pub,
        offer.slice(105),
        concat(utf8("ara/session/phone-proof/v1\0"), transcript),
      ),
    ).toBe(true);
    const auth: Authority = {
      id: unb64(vectors.pairingId),
      generation: 1,
      peer: unb64(vectors.phone.publicKey),
      current: () => true,
    };
    const v = await Channel.create(auth, "viewer", material);
    const p = await Channel.create(auth, "phone", material);
    expect(b64(await v.seal(utf8("viewer-finished")))).toBe(
      b64(unb64(vectors.proof).slice(72)),
    );
    expect(b64(await p.open(unb64(vectors.proof).slice(72)))).toBe(
      b64(utf8("viewer-finished")),
    );
    expect(b64(await p.seal(utf8("phone-finished")))).toBe(
      b64(unb64(vectors.finish).slice(8)),
    );
    await v.open(unb64(vectors.finish).slice(8));
    expect(b64(await v.seal(unb64(vectors.viewerPlaintext)))).toBe(
      vectors.viewerRecord,
    );
    expect(b64(await p.open(unb64(vectors.viewerRecord)))).toBe(
      vectors.viewerPlaintext,
    );
    expect(b64(await p.seal(unb64(vectors.phonePlaintext)))).toBe(
      vectors.phoneRecord,
    );
    expect(b64(await v.open(unb64(vectors.phoneRecord)))).toBe(
      vectors.phonePlaintext,
    );
  });
});
describe("paired session", () => {
  it("confirms keys, exchanges Unicode/binary and creates fresh reconnect keys", async () => {
    const s = await setup();
    const a = await exchange(s);
    const b = await exchange(s);
    expect(equal(a.hello.subarray(190), b.hello.subarray(190))).toBe(false);
    expect(equal(a.offer.subarray(40, 105), b.offer.subarray(40, 105))).toBe(
      false,
    );
    const plaintext = utf8("screen 🌞\0touch");
    const record = await a.v.seal(plaintext);
    expect(equal(await a.p.open(record), plaintext)).toBe(true);
    expect(
      equal(await a.v.open(await a.p.seal(new Uint8Array())), new Uint8Array()),
    ).toBe(true);
    expect(equal(await b.v.seal(plaintext), record)).toBe(false);
    await expect(b.p.open(record)).rejects.toThrow();
  });
  it.each([
    0, 4, 5, 6, 7, 8, 24, 28, 93, 158, 190,
  ])("rejects hello substitution at byte %i", async (at) => {
    const s = await setup();
    const v = await ViewerHandshake.start(s.viewer, s.va);
    const altered = mutate(v.hello, at);
    // A nonce/ephemeral substitution can reach the offer but fails endpoint transcript authentication.
    await expect(
      (async () => {
        const p = await PhoneHandshake.start(s.phone, s.pa, altered);
        await v.answer(p.offer);
      })(),
    ).rejects.toThrow();
  });
  it("rejects off-curve public keys and trailing bytes", async () => {
    const s = await setup();
    const v = await ViewerHandshake.start(s.viewer, s.va);
    const bad = v.hello.slice();
    bad.fill(0, 190);
    bad[190] = 4;
    await expect(PhoneHandshake.start(s.phone, s.pa, bad)).rejects.toThrow();
    await expect(
      PhoneHandshake.start(s.phone, s.pa, concat(v.hello, new Uint8Array(1))),
    ).rejects.toThrow();
  });
  it.each([
    0, 7, 8, 40, 105, 168,
  ])("rejects altered offer at byte %i and poisons the handshake", async (at) => {
    const s = await setup();
    const v = await ViewerHandshake.start(s.viewer, s.va);
    const p = await PhoneHandshake.start(s.phone, s.pa, v.hello);
    await expect(v.answer(mutate(p.offer, at))).rejects.toThrow();
    await expect(v.answer(p.offer)).rejects.toThrow();
  });
  it.each([
    8, 72, 118,
  ])("rejects altered proof at byte %i and poisons the handshake", async (at) => {
    const s = await setup();
    const v = await ViewerHandshake.start(s.viewer, s.va);
    const p = await PhoneHandshake.start(s.phone, s.pa, v.hello);
    const proof = await v.answer(p.offer);
    await expect(p.finish(mutate(proof, at))).rejects.toThrow();
    await expect(p.finish(proof)).rejects.toThrow();
  });
  it("requires the phone confirmation before exposing the viewer channel", async () => {
    const s = await setup();
    const v = await ViewerHandshake.start(s.viewer, s.va);
    const p = await PhoneHandshake.start(s.phone, s.pa, v.hello);
    const accepted = await p.finish(await v.answer(p.offer));
    await expect(v.finish(mutate(accepted.finish, 53))).rejects.toThrow();
    await expect(v.finish(accepted.finish)).rejects.toThrow();
  });
  it.each([
    "tamper",
    "replay",
    "order",
    "reflection",
    "oversize",
    "reserved",
  ] as const)("fails closed on %s records", async (kind) => {
    const a = await exchange(await setup());
    const record = await a.v.seal(utf8("input"));
    let bad = record;
    if (kind === "tamper") bad = mutate(record, 32);
    if (kind === "reserved") bad = mutate(record, 5);
    if (kind === "replay") await a.p.open(record);
    if (kind === "order") bad = await a.v.seal(utf8("later"));
    if (kind === "reflection") bad = await a.p.seal(utf8("wrong direction"));
    if (kind === "oversize") bad = new Uint8Array(1048609);
    await expect(a.p.open(bad)).rejects.toThrow();
    await expect(a.p.open(record)).rejects.toThrow();
    await expect(a.p.seal(utf8("closed"))).rejects.toThrow();
  });
  it("rejects revoked new handshakes and existing channels", async () => {
    const s = await setup();
    const a = await exchange(s);
    s.revoke();
    await expect(a.v.seal(utf8("input"))).rejects.toThrow();
    await expect(a.p.open(new Uint8Array())).rejects.toThrow();
    await expect(ViewerHandshake.start(s.viewer, s.va)).rejects.toThrow();
  });
  it("checks authority after async signing and refuses a revoked finish", async () => {
    const s = await setup();
    const identity: Identity = {
      publicKey: s.phone.publicKey,
      sign: async (data) => {
        const result = await s.phone.sign(data);
        s.revoke();
        return result;
      },
    };
    const v = await ViewerHandshake.start(s.viewer, s.va);
    await expect(
      PhoneHandshake.start(identity, s.pa, v.hello),
    ).rejects.toThrow();
    const s2 = await setup();
    const v2 = await ViewerHandshake.start(s2.viewer, s2.va);
    const p2 = await PhoneHandshake.start(s2.phone, s2.pa, v2.hello);
    const proof = await v2.answer(p2.offer);
    s2.revoke();
    await expect(p2.finish(proof)).rejects.toThrow();
  });
  it("refuses concurrent encryption without reusing a nonce", async () => {
    const a = await exchange(await setup());
    const results = await Promise.allSettled([
      a.v.seal(utf8("a")),
      a.v.seal(utf8("b")),
    ]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
    await expect(a.v.seal(utf8("c"))).rejects.toThrow();
  });
});

it("does not release plaintext or ciphertext after revocation during WebCrypto work", async () => {
  const s = await setup();
  const a = await exchange(s);
  const record = await a.v.seal(utf8("pending decrypt"));
  const opening = a.p.open(record);
  s.revoke();
  await expect(opening).rejects.toThrow();
  const s2 = await setup();
  const b = await exchange(s2);
  const sealing = b.v.seal(utf8("pending encrypt"));
  s2.revoke();
  await expect(sealing).rejects.toThrow();
});
it("accepts a maximum binary frame and closes on an oversized outgoing frame", async () => {
  const a = await exchange(await setup());
  const max = new Uint8Array(1048576).fill(0xab);
  expect(equal(unb64(b64(max)), max)).toBe(true);
  expect(equal(await a.p.open(await a.v.seal(max)), max)).toBe(true);
  await expect(a.v.seal(new Uint8Array(1048577))).rejects.toThrow();
  await expect(a.v.seal(new Uint8Array())).rejects.toThrow();
});
