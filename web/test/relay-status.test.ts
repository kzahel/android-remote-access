import type { Identity } from "@remote/protocol";
import type { Grant } from "@remote/protocol/enrollment";
import { afterEach, expect, it, vi } from "vitest";
import { openEncryptedSession } from "../src/relay.js";

// Transport tests have no browser IndexedDB; isolate the access-history sink.
vi.mock("../src/store.js", () => ({ setPhoneAccess: vi.fn() }));

afterEach(() => vi.unstubAllGlobals());

it("explains a queued wake and updates the message after actual delivery", async () => {
  let socket: FakeSocket | undefined;
  class FakeSocket {
    onmessage?: (event: { data: string }) => void;
    binaryType = "";
    constructor(url: URL) {
      expect(url.href).toBe(
        `wss://example.test/api/socket?id=${"ab".repeat(16)}`,
      );
      socket = this;
    }
    send = vi.fn();
    close = vi.fn();
    receive(message: object) {
      this.onmessage?.({ data: JSON.stringify(message) });
    }
  }
  vi.stubGlobal("WebSocket", FakeSocket);
  vi.stubGlobal("location", { origin: "https://example.test" });
  const report = vi.fn();
  const abort = new AbortController();
  const pending = openEncryptedSession(
    { sign: async () => new Uint8Array(64) } as unknown as Identity,
    { id: "ab".repeat(16) } as Grant,
    report,
    abort.signal,
  );
  const rejected = expect(pending).rejects.toThrow("Connection ended");
  socket?.receive({ type: "challenge", nonce: "cd".repeat(32) });
  await vi.waitFor(() => expect(socket?.send).toHaveBeenCalledOnce());
  socket?.receive({ type: "authenticated" });
  socket?.receive({ type: "contacting", delivery: "coalesced" });
  await vi.waitFor(() =>
    expect(report).toHaveBeenLastCalledWith(
      "Waiting a moment before contacting your phone again…",
    ),
  );
  socket?.receive({ type: "contacting", delivery: "accepted" });
  await vi.waitFor(() =>
    expect(report).toHaveBeenLastCalledWith("Contacting phone…"),
  );
  abort.abort();
  await rejected;
  expect(socket?.close).toHaveBeenCalled();
});
