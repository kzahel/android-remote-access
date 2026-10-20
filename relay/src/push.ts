import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  applicationDefault,
  deleteApp,
  initializeApp,
} from "firebase-admin/app";
import { getMessaging, type Message } from "firebase-admin/messaging";

export type Wake = {
  requestId: string;
  expires: number;
  pairingId?: string;
  generation?: string;
};
export type Delivery = "accepted" | "invalid_target" | "unavailable";
export type Sender = (fid: string, wake: Wake) => Promise<Delivery>;
export function validFid(value: unknown): value is string {
  return typeof value === "string" && /^[cdef][A-Za-z0-9_-]{21}$/.test(value);
}
export function wakeMessage(fid: string, wake: Wake): Message {
  return {
    fid,
    data: {
      intent: "connect-v1",
      requestId: wake.requestId,
      expires: String(wake.expires),
      ...(wake.pairingId ? { pairingId: wake.pairingId } : {}),
      ...(wake.generation ? { generation: wake.generation } : {}),
    },
    android: { priority: "high", ttl: 60000, collapseKey: "connect-v1" },
  };
}
export function firebaseSender(projectId: string) {
  const app = initializeApp(
    { credential: applicationDefault(), projectId },
    "android-remote",
  );
  return {
    send: firebaseDelivery((message) => getMessaging(app).send(message)),
    close: () => deleteApp(app),
  };
}
export function firebaseDelivery(
  send: (message: Message) => Promise<string>,
): Sender {
  return async (fid, wake) => {
    try {
      await send(wakeMessage(fid, wake));
      return "accepted";
    } catch (error) {
      const code =
        error !== null && typeof error === "object" && "code" in error
          ? error.code
          : undefined;
      return code === "messaging/registration-token-not-registered" ||
        code === "messaging/invalid-registration-token"
        ? "invalid_target"
        : "unavailable";
    }
  };
}

/** Delivery addresses are private metadata, never part of public pairing replies. */
export class PushRegistry {
  private targets: Record<string, { fid: string; generation?: string }> =
    Object.create(null);
  private readonly cooldown = new Map<string, number>();
  private readonly file: string;
  private window = 0;
  private sends = 0;
  constructor(
    directory: string,
    private readonly send?: Sender,
    private readonly now = Date.now,
  ) {
    this.file = path.join(directory, "push-registrations-v1.json");
    if (existsSync(this.file)) {
      const saved = JSON.parse(readFileSync(this.file, "utf8")) as {
        version: number;
        targets: Record<string, string | { fid: string; generation?: string }>;
      };
      if (
        saved.version !== 1 ||
        !saved.targets ||
        Object.keys(saved.targets).length > 10000
      )
        throw new Error("Invalid push state");
      for (const [id, value] of Object.entries(saved.targets)) {
        const target = typeof value === "string" ? { fid: value } : value;
        const fid = target.fid;
        if (
          target.generation !== undefined &&
          !/^[0-9a-f]{32}$/.test(target.generation)
        )
          throw new Error("Invalid push generation");
        if (!/^[0-9a-f]{32}$/.test(id) || !validFid(fid))
          throw new Error("Invalid push state");
        this.targets[id] = target;
      }
    }
  }
  register(id: string, fid: string, generation?: string) {
    if (!validFid(fid)) throw new Error("Invalid registration");
    if (generation !== undefined && !/^[0-9a-f]{32}$/.test(generation))
      throw new Error("Invalid generation");
    if (
      this.targets[id]?.fid === fid &&
      this.targets[id]?.generation === generation
    )
      return;
    this.targets[id] = { fid, ...(generation ? { generation } : {}) };
    this.persist();
  }
  remove(id: string) {
    delete this.targets[id];
    this.persist();
  }
  private persist() {
    writeFileSync(
      `${this.file}.next`,
      JSON.stringify({ version: 1, targets: this.targets }),
      { mode: 0o600 },
    );
    renameSync(`${this.file}.next`, this.file);
  }
  async wake(
    id: string,
    request: Wake,
  ): Promise<Delivery | "coalesced" | "unregistered"> {
    const target = this.targets[id];
    const fid = target?.fid;
    if (!fid || !this.send) return "unregistered";
    const now = this.now();
    if (request.expires * 1000 <= now) return "unavailable";
    if ((this.cooldown.get(id) ?? 0) > now) return "coalesced";
    if (this.window <= now) {
      this.window = now + 60000;
      this.sends = 0;
    }
    if (this.sends >= 100) return "unavailable";
    this.sends++;
    this.cooldown.set(id, now + 30000);
    for (const [key, until] of this.cooldown)
      if (until <= now) this.cooldown.delete(key);
    let result: Delivery;
    try {
      result = await this.send(fid, {
        ...request,
        ...(target?.generation
          ? { pairingId: id, generation: target.generation }
          : {}),
      });
    } catch {
      result = "unavailable";
    }
    // A concurrent registration refresh must survive an old-target failure.
    if (result === "invalid_target" && this.targets[id] === target)
      this.remove(id);
    return result;
  }
}
