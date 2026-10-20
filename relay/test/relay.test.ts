import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  b64,
  createIdentity,
  type Identity,
  PhoneHandshake,
  utf8,
  ViewerHandshake,
} from "@remote/protocol";
import {
  authBytes,
  createBytes,
  decodeInvitation,
  encodeInvitation,
  fromHex,
  type Grant,
  grantBytes,
  grantMac,
  hex,
  type Invitation,
  revokeBytes,
  verifyOffer,
} from "@remote/protocol/enrollment";
import { afterEach, beforeEach, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { Options } from "../src/server.js";
import { createRelay } from "../src/server.js";

const origin = "https://example.test";
let directory: string;
let relay: ReturnType<typeof createRelay>;
let base: string;
let viewer: Identity;
let phone: Identity;
let invitation: Invitation;
const sockets: WebSocket[] = [];
async function start(config: Partial<Options> = {}) {
  relay = createRelay({ origin, stateDir: directory, ...config });
  relay.server.listen(0, "127.0.0.1");
  await once(relay.server, "listening");
  const address = relay.server.address();
  if (!address || typeof address === "string") throw new Error("No port");
  base = `http://127.0.0.1:${address.port}`;
}
const api = (
  suffix = "",
  body?: unknown,
  headers: Record<string, string> = {},
) =>
  fetch(
    `${base}/api/pair/${invitation.id}${suffix}`,
    body === undefined
      ? { headers }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify(body),
        },
  );
