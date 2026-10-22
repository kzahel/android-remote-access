# Remote control acceptance

Measured 2026-10-20 with the public HTTPS/WSS development service, isolated
Playwright Chromium, and an owned API-35 Google APIs emulator. The default host
APK contains no test activities or shell-control path. All remote inputs originate
in the browser and cross the E2E session/hosted relay; the instrumentation APK
supplies an independent native effect witness and operates local setup/management.

The complete combined run passed with viewer revision `08f684c` and the current
host candidate. Private receipts and captures remain under ignored
`.local/control-proof/`; selectors and credentials are not committed.

- Independent native button/text/scroll witnesses, Home and installed-app launch.
- Slider movement while held; long press without an extra tap; two-finger pinch
  and rotation observed as native multi-pointer moves.
- Pause the browser's JS while the socket remains connected: the native watchdog
  releases a held slider without a dummy tap.
- Lock, wake and unlock twice: once using the explicitly saved phone-local PIN,
  once with the always-visible browser PIN field. Credentials are synthetic and
  only set on the owned emulator, never a physical phone.
- One deliberately wrong synthetic PIN blocks another attempt, forgets the saved
  PIN, and records exactly the requested attempts. New vault instances cannot
  clear the persisted latch. Local emulator cleanup restores its credential.
- Normal Android screen-sharing approval, actual H.264 decoded frames, quality
  change with fresh keyframes, and simultaneous video/input.
- Save data mode on an animated native fixture: 50 decoded frames in 5.002 s,
  253,916 encrypted WebSocket bytes received (about 0.41 Mbps). This is a fixture
  measurement, not a general capacity/quality guarantee. The Pi receives and
  forwards those bytes; other applications/quality modes can cost more.
- Global disarm ends the session; browser disabling/removal and fixture revocation
  complete normally. Native migration/encryption/attempt-latch tests also pass.

Reproduce after building both APKs and deploying the matching viewer:

```sh
HOSTED_ORIGIN=https://YOUR_ORIGIN HOSTED_TOUCH=1 HOSTED_UNLOCK=1 HOSTED_VIDEO=1 \
  pnpm exec tsx scripts/hosted-acceptance.ts --control
```

The runner owns emulator port 5594, uses explicit DNS for that disposable device,
checks public-origin reachability before creating an invitation, and restores
synthetic lock state even after ordinary failures. An interrupted synthetic-lock
marker is recovered on the next run. It refuses occupied/physical selectors.

Room migration preserves old browsers and defaults unlock permission to off.
Saved PIN ciphertext is in credential-protected no-backup storage, encrypted by
Android Keystore. The key deliberately does not require per-use authentication,
so it can work while locked **after the first local unlock after reboot**.
Mutable credential buffers are cleared where practical; JS/JVM immutable strings
and OS input internals cannot promise immediate memory erasure. Audit records
contain action categories, never PINs, typed text or screen contents.

## Physical control and direct transport

The attached Pixel 7a, Android 17/API 37, passed ordinary control on 2026-10-20
against viewer revision `68c6e3a`: rendered QR/normal pairing approval, visible
Android accessibility consent, screenshots, native tap, Unicode text, scroll,
navigation/app launch, held slider, long press, two-pointer pinch/rotation and
watchdog release. Normal system projection consent led to H.264 decoding and live
quality changes. Native WebRTC passed; Save data mode decoded 50 frames in
5.001 seconds with zero received WebSocket media bytes. Actual peer-connection
loss during a held drag released input and recovered through encrypted relay
fallback without replay. Global disarm, browser disable/removal and signed cleanup
passed with no browser errors. Both newly installed packages were removed and
the prior task requested again. Other apps/services were preserved.

No physical PIN was entered or saved, and no lock/debugging/reboot changes were
made. Credentials/reboot remain disposable-emulator tests. The keyboard witness
queries actual IME insets so the harness only sends Back to dismiss a keyboard
when it is present. Input effects and screen geometry come from an independent
native activity confined to the test APK.

For an explicitly authorized physical fixture, supply `HOSTED_DEVICE` privately
and `HOSTED_DEVICE_MODEL` with its exact model, plus `HOSTED_TOUCH=1 HOSTED_VIDEO=1
HOSTED_DIRECT=1`, to the same `--control` command. The runner checks identity,
awake/unlocked state, user 0 and absent host/test packages before installation.
It refuses synthetic-unlock/reboot/orientation fixtures on physical targets. It
preserves existing applications and uses visible consent, not secure-setting
mutations. Success removes only its owned packages; failure preserves their keys
for authenticated cleanup. Receipts are in ignored `.local/physical-control-proof/`.

## Combined reboot, idle wake and control

The final Android 0.6.0 owned-emulator run passed kernel reboot, observed
credential-locked storage, one required local first unlock of the synthetic
fixture, actual boot-receiver delivery, persisted restart opt-in and encrypted
saved-PIN availability. It then detached instrumentation, closed foreground
listeners, slept the display and independently observed forced deep `IDLE`.
The browser request produced a fresh real Firebase receipt (the relay only sends
FCM when its phone route is absent). Saved-PIN unlock succeeded, and the same
session completed all ordinary/continuous input checks, all three H.264 quality
modes, display rotation while dragging, watchdog release, wrong-PIN guard/local
forgetting and disarm/revocation cleanup. There were no browser errors.

The final Save data sample decoded 50 frames in 5 seconds and received 252,239
encrypted WebSocket bytes (about 0.40 Mbps). This is fixture traffic, not a
capacity guarantee. Accessibility can keep an Android process resident, so this
run proves socket-absent FCM wake/control, not an absent host process. The separate
FCM canary tests prove process-absent delivery with screen access disabled.

