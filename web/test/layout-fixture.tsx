import type { Command, ControlState, Reply } from "@remote/protocol/control";
import { createRoot } from "react-dom/client";
import { AppShell } from "../src/app-shell.js";
import type { RemoteSession } from "../src/control-session.js";
import { RemoteScreen } from "../src/remote-screen.js";
import type { SavedPhone } from "../src/store.js";
import "../src/viewer.css";

const state: ControlState = {
  type: "state",
  v: 1,
  phoneName: "Test phone",
  accessibility: true,
  locked: true,
  width: 1080,
  height: 2400,
  scene: 1,
  unlockAllowed: true,
  savedPin: true,
  unlockBlocked: false,
};
const source = document.createElement("canvas");
source.width = 108;
source.height = 240;
const paint = source.getContext("2d");
if (!paint) throw Error("Fixture canvas unavailable");
paint.fillStyle = "#294b3b";
paint.fillRect(0, 0, source.width, source.height);
paint.fillStyle = "#eff5ef";
paint.font = "12px sans-serif";
paint.fillText("Layout fixture", 12, 36);
const jpeg = new Uint8Array(
  await (await fetch(source.toDataURL("image/jpeg"))).arrayBuffer(),
);
let failNext = false;
const trace: string[] = [];
window.layoutFixture = {
  trace,
  patch: (patch) => Object.assign(state, patch),
  failNext: () => {
    failNext = true;
  },
};
const session = {
  path: "relay",
  connected: true,
  async command(command: Command): Promise<Reply> {
    trace.push(`${command.op}: locked=${state.locked}`);
    if (trace.length > 30) trace.shift();
    if (command.op === "status")
      return { id: 1, kind: "state", state: { ...state } };
    if (failNext && command.op === "navigation") {
      failNext = false;
      throw Error(
        "This is a deliberately long connection message. The action was not retried. Reconnect to continue when the phone is available.",
      );
    }
    if (command.op === "unlockSaved" || command.op === "unlock")
      state.locked = false;
    if (command.op === "sleep") state.locked = true;
    if (command.op === "capture") {
      if (state.locked) return { id: 1, kind: "result", code: 3 };
      return {
        id: 1,
        kind: "image",
        scene: state.scene,
        width: state.width,
        height: state.height,
        jpeg,
      };
    }
    if (command.op === "apps")
      return {
        id: 1,
        kind: "apps",
        apps: [{ packageName: "test.fixture.app", name: "Fixture app" }],
      };
    return { id: 1, kind: "result", code: 0 };
  },
} as unknown as RemoteSession;
const root = document.getElementById("root");
if (!root) throw Error("Missing fixture root");
const phone: SavedPhone = {
  id: "a".repeat(64),
  model: "Test phone",
  pairedAt: 1,
  grant: {
    id: "b".repeat(32),
    phone: "fixture",
    viewer: "fixture",
    expires: 1,
    mac: "fixture",
    phoneSignature: "fixture",
    viewerSignature: "fixture",
  },
};
createRoot(root).render(
  <AppShell phones={[phone]} current={phone}>
    <main className="connected-viewer">
      <RemoteScreen
        session={session}
        initial={{ ...state }}
        disconnect={() => {}}
      />
    </main>
  </AppShell>,
);

declare global {
  interface Window {
    layoutFixture: {
      patch: (patch: Partial<ControlState>) => void;
      failNext: () => void;
      trace: string[];
    };
  }
}
