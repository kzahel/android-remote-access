import { type Identity, identityFromKeys } from "@remote/protocol";
import type { Grant } from "@remote/protocol/enrollment";

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("remote-access-v1", 1);
  request.onupgradeneeded = () => request.result.createObjectStore("state");
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});
async function read<T>(name: string): Promise<T | undefined> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const request = db.transaction("state").objectStore("state").get(name);
    request.onsuccess = () => resolve(request.result as T | undefined);
    request.onerror = () => reject(request.error);
  });
}
export async function save(name: string, value: unknown): Promise<void> {
  const db = await database;
  return new Promise((resolve, reject) => {
    const transaction = db.transaction("state", "readwrite");
    if (value === undefined) transaction.objectStore("state").delete(name);
    else transaction.objectStore("state").put(value, name);
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error);
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
export const savedGrant = () => read<Grant>("grant");
