import type { Bytes } from "./index.js";

export type FeatureState = "unavailable" | "permission-needed" | "enabled";
export type RequestState =
  | "unavailable"
  | "off"
  | "notifications-needed"
  | "setup-needed"
  | "enabled";
export interface PhoneFeatures {
  type: "features";
  v: 1;
  screenViewing: FeatureState;
  touchControl: FeatureState;
  connectionRequests: RequestState;
}

/** Only an authenticated record from the phone may populate viewer capability state. */
export function parseFeatures(data: Bytes): PhoneFeatures {
  if (data.length > 2048) throw new Error("Invalid phone feature report");
  const value: unknown = JSON.parse(
    new TextDecoder("utf-8", { fatal: true }).decode(data),
  );
  if (!value || typeof value !== "object")
    throw new Error("Invalid phone feature report");
  const f = value as Record<string, unknown>;
  const feature = (v: unknown): v is FeatureState =>
    v === "unavailable" || v === "permission-needed" || v === "enabled";
  const request = (v: unknown): v is RequestState =>
    v === "unavailable" ||
    v === "off" ||
    v === "notifications-needed" ||
    v === "setup-needed" ||
    v === "enabled";
  if (
    f.type !== "features" ||
    f.v !== 1 ||
    !feature(f.screenViewing) ||
    !feature(f.touchControl) ||
    !request(f.connectionRequests)
  )
    throw new Error("Invalid phone feature report");
  return {
    type: "features",
    v: 1,
    screenViewing: f.screenViewing,
    touchControl: f.touchControl,
    connectionRequests: f.connectionRequests,
  };
}