async function create() {
  return api("", {
    viewer: invitation.viewer,
    expires: invitation.expires,
    signature: b64(await viewer.sign(createBytes(origin, invitation))),
  });
}
async function offer(): Promise<Grant> {
  const g: Grant = {
    id: invitation.id,
    viewer: invitation.viewer,
    phone: b64(phone.publicKey),
    expires: invitation.expires,
    mac: "",
    phoneSignature: "",
  };
  g.mac = hex(await grantMac(invitation.secret, grantBytes(origin, g)));
  g.phoneSignature = b64(await phone.sign(grantBytes(origin, g)));
  return g;
}
async function enroll() {
  expect((await create()).status).toBe(201);
  const g = await offer();
  expect((await api("/offer", g)).status).toBe(202);
  await verifyOffer(invitation, g);
  expect(
    (
      await api("/complete", {
        viewerSignature: b64(await viewer.sign(grantBytes(origin, g))),
      })
    ).status,
  ).toBe(200);
  return g;
}
function client(headers: Record<string, string> = {}) {
  const socket = new WebSocket(`${base.replace("http:", "ws:")}/api/socket`, {
    headers,
  });
  sockets.push(socket);
  const queue: { data: Buffer; binary: boolean }[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  socket.on("error", () => {});
  socket.on("message", (data, binary) => {
    queue.push({ data: Buffer.from(data as Buffer), binary });
    wake?.();
  });
  socket.on("close", () => {
    closed = true;
    wake?.();
  });
  async function next() {
    const deadline = Date.now() + 2000;
    while (!queue.length && !closed && Date.now() < deadline)
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, Math.max(1, deadline - Date.now()));
        wake = () => {
          clearTimeout(t);
          resolve();
        };
      });
    const value = queue.shift();
    if (!value) throw new Error("Closed or timed out");
    return value;
  }
  const json = async () =>
    JSON.parse((await next()).data.toString()) as {
      type: string;
      nonce: string;
    };
  return {
    socket,
    next,
    json,
    async login(
      identity: Identity,
      role: string,
      metadata: Record<string, unknown> = {},
    ) {
      const c = await json();
      socket.send(
        JSON.stringify({
          ...metadata,
          id: invitation.id,
          role,
          signature: b64(
            await identity.sign(
              authBytes(origin, invitation.id, role, c.nonce),
            ),
          ),
        }),
      );
      return json();
    },
  };
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "remote-relay-test-"));
  await start();
  viewer = await createIdentity();
  phone = await createIdentity();
  invitation = {
    v: 1,
    origin,
    id: hex(crypto.getRandomValues(new Uint8Array(16))),
    viewer: b64(viewer.publicKey),
    expires: Math.floor(Date.now() / 1000) + 120,
    secret: hex(crypto.getRandomValues(new Uint8Array(32))),
  };
});
afterEach(async () => {
  for (const s of sockets.splice(0)) s.terminate();
  await relay.close();
  await rm(directory, { recursive: true, force: true });
});
it("pairs only after both endpoint signatures and never stores the QR secret", async () => {
  await enroll();
  const stored = await readFile(
    path.join(directory, "pairings-v1.json"),
    "utf8",
  );
  expect(stored).not.toContain(invitation.secret);
  expect((await create()).status).toBe(400);
  expect((await api()).status).toBe(200);
});
it("rejects wrong QR secrets, substituted phone keys and expired invitations at endpoints", async () => {
  const g = await offer();
  await expect(
    verifyOffer({ ...invitation, secret: "00".repeat(32) }, g),
  ).rejects.toThrow();
  await expect(
    verifyOffer(invitation, { ...g, phone: b64(viewer.publicKey) }),
  ).rejects.toThrow();
  expect(decodeInvitation(encodeInvitation(invitation))).toEqual(invitation);
  expect(() =>
    decodeInvitation(encodeInvitation({ ...invitation, expires: 1 })),
  ).toThrow();
});
it("rejects invalid signatures, expired creation and unconfirmed routes", async () => {
  expect(
    (
      await api("", {
        viewer: invitation.viewer,
        expires: invitation.expires,
        signature: b64(await phone.sign(createBytes(origin, invitation))),
      })
    ).status,
  ).toBe(400);
  invitation.expires = 1;
  expect((await create()).status).toBe(400);
  const c = client();
  await expect(c.login(viewer, "viewer")).rejects.toThrow();
});
it("cannot replace a pending offer or complete with another viewer", async () => {
  await create();
  const g = await offer();
  expect((await api("/offer", g)).status).toBe(202);
  expect((await api("/offer", g)).status).toBe(400);
  expect(
    (
      await api("/complete", {
        viewerSignature: b64(await phone.sign(grantBytes(origin, g))),
      })
    ).status,
  ).toBe(400);
  expect((await api()).status).toBe(200);
});
it("forwards a real authenticated E2E handshake and binary Unicode record", async () => {
  await enroll();
  const v = client();
  const p = client();
  expect((await v.login(viewer, "viewer")).type).toBe("authenticated");
  expect((await p.login(phone, "phone")).type).toBe("authenticated");
  expect((await v.json()).type).toBe("ready");
  expect((await p.json()).type).toBe("ready");
  const va = {
    id: fromHex(invitation.id, 16),
    generation: 1,
    peer: phone.publicKey,
    current: () => true,
  };
  const vh = await ViewerHandshake.start(viewer, va);
  v.socket.send(vh.hello);
  const ph = await PhoneHandshake.start(
    phone,
    { ...va, peer: viewer.publicKey },
    new Uint8Array((await p.next()).data),
  );
  p.socket.send(ph.offer);
  v.socket.send(await vh.answer(new Uint8Array((await v.next()).data)));
  const accepted = await ph.finish(new Uint8Array((await p.next()).data));
  p.socket.send(accepted.finish);
  const channel = await vh.finish(new Uint8Array((await v.next()).data));
  const message = utf8("hello 🌞\0");
  const record = await channel.seal(message);
  expect(Buffer.from(record).includes(Buffer.from(message))).toBe(false);
  v.socket.send(record);
  expect(
    await accepted.channel.open(new Uint8Array((await p.next()).data)),
  ).toEqual(message);
  channel.close();
  accepted.channel.close();
});
it("rejects wrong-role authentication and replay on another challenge", async () => {
  await enroll();
  const bad = client();
  await expect(bad.login(viewer, "phone")).rejects.toThrow();
  const a = client();
  const challenge = await a.json();
  const signature = b64(
    await viewer.sign(
      authBytes(origin, invitation.id, "viewer", challenge.nonce),
    ),
  );
  const b = client();
  await b.json();
  b.socket.send(
    JSON.stringify({ id: invitation.id, role: "viewer", signature }),
  );
  await expect(b.next()).rejects.toThrow();
});
it("rejects cross-origin browser sockets and API mutations", async () => {
  expect((await create()).status).toBe(201);
  expect(
    (await api("/offer", await offer(), { Origin: "https://evil.test" }))
      .status,
  ).toBe(429);
  const c = client({ Origin: "https://evil.test" });
  await expect(c.next()).rejects.toThrow();
});
it("persists authority across restart and retains revoked tombstones", async () => {
  await enroll();
  await relay.close();
  await start();
  const c = client();
  expect((await c.login(phone, "phone")).type).toBe("authenticated");
  const closed = once(c.socket, "close");
  expect(
    (
      await api("/revoke", {
        signature: b64(await phone.sign(revokeBytes(origin, invitation.id))),
      })
    ).status,
  ).toBe(200);
  await closed;
  await relay.close();
  await start();
  expect((await api()).status).toBe(410);
  expect((await create()).status).toBe(400);
  const rejected = client();
  await expect(rejected.login(phone, "phone")).rejects.toThrow();
});
it("refuses viewer revocation and duplicate sockets without displacing the original", async () => {
  await enroll();
  expect(
    (
      await api("/revoke", {
        signature: b64(await viewer.sign(revokeBytes(origin, invitation.id))),
      })
    ).status,
  ).toBe(400);
  const a = client();
  await a.login(viewer, "viewer");
  const b = client();
  await expect(b.login(viewer, "viewer")).rejects.toThrow();
  expect(a.socket.readyState).toBe(WebSocket.OPEN);
});
it("closes both peers on transport loss; never queues disconnected records", async () => {
  await enroll();
  const a = client();
  const b = client();
  await a.login(viewer, "viewer");
  await b.login(phone, "phone");
  await a.json();
  await b.json();
  const closed = once(b.socket, "close");
  a.socket.close();
  await closed;
  const alone = client();
  await alone.login(viewer, "viewer");
  alone.socket.send(Buffer.from("not queued"));
  await expect(alone.next()).rejects.toThrow();
});
it("bounds bodies and rejects plaintext application traffic", async () => {
  expect((await api("", { oversized: "x".repeat(5000) })).status).toBe(413);
  await enroll();
  const a = client();
  const b = client();
  await a.login(viewer, "viewer");
  await b.login(phone, "phone");
  await a.json();
  await b.json();
  a.socket.send("plaintext");
  await expect(a.next()).rejects.toThrow();
});

