import { assert, describe, expect, it } from "vitest";
import {
  fragmentRecord,
  RECORD_LIMIT,
  RecordAssembler,
} from "../src/framing.js";

describe("ordered record framing", () => {
  it("roundtrips the largest record using SCTP-safe fragments", () => {
    const record = new Uint8Array(RECORD_LIMIT).fill(42),
      assembler = new RecordAssembler();
    let result: Uint8Array<ArrayBuffer> | undefined;
    for (const chunk of fragmentRecord(record))
      result = assembler.accept(chunk, 1);
    expect(result).toEqual(record);
    const single = fragmentRecord(new Uint8Array([1]))[0];
    assert(single);
    expect(assembler.accept(single, 2)).toEqual(new Uint8Array([1]));
  });
  it("rejects replayed/reordered, changing-size and expired partial records", () => {
    const chunks = fragmentRecord(new Uint8Array(20000));
    const assembler = new RecordAssembler();
    const first = chunks[0],
      second = chunks[1];
    assert(first && second);
    expect(() => assembler.accept(second, 0)).toThrow();
    expect(assembler.accept(first, 0)).toBeUndefined();
    expect(() => assembler.accept(first, 0)).toThrow();
    const bad = second.slice();
    new DataView(bad.buffer).setUint32(4, 20001);
    expect(() => assembler.accept(bad, 0)).toThrow();
    expect(assembler.expired(5000)).toBe(true);
    expect(() => assembler.accept(second, 5000)).toThrow();
    expect(() => fragmentRecord(new Uint8Array(RECORD_LIMIT + 1))).toThrow();
  });
});
