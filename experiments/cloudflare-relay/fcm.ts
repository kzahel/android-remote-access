/** HTTP v1 sender for a short-lived proof token; no service-account private key here. */
export async function deliverFcm(
  project: string | undefined,
  token: string | undefined,
  tokenExpires: string | undefined,
  fid: string,
  data: Record<string, string>,
): Promise<"accepted" | "invalid_target" | "unavailable"> {
  const expires = Number(tokenExpires);
  if (!project || !token || !Number.isFinite(expires) || Date.now() >= expires)
    return "unavailable";
  try {
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${project}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
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
      },
    );
    if (response.ok) return "accepted";
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
