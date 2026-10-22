import { chmodSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fromHex, type Grant, keyBytes } from "@remote/protocol/enrollment";

export type Stored = Grant & {
  viewerSignature: string;
  revoked: boolean;
  accessEnabled?: boolean;
  accessGeneration?: string;
};
export type Target = { fid: string; generation?: string };
function validatePair(id: string, row: Stored) {
  fromHex(id, 16);
  keyBytes(row.phone);
  keyBytes(row.viewer);
  if (row.id !== id || typeof row.revoked !== "boolean")
    throw new Error("Invalid authority state");
  if (row.accessEnabled !== undefined && typeof row.accessEnabled !== "boolean")
    throw new Error("Invalid access policy");
  if (row.accessGeneration !== undefined) fromHex(row.accessGeneration, 16);
  if (
    (row.accessEnabled === undefined) !==
    (row.accessGeneration === undefined)
  )
    throw new Error("Incomplete access policy");
}
function validateTarget(id: string, target: Target) {
  fromHex(id, 16);
  if (!/^[cdef][A-Za-z0-9_-]{21}$/.test(target.fid))
    throw new Error("Invalid push state");
  if (target.generation !== undefined) fromHex(target.generation, 16);
}

/** One process owns this directory. SQLite is authority; JSON is imported once. */
export class RelayState {
  readonly db: DatabaseSync;
  constructor(directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = path.join(directory, "relay.sqlite");
    this.db = new DatabaseSync(file);
    chmodSync(file, 0o600);
    try {
      this.db.exec(`
        PRAGMA synchronous = FULL;
        PRAGMA journal_mode = DELETE;
        PRAGMA busy_timeout = 1000;
        CREATE TABLE IF NOT EXISTS pairings (
          id TEXT PRIMARY KEY, value TEXT NOT NULL, created INTEGER NOT NULL
        ) STRICT;
        CREATE INDEX IF NOT EXISTS pairing_created ON pairings(created);
        CREATE TABLE IF NOT EXISTS push (id TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
        CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL) STRICT;
      `);
      if (
        !this.db
          .prepare("SELECT value FROM metadata WHERE key = 'imported'")
          .get()
      ) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
          const pairs = this.legacy(directory, "pairings-v1.json", "pairs");
          const targets = this.legacy(
            directory,
            "push-registrations-v1.json",
            "targets",
          );
          for (const [id, value] of Object.entries(pairs)) {
            const row = value as Stored;
            validatePair(id, row);
            this.db
              .prepare("INSERT INTO pairings VALUES (?, ?, 0)")
              .run(id, JSON.stringify(row));
          }
          for (const [id, value] of Object.entries(targets)) {
            const target = (
              typeof value === "string" ? { fid: value } : value
            ) as Target;
            validateTarget(id, target);
            // Never restore a push route for a revoked pairing.
            if ((pairs[id] as Stored | undefined)?.revoked) continue;
            this.putTarget(id, target);
          }
          this.db.exec("INSERT INTO metadata VALUES ('imported', '1'); COMMIT");
        } catch (error) {
          this.db.exec("ROLLBACK");
          throw error;
        }
      }
      // Fail startup on invalid persisted authority, including imported state.
      for (const [id, row] of Object.entries(this.pairs()))
        validatePair(id, row);
      for (const [id, target] of Object.entries(this.targets()))
        validateTarget(id, target);
    } catch (error) {
      this.db.close();
      throw error;
    }
  }
  private legacy(
    directory: string,
    file: string,
    field: string,
  ): Record<string, unknown> {
    const filename = path.join(directory, file);
    if (!existsSync(filename)) return {};
    const saved = JSON.parse(readFileSync(filename, "utf8"));
    if (
      saved.version !== 1 ||
      !saved[field] ||
      typeof saved[field] !== "object" ||
      Array.isArray(saved[field]) ||
      Object.keys(saved[field]).length > 10000
    )
      throw new Error("Invalid legacy relay state");
    return saved[field];
  }
  pairs(): Record<string, Stored> {
    return Object.fromEntries(
      this.db
        .prepare("SELECT id, value FROM pairings")
        .all()
        .map((row) => [row.id, JSON.parse(String(row.value))]),
    );
  }
  targets(): Record<string, Target> {
    return Object.fromEntries(
      this.db
        .prepare("SELECT id, value FROM push")
        .all()
        .map((row) => [row.id, JSON.parse(String(row.value))]),
    );
  }
  canEnroll(now = Date.now()): boolean {
    const total = this.db.prepare("SELECT count(*) AS n FROM pairings").get();
    const recent = this.db
      .prepare("SELECT count(*) AS n FROM pairings WHERE created > ?")
      .get(now - 3600000);
    return Number(total?.n) < 10000 && Number(recent?.n) < 100;
  }
  putPair(row: Stored) {
    this.db
      .prepare(`INSERT INTO pairings VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value = excluded.value`)
      .run(row.id, JSON.stringify(row), Date.now());
  }
  revoke(row: Stored) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.putPair(row);
      this.removeTarget(row.id);
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  putTarget(id: string, target: Target) {
    this.db
      .prepare(
        "INSERT INTO push VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value = excluded.value",
      )
      .run(id, JSON.stringify(target));
  }
  removeTarget(id: string) {
    this.db.prepare("DELETE FROM push WHERE id = ?").run(id);
  }
  close() {
    this.db.close();
  }
}
