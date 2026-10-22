import {
  type Bytes,
  type Channel,
  createIdentity,
  PhoneHandshake,
} from "@remote/protocol";
import {
  authBytes,
  fromHex,
  type Grant,
  verifySignature,
} from "@remote/protocol/enrollment";
import { afterEach, expect, it, vi } from "vitest";
import { openEncryptedSession } from "../src/relay.js";

vi.mock("../src/store.js", () => ({ setPhoneAccess: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

it.each([
  true,
  false,
])("exchanges real encrypted records with relay flow negotiation %s", async (flow) => {
  const viewer = await createIdentity(),
    phone = await createIdentity();
  const id = "ab".repeat(16),
    nonce = "cd".repeat(32),
    origin = "https://example.test";
  const grant = {
    id,
    phone: Buffer.from(phone.publicKey).toString("base64"),
  } as Grant;
  let handshake: PhoneHandshake | undefined;
  const state: { channel?: Channel; socket?: FakeSocket } = {};
  let sentRecords = 0;
  const acks: object[] = [],
    errors: unknown[] = [];
  class FakeSocket {
    onmessage?: (event: { data: string | ArrayBuffer }) => void;
    binaryType = "";
    bufferedAmount = 0;
    constructor() {
      state.socket = this;
      queueMicrotask(() =>
        this.emit(
          JSON.stringify({
            type: "challenge",
            nonce,
            ...(flow ? { relayFlow: 1 } : {}),
          }),
        ),
      );
    }
    close() {}
    emit(data: string | Bytes) {
      if (data instanceof Uint8Array) {
        sentRecords++;
        this.onmessage?.({ data: Uint8Array.from(data).buffer });
        if (flow)
          this.onmessage?.({
            data: JSON.stringify({
              type: "relayReceipt",
              nonce: sentRecords.toString(16).padStart(32, "0"),
            }),
          });
      } else this.onmessage?.({ data });
    }
    send(data: string | Bytes) {
      void this.process(data).catch((error) => errors.push(error));
    }
    async process(data: string | Bytes) {
      if (typeof data === "string") {
        const value = JSON.parse(data);
        if (value.type === "relayAck") {
          acks.push(value);
          return;
        }
        await verifySignature(
          Buffer.from(viewer.publicKey).toString("base64"),
          authBytes(origin, id, "viewer", nonce),
          value.signature,
        );
        this.emit(JSON.stringify({ type: "authenticated" }));
        this.emit(JSON.stringify({ type: "ready" }));
      } else if (!handshake) {
        handshake = await PhoneHandshake.start(
          phone,
          {
            id: fromHex(id, 16),
            generation: 1,
            peer: viewer.publicKey,
            current: () => true,
          },
          data,
        );
        this.emit(handshake.offer);
      } else {
        const result = await handshake.finish(data);
        state.channel = result.channel;
        this.emit(result.finish);
      }
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { origin });
  const session = await openEncryptedSession(viewer, grant);
  const { socket, channel } = state;
  if (!socket || !channel) throw new Error("Handshake did not finish");
  try {
    for (let frame = 0; frame < 4; frame++) {
      const bytes = new Uint8Array(800000);
      bytes[0] = frame;
      socket.emit(await channel.seal(bytes));
      expect(
        Buffer.from((await session.read()) ?? []).equals(Buffer.from(bytes)),
      ).toBe(true);
    }
    expect(errors).toEqual([]);
    if (flow)
      expect(acks.at(-1)).toEqual({
        type: "relayAck",
        nonce: sentRecords.toString(16).padStart(32, "0"),
      });
    else expect(acks).toEqual([]);
  } finally {
    session.close();
    channel?.close();
  }
});
