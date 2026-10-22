import type { FcmToken } from "./fcm-auth.js";

/** HTTP v1 sender. Authentication comes from the internal global token cache. */
export async function deliverFcm(
  project: string | undefined,
  token: FcmToken | undefined,
  fid: string,
  data: Record<string, string>,
): Promise<"accepted" | "invalid_target" | "unavailable" | "unauthorized"> {
  if (
    !project ||
    !token ||
    !Number.isFinite(token.expiresAt) ||
    Date.now() >= token.expiresAt
  )
    return "unavailable";
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${project}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            fid,
            data,
            android: {
              priority: "high",
              ttl: "60s",
              collapse_key: "connect-v1",
            },
          },
        }),
        signal: AbortSignal.timeout(10000),
        redirect: "manual",
      },
    );
    if (response.ok) return "accepted";
    if (response.status === 401) return "unauthorized";
    const result = (await response.json()) as {
      error?: { details?: { errorCode?: string }[] };
    };
    return result.error?.details?.some(
      (detail) => detail.errorCode === "UNREGISTERED",
    )
      ? "invalid_target"
      : "unavailable";
  } catch {
    return "unavailable";
  }
}
