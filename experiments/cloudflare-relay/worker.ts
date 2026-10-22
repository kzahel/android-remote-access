/** Isolated product proof. Gated admission; no production route or anonymous access. */
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
import { deliverFcm } from "./fcm.js";

type Env = {
  PAIRINGS: DurableObjectNamespace<Pairing>;
  PUBLIC_ORIGIN: string;
  ASSETS?: Fetcher;
  WAKE_BUDGET?: DurableObjectNamespace;
  FCM_PROJECT?: string;
  FCM_ACCESS_TOKEN?: string;
  FCM_TOKEN_EXPIRES?: string;
  PROOF_KEY?: string;
  PROOF_EXPIRES?: string;
  PROOF_BUILD?: string;
};
type Pair = Grant & {
  viewerSignature: string;
  revoked: boolean;
  accessEnabled?: boolean;
  accessGeneration?: string;
};
type Target = { fid: string; generation?: string };
type Wake = {
  requestId: string;
  expires: number;
  viewer: string;
  retryAt?: number;
};
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
  session: string;
  management?: boolean;
  policyUpdated?: boolean;
  pushUpdated?: boolean;
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
    if (
      !env.PROOF_KEY ||
      (req.headers.get("X-Proof-Key") ??
        req.headers
          .get("Cookie")
          ?.match(
            /(?:^|;\s*)__Host-yepcontrol-proof=([0-9a-f]{64})(?:;|$)/,
          )?.[1]) !== env.PROOF_KEY ||
      (env.PROOF_EXPIRES !== undefined &&
        (!Number.isFinite(Number(env.PROOF_EXPIRES)) ||
          Date.now() >= Number(env.PROOF_EXPIRES)))
    )
      return json({ error: "Proof only" }, 403);
    if (
      req.headers.has("Origin") &&
      req.headers.get("Origin") !== env.PUBLIC_ORIGIN
    )
      return json({ error: "Origin" }, 403);
    const url = new URL(req.url);
    if (
      !url.pathname.startsWith("/api/") &&
      !url.pathname.startsWith("/_proof/")
    ) {
      if (!env.ASSETS) return json({ error: "No viewer" }, 404);
      if (url.pathname === "/enroll" || url.pathname === "/install")
        url.pathname = "/install.html";
      else if (
        !url.pathname.startsWith("/assets/") &&
        !url.pathname.includes(".")
      )
        url.pathname = "/viewer.html";
      return env.ASSETS.fetch(new Request(url, req));
    }
    const api = url.pathname.match(
      /^\/api\/pair\/([0-9a-f]{32})(?:\/(offer|complete|revoke))?$/,
    );
    const diagnostic = url.pathname.match(/^\/_proof\/([0-9a-f]{32})$/);
    const id =
      api?.[1] ??
      diagnostic?.[1] ??
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
  private readonly boot = crypto.randomUUID();
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
          (!role ||
            ((ws.deserializeAttachment() as Attachment).role === role &&
              !(ws.deserializeAttachment() as Attachment).management)),
      );
  }
  private disconnect(viewerCode = 4001) {
    this.drop("wake");
    for (const ws of this.sockets()) {
      const attachment = ws.deserializeAttachment() as Attachment;
      if (attachment.role && !attachment.management)
        ws.close(attachment.role === "viewer" ? viewerCode : 4001, "Reconnect");
    }
  }
  async fetch(req: Request): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/_proof/") && req.method === "GET") {
      return json({
        boot: this.boot,
        build: this.env.PROOF_BUILD ?? "local",
        sockets: this.ctx.getWebSockets().length,
        authenticated: this.sockets().filter(
          (ws) => (ws.deserializeAttachment() as Attachment).role !== undefined,
        ).length,
        revoked: this.get<Pair>("pair")?.revoked ?? false,
      });
    }
    if (url.pathname === "/api/socket") {
      if (
        req.headers.get("Upgrade") !== "websocket" ||
        this.ctx.getWebSockets().length >= 8
      )
        return json({ error: "Unavailable" }, 429);
      const pair = new WebSocketPair();
      const server = pair[1];
      this.ctx.acceptWebSocket(server);
      server.serializeAttachment({
        session: crypto.randomUUID(),
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
        this.ctx.storage.transactionSync(() => {
          this.put("pair", { ...latest, revoked: true });
          this.drop("target");
          this.drop("wake");
        });
        this.disconnect(4010);
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
      let attachment = ws.deserializeAttachment() as Attachment;
      const pair = this.get<Pair>("pair");
      if (!pair) throw new Error("Unavailable");
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
          (auth.role !== "phone" && auth.role !== "viewer")
        )
          throw new Error("Role");
        const role = auth.role as "phone" | "viewer";
        await verifySignature(
          pair[role],
          authBytes(this.env.PUBLIC_ORIGIN, pair.id, role, attachment.nonce),
          auth.signature,
        );
        const latest = this.get<Pair>("pair");
        if (latest?.revoked && role === "viewer") {
          ws.close(4010, "Access removed");
          return;
        }
        if (
          !latest ||
          latest.revoked ||
          ws.readyState !== WebSocket.OPEN ||
          !this.ctx.getWebSockets().includes(ws)
        )
          throw new Error("Stale");
        const management = auth.mode !== undefined;
        if (management) {
          if (
            role !== "phone" ||
            auth.mode !== "registration" ||
            auth.requestId !== undefined ||
            this.sockets().some((peer) => {
              const value = peer.deserializeAttachment() as Attachment;
              return value.role === "phone" && value.management;
            })
          )
            throw new Error("Management");
        } else {
          if (latest.accessEnabled === false && role === "viewer") {
            ws.close(4011, "Access paused");
            return;
          }
          if (
            latest.accessEnabled === false ||
            (role === "phone" &&
              latest.accessGeneration !== undefined &&
              auth.generation !== latest.accessGeneration) ||
            this.sockets(role).length
          )
            throw new Error("Access or duplicate");
          if (auth.requestId !== undefined) {
            const wake = this.get<Wake>("wake"),
              viewer = this.sockets("viewer")[0];
            if (
              role !== "phone" ||
              !wake ||
              !viewer ||
              wake.requestId !== auth.requestId ||
              wake.expires * 1000 <= Date.now() ||
              (viewer.deserializeAttachment() as Attachment).session !==
                wake.viewer
            )
              throw new Error("Stale wake");
          }
        }
        attachment = {
          ...attachment,
          role,
          management,
          deadline: Date.now() + 3600000,
        };
        ws.serializeAttachment(attachment);
        ws.send(JSON.stringify({ type: "authenticated" }));
        if (!management) {
          if (this.sockets("phone").length && this.sockets("viewer").length) {
            this.drop("wake");
            for (const peer of [
              ...this.sockets("phone"),
              ...this.sockets("viewer"),
            ])
              peer.send(JSON.stringify({ type: "ready" }));
          } else if (role === "viewer" && this.env.FCM_ACCESS_TOKEN) {
            this.put("wake", {
              requestId: hex(crypto.getRandomValues(new Uint8Array(16))),
              expires: Math.floor(Date.now() / 1000) + 60,
              viewer: attachment.session,
            });
            await this.attemptWake();
          }
        }
        await this.schedule();
        return;
      }
      if (pair.revoked || attachment.deadline <= Date.now())
        throw new Error("Unavailable");
      if (typeof message === "string") {
        if (attachment.role !== "phone" || message.length > 512)
          throw new Error("Metadata");
        const value = JSON.parse(message);
        if (value.type === "setAccess") {
          if (
            !attachment.management ||
            attachment.policyUpdated ||
            typeof value.enabled !== "boolean" ||
            typeof value.generation !== "string"
          )
            throw new Error("Policy");
          fromHex(value.generation, 16);
          if (
            pair.accessGeneration !== value.generation ||
            pair.accessEnabled !== value.enabled
          ) {
            const first = pair.accessGeneration === undefined;
            this.ctx.storage.transactionSync(() => {
              this.put("pair", {
                ...pair,
                accessEnabled: value.enabled,
                accessGeneration: value.generation,
              });
              if (!first || !value.enabled) this.drop("target");
            });
            if (!first || !value.enabled)
              this.disconnect(value.enabled ? 4001 : 4011);
          }
          ws.serializeAttachment({ ...attachment, policyUpdated: true });
          ws.send(JSON.stringify({ type: "accessUpdated" }));
          return;
        }
        if (attachment.pushUpdated) throw new Error("Already registered");
        if (value.type === "registerPush") {
          if (
            typeof value.fid !== "string" ||
            !/^[cdef][A-Za-z0-9_-]{21}$/.test(value.fid)
          )
            throw new Error("Target");
          this.put("target", {
            fid: value.fid,
            ...(pair.accessGeneration
              ? { generation: pair.accessGeneration }
              : {}),
          });
        } else if (value.type === "unregisterPush") this.drop("target");
        else throw new Error("Metadata");
        ws.serializeAttachment({ ...attachment, pushUpdated: true });
        ws.send(
          JSON.stringify({
            type:
              value.type === "registerPush" ? "pushRegistered" : "pushRemoved",
          }),
        );
        return;
      }
      if (
        attachment.management ||
        pair.accessEnabled === false ||
        message.byteLength > 1048608
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
  async webSocketClose(ws: WebSocket, code: number) {
    const attachment = ws.deserializeAttachment() as Attachment;
    if (
      attachment.role &&
      !attachment.management &&
      this.sockets(attachment.role).length === 0
    )
      this.disconnect();
    // 1005/1006 are observations, never legal close-frame status codes.
    ws.close([1004, 1005, 1006, 1015].includes(code) ? 1000 : code);
    await this.schedule();
  }
  webSocketError(ws: WebSocket) {
    ws.close(1011, "Transport");
  }
  private async attemptWake() {
    const wake = this.get<Wake>("wake"),
      viewer = this.sockets("viewer")[0],
      pair = this.get<Pair>("pair"),
      target = this.get<Target>("target");
    if (
      !wake ||
      !viewer ||
      (viewer.deserializeAttachment() as Attachment).session !== wake.viewer ||
      this.sockets("phone").length ||
      !pair ||
      pair.revoked ||
      pair.accessEnabled === false
    ) {
      this.drop("wake");
      return;
    }
    if (wake.expires * 1000 <= Date.now()) {
      this.disconnect();
      return;
    }
    if (!target) {
      this.put("wake", { ...wake, retryAt: undefined });
      viewer.send(
        JSON.stringify({ type: "contacting", delivery: "unregistered" }),
      );
      return;
    }
    const until = this.get<number>("cooldown") ?? 0;
    if (until > Date.now()) {
      this.put("wake", { ...wake, retryAt: until });
      viewer.send(
        JSON.stringify({ type: "contacting", delivery: "coalesced" }),
      );
      return;
    }
    this.put("wake", { ...wake, retryAt: undefined });
    this.put("cooldown", Date.now() + 30000);
    let delivery: "accepted" | "invalid_target" | "unavailable" = "unavailable";
    try {
      const budget = await this.env.WAKE_BUDGET?.getByName("global").fetch(
        "https://budget.invalid/",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fid: target.fid }),
        },
      );
      const latest = this.get<Wake>("wake"),
        authority = this.get<Pair>("pair");
      if (
        !latest ||
        latest.requestId !== wake.requestId ||
        !authority ||
        authority.revoked ||
        authority.accessEnabled === false ||
        this.sockets("phone").length ||
        viewer.readyState !== WebSocket.OPEN ||
        !this.sockets("viewer").includes(viewer) ||
        latest.expires * 1000 <= Date.now() ||
        this.get<Target>("target")?.fid !== target.fid ||
        this.get<Target>("target")?.generation !== target.generation
      )
        return;
      if (budget?.ok)
        delivery = await deliverFcm(
          this.env.FCM_PROJECT,
          this.env.FCM_ACCESS_TOKEN,
          this.env.FCM_TOKEN_EXPIRES,
          target.fid,
          {
            intent: "connect-v1",
            requestId: wake.requestId,
            expires: String(wake.expires),
            ...(target.generation
              ? { pairingId: pair.id, generation: target.generation }
              : {}),
          },
        );
      if (
        delivery === "invalid_target" &&
        this.get<Target>("target")?.fid === target.fid &&
        this.get<Target>("target")?.generation === target.generation
      )
        this.drop("target");
    } catch {}
    if (
      this.get<Wake>("wake")?.requestId === wake.requestId &&
      viewer.readyState === WebSocket.OPEN
    )
      viewer.send(JSON.stringify({ type: "contacting", delivery }));
  }
  private async schedule() {
    const deadlines = this.sockets().map(
      (ws) => (ws.deserializeAttachment() as Attachment).deadline,
    );
    const pending = this.get<Pending>("pending"),
      wake = this.get<Wake>("wake");
    if (pending) deadlines.push(pending.expires * 1000);
    if (wake) {
      deadlines.push(wake.expires * 1000);
      if (wake.retryAt) deadlines.push(wake.retryAt);
    }
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
    const wake = this.get<Wake>("wake");
    if (
      wake &&
      (wake.expires * 1000 <= now ||
        (wake.retryAt !== undefined && wake.retryAt <= now))
    )
      await this.attemptWake();
    await this.schedule();
  }
}

/** Small proof-wide send budget. Only the Pairing class can reach this binding. */
export class WakeBudget extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS budget (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)",
    );
  }
  async fetch(req: Request) {
    const value = await body(req),
      fid = text(value.fid),
      now = Date.now();
    const sql = this.ctx.storage.sql;
    const admitted = this.ctx.storage.transactionSync(() => {
      sql.exec("DELETE FROM budget WHERE until <= ?", now);
      for (const [key, limit] of [
        ["global", 100],
        [`fid:${fid}`, 10],
      ] as const) {
        const row = sql
          .exec<{ count: number }>(
            "SELECT count FROM budget WHERE key = ?",
            key,
          )
          .toArray()[0];
        if ((row?.count ?? 0) >= limit) return false;
      }
      for (const key of ["global", `fid:${fid}`])
        sql.exec(
          "INSERT INTO budget VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = count + 1",
          key,
          now + 60000,
        );
      return true;
    });
    return json({ admitted }, admitted ? 200 : 429);
  }
}
