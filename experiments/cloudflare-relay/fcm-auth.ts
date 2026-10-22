import { importPKCS8, SignJWT } from "jose";

export type FcmToken = { accessToken: string; expiresAt: number };
type State = {
  credential: string;
  token?: FcmToken;
  retryAt?: number;
};
export type TokenStore = {
  read(): State | undefined;
  write(state: State): void;
};
const endpoint = "https://oauth2.googleapis.com/token";
const scope = "https://www.googleapis.com/auth/firebase.messaging";

/** One provider per global WakeBudget object, with a durable short-lived cache.
 * Private keys remain in the Worker secret, never in SQLite or responses.
 */
export class FcmAuth {
  private pending: Promise<FcmToken> | undefined;
  constructor(
    private project: string | undefined,
    private secret: string | undefined,
    private store: TokenStore,
    private now = Date.now,
  ) {}

  getToken(): Promise<FcmToken> {
    if (!this.pending)
      this.pending = this.load().finally(() => {
        this.pending = undefined;
      });
    return this.pending;
  }

  invalidate(accessToken: string) {
    const state = this.store.read();
    // An older in-flight send cannot discard a newer token.
    if (state?.token?.accessToken === accessToken)
      this.store.write({
        credential: state.credential,
        retryAt: this.now() + 60000,
      });
  }

  private async load(): Promise<FcmToken> {
    if (!this.project || !this.secret) throw new Error("FCM not configured");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${this.project}\0${this.secret}`),
    );
    const credential = Array.from(new Uint8Array(digest), (v) =>
      v.toString(16).padStart(2, "0"),
    ).join("");
    const previous = this.store.read();
    // Key rotation invalidates both old tokens and the previous key's backoff.
    const state: State =
      previous?.credential === credential ? previous : { credential };
    const now = this.now();
    if (state.token && state.token.expiresAt > now + 60000) return state.token;
    if ((state.retryAt ?? 0) > now) throw new Error("FCM credential backoff");
    // Persist before awaiting Google so eviction/restart cannot amplify failures.
    this.store.write({ credential, retryAt: now + 60000 });
    try {
      const account = JSON.parse(this.secret) as Record<string, unknown>;
      if (
        account.type !== "service_account" ||
        account.project_id !== this.project ||
        typeof account.client_email !== "string" ||
        !/^[^@\s]+@[^@\s]+\.iam\.gserviceaccount\.com$/.test(
          account.client_email,
        ) ||
        typeof account.private_key_id !== "string" ||
        !account.private_key_id ||
        typeof account.private_key !== "string"
      )
        throw new Error("Invalid sender configuration");
      const key = await importPKCS8(account.private_key, "RS256");
      const issued = Math.floor(now / 1000);
      const assertion = await new SignJWT({ scope })
        .setProtectedHeader({
          alg: "RS256",
          typ: "JWT",
          kid: account.private_key_id,
        })
        .setIssuer(account.client_email)
        .setAudience(endpoint)
        .setIssuedAt(issued)
        .setExpirationTime(issued + 3600)
        .sign(key);
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion,
        }),
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw new Error("Token exchange failed");
      const value = (await response.json()) as Record<string, unknown>;
      if (
        typeof value.access_token !== "string" ||
        !value.access_token ||
        value.access_token.length > 16384 ||
        value.token_type !== "Bearer" ||
        typeof value.expires_in !== "number" ||
        !Number.isInteger(value.expires_in) ||
        value.expires_in <= 60 ||
        value.expires_in > 3600
      )
        throw new Error("Invalid token response");
      // Count lifetime from before the request, conservatively including latency.
      const token = {
        accessToken: value.access_token,
        expiresAt: now + value.expires_in * 1000,
      };
      if (token.expiresAt <= this.now() + 60000)
        throw new Error("Token expired during exchange");
      this.store.write({ credential, token });
      return token;
    } catch {
      // Never propagate provider responses, assertions, tokens or key material.
      throw new Error("FCM credential unavailable");
    }
  }
}