it("accepts native JSON media types with UTF-8 charset parameters", async () => {
  const response = await api(
    "",
    {
      viewer: invitation.viewer,
      expires: invitation.expires,
      signature: b64(await viewer.sign(createBytes(origin, invitation))),
    },
    { "Content-Type": "application/json; charset=utf-8" },
  );
  expect(response.status).toBe(201);
});

const fid = `c${"a".repeat(21)}`;
async function registerPush() {
  const registration = client();
  await registration.login(phone, "phone", { mode: "registration" });
  registration.socket.send(JSON.stringify({ type: "registerPush", fid }));
  expect((await registration.json()).type).toBe("pushRegistered");
  const closed = once(registration.socket, "close");
  registration.socket.close();
  await closed;
}
it("wakes only for an authenticated viewer and hides registration metadata", async () => {
  let sent: { requestId: string; expires: number } | undefined;
  await relay.close();
  await start({
    sender: async (_fid, request) => {
      sent = request;
      return "accepted";
    },
  });
  await enroll();
  await registerPush();
  expect(JSON.stringify(await (await api()).json())).not.toContain(fid);
  const bad = client();
  await expect(bad.login(phone, "viewer")).rejects.toThrow();
  expect(sent).toBeUndefined();
  const v = client();
  await v.login(viewer, "viewer");
  expect((await v.json()).type).toBe("contacting");
  expect(sent).toBeDefined();
  const p = client();
  await p.login(phone, "phone", { requestId: sent?.requestId });
  expect((await p.json()).type).toBe("ready");
  expect((await v.json()).type).toBe("ready");
});
it("registration refresh does not displace a live encrypted route", async () => {
  await enroll();
  const v = client();
  const p = client();
  await v.login(viewer, "viewer");
  await p.login(phone, "phone");
  await v.json();
  await p.json();
  await registerPush();
  expect(v.socket.readyState).toBe(WebSocket.OPEN);
  expect(p.socket.readyState).toBe(WebSocket.OPEN);
});
it("rejects delayed, expired and revoked wake requests", async () => {
  let sent: { requestId: string; expires: number } | undefined;
  await relay.close();
  await start({
    sender: async (_fid, request) => {
      sent = request;
      return "accepted";
    },
    wakeLifetimeMs: 1000,
  });
  await enroll();
  await registerPush();
  const v = client();
  await v.login(viewer, "viewer");
  await v.json();
  const wrong = client();
  await expect(
    wrong.login(phone, "phone", { requestId: "00".repeat(16) }),
  ).rejects.toThrow();
  await new Promise((resolve) => setTimeout(resolve, 1100));
  const expired = client();
  await expect(
    expired.login(phone, "phone", { requestId: sent?.requestId }),
  ).rejects.toThrow();
  await api("/revoke", {
    signature: b64(await phone.sign(revokeBytes(origin, invitation.id))),
  });
  const revoked = client();
  await expect(
    revoked.login(phone, "phone", { requestId: sent?.requestId }),
  ).rejects.toThrow();
  expect(
    await readFile(path.join(directory, "push-registrations-v1.json"), "utf8"),
  ).not.toContain(fid);
});

