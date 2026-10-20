import type { Identity } from "@remote/protocol";
import type { Grant } from "@remote/protocol/enrollment";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ relay: vi.fn(), direct: vi.fn() }));
vi.mock("../src/relay.js", () => ({ openEncryptedSession: mocks.relay }));
vi.mock("../src/direct-lane.js", () => ({ openDirectLane: mocks.direct }));

import { RemoteSession } from "../src/control-session.js";

function lane() {
  let id = 0,
    op = 0;
  const sent: number[] = [];
  let loseTapReply = false;
  return {
    sent,
    loseTap() {
      loseTapReply = true;
    },
    close: vi.fn(),
    send: vi.fn(async (bytes: Uint8Array<ArrayBuffer>) => {
      const view = new DataView(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength,
      );
      id = view.getUint32(8);
      op = bytes[4] ?? 0;
      sent.push(op);
    }),
    read: vi.fn(async () => {
      if (op === 4 && loseTapReply)
        throw new Error("Reply lost after possible native delivery");
      const payload =
        op === 19
          ? new TextEncoder().encode("v=0\r\nanswer")
          : [1, 2].includes(op)
            ? new TextEncoder().encode(
                JSON.stringify({
                  type: "state",
                  v: 1,
                  accessibility: true,
                  locked: false,
                  width: 1080,
                  height: 2400,
                  scene: 1,
                }),
              )
            : new Uint8Array([0]);
      const result = new Uint8Array(12 + payload.length),
        view = new DataView(result.buffer);
      result.set([
        65,
        82,
        80,
        49,
        op === 19 ? 6 : [1, 2].includes(op) ? 1 : 2,
        0,
        0,
        0,
      ]);
      view.setUint32(8, id);
      result.set(payload, 12);
      return result;
    }),
  };
}
const identity = {} as Identity,
  grant = {} as Grant;
async function connect() {
  return (
    await RemoteSession.connect(
      identity,
      grant,
      vi.fn(),
      new AbortController().signal,
    )
  ).session;
}

describe("control path recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal("RTCPeerConnection", class {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });
  it("keeps the hosted lane usable when direct setup fails", async () => {
    const hosted = lane();
    mocks.relay.mockResolvedValue(hosted);
    mocks.direct.mockRejectedValue(new Error("No direct route"));
    const session = await connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.path).toBe("relay");
    expect(session.connected).toBe(true);
    expect(hosted.close).not.toHaveBeenCalled();
    expect((await session.command({ op: "status" })).kind).toBe("state");
    session.close();
  });
  it("falls back after an uncertain direct input without replaying it", async () => {
    const hosted = lane(),
      direct = lane();
    mocks.relay.mockResolvedValue(hosted);
    mocks.direct.mockImplementation(async (_identity, _grant, offer) => {
      expect(await offer("v=0\r\noffer")).toBe("v=0\r\nanswer");
      return direct;
    });
    const session = await connect();
    await vi.advanceTimersByTimeAsync(1000);
    expect(session.path).toBe("direct");
    direct.loseTap();
    await expect(
      session.command({ op: "tap", scene: 1, x: 20, y: 30 }),
    ).rejects.toThrow("not retried");
    expect(session.path).toBe("relay");
    expect(session.connected).toBe(true);
    expect(hosted.sent.filter((op) => op === 4)).toHaveLength(0);
    expect(direct.sent.filter((op) => op === 4)).toHaveLength(1);
    expect((await session.command({ op: "status" })).kind).toBe("state");
    expect(direct.close).toHaveBeenCalledOnce();
    session.close();
  });
});
