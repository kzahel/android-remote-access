import { LiveSession } from "./live.js";
let live;
// Write only on change: rewriting identical text every refresh clears selections.
const text = (element, value) => {
  if (element.textContent !== value) element.textContent = value;
};
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
  text($("notice"), message);
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
  text($("cover-title"), title);
  text($("cover-message"), message);
  $("cover-wake").hidden = !wake;
}
function renderState(next) {
  state = next;
  text($("device-name"), next.deviceName || "Demo phone");
  text(
    $("target-label"),
    next.target === "USB-connected phone"
      ? `Phone · ${next.link === "tailscale" ? "via Tailscale" : next.link ? "via ADB" : "offline"}`
      : next.target || "Local prototype",
  );
  $("unlock-experiment").hidden = next.credentialExperiment === false;
  if (next.target === "USB-connected phone") {
    text(
      $("unlock-note"),
      "One attempt, no retry. A wrong PIN counts toward Android’s lockout.",
    );
    $("pin").placeholder = "Phone PIN";
    text($("test-pin"), "Use PIN saved on this computer");
  }
  const connected = !!next.connected,
    s = next.state;
  $("connection-dot").className = "dot" + (connected ? " on" : " warn");
  $("side-dot").className = "dot" + (connected ? " on" : " warn");
  text(
    $("connection-label"),
    connected ? "Phone connected" : "Phone not responding",
  );
  text(
    $("device-subtitle"),
    connected
      ? `Android ${s.release} · ${s.locked ? "Locked" : frame && !next.captureError ? "Ready" : next.captureError ? "View unavailable" : "Connected"}`
      : next.lastSeen
        ? "Connection interrupted"
        : "Waiting for session",
  );
  text(
    $("display-state"),
    s ? `Display · ${s.interactive ? "awake" : "asleep"}` : "Display · unknown",
  );
  text(
    $("lock-state"),
    s
      ? `Lock · ${s.locked ? (s.secure ? "securely locked" : "swipe to open") : "unlocked"}`
      : "Lock · unknown",
  );
  text(
    $("platform"),
    s ? `Android ${s.release} · API ${s.api}` : next.target || "Android",
  );
  $("lab-controls").hidden = !next.lab;
  const viewable = connected && s && !s.locked && s.interactive;
  $("view-smooth").disabled = $("view-stills").disabled = !viewable;
  $("view-smooth").classList.toggle("on", !!s?.video?.active);
  $("view-stills").classList.toggle("on", !s?.video?.active);
  $("quick-unlock").hidden = next.credentialExperiment === false;
  $("quick-unlock").disabled =
    unlockSending || !!next.unlockBlocked || !connected || !s?.locked;
  text(
    $("quick-unlock-label"),
    next.unlockBlocked ? "Unlock attempted" : "Unlock",
  );
  $("quick-unlock").title = next.unlockBlocked
    ? "Unlock on the phone before trying again"
    : next.testCredential
      ? "Unlock with the PIN saved on this computer (one attempt)"
      : "Enter the phone PIN";
  $("test-pin").hidden = !next.testCredential;
  $("test-pin").disabled =
    unlockSending || !!next.unlockBlocked || !connected || !s?.locked;
  $("unlock-route").querySelector('option[value="shell"]').disabled = !next.lab;
  $("unlock-form").querySelector("button").disabled =
    unlockSending || !!next.unlockBlocked || !connected || !s?.locked;
  if (next.unlockBlocked)
    text(
      $("unlock-status"),
      "Unlock attempted. Unlock on the phone before trying again.",
    );
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
        ? "Connection lost. If it doesn’t return, press Start remote access in the phone app."
        : "Press Start remote access in the phone app.",
    );
  } else if (!s.interactive) {
    live?.cancel("Phone is asleep");
    live?.pauseVideo("Phone is asleep");
    frame = null;
    cover("The screen is asleep", "", true);
  } else if (s.credentialCapturePaused) {
    live?.pauseVideo("Unlocking · view paused");
    cover("Unlocking · view paused", "Waiting for the observed lock state");
  } else if (paused) cover("Viewer paused", "Screen refresh paused.");
  if (s)
    if (!s.video?.active && !live?.videoActive)
      text(
        $("smooth-status"),
        s.video?.message || "Allow smooth screen sharing on the phone",
      );
  if (s?.video?.mode && document.activeElement !== $("video-mode"))
    $("video-mode").value = s.video.mode;
  if (s?.video?.active && s.video.fps)
    text(
      $("smooth-status"),
      `Smooth view · up to ${s.video.fps} fps` +
        (s.video.mode === "auto"
          ? s.video.profile === "saver"
            ? " · Auto chose data saver (metered network)"
            : " · Auto chose standard (unmetered network)"
          : ""),
    );
  if (s)
    text(
      $("diagnostics"),
      [
        `Process reachable: ${connected ? "yes" : "no"}`,
        `Display awake: ${s.interactive}`,
        `Keyguard showing: ${s.locked}`,
        `Device credential locked: ${s.deviceLocked}`,
        `Secure credential: ${s.secure}`,
        `User storage unlocked: ${s.userUnlocked}`,
        `Foreground: ${s.package || "unknown"}`,
        `Capture: ${next.captureError || (frame ? "last request succeeded" : "waiting")}`,
        `Android API / target SDK: ${s.api} / ${s.targetSdk}`,
        s.grantSeconds < 0
          ? "Grant: until stopped"
          : `Grant remaining: ${Math.ceil(s.grantSeconds / 60)} min`,
        "",
        s.route,
        next.transport,
        "",
        next.limits,
      ].join("\n"),
    );
  const entries = (next.log || []).slice(0, 15);
  const activityKey = JSON.stringify(
    entries.map((entry) => [entry.at, entry.message]),
  );
  if (activityKey !== lastActivity) {
    lastActivity = activityKey;
    $("activity").replaceChildren(
      ...entries.map((entry) => {
        const li = document.createElement("li"),
          time = document.createElement("time");
        time.textContent = new Date(entry.at).toLocaleTimeString();
        li.append(time, document.createTextNode(entry.message));
        return li;
      }),
    );
  }
}
let lastActivity = "";
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
      text(
        $("frame-state"),
        transient ? "Screen · refreshing" : "Screen · unavailable",
      );
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
        notify("Connected.");
      }
      screen.src = `data:image/jpeg;base64,${frame.image}`;
      $("phone").classList.toggle("landscape", frame.width > frame.height);
      $("screen-cover").hidden = true;
      text($("frame-state"), "Screen · available");
      text($("frame-time"), new Date(result.capturedAt).toLocaleTimeString());
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
    text(
      $("view-mode"),
      paused ? "PAUSED" : live?.videoActive ? "SMOOTH VIEW" : "LIVE STILLS",
    );
    if (count !== null)
      text(
        $("touch-status"),
        count
          ? `${count} finger${count === 1 ? "" : "s"} down · sending movement`
          : "Touch ready · accessibility continuation",
      );
    // While video plays, renderState owns this line (fps and Auto choice).
    if (message) text($("smooth-status"), message);
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
    text($("typing-help"), "Editing the focused field.");
    text($("typing-status"), "Field ready");
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
  text($("typing-status"), "Sending…");
  const result = await action("text", { field: target, text, start, end });
  sending = false;
  if (!result.ok) {
    $("live-typing").checked = false;
    fieldReadSequence++;
    field = null;
    $("send-text").disabled = true;
    text($("typing-status"), "Delivery unconfirmed · no replay");
    // Keep the draft locally until the user explicitly chooses a field again.
    delivered = revision;
    return;
  }
  delivered = n;
  text($("typing-status"), "Edit delivered · check phone");
  if (revision !== delivered && $("live-typing").checked)
    queueMicrotask(sendEdit);
}
$("typing").addEventListener("input", () => {
  revision++;
  text($("typing-status"), "Draft changed");
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
  text($("disconnect"), paused ? "Resume viewer" : "Pause viewer");
  text($("view-mode"), paused ? "PAUSED" : "LIVE STILLS");
  if (paused) {
    live.cancel("Viewer paused");
    live.pauseVideo("Viewer paused");
    frame = null;
    cover("Viewer paused", "Screen refresh paused.");
  } else refreshFrame();
};
$("inspect").onclick = async () => {
  const result = await action("inspect");
  $("nodes").hidden = false;
  text($("nodes"), JSON.stringify(result.data, null, 2));
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
  text(
    $("unlock-status"),
    "Submitting once. Waiting for the phone’s observed lock state…",
  );
  try {
    // Wake and show the unlock screen first; the phone then taps past
    // the fingerprint screen and enters the PIN once.
    if (route !== "shell") {
      await api("/api/action", { op: "wake" });
      await api("/api/action", { op: "dismiss" });
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const result =
      route === "shell"
        ? await api("/api/lab", { action: "unlock", ...secret })
        : await api("/api/action", { op: "unlock", ...secret });
    pin = "";
    notify(result.message, !result.ok);
    text($("unlock-status"), result.message);
    // Locking ended screen sharing; bring smooth view back after a remote unlock.
    if (
      result.ok &&
      result.data?.locked === false &&
      route !== "shell" &&
      !preferStills
    )
      action("smooth");
  } catch (e) {
    pin = "";
    notify(e.message, true);
    text($("unlock-status"), e.message);
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
let preferStills = false;
$("view-smooth").onclick = () => {
  preferStills = false;
  action("smooth");
};
$("view-stills").onclick = () => {
  preferStills = true;
  action("smoothOff");
};
$("quick-unlock").onclick = async () => {
  if (!state?.testCredential) {
    $("advanced").open = true;
    $("pin").focus();
    return;
  }
  unlock(true);
};
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
