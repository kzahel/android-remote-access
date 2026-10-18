import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomInt } from "node:crypto";
import { createDemo } from "../server.mjs";

async function viewer(app) {
  const response = await fetch(app.url);
  const cookie = response.headers.get("set-cookie").split(";")[0];
  return async (path, data, origin = app.url) =>
    fetch(app.url + path, {
      headers: {
        Cookie: cookie,
        Origin: origin,
        "Content-Type": "application/json",
      },
      ...(data === undefined
        ? {}
        : { method: "POST", body: JSON.stringify(data) }),
    });
}
async function device(app, token = app.token, state = { locked: false }) {
  const socket = net.connect(app.phonePort, "127.0.0.1");
  await once(socket, "connect");
  socket.write(
    JSON.stringify({
      type: "hello",
      token,
      generation: "test",
      state,
    }) + "\n",
  );
  return socket;
}

test("browser actions require same-origin authority; unknown operations are refused", async () => {
  const app = await createDemo();
  try {
    assert.equal((await fetch(app.url + "/api/state")).status, 401);
    const call = await viewer(app);
    assert.equal(
      (await call("/api/action", { op: "lock" }, "https://untrusted.example"))
        .status,
      403,
    );
    assert.equal(
      (await call("/api/action", { op: "shell", command: "anything" })).status,
      400,
    );
    const hostResult = await new Promise((resolve) => {
      http.get(
        app.url + "/api/state",
        { headers: { Host: "untrusted.example" } },
        (r) => {
          r.resume();
          resolve(r.statusCode);
        },
      );
    });
    assert.equal(hostResult, 403);
  } finally {
    await app.close();
  }
});

test("overlapping credential attempts and ordinary input are refused", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "remote-access-test-"));
  const testPinFile = path.join(directory, "synthetic-pin");
  await writeFile(testPinFile, String(randomInt(100000, 1000000)), { mode: 0o600 });
  const app = await createDemo({ testPinFile, emulator: "emulator-9998" });
  try {
    const socket = await device(app, app.token, { locked: true, secure: true });
    await new Promise((r) => setTimeout(r, 20));
    const call = await viewer(app);
    const received = once(socket, "data");
    const attempt = call("/api/action", { op: "unlock", useTestPin: true });
    const [bytes] = await received;
    const command = JSON.parse(bytes.toString().trim());
    assert.equal(command.op, "unlock");
    const competing = await call("/api/action", {
      op: "unlock",
      useTestPin: true,
    });
    assert.equal(competing.status, 400);
    assert.match((await competing.json()).error, /already in progress/);
    assert.equal((await call("/api/action", { op: "tap" })).status, 400);
    const frame = await (await call("/api/frame")).json();
    assert.equal(frame.ok, false);
    assert.match(frame.message, /credential/i);
    socket.write(
      JSON.stringify({
        type: "result",
        id: command.id,
        ok: true,
        state: { locked: true, secure: true, unlockAttempted: true },
      }) + "\n",
    );
    assert.equal((await attempt).status, 200);
    assert.equal(
      (await call("/api/action", { op: "unlock", useTestPin: true })).status,
      400,
    );
    socket.destroy();
  } finally {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("wrong phone token never gains control", async () => {
  const app = await createDemo();
  try {
    const socket = await device(app, "x".repeat(app.token.length));
    await once(socket, "close");
    assert.equal(app.status().connected, false);
  } finally {
    await app.close();
  }
});

test("an interrupted action is uncertain and is never replayed on reconnect", async () => {
  const app = await createDemo();
  try {
    const socket = await device(app);
    await new Promise((r) => setTimeout(r, 20));
    const received = once(socket, "data");
    const action = app.command("tap", { x: 10, y: 20, frame: "old" });
    await received;
    socket.destroy();
    await assert.rejects(action, /not be replayed/);
    const next = await device(app);
    let replayed = false;
    next.on("data", () => {
      replayed = true;
    });
    await new Promise((r) => setTimeout(r, 100));
    assert.equal(replayed, false);
    next.destroy();
  } finally {
    await app.close();
  }
});

test("timed-out commands do not accept late results as another action", async () => {
  const app = await createDemo();
  try {
    const socket = await device(app);
    await new Promise((r) => setTimeout(r, 20));
    const received = once(socket, "data");
    const first = app.command("tap", {}, 30);
    const [bytes] = await received;
    const old = JSON.parse(bytes.toString().trim());
    await assert.rejects(first, /not be replayed/);
    const secondReceived = once(socket, "data");
    const second = app.command("state", {}, 1000);
    const [nextBytes] = await secondReceived;
    const next = JSON.parse(nextBytes.toString().trim());
    socket.write(
      JSON.stringify({
        type: "result",
        id: old.id,
        ok: true,
        message: "late",
      }) + "\n",
    );
    socket.write(
      JSON.stringify({
        type: "result",
        id: next.id,
        ok: true,
        message: "fresh",
      }) + "\n",
    );
    assert.equal((await second).message, "fresh");
    socket.destroy();
  } finally {
    await app.close();
  }
});
