/** Bounded synthetic acceptance against the isolated, secret-gated workers.dev proof. */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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

const root = path.dirname(fileURLToPath(import.meta.url));
const configPath = process.env.PROOF_LIVE_CONFIG;
const secretsPath = process.env.PROOF_LIVE_SECRETS;
if (!configPath || !secretsPath)
  throw new Error("PROOF_LIVE_CONFIG and PROOF_LIVE_SECRETS required");
const config = JSON.parse(await readFile(configPath, "utf8"));
const origin: string = config.vars.PUBLIC_ORIGIN;
const url = new URL(origin);
assert.equal(config.name, "yepcontrol-relay-proof");
assert.equal(url.protocol, "https:");
assert.ok(
  url.hostname.startsWith("yepcontrol-relay-proof.") &&
    url.hostname.endsWith(".workers.dev"),
);
assert.equal(url.origin, origin);
assert.equal(config.workers_dev, true);
assert.ok(
  Number(config.vars.PROOF_EXPIRES) > Date.now() &&
    Number(config.vars.PROOF_EXPIRES) < Date.now() + 7200001,
);
assert.equal(
  (await stat(secretsPath)).mode & 0o077,
  0,
  "Secrets file must be owner-only",
);
const key: string = JSON.parse(await readFile(secretsPath, "utf8")).PROOF_KEY;
assert.ok(key.length >= 32);
const headers = { "X-Proof-Key": key };
const viewer = await createIdentity();
const phone = await createIdentity();
const wrong = await createIdentity();
const id = hex(crypto.getRandomValues(new Uint8Array(16)));
const invitation = {
  id,
  viewer: b64(viewer.publicKey),
  expires: Math.floor(Date.now() / 1000) + 300,
};
const sockets = new Set<WebSocket>();
const report: Record<string, unknown> = {
  live: true,
  syntheticEndpoints: true,
  startedAt: new Date().toISOString(),
};
let enrolled = false;
let revoked = false;
const request = (route: string, init: RequestInit = {}) =>
  fetch(`${origin}${route}`, { ...init, signal: AbortSignal.timeout(15000) });
const api = (action = "", value?: unknown) =>
  request(
    `/api/pair/${id}${action}`,
    value === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify(value),
        },
  );
