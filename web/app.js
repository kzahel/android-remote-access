import { LiveSession } from "./live.js";
let live;
const $ = (id) => document.getElementById(id);
let state = null,
  frame = null,
  paused = false,
  capturing = false,
  pointer = null;
let field = null,
  revision = 0,
  delivered = 0,
  sending = false,
  textTimer;
let unlockSending = false;
let shownFirstFrame = false;
let fieldReadSequence = 0;
const screen = $("screen");
const notify = (message, error = false) => {
  $("notice").textContent = message;
  $("notice").classList.toggle("error", error);
};
async function api(path, data) {
  const response = await fetch(
    path,
    data === undefined
      ? { cache: "no-store" }
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  );
  const result = await response.json();
  if (!response.ok || result.error)
    throw new Error(result.error || "Request failed");
  return result;
}
async function action(op, data = {}) {
  try {
    const result = await api("/api/action", { op, ...data });
    if (result.state) renderState({ ...state, state: result.state });
    notify(result.message, !result.ok);
    if (op !== "inspect" && op !== "text") setTimeout(refreshFrame, 150);
    return result;
  } catch (e) {
    notify(e.message, true);
    return { ok: false, message: e.message };
  }
}
function cover(title, message, wake = false) {
  live?.pauseVideo(message);
  $("screen-cover").hidden = false;
  $("cover-title").textContent = title;
  $("cover-message").textContent = message;
  $("cover-wake").hidden = !wake;
}
function renderState(next) {
  state = next;
  $("device-name").textContent = next.deviceName || "Demo phone";
  $("target-label").textContent = next.target || "Local prototype";
  $("unlock-experiment").hidden = next.credentialExperiment === false;
  if (next.target === "USB-connected phone") {
    $("unlock-note").textContent =
      "Your phone’s own PIN. One submission, no automatic retry; a wrong PIN counts toward Android’s lockout.";
    $("pin").placeholder = "Phone PIN";
    $("test-pin").textContent = "Use PIN saved on this computer";
  }
  const connected = !!next.connected,
    s = next.state;
  $("connection-dot").className = "dot" + (connected ? " on" : " warn");
  $("side-dot").className = "dot" + (connected ? " on" : " warn");
  $("connection-label").textContent = connected
    ? "Phone connected"
    : "Phone not responding";
  $("device-subtitle").textContent = connected
    ? `Android ${s.release} · ${s.locked ? "Locked" : frame && !next.captureError ? "Ready" : next.captureError ? "View unavailable" : "Connected"}`
    : next.lastSeen
      ? "Connection interrupted"
      : "Waiting for session";
  $("display-state").textContent = s
    ? `Display · ${s.interactive ? "awake" : "asleep"}`
    : "Display · unknown";
  $("lock-state").textContent = s
    ? `Lock · ${s.locked ? (s.secure ? "securely locked" : "swipe to open") : "unlocked"}`
    : "Lock · unknown";
  $("platform").textContent = s
    ? `Android ${s.release} · API ${s.api}`
    : next.target || "Android";
  $("lab-controls").hidden = !next.lab;
  $("test-pin").hidden = !next.testCredential;
  $("test-pin").disabled =
    unlockSending || !!next.unlockBlocked || !connected || !s?.locked;
  $("unlock-route").querySelector('option[value="shell"]').disabled = !next.lab;
  $("unlock-form").querySelector("button").disabled =
    unlockSending || !!next.unlockBlocked || !connected || !s?.locked;
  if (next.unlockBlocked)
    $("unlock-status").textContent =
      "An attempt was made. Unlock locally before another experiment.";
  for (const button of document.querySelectorAll(
    "[data-nav],#wake,#lock,#open-fixture,#dismiss",
  ))
    button.disabled = !connected;
  if (!connected) {
    live?.cancel("Phone disconnected", false);
    live?.pauseVideo("Phone disconnected");
    shownFirstFrame = false;
    fieldReadSequence++;
    frame = null;
    field = null;
    $("typing").disabled = true;
    $("send-text").disabled = true;
    cover(
      "Phone not responding",
      next.lastSeen
        ? "The connection ended. If it does not return, open Remote access on the phone and choose Start remote access. No action will be replayed."
        : "Open Remote access on the phone and choose Start remote access.",
    );
  } else if (!s.interactive) {
    live?.cancel("Phone is asleep");
    live?.pauseVideo("Phone is asleep");
    frame = null;
    cover(
      "The screen is asleep",
      "The phone is connected. Wake the display to see what’s there.",
      true,
    );
  } else if (s.credentialCapturePaused) {
    live?.pauseVideo("Unlocking · view paused");
    cover("Unlocking · view paused", "Waiting for the observed lock state");
  } else if (paused)
    cover(
      "Viewer paused",
      "Screen refresh is paused. Resume when you’re ready.",
    );
  if (s)
    if (!s.video?.active && !live?.videoActive) $("smooth-status").textContent = s.video?.message || "Allow smooth screen sharing on the phone";
  if (s?.video?.mode && document.activeElement !== $("video-mode"))
    $("video-mode").value = s.video.mode;
  if (s?.video?.active && s.video.fps)
    $("smooth-status").textContent =
      `Smooth view · up to ${s.video.fps} fps` +
      (s.video.mode === "auto"
        ? s.video.profile === "saver"
          ? " · Auto chose data saver (metered network)"
          : " · Auto chose standard (unmetered network)"
        : "");
  if (s)
    $("diagnostics").textContent = [
      `Process reachable: ${connected ? "yes" : "no"}`,
      `Display awake: ${s.interactive}`,
      `Keyguard showing: ${s.locked}`,
      `Device credential locked: ${s.deviceLocked}`,
      `Secure credential: ${s.secure}`,
      `User storage unlocked: ${s.userUnlocked}`,
      `Foreground: ${s.package || "unknown"}`,
      `Capture: ${next.captureError || (frame ? "last request succeeded" : "waiting")}`,
      `Android API / target SDK: ${s.api} / ${s.targetSdk}`,
      `Grant remaining: ${Math.ceil(s.grantSeconds / 60)} min`,
      "",
      s.route,
      next.transport,
      "",
      next.limits,
    ].join("\n");
  $("activity").replaceChildren(
    ...(next.log || []).slice(0, 15).map((entry) => {
      const li = document.createElement("li"),
        time = document.createElement("time");
      time.textContent = new Date(entry.at).toLocaleTimeString();
      li.append(time, document.createTextNode(entry.message));
      return li;
    }),
  );
}
async function refreshState() {
  try {
    renderState(await api("/api/state"));
  } catch (e) {
    notify(`Demo server unavailable: ${e.message}`, true);
  }
}
async function refreshFrame() {
  if (
    capturing ||
    paused ||
    document.hidden ||
    !state?.connected ||
    !state.state?.interactive
  )
    return;
  capturing = true;
  try {
    const result = await api("/api/frame");
    if (!result.ok) {
      frame = null;
      const transient =
        /rate limited|changed|already in progress|timed out/.test(
          result.message,
        );
      $("frame-state").textContent = transient
        ? "Screen · refreshing"
        : "Screen · unavailable";
      if (!transient || !screen.naturalWidth)
        cover(
          result.message.includes("protected")
            ? "This screen is protected"
            : result.message.includes("credential")
              ? "Unlocking · view paused"
              : "Screen unavailable",
          result.message,
        );
    } else if (!paused && state?.connected && state.state.interactive) {
      frame = result.data;
      if (!shownFirstFrame) {
        shownFirstFrame = true;
        notify("Connected. Use the screen or open the demo power station.");
      }
      screen.src = `data:image/jpeg;base64,${frame.image}`;
      $("phone").classList.toggle("landscape", frame.width > frame.height);
      $("screen-cover").hidden = true;
      $("frame-state").textContent = "Screen · available";
      $("frame-time").textContent = new Date(
        result.capturedAt,
      ).toLocaleTimeString();
    }
  } catch (e) {
    frame = null;
    cover("View interrupted", e.message);
  } finally {
    capturing = false;
  }
}
live = new LiveSession({
  target: screen,
  canvas: $("video-screen"),
  getFrame: () => frame,
  allowed: () =>
    !paused &&
    state?.connected &&
    state.state?.interactive &&
    !state.state?.locked &&
    !state.state?.credentialCapturePaused &&
    (!state.captureError || state.captureErrorTransient),
  note: notify,
  changed: (count, message) => {
    $("view-mode").textContent = paused
      ? "PAUSED"
      : live?.videoActive
        ? "SMOOTH VIEW"
        : "LIVE STILLS";
    if (count !== null)
      $("touch-status").textContent = count
        ? `${count} finger${count === 1 ? "" : "s"} down · sending movement`
        : "Touch ready · accessibility continuation";
    if (message) $("smooth-status").textContent = message;
    else if (live?.videoActive)
      $("smooth-status").textContent =
        "Smooth view is on · consented screen sharing";
  },
  afterTouch: () => {
    setTimeout(() => readField(false), 250);
    setTimeout(refreshFrame, 50);
  },
});
// Read-only metrics used by the browser acceptance runner.
window.demoLive = live;
async function readField(explicit = true) {
  if (sending || revision !== delivered) {
    if (explicit)
      notify("Finish or send your pending edit before switching fields.", true);
    return;
  }
  const request = ++fieldReadSequence;
  const draftRevision = revision;
  const result = await action("inspect");
  // A remote read must never overwrite keys typed while it was in flight.
  if (request !== fieldReadSequence || revision !== draftRevision) return;
  const focused = result.data?.focused;
  if (focused) {
    field = focused.field;
    $("typing").disabled = false;
    $("send-text").disabled = false;
    // Polling and screen refresh never replace text while the user is editing.
    if (document.activeElement !== $("typing") || explicit) {
      $("typing").value = focused.text;
      $("typing").setSelectionRange(
        Math.max(0, focused.start),
        Math.max(0, focused.end),
      );
      revision = delivered = 0;
    }
    $("typing-help").textContent =
      "Editing the phone’s focused field. Your cursor and Unicode text are supported.";
    $("typing-status").textContent = "Field ready";
    if (explicit) $("typing").focus();
  } else if (explicit) {
    notify("Tap an editable, non-password field on the phone first.", true);
  }
}
async function sendEdit() {
  if (!field || sending || revision === delivered) return;
  const n = revision,
    text = $("typing").value,
    start = $("typing").selectionStart,
    end = $("typing").selectionEnd,
    target = field;
  sending = true;
  $("typing-status").textContent = "Sending…";
  const result = await action("text", { field: target, text, start, end });
  sending = false;
  if (!result.ok) {
    $("live-typing").checked = false;
    fieldReadSequence++;
    field = null;
    $("send-text").disabled = true;
    $("typing-status").textContent = "Delivery unconfirmed · no replay";
    // Keep the draft locally until the user explicitly chooses a field again.
    delivered = revision;
    return;
  }
  delivered = n;
  $("typing-status").textContent = "Edit delivered · check phone";
  if (revision !== delivered && $("live-typing").checked)
    queueMicrotask(sendEdit);
}
$("typing").addEventListener("input", () => {
  revision++;
  $("typing-status").textContent = "Draft changed";
  clearTimeout(textTimer);
  if ($("live-typing").checked && !$("typing").dataset.composing)
    textTimer = setTimeout(sendEdit, 45);
});
$("typing").addEventListener("compositionstart", () => {
  $("typing").dataset.composing = "yes";
  clearTimeout(textTimer);
});
$("typing").addEventListener("compositionend", () => {
  delete $("typing").dataset.composing;
  if ($("live-typing").checked) sendEdit();
});
$("send-text").onclick = sendEdit;
$("read-field").onclick = () => readField();
$("open-fixture").onclick = () => action("openFixture");
$("open-touch-lab").onclick = () => action("openTouchLab");
$("wake").onclick = $("cover-wake").onclick = () => action("wake");
$("lock").onclick = () => action("lock");
$("dismiss").onclick = () => action("dismiss");
$("refresh").onclick = () => {
  if (paused) $("disconnect").click();
  else refreshFrame();
};
for (const button of document.querySelectorAll("[data-nav]"))
  button.onclick = () => action("nav", { button: button.dataset.nav });
