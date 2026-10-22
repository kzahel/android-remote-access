import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";

const directory = await mkdtemp(path.join(tmpdir(), "yepcontrol-fcm-"));
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
});
const secret = JSON.stringify({
  type: "service_account",
  project_id: "fixture",
  client_email: "sender@fixture.iam.gserviceaccount.com",
  private_key_id: "test-key",
  private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
});
let exchanges = 0;
const options = convertV4MiniflareOptions({
  name: "fcm-runtime",
  modules: true,
  scriptPath: ".local/bundle/worker.js",
  unsafeInspectDurableObjects: true,
  compatibilityDate: "2026-10-01",
  cf: false,
  resourcePersistencePath: directory,
  durableObjects: { WAKE_BUDGET: { className: "WakeBudget", useSQLite: true } },
  bindings: {
    PUBLIC_ORIGIN: "https://proof.invalid",
    FCM_PROJECT: "fixture",
    FCM_SERVICE_ACCOUNT: secret,
  },
  outboundService: async (request) => {
    assert.equal(request.url, "https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(await request.text());
    const assertion = form.get("assertion");
    assert.ok(assertion);
    const [header, claims, signature] = assertion.split(".");
    assert.ok(header && claims && signature);
    assert.ok(
      verify(
        "RSA-SHA256",
        Buffer.from(`${header}.${claims}`),
        publicKey,
        Buffer.from(signature, "base64url"),
      ),
      "workerd signs a valid assertion",
    );
    exchanges++;
    return Response.json({
      access_token: `runtime-token-${exchanges}`,
      token_type: "Bearer",
      expires_in: 3600,
    });
  },
});
let mf = new Miniflare(options);
async function request(
  pathname = "/",
  value: unknown = { fid: crypto.randomUUID() },
) {
  const namespace = await mf.getDurableObjectNamespace("WAKE_BUDGET");
  return namespace
    .get(namespace.idFromName("global"))
    .fetch(`https://budget.invalid${pathname}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(value),
    });
}
async function token() {
  const response = await request();
  assert.equal(response.status, 200);
  return ((await response.json()) as { token: { accessToken: string } }).token
    .accessToken;
}
try {
  assert.deepEqual(
    await Promise.all(Array.from({ length: 8 }, token)),
    Array(8).fill("runtime-token-1"),
  );
  assert.equal(exchanges, 1);
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal(
    await token(),
    "runtime-token-1",
    "SQLite token cache survives workerd restart",
  );
  assert.equal(exchanges, 1);
  const storage = await mf.unsafeGetDurableObjectStorage(
    "fcm-runtime",
    "WakeBudget",
    { name: "global" },
  );
  await storage.exec(
    "UPDATE fcm_auth SET value = json_set(value, '$.token.expiresAt', ?)",
    Date.now() - 1,
  );
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal(
    await token(),
    "runtime-token-2",
    "Expired persisted token renews in workerd",
  );
  assert.equal(exchanges, 2);
  const invalidated = await request("/invalidate", {
    accessToken: "runtime-token-2",
  });
  await invalidated.text();
  await mf.dispose();
  mf = new Miniflare(options);
  const denied = await request();
  assert.equal(denied.status, 503);
  assert.deepEqual(await denied.json(), { error: "Wake unavailable" });
  assert.equal(exchanges, 2, "Invalidation backoff survives restart");
  const publicResponse = await mf.dispatchFetch(
    "https://proof.invalid/api/token",
  );
  assert.equal(publicResponse.status, 403, "No public credential endpoint");
  console.log(
    "FCM workerd/SQLite passed: concurrent exchange, restart, expiry renewal and durable 401 backoff",
  );
} finally {
  await mf.dispose();
  await rm(directory, { recursive: true, force: true });
}
