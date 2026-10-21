import { validBrowserName } from "@remote/protocol/enrollment";
import { describe, expect, it } from "vitest";
import { browserName } from "../src/browser-name.js";

const mac =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)";

describe("browserName", () => {
  it("prefers client hints", () => {
    expect(
      browserName({
        userAgent: "",
        maxTouchPoints: 0,
        userAgentData: {
          brands: [
            { brand: "Not_A Brand" },
            { brand: "Chromium" },
            { brand: "Google Chrome" },
          ],
          platform: "macOS",
        },
      }),
    ).toBe("Chrome on macOS");
    expect(
      browserName({
        userAgent: "",
        maxTouchPoints: 0,
        userAgentData: {
          brands: [{ brand: "Microsoft Edge" }, { brand: "Chromium" }],
          platform: "Windows",
        },
      }),
    ).toBe("Edge on Windows");
  });

  it("falls back to the user agent", () => {
    const cases: [string, number, string][] = [
      [`${mac} Version/19.0 Safari/605.1.15`, 0, "Safari on macOS"],
      [`${mac} Version/19.0 Safari/605.1.15`, 5, "Safari on iPad"],
      [
        "Mozilla/5.0 (iPhone; CPU iPhone OS 19_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0 Mobile/15E148 Safari/604.1",
        5,
        "Chrome on iPhone",
      ],
      [
        "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0",
        0,
        "Firefox on Linux",
      ],
      ["", 0, "Browser"],
    ];
    for (const [userAgent, maxTouchPoints, name] of cases) {
      expect(browserName({ userAgent, maxTouchPoints })).toBe(name);
      expect(validBrowserName(name)).toBe(true);
    }
  });

  it("rejects unsafe names", () => {
    expect(validBrowserName(" padded")).toBe(false);
    expect(validBrowserName("a\nb")).toBe(false);
    expect(validBrowserName("x".repeat(41))).toBe(false);
  });
});
