/** Friendly default label such as "Chrome on macOS"; a convenience for the phone owner, not an identity claim. */
type Hints = { brands?: { brand: string }[]; platform?: string };

const browsers: [RegExp, string][] = [
  [/Edg(A|iOS)?\//, "Edge"],
  [/OPR\//, "Opera"],
  [/SamsungBrowser\//, "Samsung Internet"],
  [/Firefox\/|FxiOS\//, "Firefox"],
  [/Chrome\/|CriOS\//, "Chrome"],
  [/Safari\//, "Safari"],
];

function platformName(ua: string, hint: string | undefined, touch: number) {
  if (hint === "Chrome OS") return "ChromeOS";
  if (hint) return hint;
  if (/iPhone/.test(ua)) return "iPhone";
  if (/iPad/.test(ua)) return "iPad";
  if (/Android/.test(ua)) return "Android";
  // iPadOS Safari reports a Mac user agent; touch support tells them apart.
  if (/Mac OS X/.test(ua)) return touch > 1 ? "iPad" : "macOS";
  if (/Windows/.test(ua)) return "Windows";
  if (/CrOS/.test(ua)) return "ChromeOS";
  if (/Linux/.test(ua)) return "Linux";
  return undefined;
}

export function browserName(
  nav: Pick<Navigator, "userAgent" | "maxTouchPoints"> & {
    userAgentData?: Hints;
  } = navigator,
): string {
  const ua = nav.userAgent;
  const hinted = nav.userAgentData?.brands
    ?.map((b) => b.brand)
    .find((b) => !/Not.?A.?Brand|Chromium/i.test(b))
    ?.replace(/^(Google|Microsoft) /, "");
  const browser =
    hinted ?? browsers.find(([pattern]) => pattern.test(ua))?.[1] ?? "Browser";
  const platform = platformName(
    ua,
    nav.userAgentData?.platform,
    nav.maxTouchPoints,
  );
  return (platform ? `${browser} on ${platform}` : browser).slice(0, 40).trim();
}