it("lets the phone disable delivery but refuses viewer registration", async () => {
  await enroll();
  await registerPush();
  const v = client();
  await v.login(viewer, "viewer");
  v.socket.send(JSON.stringify({ type: "registerPush", fid }));
  await expect(v.next()).rejects.toThrow();
  const p = client();
  await p.login(phone, "phone", { mode: "registration" });
  p.socket.send(JSON.stringify({ type: "unregisterPush" }));
  expect((await p.json()).type).toBe("pushRemoved");
  expect(
    await readFile(path.join(directory, "push-registrations-v1.json"), "utf8"),
  ).not.toContain(fid);
});
it("registration-only connections cannot inject records into a live route", async () => {
  await enroll();
  const v = client();
  const p = client();
  const management = client();
  await v.login(viewer, "viewer");
  await p.login(phone, "phone");
  await v.json();
  await p.json();
  await management.login(phone, "phone", { mode: "registration" });
  management.socket.send(Buffer.from("invalid management record"));
  await expect(management.next()).rejects.toThrow();
  expect(v.socket.readyState).toBe(WebSocket.OPEN);
  expect(p.socket.readyState).toBe(WebSocket.OPEN);
});

async function setAccess(enabled: boolean, generation: string) {
  const manager = client();
  await manager.login(phone, "phone", { mode: "registration" });
  manager.socket.send(
    JSON.stringify({ type: "setAccess", enabled, generation }),
  );
  expect((await manager.json()).type).toBe("accessUpdated");
  manager.socket.close();
}
it("phone policy cancels pending sessions, persists pause and rejects old generations after re-enable", async () => {
  await enroll();
  const v = client();
  await v.login(viewer, "viewer");
  const closed = once(v.socket, "close");
  await setAccess(false, "11".repeat(16));
  await closed;
  const disabled = client();
  await expect(disabled.login(viewer, "viewer")).rejects.toThrow();
  await relay.close();
  await start();
  const persisted = client();
  await expect(persisted.login(phone, "phone")).rejects.toThrow();
  await setAccess(true, "22".repeat(16));
  const stale = client();
  await expect(
    stale.login(phone, "phone", { generation: "11".repeat(16) }),
  ).rejects.toThrow();
  const current = client();
  expect(
    (await current.login(phone, "phone", { generation: "22".repeat(16) })).type,
  ).toBe("authenticated");
});
it("viewers cannot change phone policy", async () => {
  await enroll();
  const v = client();
  await v.login(viewer, "viewer");
  v.socket.send(
    JSON.stringify({
      type: "setAccess",
      enabled: false,
      generation: "11".repeat(16),
    }),
  );
  await expect(v.next()).rejects.toThrow();
  const p = client();
  expect((await p.login(phone, "phone")).type).toBe("authenticated");
});
it("push hints select the exact browser generation without carrying authority", async () => {
  let sent: import("../src/push.js").Wake | undefined;
  await relay.close();
  await start({
    sender: async (_target, hint) => {
      sent = hint;
      return "accepted";
    },
  });
  await enroll();
  const generation = "33".repeat(16);
  await setAccess(true, generation);
  await registerPush();
  const v = client();
  await v.login(viewer, "viewer");
  await v.json();
  expect(sent?.pairingId).toBe(invitation.id);
  expect(sent?.generation).toBe(generation);
});

it("independently enrolls and revokes two browsers for the same phone", async () => {
  await enroll();
  const first = invitation;
  const firstViewer = viewer;
  viewer = await createIdentity();
  invitation = {
    ...first,
    id: hex(crypto.getRandomValues(new Uint8Array(16))),
    viewer: b64(viewer.publicKey),
    secret: hex(crypto.getRandomValues(new Uint8Array(32))),
  };
  await enroll();
  const second = invitation;
  const secondViewer = viewer;
  invitation = first;
  viewer = firstViewer;
  await setAccess(false, "11".repeat(16));
  const denied = client();
  await expect(denied.login(firstViewer, "viewer")).rejects.toThrow();
  await api("/revoke", {
    signature: b64(await phone.sign(revokeBytes(origin, first.id))),
  });
  invitation = second;
  viewer = secondViewer;
  expect((await api()).status).toBe(200);
  const unaffected = client();
  expect((await unaffected.login(secondViewer, "viewer")).type).toBe(
    "authenticated",
  );
});
