import type { Authority, Bytes } from "@remote/protocol";
import {
  b64,
  createIdentity,
  equal,
  PhoneHandshake,
  unb64,
  utf8,
  ViewerHandshake,
} from "@remote/protocol";

export interface ProofResult {
  exchanges: number;
  rejected: string[];
  freshSession: boolean;
}
const exchange = async (
  path: string,
  body: Bytes = new Uint8Array(),
): Promise<Bytes> => {
  const response = await fetch(`/native/${path}`, { method: "POST", body });
  if (!response.ok) throw new Error("Native session rejected");
  return new Uint8Array(await response.arrayBuffer());
};
export async function runProof(phonePin: string): Promise<ProofResult> {
  const viewer = await createIdentity();
  const pin = unb64(phonePin);
  const auth: Authority = {
    id: new Uint8Array(16),
    generation: 1,
    peer: pin,
    current: () => true,
  };
  const rejected: string[] = [];
  const mustReject = async (name: string, work: () => Promise<unknown>) => {
    try {
      await work();
    } catch {
      rejected.push(name);
      return;
    }
    throw new Error(`${name} unexpectedly accepted`);
  };
  const setup = async () => {
    const observed = await exchange("setup", utf8(b64(viewer.publicKey)));
    if (!equal(observed, pin))
      throw new Error("Fixture phone identity changed");
  };
  const connect = async () => {
    await setup();
    const handshake = await ViewerHandshake.start(viewer, auth);
    const offer = await exchange("hello", handshake.hello);
    const proof = await handshake.answer(offer);
    return {
      channel: await handshake.finish(await exchange("proof", proof)),
      hello: handshake.hello,
      offer,
    };
  };
  let exchanges = 0;
  const roundTrip = async (connection: Awaited<ReturnType<typeof connect>>) => {
    const plain = utf8("crypto-proof canary 🌞\0binary");
    const record = await connection.channel.seal(plain);
    if (
      !equal(
        await connection.channel.open(await exchange("record", record)),
        plain,
      )
    )
      throw new Error("Different plaintext");
    exchanges++;
    return record;
  };
  const a = await connect();
  const oldRecord = await roundTrip(a);
  await mustReject("native replay", () => exchange("record", oldRecord));
  a.channel.close();
  const b = await connect();
  const freshSession =
    !equal(a.hello.subarray(190), b.hello.subarray(190)) &&
    !equal(a.offer.subarray(40, 105), b.offer.subarray(40, 105));
  if (!freshSession) throw new Error("Reused handshake");
  await roundTrip(b);
  const altered = await b.channel.seal(utf8("altered record"));
  altered[altered.length - 1] = (altered[altered.length - 1] ?? 0) ^ 1;
  await mustReject("native tamper", () => exchange("record", altered));
  b.channel.close();
  const c = await connect();
  await mustReject("native stale session", () => exchange("record", oldRecord));
  c.channel.close();
  // The browser must authenticate the phone offer before releasing its proof.
  await setup();
  const v = await ViewerHandshake.start(viewer, auth);
  const offer = await exchange("hello", v.hello);
  offer[168] = (offer[168] ?? 0) ^ 1;
  await mustReject("browser forged phone", () => v.answer(offer));
  const d = await connect();
  await roundTrip(d);
  await exchange("revoke");
  await mustReject("native revoked channel", async () =>
    exchange("record", await d.channel.seal(utf8("revoked"))),
  );
  d.channel.close();
  await mustReject("native revoked handshake", async () =>
    exchange("hello", (await ViewerHandshake.start(viewer, auth)).hello),
  );
  await exchange("done");
  return { exchanges, rejected, freshSession };
}
/** Browser-only interoperability sanity check, no transport or application commands. */
export async function browserSelfCheck(): Promise<boolean> {
  const viewer = await createIdentity();
  const phone = await createIdentity();
  const auth: Authority = {
    id: new Uint8Array(16),
    generation: 1,
    peer: phone.publicKey,
    current: () => true,
  };
  const v = await ViewerHandshake.start(viewer, auth);
  const p = await PhoneHandshake.start(
    phone,
    { ...auth, peer: viewer.publicKey },
    v.hello,
  );
  const accepted = await p.finish(await v.answer(p.offer));
  const channel = await v.finish(accepted.finish);
  try {
    return equal(
      await accepted.channel.open(
        await channel.seal(utf8("browser crypto ready")),
      ),
      utf8("browser crypto ready"),
    );
  } finally {
    channel.close();
    accepted.channel.close();
  }
}
declare global {
  interface Window {
    cryptoProof: typeof runProof;
    browserCryptoCheck: typeof browserSelfCheck;
  }
}
window.cryptoProof = runProof;
window.browserCryptoCheck = browserSelfCheck;
