/** One authenticated live channel. No touch action is replayed after failure. */
export class LiveSession {
  constructor({
    target,
    canvas,
    getFrame,
    allowed,
    note,
    changed,
    afterTouch,
  }) {
    Object.assign(this, {
      target,
      canvas,
      getFrame,
      allowed,
      note,
      changed,
      afterTouch,
    });
    this.contacts = new Map();
    this.pending = new Map();
    this.sequence = 0;
    this.request = 0;
    this.stats = {
      decoded: 0,
      batches: 0,
      maxAckMs: 0,
      lastVideoAt: 0,
      resets: 0,
      acknowledgements: [],
    };
    this.connect();
    target.addEventListener("pointerdown", (e) => this.down(e));
    target.addEventListener("pointermove", (e) => this.move(e));
    target.addEventListener("pointerup", (e) => this.up(e));
    target.addEventListener("pointercancel", () =>
      this.cancel("Touch interrupted"),
    );
    target.addEventListener("lostpointercapture", (e) => {
      if (this.contacts.get(e.pointerId)?.held)
        this.cancel("Pointer capture ended");
    });
    target.addEventListener("contextmenu", (e) => e.preventDefault());
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) this.cancel("Viewer hidden");
    });
    window.addEventListener("blur", () => this.cancel("Viewer lost focus"));
    window.addEventListener("resize", () =>
      this.cancel("Viewer size changed; start touch again"),
    );
    window.addEventListener("pagehide", () => {
      this.closed = true;
      this.cancel("Viewer closed");
      this.ws?.close();
    });
    this.timer = setInterval(() => {
      if (this.gesture && !this.busy) this.pump();
      if (this.videoActive && performance.now() - this.stats.lastVideoAt > 1200)
        this.pauseVideo("Waiting for smooth view");
    }, 45);
  }
  connect() {
    this.ws = new WebSocket(
      location.origin.replace(/^http/, "ws") + "/api/live",
    );
    this.ws.onmessage = (e) => {
      const packet = JSON.parse(e.data);
      if (packet.type === "touchResult") {
        const p = this.pending.get(packet.request);
        if (p) {
          clearTimeout(p.timer);
          this.pending.delete(packet.request);
          p.resolve(packet);
        }
      } else if (packet.type === "touchEnded")
        this.cancel(packet.message, false);
      else if (packet.type === "video") this.video(packet);
      else if (packet.type === "videoPaused") this.pauseVideo(packet.message);
    };
    this.ws.onclose = () => {
      this.cancel("Live connection ended", false);
      this.pauseVideo("Smooth view disconnected");
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.resolve({ ok: false, message: "Connection ended; no replay" });
      }
      this.pending.clear();
      if (!this.closed) setTimeout(() => this.connect(), 1000);
    };
    this.ws.onerror = () => {};
  }
  point(e) {
    const f = this.touchFrame || this.getFrame(),
      r = this.target.getBoundingClientRect();
    return [
      Math.max(
        0,
        Math.min(f.width - 1, ((e.clientX - r.left) / r.width) * f.width),
      ),
      Math.max(
        0,
        Math.min(f.height - 1, ((e.clientY - r.top) / r.height) * f.height),
      ),
    ];
  }
  down(e) {
    if (!this.allowed() || !this.getFrame()) {
      this.note?.(
        "The screen is refreshing. Try touching again in a moment.",
        true,
      );
      return;
    }
    if (
      (e.pointerType === "mouse" && e.button !== 0) ||
      this.ws.readyState !== WebSocket.OPEN ||
      this.contacts.size >= 10
    )
      return;
    e.preventDefault();
    if (!this.gesture) {
      this.gesture = crypto.randomUUID();
      this.sequence = 0;
      this.touchFrame = this.getFrame();
      this.start = performance.now();
    }
    const xy = this.point(e);
    this.contacts.set(e.pointerId, { held: true, path: [xy], xy });
    this.target.setPointerCapture(e.pointerId);
    this.changed?.(this.contacts.size);
    this.pump();
  }
  move(e) {
    const finger = this.contacts.get(e.pointerId);
    if (!finger?.held) return;
    e.preventDefault();
    for (const sample of e.getCoalescedEvents?.().length
      ? e.getCoalescedEvents()
      : [e]) {
      finger.xy = this.point(sample);
      finger.path.push(finger.xy);
    }
    if (finger.path.length > 24)
      finger.path = finger.path.filter(
        (_, i, a) => i % Math.ceil(a.length / 20) === 0 || i === a.length - 1,
      );
  }
  up(e) {
    const finger = this.contacts.get(e.pointerId);
    if (!finger) return;
    e.preventDefault();
    finger.xy = this.point(e);
    finger.path.push(finger.xy);
    finger.held = false;
    if (this.target.hasPointerCapture(e.pointerId))
      this.target.releasePointerCapture(e.pointerId);
    this.changed?.([...this.contacts.values()].filter((f) => f.held).length);
    this.pump();
  }
  async pump() {
    if (this.busy || !this.gesture || !this.contacts.size) return;
    if (performance.now() - (this.lastDispatch || 0) < 45) return;
    if (!this.allowed()) {
      this.cancel("Touch is unavailable");
      return;
    }
    const currentFrame = this.getFrame();
    if (
      currentFrame &&
      (currentFrame.width !== this.touchFrame.width ||
        currentFrame.height !== this.touchFrame.height)
    ) {
      this.cancel("Phone size changed; start touch again");
      return;
    }
    const gesture = this.gesture;
    const points = [...this.contacts].map(([id, f]) => {
      const samples = f.path.splice(0).slice(-24);
      return { id, held: f.held, path: samples.length ? samples : [f.xy] };
    });
    this.busy = true;
    const before = performance.now();
    this.lastDispatch = before;
    const request = ++this.request;
    const response = new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(request);
        resolve({
          ok: false,
          message: "Touch acknowledgement timed out; no replay",
        });
      }, 1800);
      this.pending.set(request, { resolve, timer });
    });
    if (this.ws.readyState !== WebSocket.OPEN) {
      this.busy = false;
      this.cancel("Live connection ended", false);
      return;
    }
    this.ws.send(
      JSON.stringify({
        op: "touch",
        request,
        gesture,
        sequence: this.sequence++,
        frame: this.touchFrame.frame,
        duration: 40,
        points,
      }),
    );
    const result = await response;
    this.busy = false;
    this.stats.batches++;
    this.stats.acknowledgements.push(performance.now() - before);
    if (this.stats.acknowledgements.length > 500)
      this.stats.acknowledgements.shift();
    this.stats.maxAckMs = Math.max(
      this.stats.maxAckMs,
      performance.now() - before,
    );
    if (gesture !== this.gesture) return;
    if (!result.ok) {
      this.cancel(result.message);
      return;
    }
    for (const point of points) if (!point.held) this.contacts.delete(point.id);
    if (!this.contacts.size) {
      this.gesture = null;
      this.touchFrame = null;
      this.changed?.(0);
      this.afterTouch?.();
    } else
      setTimeout(
        () => this.pump(),
        Math.max(0, 45 - (performance.now() - before)),
      );
  }
  cancel(message, send = true) {
    const had = !!this.gesture;
    this.gesture = null;
    this.touchFrame = null;
    this.contacts.clear();
    this.changed?.(0);
    if (had && send && this.ws?.readyState === WebSocket.OPEN)
      this.ws.send(JSON.stringify({ op: "touchEnd", request: ++this.request }));
    if (had) this.note?.(message, true);
  }
  pauseVideo(message) {
    this.videoActive = false;
    this.canvas.hidden = true;
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = null;
    this.codec = null;
    this.stats.resets++;
    this.changed?.(null, message);
  }
  video(packet) {
    if (!this.allowed() || document.hidden || !globalThis.VideoDecoder) return;
    if (
      !this.decoder ||
      this.codec !== packet.codec ||
      this.videoWidth !== packet.width ||
      this.videoHeight !== packet.height
    ) {
      if (!packet.key) return;
      if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
      this.codec = packet.codec;
      this.videoWidth = packet.width;
      this.videoHeight = packet.height;
      this.decoder = new VideoDecoder({
        output: (frame) => {
          if (!this.allowed()) {
            frame.close();
            return;
          }
          this.canvas.width = frame.displayWidth;
          this.canvas.height = frame.displayHeight;
          this.canvas.getContext("2d", { alpha: false }).drawImage(frame, 0, 0);
          frame.close();
          this.canvas.hidden = false;
          this.videoActive = true;
          this.stats.decoded++;
          this.stats.lastVideoAt = performance.now();
          this.changed?.(null);
        },
        error: () =>
          this.pauseVideo("Video decoder stopped; using still frames"),
      });
      try {
        this.decoder.configure({
          codec: packet.codec,
          optimizeForLatency: true,
        });
      } catch {
        this.pauseVideo("Smooth view is unsupported here; using still frames");
        return;
      }
    }
    if (this.decoder.decodeQueueSize > 3) {
      this.pauseVideo("Video catching up");
      return;
    }
    const bytes = Uint8Array.from(atob(packet.data), (c) => c.charCodeAt(0));
    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: packet.key ? "key" : "delta",
          timestamp: packet.timestamp,
          data: bytes,
        }),
      );
    } catch {
      this.pauseVideo("Waiting for a fresh video frame");
    }
  }
}
