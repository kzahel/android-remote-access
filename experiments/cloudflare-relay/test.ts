import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { WebSocket } from "ws";
import {
  authBytes,
  createBytes,
  fromHex,
  grantBytes,
  grantMac,
  hex,
  revokeBytes,
} from "../../protocol/src/enrollment.js";
import {
  b64,
  createIdentity,
  PhoneHandshake,
  ViewerHandshake,
} from "../../protocol/src/index.js";

const directory = await mkdtemp(path.join(tmpdir(), "yepcontrol-do-proof-"));
const origin = "https://proof.invalid";
const fixtureKey = crypto.randomUUID();
const workerName = "proof";
const options = convertV4MiniflareOptions({
  name: workerName,
  modules: true,
  scriptPath: ".local/bundle/worker.js",
  compatibilityDate: "2026-10-01",
  cf: false,
  durableObjects: {
    PAIRINGS: { className: "Pairing", useSQLite: true },
    WAKE_BUDGET: { className: "WakeBudget", useSQLite: true },
    ADMISSION: { className: "Admission", useSQLite: true },
  },
  ratelimits: {
    HTTP_LIMITER: {
      namespace_id: "340001",
      simple: { limit: 240, period: 60 },
    },
    START_LIMITER: {
      namespace_id: "340002",
      simple: { limit: 10, period: 60 },
    },
  },
  resourcePersistencePath: directory,
  bindings: { PUBLIC_ORIGIN: origin, PROOF_KEY: fixtureKey },
});
let mf = new Miniflare(options);
const headers = { "X-Proof-Key": fixtureKey };
const viewer = await createIdentity();
const phone = await createIdentity();
const id = hex(crypto.getRandomValues(new Uint8Array(16)));
const invitation = {
  id,
  viewer: b64(viewer.publicKey),
  expires: Math.floor(Date.now() / 1000) + 300,
};
async function api(action = "", value?: unknown, routeId = id) {
  return mf.dispatchFetch(
    `${origin}/api/pair/${routeId}${action}`,
    value === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
}
async function socket(acknowledge = true) {
  const address = await mf.ready;
  const url = new URL(`/api/socket?id=${id}`, address);
  url.protocol = "ws:";
  const ws = new WebSocket(url, { headers });
  ws.binaryType = "arraybuffer";
  const queue: (string | ArrayBuffer)[] = [];
  let wake: (() => void) | undefined;
  let closed = false;
  ws.on("message", (data, binary) => {
    if (binary) {
      assert.ok(data instanceof ArrayBuffer);
      queue.push(data);
    } else {
      const value = JSON.parse(data.toString());
      if (value.type === "relayReceipt") {
        if (acknowledge)
          ws.send(JSON.stringify({ type: "relayAck", nonce: value.nonce }));
        return;
      }
      queue.push(data.toString());
    }
    wake?.();
  });
  ws.addEventListener("close", () => {
    closed = true;
    wake?.();
  });
  ws.on("error", () => {});
  async function next() {
    if (!queue.length && !closed)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 3000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    const result = queue.shift();
    assert.notEqual(result, undefined, "Socket closed or timed out");
    return result as string | ArrayBuffer;
  }
  const json = async () => JSON.parse(String(await next()));
  return {
    ws,
    next,
    json,
    async login(
      identity: typeof phone,
      role: "phone" | "viewer",
      routeId = id,
    ) {
      const challenge = await json();
      ws.send(
        JSON.stringify({
          id: routeId,
          role,
          signature: b64(
            await identity.sign(
              authBytes(origin, routeId, role, challenge.nonce),
            ),
          ),
        }),
      );
      return json();
    },
  };
}
try {
  const health = await mf.dispatchFetch(`${origin}/health`);
  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    version: "development",
    revision: "development",
    deployment: null,
    admission: "gated",
  });
  assert.equal((await mf.listDurableObjectIds("PAIRINGS")).length, 0);
  assert.equal(
    (await mf.dispatchFetch(`${origin}/api/pair/${id}`)).status,
    403,
  );
  assert.equal(
    (
      await api("", {
        viewer: invitation.viewer,
        expires: invitation.expires,
        signature: "bad",
      })
    ).status,
    400,
  );
  assert.equal(
    (await mf.listDurableObjectIds("PAIRINGS")).length,
    0,
    "Invalid signatures must not allocate objects",
  );
  const creation = {
    ...invitation,
    signature: b64(await viewer.sign(createBytes(origin, invitation))),
  };
  const starts = await Promise.all([api("", creation), api("", creation)]);
  assert.deepEqual(starts.map((r) => r.status).sort(), [201, 400]);
  const grant = {
    ...invitation,
    phone: b64(phone.publicKey),
    phoneSignature: "",
    mac: "",
  };
  grant.phoneSignature = b64(await phone.sign(grantBytes(origin, grant)));
  grant.mac = hex(
    await grantMac(
      hex(crypto.getRandomValues(new Uint8Array(32))),
      grantBytes(origin, grant),
    ),
  );
  assert.equal(
    (await api("/offer", { ...grant, device: "c2VhbGVk" })).status,
    202,
  );
  const completions = await Promise.all(
    [0, 1].map(() =>
      api("/complete", { viewerSignature: b64(new Uint8Array()) }),
    ),
  );
  assert.deepEqual(
    completions.map((r) => r.status),
    [400, 400],
  );
  const signature = b64(await viewer.sign(grantBytes(origin, grant)));
  const completed = await Promise.all([
    api("/complete", { viewerSignature: signature }),
    api("/complete", { viewerSignature: signature }),
  ]);
  assert.deepEqual(completed.map((r) => r.status).sort(), [200, 400]);

  const v = await socket();
  assert.equal((await v.login(viewer, "viewer")).type, "authenticated");
  const p = await socket();
  assert.equal((await p.login(phone, "phone")).type, "authenticated");
  assert.equal((await v.json()).type, "ready");
  assert.equal((await p.json()).type, "ready");
  const authority = {
    id: fromHex(id, 16),
    generation: 1,
    peer: phone.publicKey,
    current: () => true,
  };
  const vh = await ViewerHandshake.start(viewer, authority);
  v.ws.send(vh.hello);
  const ph = await PhoneHandshake.start(
    phone,
    { ...authority, peer: viewer.publicKey },
    new Uint8Array((await p.next()) as ArrayBuffer),
  );
  p.ws.send(ph.offer);
  v.ws.send(await vh.answer(new Uint8Array((await v.next()) as ArrayBuffer)));
  const accepted = await ph.finish(
    new Uint8Array((await p.next()) as ArrayBuffer),
  );
  p.ws.send(accepted.finish);
  const channel = await vh.finish(
    new Uint8Array((await v.next()) as ArrayBuffer),
  );
  const roundTrip = async (plaintext: Uint8Array<ArrayBuffer>) => {
    const sealed = await channel.seal(plaintext);
    v.ws.send(sealed);
    assert.deepEqual(
      await accepted.channel.open(
        new Uint8Array((await p.next()) as ArrayBuffer),
      ),
      plaintext,
    );
  };
  await roundTrip(new TextEncoder().encode("before hibernation 🌞"));
  await mf.unsafeEvictDurableObject(workerName, "Pairing", {
    name: id,
    webSockets: "hibernate",
  });
  await roundTrip(new TextEncoder().encode("after forced hibernation 🌙"));

  const bytes = new Uint8Array(16384);
  const latencies: number[] = [];
  const start = performance.now();
  for (let frame = 0; frame < 90; frame++) {
    bytes[0] = frame;
    const before = performance.now();
    await roundTrip(bytes);
    latencies.push(performance.now() - before);
    await new Promise((resolve) =>
      setTimeout(
        resolve,
        Math.max(0, start + ((frame + 1) * 1000) / 30 - performance.now()),
      ),
    );
  }
  const elapsed = performance.now() - start;
  console.log(
    JSON.stringify({
      localOnly: true,
      encryptedFrames: 90,
      bytesPerFrame: bytes.length,
      elapsedMs: Math.round(elapsed),
      effectiveMbps: Number(
        ((90 * bytes.length * 8) / elapsed / 1000).toFixed(2),
      ),
      p95LocalRoundTripMs: Number(
        latencies
          .sort((a, b) => a - b)
          [Math.floor(latencies.length * 0.95)]?.toFixed(2),
      ),
      forcedHibernationPreservedAuthenticatedSockets: true,
    }),
  );
  const budgets = await mf.getDurableObjectNamespace("WAKE_BUDGET");
  const budget = budgets.get(budgets.idFromName("global"));
  const admit = (fid: string) =>
    budget.fetch("https://budget.invalid/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fid }),
    });
  for (let attempt = 0; attempt < 10; attempt++)
    assert.equal((await admit("fixture-target")).status, 200);
  assert.equal(
    (await admit("fixture-target")).status,
    429,
    "Per-target budget",
  );
  for (let attempt = 0; attempt < 90; attempt++)
    assert.equal((await admit(`fixture-${attempt}`)).status, 200);
  await mf.unsafeEvictDurableObject(workerName, "WakeBudget", {
    name: "global",
  });
  assert.equal(
    (await admit("fresh-target")).status,
    429,
    "Global budget survives eviction",
  );
  const alarmStarted = performance.now();
  const idle = await socket();
  await idle.json();
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
            `Authentication alarm close timeout, client state ${idle.ws.readyState}`,
          ),
        ),
      45000,
    );
    idle.ws.addEventListener("close", (event) => {
      clearTimeout(timer);
      try {
        assert.equal(event.code, 4003);
        console.log(
          JSON.stringify({
            unauthenticatedCloseCode: event.code,
            unauthenticatedCloseMs: Math.round(
              performance.now() - alarmStarted,
            ),
            cleanClose: event.wasClean,
          }),
        );
        resolve();
      } catch (error) {
        reject(error);
      }
    });
  });
  const duplicate = await socket();
  await assert.rejects(duplicate.login(viewer, "viewer"));
  const peerClosed = new Promise<number>((resolve) =>
    v.ws.once("close", resolve),
  );
  p.ws.terminate();
  assert.equal(await peerClosed, 4001, "Abrupt loss must disconnect the peer");
  const replacementViewer = await socket();
  assert.equal(
    (await replacementViewer.login(viewer, "viewer")).type,
    "authenticated",
  );
  const replacementPhone = await socket(false);
  assert.equal(
    (await replacementPhone.login(phone, "phone")).type,
    "authenticated",
  );
  assert.equal((await replacementViewer.json()).type, "ready");
  assert.equal((await replacementPhone.json()).type, "ready");
  const stalledViewerClose = new Promise<number>((resolve) =>
    replacementViewer.ws.once("close", resolve),
  );
  const stalledPhoneClose = new Promise<number>((resolve) =>
    replacementPhone.ws.once("close", resolve),
  );
  replacementViewer.ws.send(new Uint8Array(1048576));
  assert.equal(
    ((await replacementPhone.next()) as ArrayBuffer).byteLength,
    1048576,
  );
  replacementViewer.ws.send(new Uint8Array(1048576));
  assert.equal(
    ((await replacementPhone.next()) as ArrayBuffer).byteLength,
    1048576,
  );
  await mf.unsafeEvictDurableObject(workerName, "Pairing", {
    name: id,
    webSockets: "hibernate",
  });
  replacementViewer.ws.send(new Uint8Array(1));
  assert.equal(
    await stalledViewerClose,
    4001,
    "Unacknowledged data remains bounded across hibernation",
  );
  assert.equal(await stalledPhoneClose, 4001);
  const invalidAckViewer = await socket();
  assert.equal(
    (await invalidAckViewer.login(viewer, "viewer")).type,
    "authenticated",
  );
  const invalidAckClose = new Promise<number>((resolve) =>
    invalidAckViewer.ws.once("close", resolve),
  );
  invalidAckViewer.ws.send(
    JSON.stringify({ type: "relayAck", nonce: "00".repeat(16) }),
  );
  assert.equal(
    await invalidAckClose,
    4001,
    "Cannot acknowledge data never sent",
  );
  assert.equal(
    (
      await api("/revoke", {
        signature: b64(await viewer.sign(revokeBytes(origin, id))),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await api("/revoke", {
        signature: b64(await phone.sign(revokeBytes(origin, id))),
      })
    ).status,
    200,
  );
  channel.close();
  accepted.channel.close();
  await mf.dispose();
  mf = new Miniflare(options);
  assert.equal((await api()).status, 410);
  assert.equal((await api("", creation)).status, 400);
  const denied = await socket();
  await assert.rejects(denied.login(viewer, "viewer"));
  console.log(
    "Cloudflare local proof passed: signed enrollment, concurrent completion, E2E, forced hibernation, paced opaque records, persisted revocation.",
  );
} finally {
  await mf.dispose();
  await rm(directory, { recursive: true, force: true });
}
