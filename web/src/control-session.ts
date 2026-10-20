import type { Identity } from "@remote/protocol";
import {
  type Command,
  decodeReply,
  encodeCommand,
} from "@remote/protocol/control";
import type { Grant } from "@remote/protocol/enrollment";
import { openEncryptedSession } from "./relay.js";

/** Commands are serialized and bounded; failed/uncertain commands are never replayed. */
export class RemoteSession {
  private sequence = 0;
  private queued = 0;
  private active = true;
  private pending: Promise<unknown> = Promise.resolve();
  private constructor(
    private readonly lane: Awaited<ReturnType<typeof openEncryptedSession>>,
  ) {}
  static async connect(
    identity: Identity,
    grant: Grant,
    report: (s: string) => void,
    signal: AbortSignal,
  ) {
    const session = new RemoteSession(
      await openEncryptedSession(identity, grant, report, signal),
    );
    try {
      const reply = await session.command({ op: "start" });
      if (reply.kind !== "state")
        throw new Error("Update the phone app to enable remote control");
      return { session, state: reply.state };
    } catch (error) {
      session.close();
      throw error;
    }
  }
  command(command: Command) {
    if (!this.active || this.queued >= 8)
      return Promise.reject(new Error("Phone is busy. Try again."));
    this.queued++;
    const task = this.pending.then(async () => {
      if (!this.active) throw new Error("Session ended");
      const id = ++this.sequence;
      await this.lane.send(encodeCommand(id, command));
      const bytes = await this.lane.read(15000);
      if (!bytes)
        throw new Error(
          "Phone did not respond. Reconnect; the action was not retried.",
        );
      const reply = decodeReply(bytes);
      if (reply.id !== id) throw new Error("Unexpected phone reply");
      return reply;
    });
    this.pending = task.catch(() => {
      this.close();
    });
    return task.finally(() => {
      this.queued--;
    });
  }
  close() {
    this.active = false;
    this.lane.close();
  }
}
