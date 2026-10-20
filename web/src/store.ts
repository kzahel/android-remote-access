import { type Identity, identityFromKeys } from "@remote/protocol";
import { type Grant, keyBytes } from "@remote/protocol/enrollment";

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("remote-access-v1", 2);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    if (!db.objectStoreNames.contains("phones"))
      db.createObjectStore("phones", { keyPath: "id" });
  };
  request.onsuccess = () => {
    request.result.onversionchange = () => request.result.close();
    resolve(request.result);
  };
  request.onerror = () => reject(request.error);
  request.onblocked = () =>
    reject(new Error("Close older tabs for this site, then reload."));
});
async function read<T>(name: string): Promise<T | undefined> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction("state").objectStore("state").get(name);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
let cached: Promise<Identity> | undefined;
export function browserIdentity(): Promise<Identity> {
  cached ??= (async () => {
    let keys = await read<CryptoKeyPair>("identity");
    if (!keys) {
      const candidate = await crypto.subtle.generateKey(
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["sign", "verify"],
      );
      const db = await database;
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction("state", "readwrite");
        const store = tx.objectStore("state");
        const request = store.get("identity");
        request.onsuccess = () => {
          if (!request.result) store.put(candidate, "identity");
        };
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error);
      });
      keys = await read<CryptoKeyPair>("identity");
    }
    if (!keys) throw new Error("Identity storage failed");
    return identityFromKeys(keys);
  })();
  return cached;
}
export interface SavedPhone {
  id: string;
  grant: Grant;
  pairedAt: number;
  alias?: string;
  model?: string;
  lastContactAt?: number;
}
export const phoneName = (phone: SavedPhone) =>
  phone.alias || phone.model || "Your phone";
export const phoneURL = (id: string) => `/phones/${id}`;
export async function phoneId(key: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", keyBytes(key)),
  );
  return Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}
const changes = new EventTarget();
const channel =
  typeof BroadcastChannel === "undefined"
    ? undefined
    : new BroadcastChannel("remote-access-phones");
function changed() {
  changes.dispatchEvent(new Event("change"));
  channel?.postMessage("change");
}
export function watchPhones(listener: () => void): () => void {
  changes.addEventListener("change", listener);
  channel?.addEventListener("message", listener);
  window.addEventListener("focus", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    changes.removeEventListener("change", listener);
    channel?.removeEventListener("message", listener);
    window.removeEventListener("focus", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}
// Hashing cannot run inside an IDB transaction. Recheck the legacy value in the
// write transaction so simultaneous first loads migrate once without overwrites.
const migrated = (async () => {
  const legacy = await read<Grant>("grant");
  if (!legacy) return;
  const id = await phoneId(legacy.phone);
  const db = await database;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["state", "phones"], "readwrite");
    const state = tx.objectStore("state");
    const phones = tx.objectStore("phones");
    const current = state.get("grant");
    current.onsuccess = () => {
      if ((current.result as Grant | undefined)?.id !== legacy.id) return;
      const existing = phones.get(id);
      existing.onsuccess = () => {
        if (!existing.result)
          phones.put({
            id,
            grant: legacy,
            pairedAt: Date.now(),
          } satisfies SavedPhone);
        state.delete("grant");
      };
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  changed();
})();
export async function savedPhones(): Promise<SavedPhone[]> {
  await migrated;
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction("phones").objectStore("phones").getAll();
    request.onsuccess = () => resolve(request.result as SavedPhone[]);
    request.onerror = () => reject(request.error);
  });
}
async function updatePhone(
  id: string,
  update: (phone: SavedPhone | undefined) => SavedPhone | undefined,
): Promise<void> {
  await migrated;
  const db = await database;
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction("phones", "readwrite");
    const store = tx.objectStore("phones");
    const request = store.get(id);
    request.onsuccess = () => {
      const next = update(request.result as SavedPhone | undefined);
      if (next) store.put(next);
      else store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  changed();
}
export async function rememberPhone(
  grant: Grant,
  alias?: string,
): Promise<string> {
  const id = await phoneId(grant.phone);
  await updatePhone(id, (previous) => ({
    ...previous,
    id,
    grant,
    pairedAt: Date.now(),
    ...(alias?.trim() ? { alias: alias.trim().slice(0, 60) } : {}),
  }));
  return id;
}
export function renamePhone(id: string, alias: string): Promise<void> {
  const name = alias.trim().slice(0, 60);
  return updatePhone(id, (phone) => {
    if (!phone) return;
    const next = { ...phone };
    if (name) next.alias = name;
    else delete next.alias;
    return next;
  });
}
export function contactedPhone(id: string, model?: string): Promise<void> {
  return updatePhone(id, (phone) =>
    phone
      ? {
          ...phone,
          lastContactAt: Math.max(phone.lastContactAt ?? 0, Date.now()),
          ...(model ? { model } : {}),
        }
      : undefined,
  );
}
export const forgetPhone = (id: string) => updatePhone(id, () => undefined);
