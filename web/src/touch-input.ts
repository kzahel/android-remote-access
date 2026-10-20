import { resultMessage, type TouchBatch } from "@remote/protocol/control";
import type { RemoteSession } from "./control-session.js";

type Frame = { scene: number; width: number; height: number };
type Finger = {
  id: number;
  held: boolean;
  path: { x: number; y: number }[];
  x: number;
  y: number;
};
/** Bounded pointer batches and heartbeats. No React updates in the input path. */
export class TouchInput {
  private fingers = new Map<number, Finger>();
  private gesture = 0;
  private sequence = 0;
  private scene = 0;
  private sending = false;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private nextId = 0;
  private readonly cleanup: (() => void)[] = [];
  get active() {
    return this.fingers.size > 0 || this.sending;
  }
  constructor(
    private canvas: HTMLCanvasElement,
    private session: RemoteSession,
    private frame: () => Frame | undefined,
    private report: (message: string) => void,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      name: K,
      handler: (e: HTMLElementEventMap[K]) => void,
    ) => {
      canvas.addEventListener(name, handler);
      this.cleanup.push(() => canvas.removeEventListener(name, handler));
    };
    on("pointerdown", (e) => this.down(e));
    on("pointermove", (e) => this.move(e));
    on("pointerup", (e) => this.up(e));
    on("pointercancel", () => this.release());
    on("lostpointercapture", (e) => {
      if (this.fingers.get(e.pointerId)?.held) this.release();
    });
    const lost = () => this.release();
    const hidden = () => {
      if (document.hidden) this.release();
    };
    window.addEventListener("blur", lost);
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("resize", lost);
    this.cleanup.push(() => {
      window.removeEventListener("blur", lost);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("resize", lost);
    });
  }
  private point(event: PointerEvent) {
    const frame = this.frame(),
      rect = this.canvas.getBoundingClientRect();
    if (!frame) return undefined;
    return {
      x: Math.min(
        frame.width - 1,
        Math.max(0, ((event.clientX - rect.left) * frame.width) / rect.width),
      ),
      y: Math.min(
        frame.height - 1,
        Math.max(0, ((event.clientY - rect.top) * frame.height) / rect.height),
      ),
    };
  }
  private down(event: PointerEvent) {
    if (this.stopped || this.fingers.size >= 10) return;
    const p = this.point(event),
      frame = this.frame();
    if (!p || !frame) return;
    event.preventDefault();
    this.canvas.setPointerCapture(event.pointerId);
    if (!this.fingers.size && !this.sending) {
      this.gesture =
        ((crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) % 0x7ffffffe) + 1;
      this.sequence = 0;
      this.scene = frame.scene;
      this.nextId = 0;
    }
    this.fingers.set(event.pointerId, {
      id: this.nextId++,
      held: true,
      path: [p],
      ...p,
    });
    this.schedule(0);
  }
  private move(event: PointerEvent) {
    const f = this.fingers.get(event.pointerId),
      p = this.point(event);
    if (!f || !p || !f.held) return;
    event.preventDefault();
    f.x = p.x;
    f.y = p.y;
    if (f.path.length === 24) f.path.splice(1, 1);
    f.path.push(p);
    this.schedule(40);
  }
  private up(event: PointerEvent) {
    const f = this.fingers.get(event.pointerId),
      p = this.point(event);
    if (!f) return;
    event.preventDefault();
    if (p) {
      f.x = p.x;
      f.y = p.y;
      if (f.path.length === 24) f.path.shift();
      f.path.push(p);
    }
    f.held = false;
    this.schedule(0);
  }
  private schedule(ms: number) {
    if (this.stopped || this.sending || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.flush();
    }, ms);
  }
  private async flush() {
    if (this.sending || this.stopped || !this.fingers.size) return;
    this.sending = true;
    const batch: TouchBatch = {
      scene: this.scene,
      gesture: this.gesture,
      sequence: this.sequence++,
      duration: 40,
      contacts: [],
    };
    const removed: number[] = [];
    for (const [pointer, f] of this.fingers) {
      batch.contacts.push({
        id: f.id,
        held: f.held,
        path: f.path.length ? [...f.path] : [{ x: f.x, y: f.y }],
      });
      f.path = [];
      if (!f.held) removed.push(pointer);
    }
    try {
      const reply = await this.session.command({ op: "touch", batch });
      if (reply.kind !== "result" || reply.code !== 0)
        throw new Error(
          reply.kind === "result"
            ? resultMessage(reply.code)
            : "Touch interrupted",
        );
      for (const pointer of removed) this.fingers.delete(pointer);
    } catch (error) {
      this.fingers.clear();
      this.report(
        error instanceof Error
          ? error.message
          : "Touch interrupted. Lift your fingers and try again.",
      );
    } finally {
      this.sending = false;
      if (this.fingers.size) this.schedule(40);
    }
  }
  release() {
    clearTimeout(this.timer);
    this.timer = undefined;
    if (this.active) {
      this.fingers.clear();
      void this.session.command({ op: "release" }).catch(() => {});
    }
  }
  close() {
    this.release();
    this.stopped = true;
    this.cleanup.forEach((fn) => {
      fn();
    });
  }
}
