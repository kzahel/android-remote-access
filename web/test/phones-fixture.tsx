import { b64 } from "@remote/protocol";
import type { Command, ControlState, Reply } from "@remote/protocol/control";
import { createRoot } from "react-dom/client";
import type { RemoteSession } from "../src/control-session.js";
import type { ViewerServices } from "../src/phone-page.js";
import { ViewerApp } from "../src/viewer-app.js";
import "../src/viewer.css";

const models = (await (await fetch("/fixture-models")).json()) as Record<
  string,
  string
>;
const source = document.createElement("canvas");
source.width = 108;
source.height = 240;
const paint = source.getContext("2d");
if (!paint) throw Error("Missing canvas");
paint.fillStyle = "#294b3b";
paint.fillRect(0, 0, 108, 240);
const jpeg = new Uint8Array(
  await (await fetch(source.toDataURL("image/jpeg"))).arrayBuffer(),
);
window.phonesFixture = { fail: false, delay: false, calls: [], closed: 0 };
const services: ViewerServices = {
  async connect(identity, grant, _report, signal) {
    if (b64(identity.publicKey) !== grant.viewer)
      throw Error("Wrong browser identity");
    window.phonesFixture.calls.push(grant.id);
    if (window.phonesFixture.fail) throw Error("Fixture phone is unavailable");
    const state: ControlState = {
      type: "state",
      v: 1,
      phoneName: models[grant.phone] ?? "Fixture phone",
      accessibility: true,
      locked: false,
      width: 1080,
      height: 2400,
      scene: 1,
    };
    let active = true;
    const session = {
      get connected() {
        return active;
      },
      path: "relay",
      close() {
        if (active) window.phonesFixture.closed++;
        active = false;
      },
      async command(command: Command): Promise<Reply> {
        if (!active) throw Error("Fixture session ended");
        if (command.op === "status") return { id: 1, kind: "state", state };
        if (command.op === "capture")
          return {
            id: 1,
            kind: "image",
            width: 1080,
            height: 2400,
            scene: 1,
            jpeg,
          };
        return { id: 1, kind: "result", code: 0 };
      },
    } as unknown as RemoteSession;
    signal.addEventListener("abort", () => session.close(), { once: true });
    return { session, state };
  },
  async check(identity, grant, _report, signal) {
    if (b64(identity.publicKey) !== grant.viewer)
      throw Error("Wrong browser identity");
    window.phonesFixture.calls.push(grant.id);
    if (window.phonesFixture.fail) throw Error("Fixture phone is unavailable");
    if (window.phonesFixture.delay)
      await new Promise<void>((_resolve, reject) =>
        signal?.addEventListener(
          "abort",
          () => reject(new DOMException("Cancelled", "AbortError")),
          { once: true },
        ),
      );
    return {
      type: "features",
      v: 1,
      screenViewing: "enabled",
      touchControl: "enabled",
      connectionRequests: "enabled",
    };
  },
};
const root = document.getElementById("root");
if (!root) throw Error("Missing root");
createRoot(root).render(<ViewerApp services={services} />);

declare global {
  interface Window {
    phonesFixture: {
      fail: boolean;
      delay: boolean;
      calls: string[];
      closed: number;
    };
  }
}
