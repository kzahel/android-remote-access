# Complete remote-control delivery

Owner direction, 2026-10-20: implement the complete experience autonomously,
with incremental verified commits. Saved-PIN unlock, continuous touch, smooth
video and direct WebRTC with encrypted hosted fallback are in scope. This does
not authorize Play publication or changing physical-phone lock/debugging settings.

## Delivery and acceptance

1. Hosted control: versioned encrypted commands, screenshots, taps/swipes,
   navigation, text and app launching; native accessibility disclosure and
   permission checks; actual browser-to-Android effects through the relay.
2. Continuous gestures: port the proven continuation mechanics, validate bounded
   sequences/coordinates and release on loss, policy changes and rotation.
3. Wake/unlock: display wake, manual and explicitly saved native PIN, persistent
   one-attempt guard, local forgetting and backup exclusion; opt-in restart
   recovery after the first local unlock. Synthetic emulator credentials first.
4. Smooth viewing: MediaProjection/MediaCodec, encrypted H.264, quality controls,
   bounded queues and stills fallback, measured hosted relay traffic.
5. Direct transport: authenticated WebRTC with bounded setup and automatic relay
   fallback, fresh cryptographic scope and no replay during transport changes.
6. Combined acceptance: process-absent FCM, wake/unlock, actual app operation,
   video, gestures, revocation, network changes and teardown. Qualify natural
   overnight idle separately from forced Doze. Record emulator and physical
   evidence separately; never infer OEM coverage from one Pixel.

Keep Android session lifecycle, accessibility, capture, unlock and transports
separate. Keep viewer rendering/input outside React state updates for media.
Do not rewrite working pairing/management or import the spike wholesale.
A session owns all resources and teardown. Endpoint policy remains authoritative
on every command and asynchronous completion. Commands have bounded schemas and
explicit results; uncertain input is never retried automatically. Media must not
queue ahead of control indefinitely. Relay sees only encrypted application data.

Pairing remains possible before permissions. Feature setup uses progressive
native disclosure, and readiness is queried from actual system/service state.
Do not add unrelated diagnostics or development controls to consumer screens.

Android limits remain visible: first unlock after reboot is local; projection
stops on lock on current Android and needs fresh system consent; protected
content cannot be promised. Accessibility-assisted projection consent from the
spike is experimental, not an accepted unattended recovery mechanism. Play
policy/security review and multi-OEM qualification remain release gates.

Tests combine deterministic TS/Kotlin protocol and state-machine coverage,
owned-emulator instrumentation with independent effect witnesses, isolated
Chromium against the real relay/FCM, and authorized Pixel 7a checks. Store device
selectors, credentials, captures and receipts only under ignored private paths.
No production test activities or ADB control paths belong in the shipped APK.

## Progress

- Hosted basic control passes on the owned API-35 emulator through the public
  relay: screen images, native tap, Unicode text, real scroll, Home, installed-app
  launch, global disarm and removal. The independent witness is confined to the
  instrumentation APK. The normal production APK contains no test activities.
- Combined owned-emulator relay acceptance now passes held dragging, long press,
  two-finger pinch/rotation, lost-packet release, saved/manual PIN unlock, one wrong
  synthetic PIN with persisted recovery guard and local forgetting, H.264 decoding,
  quality change and full disarm/removal cleanup. See [control acceptance](control-acceptance.md).
- Native WebRTC and fresh encrypted relay recovery pass on the emulator and
  physical Pixel 7a. The physical ordinary-control/video/gesture suite passes,
  including mid-drag peer loss, no replay and cleanup. See
  [direct transport](direct-transport.md) for measurements and dependency notices.
- The complete owned-emulator run passes kernel reboot, required local first
  unlock, actual boot receiver delivery, persisted opt-in/encrypted PIN, screen-off
  forced-Doze FCM with no application relay socket, saved/manual unlock, all three
  video modes, gestures, display rotation while held and full teardown. The
  receiver and FCM execute with instrumentation detached; no-restart attachment
  preserves the live host/session.
- The requested development features are implemented. Natural unplugged overnight
  idle, broader OEM/NAT/network-change qualification, independent security review
  and Play-policy/distribution work remain release qualification. Forced Doze is
  not overnight evidence; no physical PIN/reboot qualification is claimed.