Add `HOSTED_CONTROL_WAKE=1 HOSTED_BOOT=1 HOSTED_ROTATION=1` to the emulator
invocation above to reproduce. Tests attach with `am instrument --no-restart`:
default instrumentation finish force-stops the target and would invalidate the
service/session lifecycle being measured. Real boot delivery is observed before
reattachment. Battery/idle overrides and synthetic credentials are restored on
exit; owned browser/emulator processes are reaped. Manual CI dispatch can also
opt into the relay/video/gesture/synthetic-unlock/rotation suite using the
`control_acceptance` input. CI does not select a physical phone.

Final pairing/management regressions also pass against deployed revision
`c413cb2`: two independently paired browsers, setup before permissions, permission
revocation/repair, process-absent FCM for both, restart persistence, global and
isolated browser pause, stale-generation rejection and signed removal. The
single-browser hosted regression independently passed process-absent real FCM,
encrypted exchange, Android/browser restart persistence and revocation. Its
observed request-to-receipt/exchange times were 415/615 ms, with estimated clock
uncertainty of 8 ms; these are measurements, not an availability promise.

## Stable viewer layout

The connected viewer uses the authenticated phone model as its heading and one
fixed-height status area. The screen occupies a fixed viewport-relative stage;
unlock and permission guidance appear inside it. Navigation, wake, lock and
disconnect share a compact icon dock. Smooth view uses a direct switch;
typing/app controls open in a dialog without moving the screen or dock.

`pnpm test:viewer-layout` runs the actual React screen with a synthetic session
in isolated Chromium at 1280×1000, 1728×997, 390×844, 320×680 and 844×390. All five pass
exact geometry and page-scroll comparisons through saved/manual unlock, lock,
navigation, long errors, unlock-attempt guards, permission loss, decoded frames,
rotation and both dialogs. It also verifies one heading/status, preserved touch
aspect ratio and no browser errors. This fixture does not exercise Android or
submit a credential to a physical phone; native control acceptance is separate.

The deployed viewer also passed the combined hosted emulator suite: manual and
saved synthetic-PIN unlock, native input/navigation/app launch, held/multitouch
gestures, H.264 quality changes, display rotation, failed-unlock guard, disarm and
revocation, with no browser errors. Save data decoded 50 frames over 5.002 seconds
with 255,899 encrypted relay bytes. The retained physical Pixel 9 session showed
one `Pixel 9` heading and one status, rendered screenshots and upgraded to direct
WebRTC after an in-place host update. No physical credential was submitted.

## Limits

This does not establish behavior before first local unlock, natural overnight
availability, current-API/OEM-wide unlock support, or Play approval.
Projection consent is not saved/reused, and no
production accessibility code auto-approves it. Android can stop projection on
lock and secure content can be blank or refused. Arbitrary network transitions
and OEMs remain separate qualification; direct-path loss and relay recovery have
measured acceptance. Physical FCM evidence is a wake test, not proof of physical
remote unlock.

## Smooth-view lifecycle — 2026-10-21

The viewing-quality dialog has been replaced by one Smooth view switch using
Balanced internally. Consent/start/end states and request identity address
cancellation, pending Off, stale callbacks, recreation and deadlines. See the
[investigation, implementation and regression harness](smooth-view-lifecycle.md).
Earlier quality-mode traffic figures above describe their pinned historical
runs; the current browser acceptance runner requests Balanced.


## CI smoke profile — 2026-10-22

The reusable emulator workflow runs browser/Keystore interoperability, native
navigation/local-security controls, Room/storage/migrations, and (when a hosted
origin is supplied) pairing, process-absent FCM and ordinary encrypted control.
Hosted control includes viewing, input, H.264 and rotation. Video continuity
requires ten additional decoded frames within a bounded wait after the initial
five-second sample; elapsed time and bytes are recorded, without treating a
shared software emulator as a device throughput benchmark. It uses synthetic
owned devices, not a physical phone. Android signing is gated on this profile.
With `HOSTED_SERIAL_VIDEO=1`, CI first verifies video continuity plus native tap/text,
then explicitly stops the encoder before held gestures, watchdog and rotation.
A combined software-video run [timed out on long press](https://github.com/kzahel/yepcontrol/actions/runs/39742758383);
the 700 ms input watchdog is unchanged. This is capability smoke, not qualification
of simultaneous video/held-input performance on a shared Linux runner. The default
local profile keeps video active throughout and has passed on the owned ARM emulator.
The hosted harness attempts native signed revocation before shutting down its
owned emulator on either success or failure. An intentional post-pair failure
verified this cleanup path. Native failure diagnostics expose only application
stack locations and allowlisted synthetic state; raw logs, QR material and grants stay private.

Ephemeral CI debug signing keys are not in the website's domain association.
`HOSTED_VERIFY_APP_LINKS=0` supplies a test-only marker so the decoded invitation
enters the explicit native activity and normal Grant UI; native HTTPS/origin
validation still runs. OS-verified App Links are a separate associated-signer or
Play-installed check, not a claim made by this CI profile.

An additional Linux x86_64 emulator credential run passed saved-PIN unlock but
[timed out during manual PIN unlock](https://github.com/kzahel/yepcontrol/actions/runs/39730437607).
This remains an unresolved extended qualification result; no production input
or unlock behavior was changed to make CI pass. The same extended control run
passed on the owned macOS/ARM64 emulator against the Node 24 relay. Full
credential/reboot qualification remains separate from ordinary CI smoke, via
the existing `HOSTED_UNLOCK=1` and recovery flags. This observation is not
physical PIN or Play-installed acceptance.