$("disconnect").onclick = () => {
  paused = !paused;
  document.body.classList.toggle("paused", paused);
  $("disconnect").textContent = paused ? "Resume viewer" : "Pause viewer";
  $("view-mode").textContent = paused ? "PAUSED" : "LIVE STILLS";
  if (paused) {
    live.cancel("Viewer paused");
    live.pauseVideo("Viewer paused");
    frame = null;
    cover(
      "Viewer paused",
      "Screen refresh is paused. Resume when you’re ready.",
    );
  } else refreshFrame();
};
$("inspect").onclick = async () => {
  const result = await action("inspect");
  $("nodes").hidden = false;
  $("nodes").textContent = JSON.stringify(result.data, null, 2);
};
for (const button of document.querySelectorAll("[data-lab],[data-rotation]"))
  button.onclick = async () => {
    try {
      const result = await api(
        "/api/lab",
        button.dataset.rotation === undefined
          ? { action: button.dataset.lab }
          : { action: "rotate", rotation: Number(button.dataset.rotation) },
      );
      notify(result.message, !result.ok);
    } catch (e) {
      notify(e.message, true);
    }
  };
async function unlock(useTestPin = false) {
  if (unlockSending) return;
  unlockSending = true;
  live.cancel("Unlocking");
  live.pauseVideo("Unlocking · view paused");
  const input = $("pin");
  let pin = input.value;
  input.value = "";
  const secret = useTestPin ? { useTestPin: true } : { pin };
  const route = $("unlock-route").value;
  $("unlock-form").querySelector("button").disabled = true;
  $("unlock-status").textContent =
    "Submitting once. Waiting for the phone’s observed lock state…";
  try {
    const result =
      route === "shell"
        ? await api("/api/lab", { action: "unlock", ...secret })
        : await api("/api/action", { op: "unlock", ...secret });
    pin = "";
    notify(result.message, !result.ok);
    $("unlock-status").textContent = result.message;
  } catch (e) {
    pin = "";
    notify(e.message, true);
    $("unlock-status").textContent = e.message;
  } finally {
    delete secret.pin;
    unlockSending = false;
    refreshState();
  }
}
$("unlock-form").onsubmit = (e) => {
  e.preventDefault();
  unlock();
};
$("test-pin").onclick = () => unlock(true);
$("video-mode").onchange = (e) => action("videoMode", { mode: e.target.value });
$("stop-access").onclick = () => action("stop");
$("device-card").onclick = () => {
  window.scrollTo({ top: 0, behavior: "smooth" });
  refreshState();
};
await refreshState();
await refreshFrame();
setInterval(refreshState, 1000);
setInterval(refreshFrame, 750);

$("list-apps").onclick = async () => {
  const result = await action("apps");
  if (!result.ok) return;
  $("app-select").replaceChildren(
    ...result.data.apps
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((app) => {
        const option = document.createElement("option");
        option.value = app.package;
        option.textContent = app.label;
        return option;
      }),
  );
  $("app-list").hidden = false;
};
$("launch-app").onclick = () =>
  action("openApp", { package: $("app-select").value });
