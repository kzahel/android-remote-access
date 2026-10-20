# Continuous touch experiment

After the 2026-10-20 repository split, run the prototype commands in this
record from `spike/` (`cd spike` from the root). `.local/` resolves to the
preserved root private state through the ignored compatibility symlink.

Authorized 2026-10-19: extend the emulator demo with finger-following scrolling,
slider dragging and two-finger zoom/rotation, paired with a smoother screen feed.
The follow-up also permits automated tests and the attached Pixel 7a. This remains
an experiment in manual access; Internet deployment and a production architecture
are open.

## What is implemented

The browser uses Pointer Events, pointer capture and bounded curved paths. A
single authenticated WebSocket sends ordered 40 ms batches, with at most ten
independent contacts, while fingers stay down. The Android accessibility service
continues each stroke with `continueStroke`; it does not shell out to ADB input.
A second finger can join or lift while the other remains down. Android can
still cancel an accessibility gesture; the viewer asks for a fresh gesture and
never retries an uncertain batch.

Smooth viewing is a separate, visible MediaProjection permission and foreground
service. MediaCodec encodes H.264 baseline, up to 720 pixels on the short side,
with a 30 fps target and 2 Mbps target bitrate. A separate outbound native socket
keeps video off the control connection. The host binds video to the current
native connection generation and bounds each viewer's queue; dropping frames
requires a fresh keyframe. WebCodecs decodes to a browser canvas. JPEG stills
remain the fallback and supply fresh capture/coordinate checks.

Pause, focus/visibility loss, viewport resize and viewer loss end held touch.
The native service also releases after 700 ms without a touch packet, on window
or rotation change at continuation, at a 60-second gesture limit, and on Stop.
Stationary heartbeats keep a deliberate hold alive. These are **releases**, not
a raw `ACTION_CANCEL` guarantee: public accessibility has no direct cancellation
API. Ending a held control can complete its action. Nothing should promise
transactional rollback of a button, drag or long press.

The native playground is an ordinary View consuming actual MotionEvents. It
contains a slider, a map for pinch/rotation/pan and a checklist. A private witness
records native contacts and effects independently of browser acknowledgements,
using atomic replacement so observers never read a partially written snapshot.
Tests also scroll the real Android Settings app.

## Measured evidence

Reviewed and run 2026-10-19. Exact reports, device identifiers, captures, recordings
and setup state remain under ignored `.local/`.

### Android 16 host

Google APIs ARM64 API 36, target SDK 36:

- **12 continuous-touch checks passed** in managed Chromium: slider effect before
  lift, stationary hold, joining a second finger, simultaneous zoom/rotation,
  partial lift with continued pan, curved scrolling, no unexpected native
  cancellation during ordinary continuation, H.264 decoding, socket loss,
  native lost-packet watchdog, pause/recovery and rotation interruption. Mobile
  layout and uncaught-error checks also pass within this suite.
- **Seven boundary checks passed** against the actual service: fractional
  duration/identity, non-boolean hold and off-screen paths fail before touch;
  skipped sequence releases contact; ordinary Settings scrolls while held;
  an unsupported codec falls back cleanly and a valid keyframe restores video;
  protected capture covers video and stops browser decoding; leaving that
  screen resumes video under the existing consent; Stop releases contact,
  stops the projection service, hides video and stays stopped.
- The final continuous run decoded **121 frames over 6.40 seconds (18.9 fps)**
  during its defined interaction window. Touch-batch acknowledgements were
  **43.9 ms median, 63.8 ms p95, 101.2 ms maximum**, including native batch execution.
  The independent witness reached two held contacts, 1.63× zoom and 36° rotation,
  with zero unexpected cancellations during the ordinary gestures. The dropped-
  packet release was observed within 944 ms, including polling and ADB overhead.

These are local lab measurements, not physical-finger motion-to-photon latency.
The slider timing field measures the complete scripted drag plus witness read;
it is deliberately not advertised as first-response latency. A stationary
screen need not emit 30 distinct encoded frames per second.

The existing native/control regression also passed **26 checks on API 36**,
including both explicitly authorized one-shot synthetic-PIN routes. Lock was
observed to revoke the active projection while the separate accessibility
connection remained reachable. Five browser regression checks and eight common
host authority/delivery tests passed; Android assembly and lint passed.
The updated runner then passed all **nine lifecycle checks**: force-stop,
explicit preparation, actual reboot, locked first-unlock storage, no spontaneous
grant recovery, one host-assisted synthetic first unlock and verified local
re-arming. This remains host-assisted emulator recovery.

Repeated cold-start/reboot work exposed a stale framework connection: the app
could answer over TCP while `getServiceInfo()` was null and capture returned
internal error 1. An Android accessibility `init(null, -1)` can revoke authority
before a Java `onUnbind` callback. Native Start and heartbeat now check the actual
framework connection and revoke the grant when it disappears. Emulator setup
disables the fixture service, waits for unbind, reaps only that app process,
skips an identical APK replacement and waits for package broadcasts to become
idle before re-enabling it. Setup still requires a real successful capture and
retains private failure diagnostics; an answering socket alone is not readiness.

### Android 15 host

Google APIs ARM64 API 35, target SDK 36: **12 continuous-touch checks, six
boundary checks and five browser checks passed**. The browser regression includes
real sequential typing, cursor deletion, Unicode and a delayed field read that
cannot overwrite newer keys. The continuous run decoded **82 frames over 6.56
seconds (12.5 fps)**, with touch-batch ACKs of **44.3 ms median, 62.4 ms p95 and
101.4 ms maximum**. Native two-finger zoom/rotation and interruption outcomes
matched API 36. This older base image has a September 2024 security patch;
its projection behavior must not be generalized to Android 15 QPR1+.
The existing native/control regression passed **25 checks**. Projection remained
active across lock on this pre-QPR1 image; the host still withholds its video
while keyguard is showing. Known-PIN input and viewing recovered independently.

