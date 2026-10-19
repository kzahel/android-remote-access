# Continuous touch experiment

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
records native contacts and effects independently of browser acknowledgements.
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
- **Six boundary checks passed** against the actual service: fractional
  duration/identity, non-boolean hold and off-screen paths fail before touch;
  skipped sequence releases contact; ordinary Settings scrolls while held;
  protected capture covers video and stops browser decoding; leaving that
  screen resumes video under the existing consent; Stop releases contact,
  stops the projection service, hides video and stays stopped.
- The continuous run decoded **122 frames over 6.44 seconds (18.9 fps)** during
  its defined interaction window. Touch-batch acknowledgements were **44.3 ms
  median, 73.1 ms p95, 101.8 ms maximum**, including native batch execution.
  The independent witness reached two held contacts, 1.63× zoom and 36° rotation,
  with zero unexpected cancellations during the ordinary gestures. The dropped-
  packet release was observed within 943 ms, including polling and ADB overhead.

These are local lab measurements, not physical-finger motion-to-photon latency.
The slider timing field measures the complete scripted drag plus witness read;
it is deliberately not advertised as first-response latency. A stationary
screen need not emit 30 distinct encoded frames per second.

### Physical browser client

The authorized attached **Pixel 7a**, Android API 37, Chrome 155, successfully
controlled the API 36 emulator from its real Chrome browser. Three automated
checks passed: native slider effect while held, two contacts zooming/rotating
together, and H.264 decoding with no horizontal overflow or uncaught browser
errors. The interaction decoded **89 frames at 23.6 fps**; touch-batch ACKs were
**51.1 ms median, 75.4 ms p95, 77.6 ms maximum**. This was CDP-injected touch
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
