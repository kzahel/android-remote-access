import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { type Command, decodeReply, encodeCommand } from "../src/control.js";

const vectors = JSON.parse(
  readFileSync(new URL("../vectors/control-v1.json", import.meta.url), "utf8"),
) as { id: number; command: Command; hex: string }[];
describe("control boundary", () => {
  it("matches shared Kotlin command vectors", () => {
    for (const v of vectors)
      expect(Buffer.from(encodeCommand(v.id, v.command)).toString("hex")).toBe(
        v.hex,
      );
  });
  it("rejects coordinates and durations that would change meaning during integer encoding", () => {
    for (const x of [-1, 1.5, NaN, Infinity, 2 ** 32])
      expect(() =>
        encodeCommand(1, { op: "tap", scene: 1, x, y: 0 }),
      ).toThrow();
    expect(() => encodeCommand(0, { op: "start" })).toThrow();
    expect(() =>
      encodeCommand(1, {
        op: "swipe",
        scene: 1,
        x: 0,
        y: 0,
        endX: 1,
        endY: 1,
        duration: 2001,
      }),
    ).toThrow();
    expect(() =>
      encodeCommand(1, { op: "text", text: "🌞".repeat(1025) }),
    ).toThrow();
    expect(() =>
      encodeCommand(1, { op: "launch", packageName: "x; command" }),
    ).toThrow();
  });
  it("rejects invalid and ambiguous multi-contact batches", () => {
    const batch = {
      scene: 1,
      gesture: 1,
      sequence: 0,
      duration: 40,
      contacts: [{ id: 0, held: true, path: [{ x: 1, y: 2 }] }],
    };
    expect(() =>
      encodeCommand(1, {
        op: "touch",
        batch: { ...batch, contacts: [...batch.contacts, ...batch.contacts] },
      }),
    ).toThrow();
    expect(() =>
      encodeCommand(1, { op: "touch", batch: { ...batch, duration: NaN } }),
    ).toThrow();
    expect(() =>
      encodeCommand(1, {
        op: "touch",
        batch: {
          ...batch,
          contacts: [{ id: 0, held: true, path: [{ x: NaN, y: 1 }] }],
        },
      }),
    ).toThrow();
  });
  it("only admits explicit bounded numeric unlock credentials", () => {
    for (const pin of ["", "123", "1".repeat(17), "1234\n", "１２３４", "123a"])
      expect(() => encodeCommand(1, { op: "unlock", pin })).toThrow();
    expect(
      Buffer.from(encodeCommand(8, { op: "unlock", pin: "314159" })).toString(
        "hex",
      ),
    ).toBe("415243310d00000000000008333134313539");
  });
  it("bounds video metadata before decoder allocation", () => {
    const record = new Uint8Array(56),
      v = new DataView(record.buffer);
    record.set([65, 82, 80, 49, 5, 0, 0, 0]);
    v.setUint32(8, 1);
    [1, 2, 720, 1600, 1080, 2400, 1].forEach((n, i) => {
      v.setUint32(12 + i * 4, n);
    });
    v.setBigUint64(40, 1000n);
    record.set([0, 0, 0, 1, 0x65, 1, 2, 3], 48);
    expect(decodeReply(record)).toMatchObject({
      kind: "video",
      key: true,
      scene: 2,
      timestamp: 1000,
    });
    for (const offset of [12, 16, 20, 24, 28, 32]) {
      const bad = record.slice();
      new DataView(bad.buffer).setUint32(offset, 0);
      expect(() => decodeReply(bad)).toThrow();
    }
    v.setUint32(36, 2);
    expect(() => decodeReply(record)).toThrow();
    v.setUint32(36, 1);
    v.setBigUint64(40, 2n ** 60n);
    expect(() => decodeReply(record)).toThrow();
    expect(() => encodeCommand(1, { op: "video", quality: 4 as 1 })).toThrow();
  });
  it("rejects unknown, oversized and malformed responses", () => {
    const good = new Uint8Array(
      Buffer.from("41525031020000000000000100", "hex"),
    );
    expect(decodeReply(good)).toEqual({ id: 1, kind: "result", code: 0 });
    for (const index of [0, 4, 5, 12]) {
      const bad = good.slice();
      bad[index] = 255;
      expect(() => decodeReply(bad)).toThrow();
    }
    expect(() => decodeReply(new Uint8Array(1048577))).toThrow();
  });
});
