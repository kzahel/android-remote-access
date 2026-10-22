import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { backup, DatabaseSync } from "node:sqlite";
import { b64, createIdentity } from "@remote/protocol";
import { afterEach, beforeEach, expect, it } from "vitest";
import { RelayState, type Stored } from "../src/state.js";

let directory: string;
let row: Stored;
const states: RelayState[] = [];
function open() {
  const state = new RelayState(directory);
  states.push(state);
  return state;
}
beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "relay-state-"));
  const key = b64((await createIdentity()).publicKey);
  row = {
    id: "ab".repeat(16),
    phone: key,
    viewer: key,
    expires: 1,
    phoneSignature: "fixture",
    viewerSignature: "fixture",
    mac: "fixture",
    revoked: false,
    accessEnabled: false,
    accessGeneration: "cd".repeat(16),
  };
});
afterEach(async () => {
  for (const state of states.splice(0)) state.close();
  await rm(directory, { recursive: true, force: true });
});
async function legacy(pair = row) {
  await writeFile(
    path.join(directory, "pairings-v1.json"),
    JSON.stringify({ version: 1, pairs: { [pair.id]: pair } }),
  );
  await writeFile(
    path.join(directory, "push-registrations-v1.json"),
    JSON.stringify({
      version: 1,
      targets: {
        [pair.id]: {
          fid: `c${"a".repeat(21)}`,
          generation: pair.accessGeneration,
        },
      },
    }),
  );
}
it("imports legacy policy, keys and tombstones once, without replaying stale JSON", async () => {
  await legacy();
  const state = open();
  expect(state.pairs()[row.id]).toEqual(row);
  expect(state.targets()[row.id]?.generation).toBe(row.accessGeneration);
  row.revoked = true;
  state.revoke(row);
  const restored = open();
  expect(restored.pairs()[row.id]?.revoked).toBe(true);
  expect(restored.targets()[row.id]).toBeUndefined();
  expect((await stat(path.join(directory, "relay.sqlite"))).mode & 0o777).toBe(
    0o600,
  );
  expect(state.db.prepare("PRAGMA synchronous").get()?.synchronous).toBe(2);
});
it("imports no push target for a legacy revoked pairing", async () => {
  row.revoked = true;
  await legacy();
  expect(open().targets()).toEqual({});
});
it("rolls back a partial legacy import and retries after repair", async () => {
  await legacy();
  await writeFile(path.join(directory, "push-registrations-v1.json"), "{}");
  expect(() => new RelayState(directory)).toThrow();
  await legacy();
  expect(open().pairs()).toEqual({ [row.id]: row });
});
it("keeps enrollment budgets across restart, permits recovery after the rolling hour, and retains tombstones", () => {
  const state = open();
  for (let i = 0; i < 100; i++)
    state.putPair({
      ...row,
      id: i.toString(16).padStart(32, "0"),
      revoked: true,
    });
  expect(open().canEnroll()).toBe(false);
  expect(state.canEnroll(Date.now() + 3600001)).toBe(true);
  expect(Object.keys(state.pairs())).toHaveLength(100);
});
it("creates a consistent online backup with authority and private push metadata", async () => {
  const state = open();
  state.putPair(row);
  state.putTarget(row.id, { fid: `c${"a".repeat(21)}` });
  const file = path.join(directory, "snapshot.sqlite");
  await backup(state.db, file);
  const snapshot = new DatabaseSync(file, { readOnly: true });
  expect(snapshot.prepare("PRAGMA quick_check").get()?.quick_check).toBe("ok");
  expect(snapshot.prepare("SELECT count(*) AS n FROM pairings").get()?.n).toBe(
    1,
  );
  expect(snapshot.prepare("SELECT count(*) AS n FROM push").get()?.n).toBe(1);
  snapshot.close();
  expect((await readFile(file)).subarray(0, 15).toString()).toBe(
    "SQLite format 3",
  );
});
