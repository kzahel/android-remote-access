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

## Limits

This does not establish behavior before first local unlock, natural overnight
availability, current-API/OEM-wide unlock support, or Play approval.
Projection consent is not saved/reused, and no
production accessibility code auto-approves it. Android can stop projection on
lock and secure content can be blank or refused. Arbitrary network transitions
and OEMs remain separate qualification; direct-path loss and relay recovery have
measured acceptance. Physical FCM evidence is a wake test, not proof of physical
remote unlock.
