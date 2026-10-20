import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { once } from "node:events";
import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createDemo } from "../server.mjs";
import { fingerprint, messages, pairMac } from "../pairing.mjs";

function identity(dsaEncoding) {
  const { publicKey, privateKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  return {
    spki,
    fpr: fingerprint(spki),
    sign: (message) =>
      sign("sha256", Buffer.from(message), { key: privateKey, dsaEncoding }).toString("base64"),
  };
}

async function browser(app) {
  const response = await fetch(app.url + "/pair");
  const cookie = response.headers.get("set-cookie").split(";")[0];
  const call = async (p, data) => {
    const r = await fetch(app.url + p, {
      redirect: "manual",
      headers: { Cookie: cookie, Origin: app.url, "Content-Type": "application/json" },
      ...(data === undefined ? {} : { method: "POST", body: JSON.stringify(data) }),
    });
    return { status: r.status, location: r.headers.get("location"), body: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
  };
  call.login = async (key) => {
    const { body } = await call("/api/viewer/challenge", {});
    return (await call("/api/viewer/login", {
      key: key.spki,
      signature: key.sign(messages.viewerLogin(body.nonce)),
    })).body.ok;
  };
  return call;
}

/** A line-oriented fake phone connection that has read the server challenge. */
async function phoneLink(app) {
  const socket = net.connect(app.phonePort, "127.0.0.1");
  await once(socket, "connect");
  let buffer = "";
  const lines = [];
  const waiters = [];
  socket.on("data", (bytes) => {
    buffer += bytes;
    let cut;
    while ((cut = buffer.indexOf("\n")) >= 0) {
      const line = JSON.parse(buffer.slice(0, cut));
      buffer = buffer.slice(cut + 1);
      if (waiters.length) waiters.shift()(line);
      else lines.push(line);
    }
  });
  const next = () =>
    lines.length ? Promise.resolve(lines.shift()) : new Promise((r) => waiters.push(r));
  const challenge = await next();
  assert.equal(challenge.type, "challenge");
  const send = (data) => socket.write(JSON.stringify(data) + "\n");
  return { socket, nonce: challenge.nonce, next, send };
}

async function pairedDemo() {
  const directory = await mkdtemp(path.join(tmpdir(), "remote-access-pair-"));
  const pairingFile = path.join(directory, "pairings.json");
  const app = await createDemo({
    pairingFile,
    pairRoutes: [{ host: "127.0.0.1", port: 1 }],
  });
  return {
    app,
    pairingFile,
    async close() {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function pair(app, viewer, phone, call, phoneName = "Test phone") {
  const secret = randomBytes(32).toString("base64url");
  const start = await call("/api/pair/start", { key: viewer.spki, name: "Chrome on Mac" });
  assert.equal(start.status, 200);
  const { id } = start.body;
  const link = await phoneLink(app);
  link.send({
    type: "pair",
    id,
    phoneKey: phone.spki,
    name: phoneName,
    mac: pairMac(secret, id, phone.spki, viewer.fpr),
    signature: phone.sign(messages.phonePair(link.nonce, id)),
  });
  let status;
  for (let i = 0; i < 50; i++) {
    status = (await call(`/api/pair/status?id=${id}`)).body;
    if (status.state === "phone") break;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.equal(status.state, "phone");
  // What the browser checks before it confirms.
  assert.equal(status.mac, pairMac(secret, id, status.phoneKey, viewer.fpr));
  const confirm = await call("/api/pair/confirm", {
    id,
    signature: viewer.sign(messages.confirm(id, fingerprint(status.phoneKey))),
  });
  return { id, link, confirm };
}

async function hello(app, phone, viewers) {
  const link = await phoneLink(app);
  const generation = "g-" + randomBytes(8).toString("hex");
  link.send({
    type: "hello",
    phoneKey: phone.spki,
    generation,
    signature: phone.sign(messages.phoneHello(link.nonce, generation)),
    viewers,
    state: { locked: false },
  });
  return link;
}

const until = async (check) => {
  for (let i = 0; i < 100 && !(await check()); i++)
    await new Promise((r) => setTimeout(r, 10));
  return check();
};

test("QR pairing admits only the paired browser and phone keys", async () => {
  const demo = await pairedDemo();
  const { app } = demo;
  try {
    const viewer = identity("ieee-p1363");
    const phone = identity("der");
    const call = await browser(app);
    assert.equal(await call.login(viewer), false);
    assert.equal((await call("/api/state")).status, 401);
    const home = await call("/");
    assert.equal(home.status, 302);
    assert.equal(home.location, "/pair");

    const { link, confirm } = await pair(app, viewer, phone, call);
    assert.equal(confirm.status, 200);
    assert.equal(confirm.body.phoneName, "Test phone");
    const paired = await link.next();
    assert.equal(paired.type, "paired");
    assert.equal(fingerprint(paired.viewerKey), viewer.fpr);
    assert.equal((await call("/api/state")).status, 200);

    const control = await hello(app, phone, [viewer.fpr]);
    assert.ok(await until(() => app.status().connected));
    assert.equal(app.status().deviceName, "Test phone");

    // Another tab with the same key logs in; an unpaired key does not.
    const again = await browser(app);
    assert.equal(await again.login(viewer), true);
    assert.equal((await again("/api/state")).status, 200);
    const stranger = await browser(app);
    assert.equal(await stranger.login(identity("ieee-p1363")), false);
    assert.equal((await stranger("/api/state")).status, 401);

    // Removing the browser on the phone revokes it at the relay.
    control.send({ type: "viewers", viewers: [] });
    assert.ok(await until(async () => (await call("/api/state")).status === 401));
    assert.ok(await until(async () => {
      const saved = JSON.parse(await readFile(demo.pairingFile, "utf8"));
      return Object.keys(saved.phones[phone.fpr].viewers).length === 0;
    }));
    control.socket.destroy();
  } finally {
    await demo.close();
  }
});

test("pairing refuses forged phone and browser signatures", async () => {
  const demo = await pairedDemo();
  const { app } = demo;
  try {
    const viewer = identity("ieee-p1363");
    const phone = identity("der");
    const call = await browser(app);

    // An unpaired phone key cannot connect.
    const unknown = await hello(app, phone, []);
    await once(unknown.socket, "close");
    assert.equal(app.status().connected, false);

    // A pair request signed by a different key is refused.
    const start = await call("/api/pair/start", { key: viewer.spki, name: "Chrome on Mac" });
    const link = await phoneLink(app);
    link.send({
      type: "pair",
      id: start.body.id,
      phoneKey: phone.spki,
      name: "Test phone",
      mac: "x",
      signature: identity("der").sign(messages.phonePair(link.nonce, start.body.id)),
    });
    assert.equal((await link.next()).type, "pairRefused");

    // A confirmation not signed by the browser key that started the code fails.
    const second = await pair(app, viewer, phone, call);
    assert.equal(second.confirm.status, 200);
    second.link.socket.destroy();
    const forged = await browser(app);
    const other = identity("ieee-p1363");
    const s = await forged("/api/pair/start", { key: viewer.spki, name: "Chrome on Mac" });
    const l = await phoneLink(app);
    l.send({
      type: "pair",
      id: s.body.id,
      phoneKey: phone.spki,
      name: "Test phone",
      mac: "x",
      signature: phone.sign(messages.phonePair(l.nonce, s.body.id)),
    });
    await until(async () => (await forged(`/api/pair/status?id=${s.body.id}`)).body.state === "phone");
    const bad = await forged("/api/pair/confirm", {
      id: s.body.id,
      signature: other.sign(messages.confirm(s.body.id, phone.fpr)),
    });
    assert.equal(bad.status, 400);
    // Codes belong to the browser session that opened them.
    assert.equal((await call(`/api/pair/status?id=${s.body.id}`)).body.state, "expired");
    l.socket.destroy();
  } finally {
    await demo.close();
  }
});

test("token phones still connect when pairing is enabled", async () => {
  const demo = await pairedDemo();
  const { app } = demo;
  try {
    const link = await phoneLink(app);
    link.send({ type: "hello", token: app.token, generation: "t", state: {} });
    assert.ok(await until(() => app.status().connected));
    // Local test runners present the owner-only token instead of a paired key.
    const call = await browser(app);
    const runner = async (header) =>
      (await fetch(app.url + "/api/state", {
        headers: { Cookie: (await fetch(app.url + "/pair")).headers.get("set-cookie").split(";")[0], "X-Demo-Token": header },
      })).status;
    assert.equal(await runner(app.token), 200);
    assert.equal(await runner("x".repeat(app.token.length)), 401);
    assert.equal((await call("/api/state")).status, 401);
    link.socket.destroy();
  } finally {
    await demo.close();
  }
});
