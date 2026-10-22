import { DurableObject } from "cloudflare:workers";
import { digest, requireMigration, type MigrationEnv } from "./migration.js";

type Env = MigrationEnv & {
  PAIRING_CAPACITY?: string;
  PAIRING_STARTS_PER_HOUR?: string;
  REQUESTS_PER_MINUTE?: string;
  SOCKET_CAPACITY?: string;
};
function bound(value: string | undefined, maximum: number): number {
  const parsed = value === undefined ? maximum : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum)
    throw new Error("Invalid admission bound");
  return parsed;
}

/** One bounded directory, never one object for an arbitrary unauthenticated ID.
 * Reservations are never discarded: failed/abandoned starts also consume capacity.
 * These conservative staging limits contain growth; they do not provide fair
 * anonymous enrollment or cap the cost of incoming edge requests.
 */
export class Admission extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS routes (id TEXT PRIMARY KEY, created INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE INDEX IF NOT EXISTS routes_created ON routes(created)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS budgets (key TEXT PRIMARY KEY, count INTEGER NOT NULL, until INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS sockets (lease TEXT PRIMARY KEY, until INTEGER NOT NULL)",
    );
    ctx.storage.sql.exec(
      "CREATE TABLE IF NOT EXISTS migration (hash TEXT PRIMARY KEY, manifest TEXT NOT NULL)",
    );
  }
  async importRoutes(
    rows: { id: string; created: number }[],
    manifest: string,
  ) {
    requireMigration(this.env, manifest);
    if (
      rows.length > bound(this.env.PAIRING_CAPACITY, 10000) ||
      new Set(rows.map((row) => row.id)).size !== rows.length ||
      rows.some(
        (row) =>
          !/^[0-9a-f]{32}$/.test(row.id) ||
          !Number.isSafeInteger(row.created) ||
          row.created < 0,
      )
    )
      throw new Error("Invalid routes");
    const sorted = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    const hash = await digest(JSON.stringify(sorted));
    requireMigration(this.env, manifest);
    const sql = this.ctx.storage.sql;
    this.ctx.storage.transactionSync(() => {
      const marker = sql
        .exec<{ hash: string; manifest: string }>(
          "SELECT hash, manifest FROM migration",
        )
        .toArray()[0];
      if (marker) {
        if (marker.hash !== hash || marker.manifest !== manifest)
          throw new Error("Different import");
        return;
      }
      if (
        sql.exec("SELECT id FROM routes LIMIT 1").toArray().length ||
        sql.exec("SELECT lease FROM sockets LIMIT 1").toArray().length
      )
        throw new Error("Destination is not empty");
      for (const row of rows)
        sql.exec("INSERT INTO routes VALUES (?, ?)", row.id, row.created);
      sql.exec("INSERT INTO migration VALUES (?, ?)", hash, manifest);
    });
    const observed = sql
      .exec<{ id: string; created: number }>(
        "SELECT id, created FROM routes ORDER BY id",
      )
      .toArray();
    if ((await digest(JSON.stringify(observed))) !== hash)
      throw new Error("Imported routes changed");
    return hash;
  }
  async fetch(req: Request): Promise<Response> {
    const { id, create, upgrade, lease } = (await req.json()) as {
      id: string;
      create: boolean;
      upgrade: boolean;
      lease?: string;
    };
    if (new URL(req.url).pathname === "/release") {
      if (typeof lease !== "string") return new Response(null, { status: 400 });
      this.ctx.storage.sql.exec("DELETE FROM sockets WHERE lease = ?", lease);
      return new Response(null, { status: 200 });
    }
    if (!/^[0-9a-f]{32}$/.test(id)) return new Response(null, { status: 400 });
    const capacity = bound(this.env.PAIRING_CAPACITY, 10000);
    const starts = bound(this.env.PAIRING_STARTS_PER_HOUR, 100);
    const requests = bound(this.env.REQUESTS_PER_MINUTE, 3000);
    const socketCapacity = bound(this.env.SOCKET_CAPACITY, 128);
    const newLease = crypto.randomUUID();
    const now = Date.now();
    const sql = this.ctx.storage.sql;
    const status = this.ctx.storage.transactionSync(() => {
      const take = (key: string, limit: number) => {
        const row = sql
          .exec<{ count: number; until: number }>(
            "SELECT count, until FROM budgets WHERE key = ?",
            key,
          )
          .toArray()[0];
        if (row && row.until > now && row.count >= limit) return false;
        sql.exec(
          "INSERT INTO budgets VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count = CASE WHEN until > ? THEN count + 1 ELSE 1 END, until = CASE WHEN until > ? THEN until ELSE excluded.until END",
          key,
          now + 60000,
          now,
          now,
        );
        return true;
      };
      if (!take("requests", requests) || (upgrade && !take("upgrades", 60)))
        return 429;
      const existing = sql
        .exec("SELECT id FROM routes WHERE id = ?", id)
        .toArray()[0];
      if (existing) {
        if (upgrade) {
          sql.exec("DELETE FROM sockets WHERE until <= ?", now);
          const count = sql
            .exec<{ count: number }>("SELECT COUNT(*) AS count FROM sockets")
            .one().count;
          if (count >= socketCapacity) return 429;
          // A connection can authenticate for ten seconds, then run for one hour.
          sql.exec(
            "INSERT INTO sockets VALUES (?, ?)",
            newLease,
            now + 3620000,
          );
        }
        return 200;
      }
      if (!create) return 404;
      const count = (where = "", ...values: number[]) =>
        sql
          .exec<{ count: number }>(
            `SELECT COUNT(*) AS count FROM routes ${where}`,
            ...values,
          )
          .one().count;
      if (
        count() >= capacity ||
        count("WHERE created > ?", now - 3600000) >= starts
      )
        return 429;
      sql.exec("INSERT INTO routes VALUES (?, ?)", id, now);
      return 200;
    });
    return new Response(null, {
      status,
      headers: {
        "Cache-Control": "no-store",
        ...(status === 429 ? { "Retry-After": "60" } : {}),
        ...(status === 200 && upgrade ? { "X-Relay-Lease": newLease } : {}),
      },
    });
  }
}
