/** One-time, fail-closed Node -> Durable Object authority transfer. No public relay route. */
import {
  fromHex,
  grantBytes,
  hex,
  type Grant,
  verifySignature,
} from "../../protocol/src/enrollment.js";

export type Pair = Grant & {
  viewerSignature: string;
  revoked: boolean;
  accessEnabled?: boolean;
  accessGeneration?: string;
};
export type Target = { fid: string; generation?: string };
export type MigrationRow = { pair: Pair; created: number; target?: Target };
export type Snapshot = { version: 1; origin: string; rows: MigrationRow[] };
export type MigrationEnv = {
  RELAY_MODE?: string;
  MIGRATION_SHA256?: string;
  MIGRATION_EXPIRES?: string;
};
export async function digest(value: string): Promise<string> {
  return hex(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)),
    ),
  );
}
export function requireMigration(env: MigrationEnv, hash: string) {
  if (
    env.RELAY_MODE !== "maintenance" ||
    !/^[0-9a-f]{64}$/.test(hash) ||
    env.MIGRATION_SHA256 !== hash ||
    !Number.isSafeInteger(Number(env.MIGRATION_EXPIRES)) ||
    Number(env.MIGRATION_EXPIRES) <= Date.now()
  )
    throw new Error("Migration disabled");
}
export async function validateRow(row: MigrationRow, origin: string) {
  const p = row.pair;
  fromHex(p.id, 16);
  fromHex(p.mac, 32);
  if (
    !Number.isSafeInteger(row.created) ||
    row.created < 0 ||
    !Number.isSafeInteger(p.expires) ||
    typeof p.revoked !== "boolean" ||
    (p.accessEnabled === undefined) !== (p.accessGeneration === undefined) ||
    (p.accessEnabled !== undefined && typeof p.accessEnabled !== "boolean")
  )
    throw new Error("Invalid authority");
  if (p.accessGeneration !== undefined) fromHex(p.accessGeneration, 16);
  await verifySignature(p.phone, grantBytes(origin, p), p.phoneSignature);
  await verifySignature(p.viewer, grantBytes(origin, p), p.viewerSignature);
  if (row.target) {
    if (p.revoked || !/^[cdef][A-Za-z0-9_-]{21}$/.test(row.target.fid))
      throw new Error("Invalid target");
    if (row.target.generation !== undefined) {
      fromHex(row.target.generation, 16);
      if (row.target.generation !== p.accessGeneration)
        throw new Error("Stale target");
    }
  }
}
export async function validateSnapshot(snapshot: Snapshot, origin: string) {
  if (
    snapshot.version !== 1 ||
    snapshot.origin !== origin ||
    !Array.isArray(snapshot.rows) ||
    snapshot.rows.length > 500
  )
    throw new Error("Invalid snapshot");
  const ids = new Set<string>();
  for (const row of snapshot.rows) {
    if (ids.has(row.pair.id)) throw new Error("Duplicate ID");
    ids.add(row.pair.id);
    await validateRow(row, origin);
  }
}
