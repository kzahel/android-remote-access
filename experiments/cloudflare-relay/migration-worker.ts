/** Deploy temporarily with bindings to the destination Worker; delete after verified import. */
import type { Admission } from "./admission.js";
import {
  digest,
  IMPORT_BATCH_SIZE,
  requireMigration,
  type MigrationEnv,
  type Snapshot,
  validateSnapshot,
} from "./migration.js";
import type { Pairing } from "./worker.js";
type Env = MigrationEnv & {
  PUBLIC_ORIGIN: string;
  MIGRATION_TOKEN: string;
  PAIRINGS: DurableObjectNamespace<Pairing>;
  ADMISSION: DurableObjectNamespace<Admission>;
};
export default {
  async fetch(req: Request, env: Env) {
    if (
      req.method !== "POST" ||
      new URL(req.url).pathname !== "/import" ||
      !env.MIGRATION_TOKEN ||
      req.headers.get("Authorization") !== `Bearer ${env.MIGRATION_TOKEN}`
    )
      return new Response(null, { status: 404 });
    try {
      // Bound before parsing; imported credentials/targets never enter logs or responses.
      const reader = req.body?.getReader();
      if (!reader) throw new Error("Body");
      const chunks: Uint8Array[] = [];
      let size = 0;
      for (;;) {
        const next = await reader.read();
        if (next.done) break;
        size += next.value.length;
        if (size > 8 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("Size");
        }
        chunks.push(next.value);
      }
      const bytes = new Uint8Array(size);
      let byteOffset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, byteOffset);
        byteOffset += chunk.length;
      }
      const raw = new TextDecoder().decode(bytes);
      const hash = await digest(raw);
      requireMigration(env, hash);
      const snapshot = JSON.parse(raw) as Snapshot;
      await validateSnapshot(snapshot, env.PUBLIC_ORIGIN);
      // Validate everything before allocating destination objects. Sequential RPCs
      // keep subrequests bounded; identical retries resume without replacing authority.
      const parameter = new URL(req.url).searchParams.get("offset") ?? "0";
      if (!/^(0|[1-9][0-9]*)$/.test(parameter)) throw new Error("Offset");
      const offset = Number(parameter);
      if (
        !Number.isSafeInteger(offset) ||
        offset % IMPORT_BATCH_SIZE ||
        offset < 0 ||
        (offset >= snapshot.rows.length &&
          !(offset === 0 && snapshot.rows.length === 0))
      )
        throw new Error("Offset");
      const batch = snapshot.rows.slice(offset, offset + IMPORT_BATCH_SIZE);
      for (const row of batch) {
        const result = await env.PAIRINGS.getByName(row.pair.id).importState(
          row,
          hash,
        );
        if (result !== (await digest(JSON.stringify(row))))
          throw new Error("Pair verification");
      }
      const routes = snapshot.rows.map((row) => ({
        id: row.pair.id,
        created: row.created,
      }));
      await env.ADMISSION.getByName("global").importBatch(
        offset,
        routes.slice(offset, offset + IMPORT_BATCH_SIZE),
        routes.length,
        hash,
      );
      const nextOffset = Math.min(
        offset + IMPORT_BATCH_SIZE,
        snapshot.rows.length,
      );
      if (nextOffset < snapshot.rows.length)
        return Response.json({ sha256: hash, nextOffset, verified: false });
      await env.ADMISSION.getByName("global").importRoutes(routes, hash);
      return Response.json({
        sha256: hash,
        pairs: snapshot.rows.length,
        revoked: snapshot.rows.filter((row) => row.pair.revoked).length,
        paused: snapshot.rows.filter((row) => row.pair.accessEnabled === false)
          .length,
        targets: snapshot.rows.filter((row) => row.target).length,
        verified: true,
      });
    } catch {
      return Response.json(
        { error: "Import refused; destination stays in maintenance" },
        { status: 409 },
      );
    }
  },
} satisfies ExportedHandler<Env>;
