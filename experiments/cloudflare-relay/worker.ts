/** Isolated runtime proof. No production route, FCM sender or anonymous admission policy. */
import { DurableObject } from "cloudflare:workers";
import {
  authBytes,
  createBytes,
  fromHex,
  type Grant,
  grantBytes,
  hex,
  revokeBytes,
  verifySignature,
} from "../../protocol/src/enrollment.js";

type Env = {
  PAIRINGS: DurableObjectNamespace<Pairing>;
  PUBLIC_ORIGIN: string;
  PROOF_KEY?: string;
};
type Pair = Grant & { viewerSignature: string; revoked: boolean };
type Pending = {
  id: string;
  viewer: string;
  expires: number;
  offer?: Grant;
  device?: string;
};
type Attachment = {
  nonce: string;
  deadline: number;
  working?: boolean;
  role?: "phone" | "viewer";
};
const json = (value: unknown, status = 200) =>
  Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
async function body(
  req: Pick<Request, "headers" | "body">,
): Promise<Record<string, unknown>> {
  if (req.headers.get("content-type")?.split(";")[0] !== "application/json")
    throw new Error("JSON required");
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Body required");
  const chunks: Uint8Array[] = [];
  let length = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    length += next.value.length;
    if (length > 4096) {
      await reader.cancel();
      throw new Error("Body too large");
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return JSON.parse(new TextDecoder().decode(bytes));
}
function text(value: unknown): string {
  if (typeof value !== "string" || value.length > 1600)
    throw new Error("Invalid field");
  return value;
}
export default {
  async fetch(req: Request, env: Env) {
    // A fixture gate, NOT the proposed production enrollment defense.
    if (!env.PROOF_KEY || req.headers.get("X-Proof-Key") !== env.PROOF_KEY)
      return json({ error: "Proof only" }, 403);
    if (
      req.headers.has("Origin") &&
      req.headers.get("Origin") !== env.PUBLIC_ORIGIN
    )
      return json({ error: "Origin" }, 403);
    const url = new URL(req.url);
    const api = url.pathname.match(
      /^\/api\/pair\/([0-9a-f]{32})(?:\/(offer|complete|revoke))?$/,
    );
    const id =
      api?.[1] ??
      (url.pathname === "/api/socket" ? url.searchParams.get("id") : null);
    if (!id || !/^[0-9a-f]{32}$/.test(id)) return json({ error: "Route" }, 404);
    try {
      let forward = req;
      if (api && !api[2] && req.method === "POST") {
        // Reject malformed/unsigned enrollment before allocating a billable object.
        const value = await body(req);
        const viewer = text(value.viewer);
        const expires = Number(value.expires);
        if (
          !Number.isSafeInteger(value.expires) ||
          expires * 1000 <= Date.now() ||
          expires * 1000 > Date.now() + 301000
        )
          throw new Error("Expiry");
        await verifySignature(
          viewer,
          createBytes(env.PUBLIC_ORIGIN, { id, viewer, expires }),
          text(value.signature),
        );
        forward = new Request(req.url, {
          method: req.method,
          headers: req.headers,
          body: JSON.stringify(value),
        });
      }
      return await env.PAIRINGS.getByName(id).fetch(forward);
    } catch {
      return json({ error: "Rejected" }, 400);
    }
  },
} satisfies ExportedHandler<Env>;

export class Pairing extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
    );
  }
  private get<T>(key: string): T | undefined {
    const row = this.ctx.storage.sql
      .exec<{ value: string }>("SELECT value FROM state WHERE key = ?", key)
      .toArray()[0];
    return row ? (JSON.parse(row.value) as T) : undefined;
  }
  private put(key: string, value: unknown) {
    this.ctx.storage.sql.exec(
      "INSERT INTO state VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      key,
      JSON.stringify(value),
    );
  }
  private drop(key: string) {
    this.ctx.storage.sql.exec("DELETE FROM state WHERE key = ?", key);
  }
  private sockets(role?: string) {
    return this.ctx
      .getWebSockets()
      .filter(
        (ws) =>
          ws.readyState === WebSocket.OPEN &&
          (!role || (ws.deserializeAttachment() as Attachment).role === role),
      );
  }
  private disconnect() {
    for (const ws of this.sockets()) ws.close(4001, "Reconnect");
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === "/api/socket") {
      if (
        req.headers.get("Upgrade") !== "websocket" ||
        this.ctx.getWebSockets().length >= 4
      )
        return json({ error: "Unavailable" }, 429);
      const pair = new WebSocketPair();
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        nonce: hex(crypto.getRandomValues(new Uint8Array(32))),
        deadline: Date.now() + 10000,
      } satisfies Attachment);
      const attachment = server.deserializeAttachment() as Attachment;
      server.send(
        JSON.stringify({ type: "challenge", nonce: attachment.nonce }),
      );
      await this.schedule();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }
    const id = url.pathname.split("/")[3] ?? "";
    const action = url.pathname.split("/")[4];
    try {
      const paired = this.get<Pair>("pair");
      const pending = this.get<Pending>("pending");
      if (req.method === "GET" && !action) {
        if (paired?.revoked) return json({ error: "Unavailable" }, 410);
        if (paired) return json({ state: "paired", grant: paired });
        if (pending && pending.expires * 1000 > Date.now())
          return json(
            pending.offer
              ? {
                  state: "offered",
                  grant: pending.offer,
                  device: pending.device,
                }
              : { state: "waiting" },
          );
        return json({ error: "Unavailable" }, 404);
      }
      if (req.method !== "POST") return json({ error: "Method" }, 405);
      const value = await body(req);
      if (!action) {
        if (
          this.get<Pair>("pair") ||
          (this.get<Pending>("pending")?.expires ?? 0) * 1000 > Date.now()
        )
          throw new Error("Duplicate");
        if (Number(value.expires) * 1000 <= Date.now())
          throw new Error("Expired");
        // The front Worker already verified the creation signature and expiry.
        this.put("pending", {
          id,
          viewer: text(value.viewer),
          expires: value.expires,
        });
        await this.schedule();
        return json({ state: "waiting" }, 201);
      }
      if (action === "revoke") {
        if (!paired) throw new Error("No pair");
        await verifySignature(
          paired.phone,
          revokeBytes(this.env.PUBLIC_ORIGIN, id),
          text(value.signature),
        );
        const latest = this.get<Pair>("pair");
        if (!latest) throw new Error("No pair");
        this.put("pair", { ...latest, revoked: true });
        this.disconnect();
        return json({ state: "revoked" });
      }
      if (paired || !pending || pending.expires * 1000 <= Date.now())
        throw new Error("No invitation");
      if (action === "offer") {
        const offer: Grant = {
          id,
          viewer: pending.viewer,
          expires: pending.expires,
          phone: text(value.phone),
          phoneSignature: text(value.phoneSignature),
          mac: text(value.mac),
        };
        fromHex(offer.mac, 32);
        const device = text(value.device);
        if (!/^[A-Za-z0-9+/]+={0,2}$/.test(device)) throw new Error("Device");
        await verifySignature(
          offer.phone,
          grantBytes(this.env.PUBLIC_ORIGIN, offer),
          offer.phoneSignature,
        );
        // Re-read after await: DO input gates do not serialize arbitrary crypto awaits.
        const latest = this.get<Pending>("pending");
        if (
          !latest ||
          latest.offer ||
          this.get<Pair>("pair") ||
          latest.expires * 1000 <= Date.now()
        )
          throw new Error("Stale");
        this.put("pending", { ...latest, offer, device });
        return json({ state: "offered" }, 202);
      }
      if (action !== "complete" || !pending.offer) throw new Error("No offer");
      const viewerSignature = text(value.viewerSignature);
      await verifySignature(
        pending.viewer,
        grantBytes(this.env.PUBLIC_ORIGIN, pending.offer),
        viewerSignature,
      );
      const latest = this.get<Pending>("pending");
      if (
        !latest?.offer ||
        this.get<Pair>("pair") ||
        latest.expires * 1000 <= Date.now()
      )
        throw new Error("Stale");
      this.ctx.storage.transactionSync(() => {
        this.put("pair", { ...latest.offer, viewerSignature, revoked: false });
        this.drop("pending");
      });
      return json({ state: "paired", grant: this.get<Pair>("pair") });
    } catch {
      return json({ error: "Rejected" }, 400);
    }
  }
  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    try {
      const attachment = ws.deserializeAttachment() as Attachment;
      const pair = this.get<Pair>("pair");
      if (!pair || pair.revoked) throw new Error("Unavailable");
      if (!attachment.role) {
        if (
          attachment.working ||
          typeof message !== "string" ||
          message.length > 2048 ||
          attachment.deadline <= Date.now()
        )
          throw new Error("Auth");
        ws.serializeAttachment({ ...attachment, working: true });
        const auth = JSON.parse(message);
        if (
          auth.id !== pair.id ||
          (auth.role !== "phone" && auth.role !== "viewer") ||
          auth.mode !== undefined ||
          auth.requestId !== undefined
        )
          throw new Error("Role");
        const role = auth.role as "phone" | "viewer";
        await verifySignature(
          pair[role],
          authBytes(this.env.PUBLIC_ORIGIN, pair.id, role, attachment.nonce),
          auth.signature,
        );
        if (
          this.get<Pair>("pair")?.revoked ||
          this.sockets(role).length ||
          ws.readyState !== WebSocket.OPEN ||
          !this.ctx.getWebSockets().includes(ws)
        )
          throw new Error("Stale");
        ws.serializeAttachment({
          ...attachment,
          role,
          deadline: Date.now() + 3600000,
        } satisfies Attachment);
        ws.send(JSON.stringify({ type: "authenticated" }));
        if (this.sockets("phone").length && this.sockets("viewer").length)
          for (const peer of this.sockets()) {
            if ((peer.deserializeAttachment() as Attachment).role)
              peer.send(JSON.stringify({ type: "ready" }));
          }
        await this.schedule();
        return;
      }
      if (
        typeof message === "string" ||
        message.byteLength > 1048608 ||
        attachment.deadline <= Date.now()
      )
        throw new Error("Record");
      const peer = this.sockets(
        attachment.role === "phone" ? "viewer" : "phone",
      )[0];
      if (!peer) throw new Error("Peer");
      peer.send(message);
    } catch {
      ws.close(4003, "Rejected");
    }
  }
  webSocketClose(ws: WebSocket, code: number) {
    // Closing one route never leaves records queued for a reconnect.
    const role = (ws.deserializeAttachment() as Attachment).role;
    if (role && this.sockets(role).length === 0) this.disconnect();
    ws.close(code === 1005 ? 1000 : code);
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "Transport");
  }
  private async schedule() {
    const deadlines = this.sockets().map(
      (ws) => (ws.deserializeAttachment() as Attachment).deadline,
    );
    const pending = this.get<Pending>("pending");
    if (pending) deadlines.push(pending.expires * 1000);
    if (deadlines.length)
      await this.ctx.storage.setAlarm(
        Math.max(Date.now() + 1, Math.min(...deadlines)),
      );
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    const now = Date.now();
    if ((this.get<Pending>("pending")?.expires ?? Infinity) * 1000 <= now)
      this.drop("pending");
    for (const ws of this.sockets())
      if ((ws.deserializeAttachment() as Attachment).deadline <= now)
        ws.close(4003, "Expired");
    await this.schedule();
  }
}
