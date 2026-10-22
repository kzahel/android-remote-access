import assert from "node:assert/strict";
import { deliverFcm } from "./fcm.js";

const original = globalThis.fetch;
const fid = `c${"a".repeat(21)}`;
const token = { accessToken: "fixture-token", expiresAt: Date.now() + 60000 };
let calls = 0;
let response = Response.json({ name: "projects/fixture/messages/accepted" });
try {
  globalThis.fetch = async (url, init) => {
    calls++;
    assert.equal(
      url,
      "https://fcm.googleapis.com/v1/projects/fixture/messages:send",
    );
    assert.equal(
      new Headers(init?.headers).get("Authorization"),
      "Bearer fixture-token",
    );
    assert.deepEqual(JSON.parse(String(init?.body)), {
      message: {
        fid,
        data: { intent: "connect-v1" },
        android: { priority: "high", ttl: "60s", collapse_key: "connect-v1" },
      },
    });
    return response;
  };
  assert.equal(
    await deliverFcm("fixture", { ...token, expiresAt: 1 }, fid, {}),
    "unavailable",
  );
  for (const invalid of [
    undefined,
    { ...token, expiresAt: NaN },
    { ...token, expiresAt: Infinity },
  ])
    assert.equal(await deliverFcm("fixture", invalid, fid, {}), "unavailable");
  assert.equal(calls, 0);
  assert.equal(
    await deliverFcm("fixture", token, fid, {
      intent: "connect-v1",
    }),
    "accepted",
  );
  response = Response.json(
    { error: { details: [{ errorCode: "UNREGISTERED" }] } },
    { status: 404 },
  );
  assert.equal(
    await deliverFcm("fixture", token, fid, {
      intent: "connect-v1",
    }),
    "invalid_target",
  );
  response = Response.json(
    { error: { status: "UNAVAILABLE" } },
    { status: 503 },
  );
  assert.equal(
    await deliverFcm("fixture", token, fid, {
      intent: "connect-v1",
    }),
    "unavailable",
  );
  response = new Response(null, { status: 401 });
  assert.equal(
    await deliverFcm("fixture", token, fid, { intent: "connect-v1" }),
    "unauthorized",
  );
  response = new Response(null, { status: 403 });
  assert.equal(
    await deliverFcm("fixture", token, fid, { intent: "connect-v1" }),
    "unavailable",
  );
  console.log("FCM HTTP v1 contract and expiry/provider classification passed");
} finally {
  globalThis.fetch = original;
}