async function status(): Promise<{
  boot: string;
  build: string;
  sockets: number;
  authenticated: number;
  revoked: boolean;
}> {
  const result = await request(`/_proof/${id}`, { headers });
  assert.equal(result.status, 200);
  return result.json();
}
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function close(
  ws: WebSocket,
  timeout = 45000,
): Promise<{ code: number; clean: boolean }> {
  if (ws.readyState === WebSocket.CLOSED)
    return Promise.reject(new Error("Socket already closed"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Close deadline exceeded")),
      timeout,
    );
    ws.addEventListener(
      "close",
      (event) => {
        clearTimeout(timer);
        resolve({ code: event.code, clean: event.wasClean });
      },
      { once: true },
    );
  });
}
function socket() {
  const ws = new WebSocket(
    `${origin.replace("https:", "wss:")}/api/socket?id=${id}`,
    { headers, handshakeTimeout: 15000 },
  );
  sockets.add(ws);
  ws.binaryType = "arraybuffer";
  const queue: (string | ArrayBuffer)[] = [];
  let ended = false;
  let wake: (() => void) | undefined;
  ws.on("message", (data, binary) => {
    if (binary) {
      assert.ok(data instanceof ArrayBuffer);
      queue.push(data);
    } else queue.push(data.toString());
    wake?.();
  });
  ws.on("close", () => {
    ended = true;
    sockets.delete(ws);
    wake?.();
  });
  ws.on("error", () => {
    ended = true;
    wake?.();
  });
  async function next() {
    if (!queue.length && !ended)
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, 15000);
        wake = () => {
          clearTimeout(timer);
          resolve();
        };
      });
    const result = queue.shift();
    assert.notEqual(
      result,
      undefined,
      "Socket closed or message deadline exceeded",
    );
    return result as string | ArrayBuffer;
  }
  const json = async () => JSON.parse(String(await next()));
  async function authenticate(
    identity: typeof viewer,
    role: "phone" | "viewer",
    signedId = id,
  ) {
    const challenge = await json();
    assert.equal(challenge.type, "challenge");
    ws.send(
      JSON.stringify({
        id: signedId,
        role,
        signature: b64(
          await identity.sign(
            authBytes(origin, signedId, role, challenge.nonce),
          ),
        ),
      }),
    );
  }
  return { ws, next, json, authenticate };
}
async function connect() {
  const v = socket();
  await v.authenticate(viewer, "viewer");
  assert.equal((await v.json()).type, "authenticated");
  const p = socket();
  await p.authenticate(phone, "phone");
  assert.equal((await p.json()).type, "authenticated");
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
  async function exchange(message: string) {
    const plain = new TextEncoder().encode(message);
    v.ws.send(await channel.seal(plain));
    assert.deepEqual(
      await accepted.channel.open(
        new Uint8Array((await p.next()) as ArrayBuffer),
      ),
      plain,
    );
    p.ws.send(await accepted.channel.seal(plain));
    assert.deepEqual(
      await channel.open(new Uint8Array((await v.next()) as ArrayBuffer)),
      plain,
    );
  }
  return { v, p, channel, phoneChannel: accepted.channel, exchange };
}
async function refusal(identity: typeof viewer, signedId = id) {
  const candidate = socket();
  const closed = close(candidate.ws);
  await candidate.authenticate(identity, "viewer", signedId);
  assert.equal((await closed).code, 4003);
}
async function revoke() {
  const response = await api("/revoke", {
    signature: b64(await phone.sign(revokeBytes(origin, id))),
  });
  assert.equal(response.status, 200);
  revoked = true;
}
try {
  console.log("Checking live gate, origin and signed enrollment");
  assert.equal((await request(`/api/pair/${id}`)).status, 403);
  assert.equal(
    (
      await request(`/api/pair/${id}`, {
        headers: { ...headers, Origin: "https://wrong.invalid" },
      })
    ).status,
    403,
  );
  assert.equal(
    (await api("", { ...invitation, signature: "bad" })).status,
    400,
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
  const viewerSignature = b64(await viewer.sign(grantBytes(origin, grant)));
  const completions = await Promise.all([
    api("/complete", { viewerSignature }),
    api("/complete", { viewerSignature }),
  ]);
  assert.deepEqual(completions.map((r) => r.status).sort(), [200, 400]);
  enrolled = true;
  report.signedEnrollment = true;
  await refusal(wrong);
  await refusal(viewer, "00".repeat(16));
  report.wrongKeyAndRoutingIdRefused = true;

  let session = await connect();
  await session.exchange("live E2E both directions 🌞");
  report.bidirectionalE2E = true;
  const first = await status();
  console.log(
    "Waiting for real idle hibernation with authenticated sockets open",
  );
  let after = first;
  let idleMs = 0;
  for (let attempt = 0; attempt < 5 && after.boot === first.boot; attempt++) {
    await delay(25000);
    idleMs += 25000;
    after = await status();
    console.log(
      JSON.stringify({
        idleMs,
        constructorChanged: after.boot !== first.boot,
        authenticatedSockets: after.authenticated,
      }),
    );
  }
  assert.notEqual(
    after.boot,
    first.boot,
    "No real hibernation observed within bounded idle window",
  );
  assert.equal(after.authenticated, 2);
  await session.exchange("after real hibernation 🌙");
  report.hibernation = {
    constructorChanged: true,
    preservedSockets: after.authenticated,
    observedAfterMs: idleMs,
  };

  console.log(
    "Measuring 30 seconds of paced encrypted phone-to-viewer records",
  );
  const count = 900;
  const sent: number[] = [];
  const latency: number[] = [];
  const start = performance.now();
  const receiving = (async () => {
    for (let frame = 0; frame < count; frame++) {
      const plain = await session.channel.open(
        new Uint8Array((await session.v.next()) as ArrayBuffer),
      );
      assert.equal(plain.byteLength, 16384);
      assert.equal(
        new DataView(plain.buffer, plain.byteOffset).getUint32(0),
        frame,
      );
      latency.push(performance.now() - (sent[frame] ?? start));
    }
  })();
  void receiving.catch(() => {});
  try {
    for (let frame = 0; frame < count; frame++) {
      assert.ok(
        session.p.ws.bufferedAmount < 2097152,
        "Sender backpressure budget exceeded",
      );
      const plain = new Uint8Array(16384);
      new DataView(plain.buffer).setUint32(0, frame);
      sent.push(performance.now());
      session.p.ws.send(await session.phoneChannel.seal(plain));
      await delay(
        Math.max(0, start + ((frame + 1) * 1000) / 30 - performance.now()),
      );
    }
  } finally {
    await receiving;
  }
  const elapsed = performance.now() - start;
  latency.sort((a, b) => a - b);
  report.stream = {
    frames: count,
    bytesPerFrame: 16384,
    elapsedMs: Math.round(elapsed),
    payloadMbps: Number(((count * 16384 * 8) / elapsed / 1000).toFixed(2)),
    p50Ms: latency[Math.floor(count * 0.5)],
    p95Ms: latency[Math.floor(count * 0.95)],
    maxMs: latency.at(-1),
  };
  console.log(JSON.stringify(report.stream));

  console.log(
    "Checking a five-second paused receiver and record-size boundaries",
  );
  session.v.ws.pause();
  const pausedAt = performance.now();
  try {
    for (let frame = 0; frame < 150; frame++) {
      const plain = new Uint8Array(16384);
      new DataView(plain.buffer).setUint32(0, frame);
      session.p.ws.send(await session.phoneChannel.seal(plain));
      await delay(
        Math.max(0, pausedAt + ((frame + 1) * 1000) / 30 - performance.now()),
      );
    }
  } finally {
    session.v.ws.resume();
  }
  for (let frame = 0; frame < 150; frame++) {
    const plain = await session.channel.open(
      new Uint8Array((await session.v.next()) as ArrayBuffer),
    );
    assert.equal(plain.byteLength, 16384);
    assert.equal(
      new DataView(plain.buffer, plain.byteOffset).getUint32(0),
      frame,
    );
  }
  report.pausedReceiver = {
    pauseMs: 5000,
    records: 150,
    bytesPerRecord: 16384,
    recoveredInOrder: true,
  };
  const maximum = await session.phoneChannel.seal(new Uint8Array(1048576));
  assert.equal(maximum.byteLength, 1048608);
  session.p.ws.send(maximum);
  assert.equal(
    (
      await session.channel.open(
        new Uint8Array((await session.v.next()) as ArrayBuffer),
      )
    ).byteLength,
    1048576,
  );
  const limitPhoneClosed = close(session.p.ws),
    limitViewerClosed = close(session.v.ws);
  session.p.ws.send(new Uint8Array(1048609));
  assert.equal((await limitPhoneClosed).code, 4003);
  assert.equal((await limitViewerClosed).code, 4001);
  session.channel.close();
  session.phoneChannel.close();
  session = await connect();
  await session.exchange("fresh session after oversized record refusal");
  report.recordBoundary = {
    acceptedBytes: 1048608,
    rejectedBytes: 1048609,
    recovered: true,
  };

  const duplicate = socket();
  const duplicateClosed = close(duplicate.ws);
  await duplicate.authenticate(viewer, "viewer");
  assert.equal((await duplicateClosed).code, 4003);
  await session.exchange("duplicate did not displace original");
  report.duplicateRefusedWithoutDisplacement = true;
  const idle = socket();
  const idleStarted = performance.now();
  const idleClosed = close(idle.ws);
  await idle.json();
  const idleResult = await idleClosed;
  assert.equal(idleResult.code, 4003);
  report.unauthenticatedTimeout = {
    ...idleResult,
    observedMs: Math.round(performance.now() - idleStarted),
  };
  console.log(JSON.stringify(report.unauthenticatedTimeout));
  const peerClosed = close(session.p.ws);
  session.v.ws.terminate();
  assert.equal((await peerClosed).code, 4001);
  session.channel.close();
  session.phoneChannel.close();
  session = await connect();
  await session.exchange("fresh reconnect, no queued records");
  report.abruptDisconnectAndFreshReconnect = true;
  assert.equal(
    (
      await api("/revoke", {
        signature: b64(await viewer.sign(revokeBytes(origin, id))),
      })
    ).status,
    400,
  );
  const vClosed = close(session.v.ws),
    pClosed = close(session.p.ws);
  await revoke();
  assert.equal((await vClosed).code, 4001);
  assert.equal((await pClosed).code, 4001);
  session.channel.close();
  session.phoneChannel.close();
  assert.equal((await api()).status, 410);
  report.revocationDisconnectedBoth = true;

  console.log(
    "Redeploying only the isolated proof Worker to check durable revocation",
  );
  const redeployedBuild = `live-${crypto.randomUUID()}`;
  const redeploy = await promisify(execFile)(
    path.join(root, "node_modules/.bin/wrangler"),
    [
      "deploy",
      "--config",
      configPath,
      "--secrets-file",
      secretsPath,
      "--var",
      `PROOF_BUILD:${redeployedBuild}`,
    ],
    { cwd: root, timeout: 120000, maxBuffer: 2097152 },
  );
  await writeFile(
    path.join(path.dirname(configPath), "redeploy.log"),
    redeploy.stdout + redeploy.stderr,
    { mode: 0o600 },
  );
  let current = await status();
  for (
    let attempt = 0;
    attempt < 12 && current.build !== redeployedBuild;
    attempt++
  ) {
    await delay(1000);
    current = await status();
  }
  assert.equal(current.build, redeployedBuild);
  assert.equal(current.revoked, true);
  assert.equal((await api()).status, 410);
  assert.equal((await api("", creation)).status, 400);
  await refusal(viewer);
  report.revocationSurvivedRedeploy = true;
  report.finishedAt = new Date().toISOString();
  await writeFile(
    path.join(path.dirname(configPath), "report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 },
  );
  console.log(JSON.stringify(report));
  console.log("Live Cloudflare proof passed");
} finally {
  for (const ws of sockets) ws.terminate();
  if (enrolled && !revoked) await revoke();
}
