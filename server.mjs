import http from "node:http";
import net from "node:net";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { spawn } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";

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
  "openTouchLab",
  "videoKeyframe",
  "videoMode",
  "smooth",
  "smoothOff",
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
  if (options.tailnetHost && !/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+$/.test(options.tailnetHost))
    throw new Error("tailnetHost must be a Tailscale 100.64.0.0/10 address");
  const token = options.token || secret();
  const phoneProfile = options.profile === "usb-phone";
  // The emulator's synthetic fixture, or the phone owner's opt-in saved PIN.
  const pinFile = phoneProfile
    ? options.phoneUnlock && options.savedPinFile
    : options.emulator && options.testPinFile;
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
  let viewerStopped = false;
  let currentFrame = null;
  let capturePromise = null;
  let lastCapture = 0;
  let lastCaptureAttempt = 0;
  let lastFrameError = "";
  // A busy or changing screen fails a still capture briefly; only a protected
  // screen or missing permission should also hold back video.
  const transientFrameError = () =>
    /rate limited|changed|already in progress|timed out/.test(lastFrameError);
  let credentialInProgress = false;
  let credentialChild = null;
  let credentialReserved = false;
  let credentialVersion = 0;
  let videoDevice = null;
  let lastVideoAt = 0;
  let videoFrames = 0;
  const viewers = new Set();
  let touchOwner = null;
  const live = new WebSocketServer({
    noServer: true,
    maxPayload: 32768,
    perMessageDeflate: false,
  });
  function broadcast(message) {
    for (const viewer of viewers)
      if (
        viewer.readyState === WebSocket.OPEN &&
        viewer.bufferedAmount < 262144
      )
        viewer.send(JSON.stringify(message));
  }
  function endTouch(reason, owner = touchOwner) {
    if (!owner || touchOwner !== owner) return;
    touchOwner = null;
    if (device) command("touchEnd", {}, 1200).catch(() => {});
    if (owner.socket.readyState === WebSocket.OPEN)
      owner.socket.send(
        JSON.stringify({ type: "touchEnded", message: reason }),
      );
  }
  function videoPause(message) {
    for (const viewer of viewers) viewer.needsKey = true;
    broadcast({ type: "videoPaused", message });
  }
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
    endTouch("Phone connection ended");
    videoDevice?.destroy();
    videoDevice = null;
    videoPause("Phone connection ended");
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
          if (/protected|credential|permission/.test(result.message))
            videoPause(result.message);
        }
        return result.ok ? currentFrame : result;
      })
      .finally(() => {
        capturePromise = null;
      });
    return capturePromise;
  }
  let deviceRoute = "";
  const acceptPhone = (socket, route) => {
    socket.setNoDelay(true);
    let admitted = false,
      role = "control",
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
          if (data.type !== "hello" || !equal(data.token, token)) {
            socket.destroy();
            return;
          }
          if (data.role === "video") {
            if (!device || data.generation !== generation) {
              socket.destroy();
              return;
            }
            videoDevice?.destroy();
            videoDevice = socket;
            admitted = true;
            role = "video";
            clearTimeout(authTimer);
            continue;
          }
          if (device) {
            socket.destroy();
            return;
          }
          clearTimeout(authTimer);
          admitted = true;
          device = socket;
          deviceRoute = route;
          generation = data.generation;
          viewerStopped = false;
          update(data.state);
          invalidate();
          activity("connection", "Phone connected");
          continue;
        }
        if (role === "video") {
          if (socket !== videoDevice || !device) {
            socket.destroy();
            return;
          }
          if (
            data.type !== "video" ||
            typeof data.data !== "string" ||
            data.data.length > 1048576
          ) {
            socket.destroy();
            return;
          }
          lastVideoAt = Date.now();
          videoFrames++;
          if (
            credentialReserved ||
            credentialInProgress ||
            !state?.interactive ||
            state?.locked ||
            (lastFrameError && !transientFrameError())
          )
            continue;
          for (const viewer of viewers) {
            if (viewer.readyState !== WebSocket.OPEN) continue;
            if (viewer.bufferedAmount > 262144) {
              viewer.needsKey = true;
              continue;
            }
            if (viewer.needsKey && !data.key) continue;
            viewer.needsKey = false;
            viewer.send(JSON.stringify(data));
          }
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
        credentialVersion++;
        if (credentialChild) credentialChild.kill("SIGKILL");
        device = null;
        invalidate();
        activity("connection", "Phone disconnected", false);
      }
      if (socket === videoDevice) {
        videoDevice = null;
        videoPause("Smooth view connection ended");
      }
    });
  };
  const phone = net.createServer((socket) => acceptPhone(socket, "adb"));
  await new Promise((resolve, reject) => {
    phone.once("error", reject);
    phone.listen(options.phonePort ?? 0, "127.0.0.1", resolve);
  });
  // Optional second phone listener on this computer's Tailscale address only,
  // so the app can reach it on any network. Same token; WireGuard encrypts it.
  const tailnet = options.tailnetHost
    ? net.createServer((socket) => acceptPhone(socket, "tailscale"))
    : null;
  if (tailnet)
    await new Promise((resolve, reject) => {
      tailnet.once("error", reject);
      tailnet.listen(options.tailnetPort ?? 0, options.tailnetHost, resolve);
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
    captureErrorTransient: transientFrameError(),
    lab: !!options.emulator,
    target: options.profile === "usb-phone" ? "USB-connected phone" : "Local emulator",
    deviceName: options.deviceName || "Demo phone",
    credentialExperiment: !phoneProfile || !!options.phoneUnlock,
    testCredential: !!pinFile && existsSync(pinFile),
    unlockBlocked,
    live: {
      videoConnected: !!videoDevice,
      lastVideoAt,
      videoFrames,
      touchHeld: !!touchOwner,
    },
    link: device ? deviceRoute : "",
    transport: options.profile === "usb-phone"
      ? deviceRoute === "tailscale" && device
        ? "Phone demo · native phone control · Tailscale transport"
        : "USB demo · native phone control · local ADB reverse transport"
      : "Local emulator demo · app connects outward · no ADB forwarding",
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
      if (input) credentialChild = child;
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
        if (credentialChild === child) credentialChild = null;
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
      if (!pinFile) throw new Error("Test credential is not configured");
      const info = await stat(pinFile).catch(() => null);
      if (!info)
        throw new Error(
          phoneProfile
            ? "Save this phone's PIN first; see docs/phone-spike.md"
            : "Enroll the disposable emulator PIN first with scripts/credential.py",
        );
      if (phoneProfile && (info.mode & 0o077) !== 0)
        throw new Error("Saved PIN file must be readable only by you (chmod 600)");
      data.pin = (await readFile(pinFile, "utf8")).trim();
      delete data.useTestPin;
    }
  }
  async function lab(action, data) {
    if (credentialInProgress)
      throw new Error("Credential delivery is already in progress");
    const version = credentialVersion;
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
      const packagePath = (
        await adb(["shell", "pm", "path", "dev.remoteaccess.spike"])
      )
        .trim()
        .replace(/^package:/, "");
      if (!/^\/data\/app\/[A-Za-z0-9_~+/=.-]+\/base\.apk$/.test(packagePath))
        throw new Error("Unexpected APK path");
      const inspection = JSON.parse(
        await adb([
          "shell",
          `CLASSPATH=${packagePath}`,
          "app_process",
          "/system/bin",
          "dev.remoteaccess.spike.ShellUi",
        ]),
      );
      const entry = inspection.nodes?.find(
        (n) => n.id === "com.android.systemui:id/pinEntry" && n.password,
      );
      if (!entry || entry.hasText !== false)
        throw new Error("An observed empty SystemUI PIN field is required");
      const focus = await adb(["shell", "dumpsys", "window"]);
      if (!/mCurrentFocus=Window\{[^\n]*NotificationShade/.test(focus))
        throw new Error(
          "SystemUI does not own keyboard focus; wait for the PIN screen",
        );
      await new Promise((resolve) => setTimeout(resolve, 600));
      if (version !== credentialVersion || !device)
        throw new Error(
          "Access ended during unlock preparation; no PIN delivered",
        );
      unlockBlocked = true;
      credentialInProgress = true;
      currentFrame = null;
      const pin = Buffer.from(data.pin + "\n");
      delete data.pin;
      try {
        await command("pauseCredentialCapture");
        if (version !== credentialVersion || !device)
          throw new Error("Access ended before credential delivery");
        await adb(
          [
            "shell",
            `CLASSPATH=${packagePath}`,
            "app_process",
            "/system/bin",
            "dev.remoteaccess.spike.ShellPin",
            inspection.nodes.some(
              (n) => n.id === "com.android.systemui:id/key_enter",
            )
              ? "submit"
              : "digits-only",
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
    let ownsCredentialReservation = false;
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
          if (
            (credentialReserved || credentialInProgress) &&
            !["state", "inspect", "capture", "stop"].includes(op)
          )
            throw new Error("Credential delivery is already in progress");
          if (op === "stop") {
            viewerStopped = true;
            endTouch("Remote access stopped");
            videoPause("Remote access stopped");
            credentialVersion++;
            if (credentialChild) credentialChild.kill("SIGKILL");
          }
          if (!safeOps.has(op)) {
            json(400, { error: "Unknown action" });
            return;
          }
          if (op === "unlock") {
            if (phoneProfile && !options.phoneUnlock)
              throw new Error("Unlock this phone locally; credential experiments are emulator-only");
            endTouch("Unlocking");
            videoPause("Unlocking · view paused");
            credentialReserved = true;
            ownsCredentialReservation = true;
            const version = credentialVersion;
            await credential(data);
            if (version !== credentialVersion || !device)
              throw new Error("Access ended during unlock preparation");
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
            // Unlock may first tap past Pixel's fingerprint-only screen.
            result = await command(op, data, op === "unlock" || op === "smooth" ? 15000 : undefined);
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
          if (credentialReserved || credentialInProgress)
            throw new Error("Credential delivery is already in progress");
          if (action === "unlock") {
            credentialReserved = true;
            ownsCredentialReservation = true;
          }
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
        "/live.js": "live.js",
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
    } finally {
      if (ownsCredentialReservation) credentialReserved = false;
    }
  });
  server.on("upgrade", (req, socket, head) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const cookie = req.headers.cookie
      ?.split(";")
      .map((s) => s.trim())
      .find((s) => s.startsWith("remote_demo="))
      ?.slice(12);
    if (
      req.url !== "/api/live" ||
      req.headers.host !== new URL(origin).host ||
      req.headers.origin !== origin ||
      !equal(cookie, session)
    ) {
      socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
      return;
    }
    live.handleUpgrade(req, socket, head, (viewer) =>
      live.emit("connection", viewer),
    );
  });
  live.on("connection", (viewer) => {
    viewers.add(viewer);
    viewer.needsKey = true;
    command("videoKeyframe").catch(() => {});
    let busy = false;
    viewer.on("error", () => {});
    viewer.on("close", () => {
      viewers.delete(viewer);
      if (touchOwner?.socket === viewer) endTouch("Viewer connection ended");
    });
    viewer.on("message", async (bytes) => {
      let request;
      let dispatched = false;
      try {
        const data = JSON.parse(bytes.toString());
        request = data.request;
        if (!Number.isSafeInteger(request) || request < 0)
          throw new Error("Invalid request identity");
        if (data.op === "touchEnd") {
          if (touchOwner?.socket === viewer) endTouch("Viewer released touch");
          viewer.send(
            JSON.stringify({
              type: "touchResult",
              request,
              ok: true,
              message: "Touch ended",
            }),
          );
          return;
        }
        if (data.op !== "touch")
          throw new Error("Only touch messages are accepted on this channel");
        if (
          credentialReserved ||
          credentialInProgress ||
          state?.locked ||
          !state?.interactive
        )
          throw new Error(
            "Touch is unavailable while locked, asleep or unlocking",
          );
        if (busy)
          throw new Error("Previous touch batch is still in flight; no replay");
        if (
          touchOwner &&
          (touchOwner.socket !== viewer || touchOwner.gesture !== data.gesture)
        )
          throw new Error("Another viewer owns touch");
        if (!touchOwner) {
          if (data.sequence !== 0)
            throw new Error("Touch session ended; start again");
          touchOwner = { socket: viewer, gesture: data.gesture };
        }
        busy = true;
        dispatched = true;
        const owner = touchOwner;
        const { op, request: ignored, ...payload } = data;
        const result = await command("touch", payload, 1600);
        if (touchOwner === owner && (!result.ok || result.data?.held === 0))
          touchOwner = null;
        if (viewer.readyState === WebSocket.OPEN)
          viewer.send(
            JSON.stringify({ ...result, type: "touchResult", request }),
          );
      } catch (error) {
        if (touchOwner?.socket === viewer)
          endTouch("Touch delivery unconfirmed; no replay");
        if (viewer.readyState === WebSocket.OPEN)
          viewer.send(
            JSON.stringify({
              type: "touchResult",
              request,
              ok: false,
              message: error.message,
            }),
          );
      } finally {
        if (dispatched) busy = false;
      }
    });
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
  // The phone app dials its own loopback; an owned `adb reverse` carries that
  // here. A dropped ADB transport removes the mapping, and a timed-out one can
  // strand it (accepted, never forwarded), while the armed app keeps retrying.
  // Restore only our port, on any ADB route to the same physical phone.
  const linkGrace = options.linkGraceMs ?? 6000;
  let silentSince = Date.now(),
    lastRepair = 0,
    repairs = 0,
    repairing = false,
    linkMessage = "";
  const runAdb =
    options.runAdb ||
    ((args, timeout = 8000) =>
      new Promise((resolve, reject) => {
        const child = spawn(options.adb || "adb", args, {
          stdio: ["ignore", "pipe", "ignore"],
        });
        const output = [];
        const timer = setTimeout(() => child.kill("SIGKILL"), timeout);
        child.stdout.on("data", (b) => output.push(b));
        child.on("error", () => reject(new Error("ADB could not start")));
        child.on("close", (code) => {
          clearTimeout(timer);
          if (code === 0) resolve(Buffer.concat(output).toString());
          else reject(new Error("ADB command failed"));
        });
      }));
  async function repairLink() {
    const link = JSON.parse(
      await readFile(options.linkFile, "utf8").catch(() => {
        throw new Error("Phone link details are not recorded yet");
      }),
    );
    const port = `tcp:${link.devicePort}`;
    const routes = [link.serial];
    const listed = await runAdb(["devices"]).catch(() => "");
    for (const line of listed.split("\n")) {
      const [serial, kind] = line.trim().split(/\s+/);
      if (kind !== "device" || serial === link.serial || /^emulator-/.test(serial))
        continue;
      const hardware = await runAdb(["-s", serial, "shell", "getprop", "ro.serialno"], 5000)
        .then((out) => out.trim())
        .catch(() => "");
      if (hardware && hardware === link.hardwareSerial) routes.push(serial);
    }
    for (const serial of routes) {
      try {
        await runAdb(["-s", serial, "reverse", "--remove", port]).catch(() => {});
        await runAdb(["-s", serial, "reverse", port, `tcp:${phone.address().port}`]);
        return serial === link.serial
          ? "Phone link restored over the selected ADB connection"
          : "Phone link restored over another ADB connection to this phone";
      } catch {}
    }
    throw new Error("No ADB connection to this phone; waiting");
  }
  const linkWatch = setInterval(async () => {
    if (device || viewerStopped || closing) {
      silentSince = Date.now();
      repairs = 0;
      if (device) linkMessage = "";
      return;
    }
    const now = Date.now();
    const backoff = repairs < 3 ? 10000 : 60000;
    // Only after the app has connected once; setup consent can take minutes.
    if (!options.linkFile || !seen || repairing || now - silentSince < linkGrace || now - lastRepair < backoff)
      return;
    repairing = true;
    lastRepair = now;
    repairs++;
    try {
      const message = await repairLink();
      if (!closing && linkMessage !== message) activity("connection", message);
      linkMessage = message;
    } catch (error) {
      if (!closing && linkMessage !== error.message)
        activity("connection", error.message, false);
      linkMessage = error.message;
    } finally {
      repairing = false;
    }
  }, options.linkCheckMs ?? 3000);
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    phonePort: phone.address().port,
    tailnetPort: tailnet?.address().port ?? null,
    token,
    status,
    command,
    async close() {
      closing = true;
      endTouch("Demo closed");
      for (const viewer of viewers) viewer.terminate();
      live.close();
      videoDevice?.destroy();
      clearInterval(ping);
      clearInterval(linkWatch);
      device?.destroy();
      invalidate();
      await Promise.all([
        new Promise((r) => server.close(r)),
        new Promise((r) => phone.close(r)),
        tailnet ? new Promise((r) => tailnet.close(r)) : null,
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
    process.env.DEMO_RUNNING || path.join(root, ".local", "running.json"),
    JSON.stringify({
      url: app.url,
      phonePort: app.phonePort,
      tailnetPort: app.tailnetPort,
      token: app.token,
      pid: process.pid,
    }),
    { mode: 0o600 },
  );
  console.log(`Remote access spike: ${app.url}`);
  console.log(app.status().transport);
  for (const signal of ["SIGTERM", "SIGINT"])
    process.on(signal, async () => {
      await app.close();
      process.exit(0);
    });
}