An initial API 35 interruption check started while coordinate refresh was
temporarily unavailable. The runner now waits for input readiness before each
new gesture, without retrying a delivered gesture; the viewer explicitly asks
the user to touch again when coordinates are refreshing.

### Physical browser client

The authorized attached **Pixel 7a**, Android API 37, Chrome 155, successfully
controlled the API 36 emulator from its real Chrome browser. Three automated
checks passed: native slider effect while held, two contacts zooming/rotating
together, and H.264 decoding with no horizontal overflow or uncaught browser
errors. The final interaction decoded **78 frames at 21.6 fps**; touch-batch ACKs
were **51.9 ms median, 77.5 ms p95, 107.6 ms maximum**. This was CDP-injected touch
on physical browser hardware, **not a physical-finger trial**, and the Pixel
was the client, not the Android host.

The runner verifies the exact eligible model through a private selector and
Machine Control's read-only handheld doctor. It opens only its own new Chrome
tab, uses temporary selected-device ADB transports to the loopback demo and
DevTools, closes that tab, removes only transports it created and restores the
previous foreground activity. It preserves existing tabs, mappings, credentials,
lock/debugging settings and installed apps. No host APK was installed on the
physical phone. The remote screen must be within the client viewport for input;
the runner scrolls it into view before injecting contacts.

### Physical Android host

The subsequent explicit request to control the attached phone was implemented
and tested on the Pixel 7a itself. See [the USB phone host runbook and measured
results](phone-spike.md): eleven touch checks, five browser checks and seven
boundary checks passed on Android 17/API 37. This is native phone input and
capture over a local USB transport, distinct from the browser-client trial
above. Physical secure unlock, Internet reachability and overnight survival
remain unqualified.

## Fidelity and remaining limits

This proves useful continuous touch, rather than isolated swipes replayed after
lift. It does not expose raw hardware input. Path segments have scheduled timing
and are limited by Android accessibility dispatch, batch cadence and browser
sample coalescing. Pressure, contact shape, stylus tilt/buttons, palm rejection,
hover, haptics and an exact physical sampling clock are not forwarded. Two
contacts were qualified; ten is an implemented protocol limit, not a measured
ten-finger result. The partial-lift case uses a specifically scripted browser
PointerEvent because CDP requires zero contacts in `touchEnd`.

Browser/OS-reserved edge gestures, app restrictions, OEM behavior, competing local
fingers, iOS/Safari clients, lossy WAN links and physical-finger ergonomics remain
untested. WebCodecs needs browser support and a secure context; loopback qualifies.
Production transport must address TLS/encryption, pairing, relays and abuse
boundaries separately. `ws` is an exact-pinned MIT dependency; no Buddy or scrcpy
native code/APK was copied.

Capture consent, input authority, secure unlock and network reachability remain
distinct. Android 16 stops projection on lock and needs visible consent again;
accessibility still viewing and the explicitly authorized disposable known-PIN
experiment are separate. An older base Android 15 emulator does not establish
Android 15 QPR1+ projection behavior. No wrong credential, lock weakening or
phone-local first-unlock recovery is part of this extension. Overnight/Doze,
Bluetooth apps, Internet operation and production readiness remain unqualified.

## Reproduce

See the [demo runbook](../spike/README.md). After starting/re-arming the owned AVD:

```sh
python3 scripts/demo.py smooth
node scripts/touch-acceptance.mjs
node scripts/pixel-client-acceptance.mjs  # optional authorized attached Pixel client
node scripts/touch-boundaries.mjs        # ends access; re-arm to continue
```

All browser runners close their owned managed browser or disconnect their owned
physical-browser debugging session in `finally`. The Pixel runner currently uses
the sibling Machine Control Android adapter for read-only readiness. It refuses
a locked/unavailable client instead of attempting credential entry.

## Platform references and implementation lessons

Reviewed 2026-10-19, platform source/documentation:

- [GestureDescription, Android 16 release](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-16.0.0_r1/core/java/android/accessibilityservice/GestureDescription.java):
  immutable scheduled paths, continuation and runtime stroke limits. A
  continuation must start at the previous endpoint.
- [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService):
  `dispatchGesture` can cancel existing touch. This is not unrestricted
  MotionEvent input.
- [AccessibilityService, pinned Android 16 source](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-16.0.0_r1/core/java/android/accessibilityservice/AccessibilityService.java):
  connection lookup for `getServiceInfo()` and screenshot error 1 when the
  framework connection is absent. This informed the readiness check above.
- [MotionEventInjector, pinned Android 16 source](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-16.0.0_r1/services/accessibility/java/com/android/server/accessibility/MotionEventInjector.java):
  reviewed while diagnosing continuation validation. A stationary continuation
  yields no generated events; retain the existing stroke and renew only the
  heartbeat. A joining stroke starts at 1 ms, after the existing continuation's
  initial point, so it does not invalidate the continuation's first step. These
  details were then verified through delivered native events.
- [MediaProjection](https://developer.android.com/media/grow/media-projection):
  visible consent, foreground-service type and one capture session per consent.
  Resize the existing virtual display instead of recreating capture authority.
  Android 15 QPR1+ stops projection on lock; never silently re-authorize it.
- [Pointer Events](https://www.w3.org/TR/pointerevents3/): pointer identities,
  capture and cancellation. Browser/OS-reserved gestures remain separate.
