import type { Reply } from "@remote/protocol/control";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { VideoDecodeError, VideoRenderer } from "../src/video-renderer.js";

type Frame = Extract<Reply, { kind: "video" }>;
const frame = {
  kind: "video",
  epoch: 1,
  key: true,
  timestamp: 1,
  scene: 1,
  sourceWidth: 1080,
  sourceHeight: 2400,
  data: new Uint8Array([0, 0, 0, 1, 0x67, 0x42, 0, 0x1f, 0]),
} as Frame;
let callbacks: VideoDecoderInit;
let rejectConfig = false;
let rejectDecode = false;
let decoder: FakeDecoder;
class FakeDecoder {
  state = "unconfigured";
  decodeQueueSize = 0;
  close = vi.fn(() => {
    this.state = "closed";
  });
  constructor(init: VideoDecoderInit) {
    callbacks = init;
    decoder = this;
  }
  configure() {
    if (rejectConfig) throw new Error("Unsupported codec");
    this.state = "configured";
  }
  decode() {
    if (rejectDecode) throw new Error("Invalid bitstream");
  }
}
beforeEach(() => {
  rejectConfig = false;
  rejectDecode = false;
  vi.stubGlobal("VideoDecoder", FakeDecoder);
  vi.stubGlobal(
    "EncodedVideoChunk",
    class {
      constructor(_value: unknown) {}
    },
  );
});
afterEach(() => vi.unstubAllGlobals());
const renderer = () => new VideoRenderer({} as HTMLCanvasElement, () => {});
it("turns unsupported configuration into a terminal still-frame fallback", () => {
  rejectConfig = true;
  const view = renderer();
  expect(() => view.push(frame)).toThrow(VideoDecodeError);
  expect(decoder.close).toHaveBeenCalledOnce();
  expect(() => view.push(frame)).toThrow(VideoDecodeError);
  view.close(); // Idempotent after a decoder has closed itself.
});
it("propagates asynchronous decoder failure on the next frame", () => {
  const view = renderer();
  expect(view.push(frame)).toBe(true);
  callbacks.error(new DOMException("Decoder failed"));
  expect(() => view.push(frame)).toThrow(VideoDecodeError);
  view.close();
  expect(decoder.close).toHaveBeenCalledOnce();
});
it("distinguishes dropped backlog from fatal decode failure", () => {
  const view = renderer();
  view.push(frame);
  decoder.decodeQueueSize = 5;
  expect(view.push(frame)).toBe(false);
  expect(view.push(frame)).toBe(true); // Fresh keyframe recovers ordinary backlog.
  rejectDecode = true;
  expect(() => view.push(frame)).toThrow(VideoDecodeError);
  expect(decoder.close).toHaveBeenCalledOnce();
});
