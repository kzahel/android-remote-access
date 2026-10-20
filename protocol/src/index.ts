/** Experimental paired session. Exact wire contract: docs/crypto-session-v1.md. */
export type Bytes = Uint8Array<ArrayBuffer>;
const enc = new TextEncoder();
export const utf8 = (text: string): Bytes => enc.encode(text);
export const concat = (...parts: Uint8Array[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
export const equal = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
};
export const b64 = (data: Uint8Array): string => {
  let encoded = "";
  for (let at = 0; at < data.length; at += 32768)
    encoded += String.fromCharCode(...data.subarray(at, at + 32768));
  return btoa(encoded);
};
export const unb64 = (text: string): Bytes =>
  Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
export const hash = async (data: Bytes): Promise<Bytes> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", data));
const reject = (): never => {
  throw new Error("Session rejected");
};
function requireValue(ok: boolean): asserts ok {
  if (!ok) reject();
}
const domain = (label: string) => utf8(`ara/session/${label}/v1\0`);
const header = (type: number): Bytes =>
  new Uint8Array([65, 82, 65, 49, type, 1, 1, 0]);
const frame = (data: Bytes, type: number, size: number) =>
  requireValue(
    data.length === size && equal(data.subarray(0, 8), header(type)),
  );
const uint32 = (n: number): Bytes => {
  requireValue(Number.isInteger(n) && n >= 0 && n <= 0xffffffff);
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, n);
  return out;
};
const random = (size: number): Bytes =>
  crypto.getRandomValues(new Uint8Array(size));
export interface Identity {
  readonly publicKey: Bytes;
  sign(data: Bytes): Promise<Bytes>;
}
export interface Authority {
  readonly id: Bytes;
  readonly generation: number;
  readonly peer: Bytes;
  current(): boolean;
}
function check(auth: Authority) {
  requireValue(
    auth.id.length === 16 && auth.peer.length === 65 && auth.current(),
  );
  uint32(auth.generation);
}
function snapshot(auth: Authority): Authority {
  check(auth);
  return {
    id: auth.id.slice(),
    generation: auth.generation,
    peer: auth.peer.slice(),
    current: () => auth.current(),
  };
}
export async function identityFromKeys(pair: CryptoKeyPair): Promise<Identity> {
  const publicKey = new Uint8Array(
    await crypto.subtle.exportKey("raw", pair.publicKey),
  );
  return {
    publicKey,
    sign: async (data) =>
      new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          pair.privateKey,
          data,
        ),
      ),
  };
}
export async function createIdentity(): Promise<Identity> {
  return identityFromKeys(
    await crypto.subtle.generateKey(
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign", "verify"],
    ),
  );
}
async function verify(key: Bytes, data: Bytes, signature: Bytes) {
  requireValue(key.length === 65 && key[0] === 4 && signature.length === 64);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  requireValue(
    await crypto.subtle.verify(
      { name: "ECDSA", hash: "SHA-256" },
      publicKey,
      signature,
      data,
    ),
  );
}
const ephemeral = () =>
  crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, [
    "deriveBits",
  ]);
