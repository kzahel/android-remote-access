import { describe, expect, it } from "vitest";
import { parseFeatures } from "../src/features.js";
import { utf8 } from "../src/index.js";

const report = {
  type: "features",
  v: 1,
  screenViewing: "unavailable",
  touchControl: "permission-needed",
  connectionRequests: "notifications-needed",
  device: {
    manufacturer: "Google",
    model: "Pixel 9",
    name: "Pixel 9",
    android: "17",
    sdk: 37,
    app: "0.6.0",
  },
};
describe("authenticated phone feature report decoding", () => {
  it("keeps capability states independent and drops remote display text", () => {
    expect(
      parseFeatures(
        utf8(JSON.stringify({ ...report, message: "untrusted display text" })),
      ),
    ).toEqual(report);
  });
  it.each([
    null,
    [],
    { ...report, v: 2 },
    { ...report, screenViewing: true },
    { ...report, touchControl: "granted" },
    { ...report, connectionRequests: "" },
    { ...report, device: undefined },
  ])("rejects invalid reports: %j", (value) => {
    expect(() => parseFeatures(utf8(JSON.stringify(value)))).toThrow();
  });
  it("rejects oversized and malformed records", () => {
    expect(() => parseFeatures(utf8(" ".repeat(2049)))).toThrow();
    expect(() => parseFeatures(new Uint8Array([255]))).toThrow();
    expect(() => parseFeatures(utf8("{"))).toThrow();
  });
});
