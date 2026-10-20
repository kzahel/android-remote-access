# Hosted control acceptance

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

Limits: this does not establish physical Pixel control/video acceptance, behavior
before first local unlock, natural overnight availability, current-API/OEM-wide
unlock support, or Play approval. Projection consent is not saved/reused, and no
production accessibility code auto-approves it. Android can stop projection on
lock and secure content can be blank or refused. Actual reboot recovery,
rotation/socket-loss qualification and direct-transport acceptance are tracked
separately in the completion plan. Existing FCM physical evidence is a separate
wake test, not proof of this combined control path.