async function agreement(local: CryptoKeyPair, peer: Bytes): Promise<Bytes> {
  requireValue(peer.length === 65 && peer[0] === 4);
  const publicKey = await crypto.subtle.importKey(
    "raw",
    peer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicKey },
      local.privateKey,
      256,
    ),
  );
}
export async function deriveMaterial(
  secret: Bytes,
  transcript: Bytes,
): Promise<Bytes[]> {
  requireValue(secret.length === 32 && transcript.length === 32);
  const key = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveBits",
  ]);
  return Promise.all(
    ["viewer-key", "phone-key", "viewer-nonce", "phone-nonce"].map(
      async (label, i) =>
        new Uint8Array(
          await crypto.subtle.deriveBits(
            {
              name: "HKDF",
              hash: "SHA-256",
              salt: transcript,
              info: utf8(`ara/session/v1/${label}`),
            },
            key,
            i < 2 ? 256 : 32,
          ),
        ),
    ),
  );
}
export class Channel {
  private closed = false;
  private sending = false;
  private receiving = false;
  private sendSequence = 0;
  private sendBytes = 0;
  private receiveBytes = 0;
  private receiveSequence = 0;
  private constructor(
    private auth: Authority,
    private direction: number,
    private sendKey: CryptoKey,
    private receiveKey: CryptoKey,
    private sendPrefix: Bytes,
    private receivePrefix: Bytes,
  ) {}
  static async create(
    auth: Authority,
    role: "viewer" | "phone",
    material: Bytes[],
  ): Promise<Channel> {
    requireValue(material.length === 4);
    const keys = await Promise.all(
      material
        .slice(0, 2)
        .map((key) =>
          crypto.subtle.importKey("raw", key, "AES-GCM", false, [
            "encrypt",
            "decrypt",
          ]),
        ),
    );
    const dir = role === "viewer" ? 0 : 1;
    check(auth);
    const sendKey = keys[dir];
    const receiveKey = keys[1 - dir];
    const sendPrefix = material[dir + 2];
    const receivePrefix = material[3 - dir];
    if (!sendKey || !receiveKey || !sendPrefix || !receivePrefix)
      return reject();
    return new Channel(
      auth,
      dir,
      sendKey,
      receiveKey,
      sendPrefix.slice(),
      receivePrefix.slice(),
    );
  }
  close() {
    this.closed = true;
    this.sendPrefix.fill(0);
    this.receivePrefix.fill(0);
  }
  private ready() {
    requireValue(!this.closed);
    check(this.auth);
  }
  async seal(plaintext: Bytes): Promise<Bytes> {
    try {
      this.ready();
      requireValue(
        !this.sending &&
          plaintext.length <= 1048576 &&
          this.sendSequence < 2 ** 20 &&
          this.sendBytes + plaintext.length <= 2 ** 30,
      );
      this.sending = true;
      const h = concat(
        utf8("ARR1"),
        new Uint8Array([this.direction, 0, 0, 0]),
        new Uint8Array(8),
      );
      new DataView(h.buffer).setBigUint64(8, BigInt(this.sendSequence++));
      this.sendBytes += plaintext.length;
      const iv = concat(this.sendPrefix, h.subarray(8));
      const encrypted = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: h, tagLength: 128 },
        this.sendKey,
        plaintext,
      );
      this.ready();
      return concat(h, new Uint8Array(encrypted));
    } catch {
      this.close();
      return reject();
    } finally {
      this.sending = false;
    }
  }
  async open(record: Bytes): Promise<Bytes> {
    try {
      this.ready();
      requireValue(!this.receiving);
      this.receiving = true;
      requireValue(
        record.length >= 32 &&
          record.length <= 1048608 &&
          equal(
            record.subarray(0, 8),
            concat(utf8("ARR1"), new Uint8Array([1 - this.direction, 0, 0, 0])),
          ),
      );
      const h = record.slice(0, 16);
      requireValue(
        this.receiveSequence < 2 ** 20 &&
          this.receiveBytes + record.length - 32 <= 2 ** 30 &&
          new DataView(h.buffer).getBigUint64(8) ===
            BigInt(this.receiveSequence),
      );
      const plaintext = new Uint8Array(
        await crypto.subtle.decrypt(
          {
            name: "AES-GCM",
            iv: concat(this.receivePrefix, h.subarray(8)),
            additionalData: h,
            tagLength: 128,
          },
          this.receiveKey,
          record.subarray(16),
        ),
      );
      this.ready();
      this.receiveSequence++;
      this.receiveBytes += plaintext.length;
      return plaintext;
    } catch {
      this.close();
      return reject();
    } finally {
      this.receiving = false;
    }
  }
}
async function channel(
  auth: Authority,
  role: "viewer" | "phone",
  local: CryptoKeyPair,
  peer: Bytes,
  transcript: Bytes,
): Promise<Channel> {
  const secret = await agreement(local, peer);
  try {
    const material = await deriveMaterial(secret, transcript);
    try {
      return await Channel.create(auth, role, material);
    } finally {
      for (const value of material) value.fill(0);
    }
  } finally {
    secret.fill(0);
  }
}
export class ViewerHandshake {
  private phase: "offer" | "working" | "finish" | "done" | "failed" = "offer";
  private record?: Channel;
  private constructor(
    readonly hello: Bytes,
    private identity: Identity,
    private auth: Authority,
    private ephemeralKey: CryptoKeyPair | undefined,
  ) {}
  static async start(
    identity: Identity,
    authority: Authority,
  ): Promise<ViewerHandshake> {
    const auth = snapshot(authority);
    requireValue(identity.publicKey.length === 65);
    const key = await ephemeral();
    const pub = new Uint8Array(
      await crypto.subtle.exportKey("raw", key.publicKey),
    );
    check(auth);
    return new ViewerHandshake(
      concat(
        header(1),
        auth.id,
        uint32(auth.generation),
        identity.publicKey,
        auth.peer,
        random(32),
        pub,
      ),
      identity,
      auth,
      key,
    );
  }
  async answer(offer: Bytes): Promise<Bytes> {
    try {
      check(this.auth);
      requireValue(this.phase === "offer");
      this.phase = "working";
      frame(offer, 2, 169);
      const transcript = await hash(
        concat(domain("transcript"), this.hello, offer.subarray(0, 105)),
      );
      await verify(
        this.auth.peer,
        concat(domain("phone-proof"), transcript),
        offer.slice(105),
      );
      const key = this.ephemeralKey;
      requireValue(!!key);
      this.ephemeralKey = undefined;
      this.record = await channel(
        this.auth,
        "viewer",
        key,
        offer.slice(40, 105),
        transcript,
      );
      const signature = await this.identity.sign(
        concat(domain("viewer-proof"), transcript),
      );
      requireValue(signature.length === 64);
      const proof = concat(
        header(3),
        signature,
        await this.record.seal(utf8("viewer-finished")),
      );
      check(this.auth);
      requireValue(this.phase === "working");
      this.phase = "finish";
      return proof;
    } catch {
      this.phase = "failed";
      this.ephemeralKey = undefined;
      this.record?.close();
      return reject();
    }
  }
  async finish(finish: Bytes): Promise<Channel> {
    try {
      check(this.auth);
      requireValue(this.phase === "finish" && !!this.record);
      this.phase = "working";
      frame(finish, 4, 54);
      requireValue(
        equal(await this.record.open(finish.slice(8)), utf8("phone-finished")),
      );
      check(this.auth);
      requireValue(this.phase === "working");
      this.phase = "done";
      return this.record;
    } catch {
      this.phase = "failed";
      this.ephemeralKey = undefined;
      this.record?.close();
      return reject();
    }
  }
}
export class PhoneHandshake {
  private used = false;
  private constructor(
    readonly offer: Bytes,
    private auth: Authority,
    private transcript: Bytes,
    private record: Channel,
  ) {}
  static async start(
    identity: Identity,
    authority: Authority,
    hello: Bytes,
  ): Promise<PhoneHandshake> {
    const auth = snapshot(authority);
    frame(hello, 1, 255);
    requireValue(
      equal(hello.subarray(8, 24), auth.id) &&
        equal(hello.subarray(24, 28), uint32(auth.generation)) &&
        equal(hello.subarray(28, 93), auth.peer) &&
        equal(hello.subarray(93, 158), identity.publicKey),
    );
    const key = await ephemeral();
    const pub = new Uint8Array(
      await crypto.subtle.exportKey("raw", key.publicKey),
    );
    const unsigned = concat(header(2), random(32), pub);
    const transcript = await hash(
      concat(domain("transcript"), hello, unsigned),
    );
    const record = await channel(
      auth,
      "phone",
      key,
      hello.slice(190),
      transcript,
    );
    try {
      const signature = await identity.sign(
        concat(domain("phone-proof"), transcript),
      );
      requireValue(signature.length === 64);
      check(auth);
      return new PhoneHandshake(
        concat(unsigned, signature),
        auth,
        transcript,
        record,
      );
    } catch {
      record.close();
      return reject();
    }
  }
  async finish(proof: Bytes): Promise<{ finish: Bytes; channel: Channel }> {
    try {
      check(this.auth);
      requireValue(!this.used);
      this.used = true;
      frame(proof, 3, 119);
      await verify(
        this.auth.peer,
        concat(domain("viewer-proof"), this.transcript),
        proof.slice(8, 72),
      );
      requireValue(
        equal(await this.record.open(proof.slice(72)), utf8("viewer-finished")),
      );
      const finish = concat(
        header(4),
        await this.record.seal(utf8("phone-finished")),
      );
      check(this.auth);
      return { finish, channel: this.record };
    } catch {
      this.record.close();
      return reject();
    }
  }
}
