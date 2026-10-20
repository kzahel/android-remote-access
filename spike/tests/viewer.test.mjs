import test from "node:test";
import assert from "node:assert/strict";
import { LiveSession } from "../web/live.js";

test("a joining finger uses the ongoing gesture frame during a still refresh", () => {
  const contacts = new Map([[1, { held: true, xy: [100, 100], path: [] }]]);
  let captured;
  const live = {
    allowed: () => true,
    getFrame: () => null,
    gesture: "ongoing-gesture",
    touchFrame: { width: 1080, height: 2400 },
    contacts,
    ws: { readyState: 1 },
    target: { setPointerCapture: (id) => { captured = id; } },
    point: () => [200, 200],
    pump() {},
  };
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = { OPEN: 1 };
  try {
    LiveSession.prototype.down.call(live, {
      pointerId: 2, pointerType: "touch", preventDefault() {},
    });
    assert.equal(captured, 2);
    assert.equal(contacts.size, 2);
    // Permission/protected-screen failure still prevents another contact.
    live.allowed = () => false;
    LiveSession.prototype.down.call(live, {
      pointerId: 3, pointerType: "touch", preventDefault() {},
    });
    assert.equal(contacts.size, 2);
  } finally {
    globalThis.WebSocket = previous;
  }
});
