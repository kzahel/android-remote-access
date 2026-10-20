/** Commands travel only inside an authenticated application record. Integers are big-endian. */
export type Command =
  | { op: "start" | "status" | "capture" | "wake" }
  | { op: "tap"; scene: number; x: number; y: number }
  | {
      op: "swipe";
      scene: number;
      x: number;
      y: number;
      endX: number;
      endY: number;
      duration: number;
    }
  | { op: "navigation"; action: "back" | "home" | "recents" }
  | { op: "text"; text: string }
  | { op: "launch"; packageName: string };
const operations = [
  "start",
  "status",
  "capture",
  "tap",
  "swipe",
  "navigation",
  "text",
  "launch",
  "wake",
] as const;
export const MAX_COMMAND = 4112;
export function encodeCommand(
  id: number,
  command: Command,
): Uint8Array<ArrayBuffer> {
  if (!Number.isInteger(id) || id < 1 || id > 0xffffffff)
    throw new Error("Invalid command ID");
  let values: number[] = [];
  let tail = new Uint8Array();
  switch (command.op) {
    case "tap":
      values = [command.scene, command.x, command.y];
      break;
    case "swipe":
      values = [
        command.scene,
        command.x,
        command.y,
        command.endX,
        command.endY,
        command.duration,
      ];
      break;
    case "navigation":
      tail = new Uint8Array([
        ["back", "home", "recents"].indexOf(command.action) + 1,
      ]);
      break;
    case "text":
      tail = new TextEncoder().encode(command.text);
      if (tail.length > 4096) throw new Error("Text too long");
      break;
    case "launch":
      if (
        !/^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z][A-Za-z0-9_]*)+$/.test(
          command.packageName,
        ) ||
        command.packageName.length > 256
      )
        throw new Error("Invalid app");
      tail = new TextEncoder().encode(command.packageName);
      break;
  }
  if (
    values.some((v) => !Number.isInteger(v) || v < 0 || v > 0x7fffffff) ||
    ("scene" in command && command.scene === 0) ||
    (command.op === "swipe" &&
      (command.duration < 40 || command.duration > 2000))
  )
    throw new Error("Invalid gesture");
  const out = new Uint8Array(12 + values.length * 4 + tail.length);
  out.set([65, 82, 67, 49, operations.indexOf(command.op) + 1, 0, 0, 0]);
  const view = new DataView(out.buffer);
  view.setUint32(8, id);
  values.forEach((v, i) => {
    view.setUint32(12 + i * 4, v);
  });
  out.set(tail, 12 + values.length * 4);
  return out;
}
export type ControlState = {
  type: "state";
  v: 1;
  accessibility: boolean;
  locked: boolean;
  width: number;
  height: number;
  scene: number;
};
export type Reply = { id: number } & (
  | { kind: "state"; state: ControlState }
  | { kind: "result"; code: number }
  | {
      kind: "image";
      scene: number;
      width: number;
      height: number;
      jpeg: Uint8Array<ArrayBuffer>;
    }
);
export function decodeReply(data: Uint8Array<ArrayBuffer>): Reply {
  if (
    data.length < 12 ||
    data.length > 1048576 ||
    String.fromCharCode(...data.slice(0, 4)) !== "ARP1" ||
    data.slice(5, 8).some(Boolean)
  )
    throw new Error("Invalid control reply");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const id = view.getUint32(8);
  if (!id) throw new Error("Invalid reply ID");
  switch (data[4]) {
    case 1: {
      if (data.length > 2048) throw new Error("Invalid state");
      const s: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(data.slice(12)),
      );
      if (!s || typeof s !== "object") throw new Error("Invalid state");
      const state = s as ControlState;
      if (
        state.type !== "state" ||
        state.v !== 1 ||
        typeof state.accessibility !== "boolean" ||
        typeof state.locked !== "boolean" ||
        [state.width, state.height, state.scene].some(
          (n) => !Number.isInteger(n) || n < 0 || n > 0x7fffffff,
        ) ||
        state.width > 16384 ||
        state.height > 16384
      )
        throw new Error("Invalid state");
      return { id, kind: "state", state };
    }
    case 2:
      if (data.length !== 13 || data[12] === undefined || data[12] > 8)
        throw new Error("Invalid result");
      return { id, kind: "result", code: data[12] };
    case 3: {
      if (data.length < 28) throw new Error("Invalid image");
      const scene = view.getUint32(12),
        width = view.getUint32(16),
        height = view.getUint32(20);
      if (
        !scene ||
        scene > 0x7fffffff ||
        !width ||
        !height ||
        width > 16384 ||
        height > 16384 ||
        data[24] !== 255 ||
        data[25] !== 216
      )
        throw new Error("Invalid image");
      return { id, kind: "image", scene, width, height, jpeg: data.slice(24) };
    }
    default:
      throw new Error("Unknown control reply");
  }
}
export function resultMessage(code: number): string {
  return (
    [
      "Done",
      "Enable screen access on the phone",
      "Screen changed. Try again",
      "Phone is locked",
      "This action is unavailable",
      "Screen is protected or capture was interrupted",
      "Phone is busy. Try again",
      "Action was interrupted; it was not retried",
      "Session ended",
    ][code] ?? "Action failed"
  );
}
