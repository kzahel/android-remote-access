# Android Remote Access

Research for an approachable, standalone way to reach an Android phone left
somewhere else. The repository name is a working name, not a chosen brand.

The motivating example is an old phone in an RV: open the battery vendor's app
and check whether solar is charging the big power station. Other examples are
using the phone as a camera, recovering an app login, and operating a dedicated
phone without visiting it physically.

**Stage: hosted development pairing and encrypted sessions.** TypeScript/React
and Kotlin now enroll real peer identities by QR, reconnect with durable pins,
exchange encrypted test messages through a hosted relay, and revoke access.
See [hosted acceptance](docs/hosted-pairing-proof.md) for measured scope. The
[FCM wake slice](docs/fcm-wake-v1.md) now passes real delivery from the hosted
relay with the app process/socket absent, on an owned emulator and a physical
Pixel 7a, including screen-off forced Doze.
The Android host also manages multiple paired browsers, local nicknames, global
and per-browser access switches, and local SQLite activity history. See
[mobile management](docs/mobile-management.md).
Screen viewing/control and WebRTC are later slices. The
[manual-access spike](spike/README.md) remains the working remote-control demo.
This project is independent of Yep Anywhere and needs no AI runtime.

## Develop

Requirements: Node 22+, pnpm 10.30.3, JDK 17 and Android SDK platform 36 / build
tools 35.0.0 or 36.0.0. Set `ANDROID_HOME` to the SDK. Gradle is supplied by the
committed wrapper with a pinned distribution checksum.

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build:android
```

For real Chromium ↔ Android Keystore verification, install the SDK emulator
and `system-images;android-35;google_apis;arm64-v8a` on ARM64, or `x86_64` on
Intel/AMD hosts, then:

```sh
pnpm exec playwright install chromium
pnpm test:interop
```

The runner creates its own headless API 35 AVD in `.local/crypto-proof/`, refuses
to adopt an existing device, and reaps its browser, emulator and forwarding.
It installs only the crypto proof app on that emulator. No physical phone or
lock credential is involved. Linux needs working KVM; Windows needs an SDK
and process environment capable of running the selected emulator. The local
acceptance below is macOS ARM64; other runner hosts are not yet qualified.
The optional CI interoperability job runs on manual workflow dispatch.

`pnpm --filter @remote/web dev` serves `/crypto.html` for the isolated browser
crypto self-check and `/viewer.html` for the new pairing UI. Hosted pairing
requires HTTPS and the same-origin relay API. To run the public acceptance:

```sh
HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN pnpm test:hosted
```

This separate runner decodes the rendered QR screenshot and uses the normal
Android Grant flow, then tests persisted reconnect and revocation. It owns
an API-35 emulator on port 5594 and an isolated Chromium; artifacts stay in
`.local/hosted-proof/`. See the private dotfiles runbook for deployment.

Existing phone demos retain temporary root asset symlinks and the root server launcher;
new prototype commands run from `spike/`.

Configured Firebase builds can exercise the full native management UI with two
independent browsers and real process-absent wake delivery:

```sh
HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN pnpm test:mobile
```

This owns an emulator and isolated Chromium; it never selects a physical phone.
Private screenshots/results stay in `.local/mobile-proof/`.

## Evidence and plans

See [pairing/relay v1](docs/pairing-relay-v1.md) for enrollment and routing,
[crypto session v1](docs/crypto-session-v1.md) for the exact session construction,
[hosted acceptance](docs/hosted-pairing-proof.md) for measured scope, and the
[production plan](docs/production-plan.md#repository-and-build-structure) for
later slices. The crypto composition has not had independent security review.

- [Run the emulator demo](spike/README.md)
- [Control an attached phone](docs/phone-spike.md)
- [Continuous touch and smooth-view experiment](docs/touch-spike.md)
- [Product inspiration, use cases and open decisions](docs/product.md)
- [Production plan: gates, architecture and phases toward a Play release](docs/production-plan.md)
- [Android capabilities, unlock, wake and background reliability](docs/android-platform.md)
- [Competitors and alternatives](docs/competitors.md)
- [Competitor implementations: unlock, screen power, capture and recovery](docs/competitor-implementations.md)
- [Pinned reference repositories and checkout instructions](research/README.md)
- [UX analysis and research questions](docs/ux.md)
- [Relevant sibling repositories and reuse boundaries](docs/sibling-repositories.md)
- [Sources, review method and evidence limits](research/SOURCES.md)
- [Instructions for future agents](AGENTS.md)

Initial research: **2026-10-18**. It uses official platform documentation,
vendor support material, public project documentation and selected sibling
repository evidence. It is not a hands-on competitor test or a phone experiment.

The most consequential findings are that screen capture, input, waking the
process, waking the display and unlocking are separate capabilities; FCM and
background permissions do not combine into an unconditional availability
guarantee. See the platform analysis before choosing an implementation.
