import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { FcmAuth, type TokenStore } from "./fcm-auth.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const account = {
  type: "service_account",
  project_id: "fixture",
  client_email: "sender@fixture.iam.gserviceaccount.com",
  private_key_id: "key-1",
  private_key: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
  // Credentials cannot redirect assertions or request broader OAuth scopes.
  token_uri: "https://attacker.invalid/",
};
let state: ReturnType<TokenStore["read"]>;
const store: TokenStore = {
  read: () => state && structuredClone(state),
  write: (value) => {
    state = structuredClone(value);
  },
};
let now = Date.now();
let calls = 0;
let mode: "ok" | "failure" | "timeout" | "malformed" = "ok";
const original = globalThis.fetch;
const secret = () => JSON.stringify(account);
const provider = () => new FcmAuth("fixture", secret(), store, () => now);
try {
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(url, "https://oauth2.googleapis.com/token");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "manual");
    const form = new URLSearchParams(init?.body as URLSearchParams);
    assert.equal(
      form.get("grant_type"),
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    const jwt = form.get("assertion");
    assert.ok(jwt);
    const [header, claims, signature] = jwt.split(".");
    assert.ok(header && claims && signature);
    assert.deepEqual(JSON.parse(Buffer.from(header, "base64url").toString()), {
      alg: "RS256",
      typ: "JWT",
      kid: account.private_key_id,
    });
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
    );
    assert.deepEqual(JSON.parse(Buffer.from(claims, "base64url").toString()), {
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      iss: account.client_email,
      aud: "https://oauth2.googleapis.com/token",
      iat: Math.floor(now / 1000),
      exp: Math.floor(now / 1000) + 3600,
    });
    if (mode === "failure")
      return new Response("private-provider-detail", { status: 503 });
    if (mode === "timeout")
      throw new DOMException("private-provider-detail", "TimeoutError");
    if (mode === "malformed")
      return Response.json({
        access_token: "fixture",
        token_type: "Bearer",
        expires_in: "3600",
      });
    return Response.json({
      access_token: `token-${calls}`,
      token_type: "Bearer",
      expires_in: 3600,
    });
  };
  const auth = provider();
  const tokens = await Promise.all(
    Array.from({ length: 20 }, () => auth.getToken()),
  );
  assert.equal(calls, 1, "Concurrent wakes share one exchange");
  assert.ok(tokens.every((value) => value.accessToken === "token-1"));
  assert.equal(
    (await provider().getToken()).accessToken,
    "token-1",
    "Cache survives object reconstruction",
  );
  assert.equal(calls, 1);
  assert.ok(!JSON.stringify(state).includes(account.private_key));
  now += 3540001;
  assert.equal(
    (await provider().getToken()).accessToken,
    "token-2",
    "Refresh before expiry",
  );
  now += 3600001;
  assert.equal(
    (await provider().getToken()).accessToken,
    "token-3",
    "Expired cache renews after restart",
  );
  provider().invalidate("token-1");
  assert.equal(
    (await provider().getToken()).accessToken,
    "token-3",
    "Stale send cannot invalidate new token",
  );
  provider().invalidate("token-3");
  await assert.rejects(provider().getToken(), /backoff/);
  assert.equal(calls, 3, "401 invalidation backs off across restart");
  now += 60001;
  assert.equal((await provider().getToken()).accessToken, "token-4");
  for (const failure of ["failure", "timeout", "malformed"] as const) {
    provider().invalidate(`token-${calls}`);
    now += 60001;
    mode = failure;
    const before: number = calls;
    await assert.rejects(provider().getToken(), {
      message: "FCM credential unavailable",
    });
    await assert.rejects(provider().getToken(), /backoff/);
    assert.equal(
      calls,
      before + 1,
      "Failed exchange retries at most once per minute",
    );
    now += 60001;
    mode = "ok";
    await provider().getToken();
  }
  const beforeRotation = calls;
  account.private_key_id = "key-2";
  await provider().getToken();
  assert.equal(
    calls,
    beforeRotation + 1,
    "Key rotation discards cached credentials immediately",
  );
  await assert.rejects(
    new FcmAuth("fixture", undefined, store).getToken(),
    /not configured/,
  );
  await assert.rejects(
    new FcmAuth("wrong-project", secret(), store).getToken(),
    { message: "FCM credential unavailable" },
  );
  assert.equal(
    calls,
    beforeRotation + 1,
    "Deleted or mismatched credentials never use the old token",
  );
  console.log(
    "FCM renewal passed: signed scoped JWT, single-flight, durable cache, expiry, invalidation, rotation and failure backoff",
  );
} finally {
  globalThis.fetch = original;
}
