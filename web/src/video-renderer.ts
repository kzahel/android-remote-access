import type { Reply } from "@remote/protocol/control";

type Frame = Extract<Reply, { kind: "video" }>;
export class VideoDecodeError extends Error {
  constructor() {
    super("Smooth view is unavailable in this browser. Using still frames.");
  }
}
/** Annex-B baseline AVC, no B frames. Keep decoded pixels and metadata out of React. */
export class VideoRenderer {
  private decoder: VideoDecoder | undefined;
  private epoch = 0;
  private codec = "";
  private pending = new Map<number, Frame>();
  private failed = false;
  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly displayed: (frame: {
      scene: number;
      width: number;
      height: number;
    }) => void,
  ) {}
  static supported() {
    return typeof VideoDecoder !== "undefined";
  }
  push(frame: Frame): boolean {
    if (this.failed) throw new VideoDecodeError();
    if ((this.decoder?.decodeQueueSize ?? 0) > 4) {
      this.close();
      this.failed = false;
      return false;
    }
    if (frame.epoch !== this.epoch || !this.decoder) {
      if (!frame.key) return false;
      this.close();
      this.epoch = frame.epoch;
    }
    if (frame.key) {
      // A keyframe includes SPS/PPS; use its exact profile/compatibility/level.
      const d = frame.data;
      let codec = "";
      for (let i = 0; i + 7 < d.length; i++) {
        if (
          d[i] === 0 &&
          d[i + 1] === 0 &&
          d[i + 2] === 1 &&
          ((d[i + 3] ?? 0) & 31) === 7
        ) {
          codec = `avc1.${Array.from(d.slice(i + 4, i + 7), (n) => n.toString(16).padStart(2, "0")).join("")}`;
          break;
        }
      }
      if (!codec) return false;
      if (
        !this.decoder ||
        this.codec !== codec ||
        this.decoder.state !== "configured"
      ) {
        this.close();
        this.epoch = frame.epoch;
        this.codec = codec;
        this.decoder = new VideoDecoder({
          output: (decoded) => {
            try {
              const meta = this.pending.get(decoded.timestamp);
              this.pending.delete(decoded.timestamp);
              if (!meta) return;
              this.canvas.width = meta.sourceWidth;
              this.canvas.height = meta.sourceHeight;
              this.canvas
                .getContext("2d")
                ?.drawImage(decoded, 0, 0, meta.sourceWidth, meta.sourceHeight);
              this.displayed({
                scene: meta.scene,
                width: meta.sourceWidth,
                height: meta.sourceHeight,
              });
            } finally {
              decoded.close();
            }
          },
          error: () => {
            this.failed = true;
          },
        });
        try {
          this.decoder.configure({ codec, optimizeForLatency: true });
        } catch {
          this.failed = true;
          this.close();
          throw new VideoDecodeError();
        }
      }
    }
    if (
      !this.decoder ||
      this.decoder.state !== "configured" ||
      this.pending.size >= 8
    )
      return false;
    this.pending.set(frame.timestamp, frame);
    try {
      this.decoder.decode(
        new EncodedVideoChunk({
          type: frame.key ? "key" : "delta",
          timestamp: frame.timestamp,
          data: frame.data,
        }),
      );
    } catch {
      this.failed = true;
      this.close();
      throw new VideoDecodeError();
    }
    return true;
  }
  close() {
    if (this.decoder && this.decoder.state !== "closed") this.decoder.close();
    this.decoder = undefined;
    this.pending.clear();
    this.codec = "";
    this.epoch = 0;
  }
}
