/** Regenerates SYNTHETIC fixtures only; signatures vary. Never used at runtime. */
import { createECDH, createPrivateKey, sign } from "node:crypto";
import { writeFile } from "node:fs/promises";
import type { Authority } from "../protocol/src/index.js";
import {
  b64,
  Channel,
  concat,
  deriveMaterial,
  hash,
  utf8,
} from "../protocol/src/index.js";

const key = (n: number) => {
  const ecdh = createECDH("prime256v1");
  const d = Buffer.alloc(32);
  d[31] = n;
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const privateKey = createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      x: pub.subarray(1, 33).toString("base64url"),
      y: pub.subarray(33).toString("base64url"),
      d: d.toString("base64url"),
    },
    format: "jwk",
  });
  return {
    ecdh,
    privateKey,
    fixture: {
      publicKey: pub.toString("base64"),
      privatePkcs8: privateKey
        .export({ type: "pkcs8", format: "der" })
        .toString("base64"),
    },
  };
};
const viewer = key(1);
const phone = key(2);
const ve = key(3);
const pe = key(4);
const header = (type: number) =>
  new Uint8Array([65, 82, 65, 49, type, 1, 1, 0]);
const pairingId = new Uint8Array(16).fill(0x10);
const hello = concat(
  header(1),
  pairingId,
  new Uint8Array([0, 0, 0, 1]),
  viewer.ecdh.getPublicKey(),
  phone.ecdh.getPublicKey(),
  new Uint8Array(32).fill(0x20),
  ve.ecdh.getPublicKey(),
);
const unsigned = concat(
  header(2),
  new Uint8Array(32).fill(0x30),
  pe.ecdh.getPublicKey(),
);
const transcript = await hash(
  concat(utf8("ara/session/transcript/v1\0"), hello, unsigned),
);
const secret = Uint8Array.from(ve.ecdh.computeSecret(pe.ecdh.getPublicKey()));
const material = await deriveMaterial(secret, transcript);
const auth: Authority = {
  id: pairingId,
  generation: 1,
  peer: Uint8Array.from(phone.ecdh.getPublicKey()),
  current: () => true,
};
const vc = await Channel.create(auth, "viewer", material);
const pc = await Channel.create(auth, "phone", material);
const signFixture = (label: string, k: typeof viewer) =>
  sign("sha256", concat(utf8(`ara/session/${label}/v1\0`), transcript), {
    key: k.privateKey,
    dsaEncoding: "ieee-p1363",
  });
const offer = concat(unsigned, signFixture("phone-proof", phone));
const proof = concat(
  header(3),
  signFixture("viewer-proof", viewer),
  await vc.seal(utf8("viewer-finished")),
);
const finish = concat(header(4), await pc.seal(utf8("phone-finished")));
const viewerPlaintext = utf8("hello from browser");
const phonePlaintext = utf8("hello from phone 🌞");
const vector = {
  warning:
    "PUBLIC SYNTHETIC TEST KEYS: scalars 1,2,3,4. NEVER USE IN AN APPLICATION.",
  viewer: viewer.fixture,
  phone: phone.fixture,
  viewerEphemeral: ve.fixture,
  phoneEphemeral: pe.fixture,
  pairingId: b64(pairingId),
  generation: 1,
  hello: b64(hello),
  offer: b64(offer),
  proof: b64(proof),
  finish: b64(finish),
  transcript: b64(transcript),
  secret: b64(secret),
  material: material.map(b64),
  viewerPlaintext: b64(viewerPlaintext),
  phonePlaintext: b64(phonePlaintext),
  viewerRecord: b64(await vc.seal(viewerPlaintext)),
  phoneRecord: b64(await pc.seal(phonePlaintext)),
};
await writeFile(
  new URL("../protocol/vectors/session-v1.json", import.meta.url),
  `${JSON.stringify(vector, null, 2)}\n`,
);
