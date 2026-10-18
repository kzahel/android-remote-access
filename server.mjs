import http from "node:http";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";

const root = path.dirname(fileURLToPath(import.meta.url));
const secret = () => randomBytes(32).toString("base64url");
const equal = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  a.length === b.length &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));
const safeOps = new Set([
  "state",
  "capture",
  "tap",
  "swipe",
  "nav",
  "text",
  "inspect",
  "apps",
  "openApp",
  "wake",
  "dismiss",
  "lock",
  "openFixture",
  "unlock",
  "stop",
]);
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export async function createDemo(options = {}) {
  const token = options.token || secret();
  const session = secret();
  const pending = new Map();
  const log = [];
  let device = null;
  let state = null;
  let seen = 0;
  let generation = "";
  let sequence = 0;
  let unlockBlocked = false;
  let closing = false;
  let currentFrame = null;
  let capturePromise = null;
  let lastCapture = 0;
  let lastCaptureAttempt = 0;
  let lastFrameError = "";
  let credentialInProgress = false;
  const activity = (kind, message, ok = true) => {
    log.unshift({ at: Date.now(), kind, message, ok });
    log.splice(30);
  };
  function update(next) {
    state = next;
    seen = Date.now();
    if (state && !state.locked) unlockBlocked = false;
  }
  function invalidate(
    message = "Connection ended; the action will not be replayed",
  ) {
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(new Error(message));
    }
    pending.clear();
    currentFrame = null;
    capturePromise = null;
  }
  function command(op, data = {}, timeout = 6500) {
    if (!device || device.destroyed)
      return Promise.reject(new Error("Phone is not connected"));
    const id = String(++sequence);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(
          new Error("No confirmed result. This action will not be replayed."),
        );
      }, timeout);
      pending.set(id, { resolve, reject, timer });
      device.write(JSON.stringify({ ...data, op, id }) + "\n", (err) => {
        if (err && pending.has(id)) {
          clearTimeout(timer);
          pending.delete(id);
          reject(new Error("Delivery uncertain; no automatic replay"));
        }
      });
    });
  }
  async function capture() {
    if (credentialInProgress)
      return {
        ok: false,
        message: "Screen capture is paused during credential delivery",
      };
    if (capturePromise) return capturePromise;
    if (currentFrame && Date.now() - lastCapture < 500) return currentFrame;
    capturePromise = (async () => {
      const delay = Math.max(0, 500 - (Date.now() - lastCaptureAttempt));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (credentialInProgress)
        return {
          ok: false,
          message: "Screen capture is paused during credential delivery",
        };
      lastCaptureAttempt = Date.now();
      return command("capture");
    })()
      .then((result) => {
        if (result.ok) {
          currentFrame = { ...result, capturedAt: Date.now() };
          lastCapture = Date.now();
          lastFrameError = "";
        } else {
          currentFrame = null;
          lastFrameError = result.message;
        }
        return result.ok ? currentFrame : result;
      })
      .finally(() => {
        capturePromise = null;
      });
    return capturePromise;
  }
  const phone = net.createServer((socket) => {
    socket.setNoDelay(true);
    let admitted = false,
      buffer = "";
    const authTimer = setTimeout(() => socket.destroy(), 3000);
    socket.on("data", (bytes) => {
      buffer += bytes.toString("utf8");
      if (buffer.length > 2 * 1024 * 1024) {
        socket.destroy();
        return;
      }
      let cut;
      while ((cut = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 1);
        let data;
        try {
          data = JSON.parse(line);
        } catch {
          socket.destroy();
          return;
        }
        if (!admitted) {
          if (data.type !== "hello" || !equal(data.token, token) || device) {
            socket.destroy();
            return;
          }
          clearTimeout(authTimer);
          admitted = true;
          device = socket;
          generation = data.generation;
          update(data.state);
          invalidate();
          activity("connection", "Phone connected");
          continue;
        }
        if (socket !== device) return;
        if (data.state) update(data.state);
        if (data.type === "result") {
          const p = pending.get(data.id);
          if (p) {
            clearTimeout(p.timer);
            pending.delete(data.id);
            p.resolve(data);
          }
        }
      }
    });
    socket.on("error", () => {});
    socket.on("close", () => {
      clearTimeout(authTimer);
      if (socket === device) {
        device = null;
        invalidate();
        activity("connection", "Phone disconnected", false);
      }
    });
  });
  await new Promise((resolve, reject) => {
    phone.once("error", reject);
    phone.listen(options.phonePort ?? 0, "127.0.0.1", resolve);
  });

  async function body(req) {
    const bytes = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 32768) throw new Error("Request too large");
      bytes.push(chunk);
    }
    return JSON.parse(Buffer.concat(bytes).toString("utf8"));
  }
  const status = () => ({
    connected: !!device && Date.now() - seen < 5000,
    lastSeen: seen || null,
    generation,
    state,
    log,
    captureError: lastFrameError,
    lab: !!options.emulator,
    testCredential: !!options.testPinFile && existsSync(options.testPinFile),
    unlockBlocked,
    transport: "Local emulator demo · app connects outward · no ADB forwarding",
    limits:
      "Local prototype. Internet reachability, Doze and unattended reboot recovery are unqualified.",
  });
  async function adb(args, input, timeout = 8000) {
    if (!options.emulator || !/^emulator-\d+$/.test(options.emulator))
      throw new Error(
        "The optional lab requires an explicitly selected emulator",
      );
    return new Promise((resolve, reject) => {
      const child = spawn(
        options.adb || "adb",
        ["-s", options.emulator, ...args],
        { stdio: ["pipe", "pipe", "pipe"] },
      );
      const output = [];
      let size = 0;
      const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
      child.on("error", () => {
        clearTimeout(timer);
        reject(new Error("ADB could not start"));
      });
      child.stdout.on("data", (b) => {
        size += b.length;
        if (size > 1024 * 1024) child.kill();
        else output.push(b);
      });
      child.stderr.resume();
      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) resolve(Buffer.concat(output).toString());
        else reject(new Error("Emulator operation failed; no automatic retry"));
      });
      child.stdin.on("error", () => {});
      child.stdin.end(input);
    });
  }
  async function credential(data) {
    if (data.useTestPin === true) {
      if (!options.emulator || !options.testPinFile)
        throw new Error("Test credential is not configured");
      try {
        data.pin = (await readFile(options.testPinFile, "utf8")).trim();
      } catch {
        throw new Error(
          "Enroll the disposable emulator PIN first with scripts/credential.py",
        );
      }
      delete data.useTestPin;
    }
  }
  async function lab(action, data) {
    if ((await adb(["shell", "getprop", "ro.kernel.qemu"])).trim() !== "1")
      throw new Error("This target is not an emulator");
    if (action === "wake") {
      await adb(["shell", "input", "keyevent", "KEYCODE_WAKEUP"]);
      return {
        ok: true,
        message: "Emulator shell wake delivered; checking native state",
      };
    }
    if (action === "sleep") {
      await adb(["shell", "input", "keyevent", "KEYCODE_SLEEP"]);
      return {
        ok: true,
        message: "Emulator shell sleep delivered; checking native state",
      };
    }
    if (action === "disconnect") {
      device?.destroy();
      return {
        ok: true,
        message: "Link interrupted; actions will not be replayed",
      };
    }
    if (action === "rotate") {
      if (![0, 1].includes(data.rotation))
        throw new Error("Choose portrait or landscape");
      await adb([
        "shell",
        "settings",
        "put",
        "system",
        "accelerometer_rotation",
        "0",
      ]);
      await adb([
        "shell",
        "settings",
        "put",
        "system",
        "user_rotation",
        String(data.rotation),
      ]);
      return { ok: true, message: "Emulator rotation changed" };
    }
    if (action === "unlock") {
      await credential(data);
      if (!state?.locked || !state.secure || !state.interactive)
        throw new Error(
          "Wake a securely locked phone and show its PIN field first",
        );
      if (unlockBlocked)
        throw new Error(
          "One attempt already made. Unlock locally before another experiment.",
        );
      if (typeof data.pin !== "string" || !/^[0-9]{4,16}$/.test(data.pin))
        throw new Error("Enter a 4–16 digit known PIN");
      const policy = await adb(["shell", "dumpsys", "device_policy"]);
      const thresholds = [
        ...policy.matchAll(/maximumFailedPasswordsForWipe=(\d+)/g),
      ].map((m) => Number(m[1]));
      if (state.wipeThreshold !== 0 || thresholds.some((n) => n > 0))
        throw new Error("No verified zero-wipe policy; unlock refused");
      const info = await adb(["shell", "dumpsys", "device_policy"]);
      if (
        /mDeviceOwnerAdmin=ComponentInfo|mProfileOwner.*ComponentInfo/.test(
          info,
        )
      )
        throw new Error("Managed emulator unlock is excluded");
      const inspection = await command("inspect");
      const entry = inspection.data?.nodes?.find(
        (n) => n.id === "com.android.systemui:id/pinEntry" && n.password,
      );
      if (!entry || entry.passwordHasText !== false)
        throw new Error("An observed empty SystemUI PIN field is required");
      const focus = await adb(["shell", "dumpsys", "window"]);
      if (!/mCurrentFocus=Window\{[^\n]*NotificationShade/.test(focus))
        throw new Error(
          "SystemUI does not own keyboard focus; wait for the PIN screen",
        );
      await new Promise((resolve) => setTimeout(resolve, 600));
      const packagePath = (
        await adb(["shell", "pm", "path", "dev.remoteaccess.spike"])
      )
        .trim()
        .replace(/^package:/, "");
      if (!/^\/data\/app\/[A-Za-z0-9_~+/=.-]+\/base\.apk$/.test(packagePath))
        throw new Error("Unexpected APK path");
      unlockBlocked = true;
      credentialInProgress = true;
      currentFrame = null;
      await command("pauseCredentialCapture");
      const pin = Buffer.from(data.pin + "\n");
      delete data.pin;
      try {
        await adb(
          [
            "shell",
            `CLASSPATH=${packagePath}`,
            "app_process",
            "/system/bin",
            "dev.remoteaccess.spike.ShellPin",
          ],
          pin,
        );
      } finally {
        pin.fill(0);
        await new Promise((resolve) => setTimeout(resolve, 2500));
        await command("resumeCredentialCapture").catch(() => {});
        credentialInProgress = false;
        currentFrame = null;
      }
      await new Promise((resolve) => setTimeout(resolve, 1200));
      const observed = await command("state");
      return {
        ok: !observed.state.locked,
        message: observed.state.locked
          ? "PIN delivered once; the phone is still locked. No retry."
          : "Unlocked · independently observed by the native app",
        data: {
          route: "Emulator-only ADB shell helper",
          locked: observed.state.locked,
        },
      };
    }
    throw new Error("Unknown lab operation");
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
    const origin = `http://127.0.0.1:${server.address().port}`;
    const json = (code, value) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(JSON.stringify(value));
    };
    try {
      if (req.headers.host !== new URL(origin).host) {
        json(403, { error: "Use the loopback demo address" });
        return;
      }
      const url = new URL(req.url, origin);
      if (url.pathname.startsWith("/api/")) {
        const cookie = req.headers.cookie
          ?.split(";")
          .map((s) => s.trim())
          .find((s) => s.startsWith("remote_demo="))
          ?.slice(12);
        if (!equal(cookie, session)) {
          json(401, { error: "Open the demo page first" });
          return;
        }
        if (req.method === "POST" && req.headers.origin !== origin) {
          json(403, { error: "Same-origin action required" });
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/state") {
          json(200, status());
          return;
        }
        if (req.method === "GET" && url.pathname === "/api/frame") {
          json(200, await capture());
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/action") {
          const data = await body(req);
          const op = data.op;
          delete data.op;
          if (!safeOps.has(op)) {
            json(400, { error: "Unknown action" });
            return;
          }
          if (op === "unlock") {
            await credential(data);
            if (unlockBlocked)
              throw new Error(
                "One unlock attempt already made. Unlock locally first.",
              );
            if (!state?.secure || !state.locked)
              throw new Error("A secure locked phone is required");
            if (typeof data.pin !== "string" || !/^[0-9]{4,16}$/.test(data.pin))
              throw new Error("Enter a 4–16 digit known PIN");
            unlockBlocked = true;
            credentialInProgress = true;
            currentFrame = null;
          }
          if (!["state", "inspect", "capture"].includes(op)) {
            currentFrame = null;
            lastCapture = 0;
          }
          let result;
          try {
            result = await command(op, data);
          } finally {
            if (op === "unlock") {
              delete data.pin;
              await new Promise((resolve) => setTimeout(resolve, 2500));
              credentialInProgress = false;
              currentFrame = null;
            }
          }
          if (op === "unlock" && result.state && !result.state.unlockAttempted)
            unlockBlocked = false;
          if (op !== "inspect" && op !== "capture" && op !== "state")
            activity(op, result.message, result.ok);
          json(200, result);
          return;
        }
        if (req.method === "POST" && url.pathname === "/api/lab") {
          const data = await body(req);
          const action = data.action;
          delete data.action;
          const result = await lab(action, data);
          activity("lab", result.message, result.ok);
          json(200, result);
          return;
        }
        json(404, { error: "Unknown endpoint" });
        return;
      }
      if (req.method !== "GET") {
        json(405, { error: "GET required" });
        return;
      }
      const files = {
        "/": "index.html",
        "/app.js": "app.js",
        "/style.css": "style.css",
      };
      const file = files[url.pathname];
      if (!file) {
        json(404, { error: "Not found" });
        return;
      }
      if (url.pathname === "/")
        res.setHeader(
          "Set-Cookie",
          `remote_demo=${session}; HttpOnly; SameSite=Strict; Path=/`,
        );
      res.writeHead(200, { "Content-Type": types[path.extname(file)] });
      res.end(await readFile(path.join(root, "web", file)));
    } catch (error) {
      json(400, { error: error.message || "Request failed" });
    }
  });
  server.requestTimeout = 10000;
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", resolve);
  });
  const ping = setInterval(() => {
    if (device && !closing)
      command("ping", {}, 4000).catch(() => device?.destroy());
  }, 5000);
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    phonePort: phone.address().port,
    token,
    status,
    command,
    async close() {
      closing = true;
      clearInterval(ping);
      device?.destroy();
      invalidate();
      await Promise.all([
        new Promise((r) => server.close(r)),
        new Promise((r) => phone.close(r)),
      ]);
    },
  };
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const configPath =
    process.env.DEMO_CONFIG || path.join(root, ".local", "server.json");
  let config = {};
  try {
    config = JSON.parse(await readFile(configPath, "utf8"));
  } catch {}
  const app = await createDemo(config);
  await mkdir(path.join(root, ".local"), { recursive: true });
  await writeFile(
    path.join(root, ".local", "running.json"),
    JSON.stringify({
      url: app.url,
      phonePort: app.phonePort,
      token: app.token,
      pid: process.pid,
    }),
    { mode: 0o600 },
  );
  console.log(`Remote access spike: ${app.url}`);
  console.log(
    "Local emulator only. No ADB forwarding in the app control path.",
  );
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
