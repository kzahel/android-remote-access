import { randomBytes } from "node:crypto";
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { createServer, type IncomingMessage } from "node:http";
import path from "node:path";
import {
  authBytes,
  createBytes,
  fromHex,
  type Grant,
  grantBytes,
  keyBytes,
  originURL,
  revokeBytes,
  verifySignature,
} from "@remote/protocol/enrollment";
import { WebSocket, WebSocketServer } from "ws";

type Stored = Grant & { viewerSignature: string; revoked: boolean };
type Pending = { id: string; viewer: string; expires: number; offer?: Grant };
export interface Options {
  origin: string;
  stateDir: string;
  revision?: string;
  trustProxy?: boolean;
}
export function createRelay(options: Options) {
  const origin = originURL(options.origin);
  mkdirSync(options.stateDir, { recursive: true, mode: 0o700 });
  const file = path.join(options.stateDir, "pairings-v1.json");
  const pairs: Record<string, Stored> = Object.create(null);
  if (existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, "utf8")) as {
      version: number;
      pairs: Record<string, Stored>;
    };
    if (saved.version !== 1 || !saved.pairs || typeof saved.pairs !== "object")
      throw new Error("Invalid authority state");
    for (const [id, row] of Object.entries(saved.pairs)) {
      fromHex(id, 16);
      keyBytes(row.phone);
      keyBytes(row.viewer);
      if (row.id !== id || typeof row.revoked !== "boolean")
        throw new Error("Invalid authority state");
      pairs[id] = row;
    }
  }
  const persist = () => {
    const temporary = `${file}.next`;
    writeFileSync(temporary, JSON.stringify({ version: 1, pairs }), {
      mode: 0o600,
    });
    const fd = openSync(temporary, "r");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    const dir = openSync(options.stateDir, "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  };
  let unhealthy = false;
  const durable = () => {
    try {
      persist();
    } catch {
      unhealthy = true;
      for (const ws of wss.clients) ws.terminate();
      throw new Error("Persistence unavailable");
    }
  };
  const pending = new Map<string, Pending>();
  const buckets = new Map<string, { until: number; count: number }>();
  const routes = new Map<
    string,
    Partial<Record<"phone" | "viewer", WebSocket>>
  >();
  const disconnect = (id: string) => {
    const route = routes.get(id);
    routes.delete(id);
    for (const ws of Object.values(route ?? {}))
      ws.close(4001, "Reconnect with a fresh session");
  };
  function admit(req: IncomingMessage): boolean {
    if (unhealthy) return false;
    if (req.headers.origin && req.headers.origin !== origin) return false;
    let ip = req.socket.remoteAddress ?? "unknown";
    if (
      options.trustProxy &&
      ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)
    )
      ip =
        String(req.headers["x-forwarded-for"] ?? ip)
          .split(",")
          .at(-1)
          ?.trim() ?? ip;
    const now = Date.now();
    let bucket = buckets.get(ip);
    if (!bucket || bucket.until <= now) {
      if (buckets.size >= 10000) return false;
      bucket = { until: now + 60000, count: 0 };
      buckets.set(ip, bucket);
    }
    return ++bucket.count <= 240;
  }
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", "application/json");
    const reply = (status: number, body: unknown) => {
      res.writeHead(status);
      res.end(JSON.stringify(body));
    };
    try {
      if (req.url === "/health" && req.method === "GET") {
        reply(unhealthy ? 503 : 200, {
          status: unhealthy ? "unavailable" : "ok",
          revision: options.revision ?? "development",
        });
        return;
      }
      if (!admit(req)) {
        reply(429, { error: "Request unavailable" });
        return;
      }
      const parts = req.url?.match(
        /^\/api\/pair\/([0-9a-f]{32})(?:\/(offer|complete|revoke))?$/,
      );
      if (!parts) {
        reply(404, { error: "Not found" });
        return;
      }
      const id = parts[1] ?? "";
      const action = parts[2];
      const existing = pairs[id];
      let p = pending.get(id);
      if (p && p.expires * 1000 <= Date.now()) {
        pending.delete(id);
        p = undefined;
      }
      if (req.method === "GET" && !action) {
        if (existing?.revoked) reply(410, { error: "Unavailable" });
        else if (existing) reply(200, { state: "paired", grant: existing });
        else if (p)
          reply(
            200,
            p.offer
              ? { state: "offered", grant: p.offer }
              : { state: "waiting" },
          );
        else reply(404, { error: "Unavailable" });
        return;
      }
      if (
        req.method !== "POST" ||
        req.headers["content-type"] !== "application/json"
      ) {
        reply(415, { error: "JSON required" });
        return;
      }
      const chunks: Buffer[] = [];
      let length = 0;
      for await (const chunk of req) {
        const b = Buffer.from(chunk);
        length += b.length;
        if (length > 4096) {
          reply(413, { error: "Too large" });
          return;
        }
        chunks.push(b);
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
        string,
        unknown
      >;
      const text = (key: string) => {
        const value = body[key];
        if (typeof value !== "string" || value.length > 512)
          throw new Error("Invalid field");
        return value;
      };
      if (!action) {
        const viewer = text("viewer");
        const expires = body.expires;
        if (
          existing ||
          p ||
          pending.size >= 1000 ||
          Object.keys(pairs).length >= 10000 ||
          !Number.isSafeInteger(expires) ||
          typeof expires !== "number" ||
          expires * 1000 <= Date.now() ||
          expires * 1000 > Date.now() + 301000
        )
          throw new Error("Unavailable");
        await verifySignature(
          viewer,
          createBytes(origin, { id, viewer, expires }),
          text("signature"),
        );
        if (pairs[id] || pending.has(id) || unhealthy)
          throw new Error("Unavailable");
        pending.set(id, { id, viewer, expires });
        reply(201, { state: "waiting" });
      } else if (action === "offer") {
        if (!p || p.offer || existing) throw new Error("Unavailable");
        const grant: Grant = {
          id,
          viewer: p.viewer,
          expires: p.expires,
          phone: text("phone"),
          phoneSignature: text("phoneSignature"),
          mac: text("mac"),
        };
        fromHex(grant.mac, 32);
        await verifySignature(
          grant.phone,
          grantBytes(origin, grant),
          grant.phoneSignature,
        );
        if (
          pending.get(id) !== p ||
          p.offer ||
          pairs[id] ||
          p.expires * 1000 <= Date.now() ||
          unhealthy
        )
          throw new Error("Unavailable");
        p.offer = grant;
        reply(202, { state: "offered" });
      } else if (action === "complete") {
        if (!p?.offer || existing) throw new Error("Unavailable");
        const viewerSignature = text("viewerSignature");
        await verifySignature(
          p.viewer,
          grantBytes(origin, p.offer),
          viewerSignature,
        );
        if (
          pending.get(id) !== p ||
          pairs[id] ||
          p.expires * 1000 <= Date.now() ||
          unhealthy
        )
          throw new Error("Unavailable");
        pairs[id] = { ...p.offer, viewerSignature, revoked: false };
        durable();
        pending.delete(id);
        reply(200, { state: "paired", grant: pairs[id] });
      } else if (action === "revoke") {
        if (!existing) throw new Error("Unavailable");
        await verifySignature(
          existing.phone,
          revokeBytes(origin, id),
          text("signature"),
        );
        if (unhealthy) throw new Error("Unavailable");
        existing.revoked = true;
        durable();
        disconnect(id);
        reply(200, { state: "revoked" });
      }
    } catch {
      if (!res.headersSent)
        reply(unhealthy ? 503 : 400, { error: "Request rejected" });
      else res.end();
    }
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 10000;
  server.maxHeadersCount = 32;
  const wss = new WebSocketServer({
    noServer: true,
    maxPayload: 1048608,
    perMessageDeflate: false,
  });
  server.on("upgrade", (req, socket, head) => {
    if (req.url !== "/api/socket" || !admit(req) || wss.clients.size >= 1000) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
  });
  wss.on("connection", (ws: WebSocket) => {
    const nonce = randomBytes(32).toString("hex");
    ws.send(JSON.stringify({ type: "challenge", nonce }));
    let id: string | undefined;
    let role: "phone" | "viewer" | undefined;
    let working = false;
    let authenticated = false;
    let alive = true;
    const timeout = setTimeout(
      () => ws.close(4003, "Authentication expired"),
      10000,
    );
    const lifetime = setTimeout(
      () => ws.close(4001, "Session expired"),
      3600000,
    );
    const heartbeat = setInterval(() => {
      if (!alive) ws.terminate();
      else {
        alive = false;
        ws.ping();
      }
    }, 30000);
    ws.on("pong", () => {
      alive = true;
    });
    ws.on("error", () => ws.terminate());
    ws.on("close", () => {
      clearTimeout(timeout);
      clearTimeout(lifetime);
      clearInterval(heartbeat);
      if (id && role && routes.get(id)?.[role] === ws) disconnect(id);
    });
    ws.on("message", async (input, binary) => {
      const data = Buffer.isBuffer(input)
        ? input
        : Array.isArray(input)
          ? Buffer.concat(input)
          : Buffer.from(input);
      try {
        if (unhealthy) throw new Error("Unavailable");
        if (!authenticated) {
          if (binary || working || data.length > 2048)
            throw new Error("Authentication required");
          working = true;
          const message = JSON.parse(data.toString()) as {
            id: string;
            role: string;
            signature: string;
          };
          fromHex(message.id, 16);
          if (message.role !== "phone" && message.role !== "viewer")
            throw new Error("Invalid role");
          const pair = pairs[message.id];
          if (!pair || pair.revoked) throw new Error("Unavailable");
          await verifySignature(
            pair[message.role],
            authBytes(origin, message.id, message.role, nonce),
            message.signature,
          );
          if (pair.revoked || ws.readyState !== WebSocket.OPEN || unhealthy)
            throw new Error("Unavailable");
          const route = routes.get(message.id) ?? {};
          if (route[message.role]) throw new Error("Already connected");
          id = message.id;
          role = message.role;
          route[role] = ws;
          routes.set(id, route);
          authenticated = true;
          clearTimeout(timeout);
          ws.send(JSON.stringify({ type: "authenticated" }));
          if (route.phone && route.viewer)
            for (const peer of Object.values(route))
              peer.send(JSON.stringify({ type: "ready" }));
        } else {
          const pair = id ? pairs[id] : undefined;
          const route = id ? routes.get(id) : undefined;
          const peer = role === "phone" ? route?.viewer : route?.phone;
          if (
            !binary ||
            !pair ||
            pair.revoked ||
            !peer ||
            peer.readyState !== WebSocket.OPEN ||
            peer.bufferedAmount > 1048608
          )
            throw new Error("Peer unavailable");
          peer.send(data, { binary: true });
        }
      } catch {
        ws.close(4003, "Request rejected");
      }
    });
  });
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, p] of pending)
      if (p.expires * 1000 <= now) pending.delete(id);
    for (const [ip, b] of buckets) if (b.until <= now) buckets.delete(ip);
  }, 10000);
  sweep.unref();
  return {
    server,
    async close() {
      clearInterval(sweep);
      for (const ws of wss.clients) ws.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    },
  };
}
