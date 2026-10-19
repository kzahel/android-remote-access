import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import http from "node:http";
import { once } from "node:events";
import { mkdtemp, writeFile, rm, chmod } from "node:fs/promises";
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

test("USB phone profile refuses emulator credentials before native dispatch", async () => {
  const app = await createDemo({ profile: "usb-phone", deviceName: "Test phone" });
  try {
    const socket = await device(app, app.token, { locked: true, secure: true });
    await new Promise((r) => setTimeout(r, 20));
    const call = await viewer(app);
    const response = await call("/api/action", { op: "unlock", useTestPin: true });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /emulator-only/);
    assert.equal(app.status().unlockBlocked, false);
    assert.equal(app.status().credentialExperiment, false);
    assert.equal(app.status().lab, false);
    assert.equal(app.status().deviceName, "Test phone");
    assert.equal((await call("/api/lab", { action: "wake" })).status, 400);
    socket.destroy();
  } finally {
    await app.close();
  }
});

test("opted-in USB phone delivers an owner-only saved PIN once", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "remote-access-test-"));
  const savedPinFile = path.join(directory, "pin");
  const pin = String(randomInt(100000, 1000000));
  await writeFile(savedPinFile, pin + "\n", { mode: 0o644 });
  const app = await createDemo({ profile: "usb-phone", phoneUnlock: true, savedPinFile });
  try {
    const socket = await device(app, app.token, { locked: true, secure: true });
    await new Promise((r) => setTimeout(r, 20));
    const call = await viewer(app);
    assert.equal(app.status().credentialExperiment, true);
    assert.equal(app.status().lab, false);
    const loose = await call("/api/action", { op: "unlock", useTestPin: true });
    assert.equal(loose.status, 400);
    assert.match((await loose.json()).error, /chmod 600/);
    await chmod(savedPinFile, 0o600);
    const received = once(socket, "data");
    const attempt = call("/api/action", { op: "unlock", useTestPin: true });
    const command = JSON.parse((await received)[0].toString().trim());
    assert.equal(command.op, "unlock");
    assert.equal(command.pin, pin);
    socket.write(
      JSON.stringify({
        type: "result",
        id: command.id,
        ok: true,
        state: { locked: true, secure: true, unlockAttempted: true },
      }) + "\n",
    );
    assert.equal((await attempt).status, 200);
    assert.equal(app.status().unlockBlocked, true);
    socket.destroy();
  } finally {
    await app.close();
  }
});

async function dropLink(app) {
  const socket = await device(app, app.token, { locked: false });
  await new Promise((r) => setTimeout(r, 20));
  socket.destroy();
  await new Promise((r) => setTimeout(r, 80));
}

async function linkDemo(routes, extra = {}) {
  const directory = await mkdtemp(path.join(tmpdir(), "remote-access-test-"));
  const linkFile = path.join(directory, "link.json");
  await writeFile(
    linkFile,
    JSON.stringify({ serial: "phone.local:5555", hardwareSerial: "HW1", devicePort: 41000 }),
  );
  const calls = [];
  const runAdb = async (args) => {
    calls.push(args.join(" "));
    if (args[0] === "devices")
      return "List of devices attached\n" + Object.keys(routes).map((s) => `${s}\tdevice`).join("\n");
    const route = routes[args[1]];
    if (!route) throw new Error("device not found");
    if (args.includes("getprop")) return route.hardware + "\n";
    if (args[2] === "reverse" && args[3] !== "--remove" && !route.reverse) throw new Error("failed");
    return "";
  };
  const app = await createDemo({
    profile: "usb-phone",
    linkFile,
    runAdb,
    linkGraceMs: 0,
    linkCheckMs: 10,
    ...extra,
  });
  return { app, calls };
}

test("USB phone link repair restores only the owned reverse port", async () => {
  const { app, calls } = await linkDemo({ "phone.local:5555": { hardware: "HW1", reverse: true } });
  try {
    await new Promise((r) => setTimeout(r, 50));
    assert.equal(calls.length, 0, "no repair before the app has connected");
    await dropLink(app);
    assert.ok(calls.includes(`-s phone.local:5555 reverse tcp:41000 tcp:${app.phonePort}`));
    assert.ok(calls.every((c) => !/reverse --remove-all/.test(c)));
    assert.match(app.status().log[0].message, /restored over the selected/);
  } finally {
    await app.close();
  }
});

test("USB phone link repair falls back only to the same physical phone", async () => {
  const { app, calls } = await linkDemo({
    OTHERPHONE: { hardware: "HW2", reverse: true },
    HW1USB: { hardware: "HW1", reverse: true },
  });
  try {
    await dropLink(app);
    assert.ok(calls.includes(`-s HW1USB reverse tcp:41000 tcp:${app.phonePort}`));
    assert.ok(!calls.some((c) => c.startsWith("-s OTHERPHONE reverse")));
    assert.match(app.status().log[0].message, /another ADB connection/);
  } finally {
    await app.close();
  }
});

test("USB phone link repair pauses after a viewer Stop", async () => {
  const { app, calls } = await linkDemo(
    { "phone.local:5555": { hardware: "HW1", reverse: true } },
    { linkGraceMs: 60 },
  );
  try {
    const socket = await device(app, app.token, { locked: false });
    await new Promise((r) => setTimeout(r, 20));
    const call = await viewer(app);
    const stopped = once(socket, "data");
    const response = call("/api/action", { op: "stop" });
    const command = JSON.parse((await stopped)[0].toString().trim());
    socket.write(JSON.stringify({ type: "result", id: command.id, ok: true, state: {} }) + "\n");
    assert.equal((await response).status, 200);
    socket.destroy();
    await new Promise((r) => setTimeout(r, 150));
    assert.equal(calls.length, 0);
  } finally {
    await app.close();
  }
});

test("phone listener refuses a non-Tailscale address", async () => {
  for (const tailnetHost of ["192.168.1.5", "0.0.0.0", "100.63.1.1", "100.128.0.1"])
    await assert.rejects(createDemo({ profile: "usb-phone", tailnetHost }), /Tailscale/);
});
