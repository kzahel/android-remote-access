import { type Identity, identityFromKeys } from "@remote/protocol";
import type { DeviceInfo } from "@remote/protocol/device";
import { type Grant, keyBytes } from "@remote/protocol/enrollment";

const database = new Promise<IDBDatabase>((resolve, reject) => {
  const request = indexedDB.open("remote-access-v1", 3);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains("state")) db.createObjectStore("state");
    // Initial development keeps no compatibility: a new phone format starts over.
    if (db.objectStoreNames.contains("phones")) db.deleteObjectStore("phones");
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
/** This browser's own record of a phone event; never read from the phone. */
export interface PhoneEvent {
  at: number;
  text: string;
}
export interface SavedPhone {
  id: string;
  grant: Grant;
  pairedAt: number;
  alias?: string;
  /** The phone's latest self-report; refreshed on every authenticated contact. */
  device: DeviceInfo;
  deviceAt: number;
  lastContactAt?: number;
  /** The relay's verdict for this grant, cleared on success or when another grant is saved. */
  access?: PhoneAccess;
  history: PhoneEvent[];
}
export type PhoneAccess = "removed" | "paused";
export const phoneName = (phone: SavedPhone) =>
  phone.alias || phone.device.name || phone.device.model;
export const phoneURL = (id: string) => `/phones/${id}`;
export const phoneDetailsURL = (id: string) => `/phones/${id}/details`;
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
export async function savedPhones(): Promise<SavedPhone[]> {
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
const historyLimit = 200;
const logged = (phone: SavedPhone, ...text: string[]): PhoneEvent[] =>
  [...text.map((t) => ({ at: Date.now(), text: t })), ...phone.history].slice(
    0,
    historyLimit,
  );
/** Notable changes between two self-reports, worth keeping in this browser's history. */
function deviceChanges(before: DeviceInfo, after: DeviceInfo): string[] {
  const changes: string[] = [];
  if (before.android !== after.android)
    changes.push(`Android updated to ${after.android}`);
  if (before.app !== after.app)
    changes.push(`YepControl updated to ${after.app}`);
  if (before.name !== after.name)
    changes.push(`Phone renamed itself “${after.name}”`);
  return changes;
}
export async function rememberPhone(
  grant: Grant,
  device: DeviceInfo,
): Promise<string> {
  const id = await phoneId(grant.phone);
  await updatePhone(id, (previous) => {
    const now = Date.now();
    const next: SavedPhone = {
      id,
      grant,
      pairedAt: now,
      device,
      deviceAt: now,
      history: [],
      ...(previous?.alias ? { alias: previous.alias } : {}),
      ...(previous?.lastContactAt
        ? { lastContactAt: previous.lastContactAt }
        : {}),
    };
    next.history = logged(
      { ...next, history: previous?.history ?? [] },
      previous ? "New pairing added; earlier access unchanged" : "Paired",
    );
    return next;
  });
  return id;
}
export function renamePhone(id: string, alias: string): Promise<void> {
  const name = alias.trim().slice(0, 60);
  return updatePhone(id, (phone) => {
    if (!phone || name === (phone.alias ?? "")) return phone;
    const next = { ...phone };
    if (name) next.alias = name;
    else delete next.alias;
    next.history = logged(
      phone,
      name ? `Renamed to “${name}”` : "Name reset to the phone’s own",
    );
    return next;
  });
}
/** Records an authenticated contact. `event` is logged; routine refreshes pass none. */
export function contactedPhone(
  id: string,
  device: DeviceInfo,
  event?: string,
): Promise<void> {
  return updatePhone(id, (phone) => {
    if (!phone) return undefined;
    const now = Date.now();
    const notes = [...deviceChanges(phone.device, device)];
    if (event) notes.unshift(event);
    return {
      ...phone,
      device,
      deviceAt: now,
      lastContactAt: Math.max(phone.lastContactAt ?? 0, now),
      history: notes.length ? logged(phone, ...notes) : phone.history,
    };
  });
}
export const forgetPhone = (id: string) => updatePhone(id, () => undefined);
/** Records the relay's verdict for this exact pairing; a newer pairing of the same phone is untouched. */
export async function setPhoneAccess(
  grant: Grant,
  access: PhoneAccess | undefined,
): Promise<void> {
  const id = await phoneId(grant.phone);
  const current = (await savedPhones()).find((phone) => phone.id === id);
  if (current?.grant.id !== grant.id || current.access === access) return;
  await updatePhone(id, (phone) => {
    if (phone?.grant.id !== grant.id) return phone;
    const next = { ...phone };
    if (access) next.access = access;
    else delete next.access;
    next.history = logged(
      phone,
      access === "removed"
        ? "Access removed on the phone"
        : access === "paused"
          ? "Access paused on the phone"
          : "Access allowed again",
    );
    return next;
  });
}
/** A revoked pairing answers 410 to its ID; pause stays private to the authenticated socket. */
export async function refreshRemoved(phones: SavedPhone[]): Promise<void> {
  await Promise.all(
    phones
      .filter((phone) => phone.access !== "removed")
      .map(async (phone) => {
        try {
          const response = await fetch(`/api/pair/${phone.grant.id}`);
          if (response.status === 410)
            await setPhoneAccess(phone.grant, "removed");
        } catch {}
      }),
  );
}
