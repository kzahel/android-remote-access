# Android Remote Access

Research for an approachable, standalone way to reach an Android phone left
somewhere else. The repository name is a working name, not a chosen brand.

The motivating example is an old phone in an RV: open the battery vendor's app
and check whether solar is charging the big power station. Other examples are
using the phone as a camera, recovering an app login, and operating a dedicated
phone without visiting it physically.

**Stage: production foundation plus preserved phone prototypes.** The first
production slice implements an experimental paired crypto session in TypeScript
and Kotlin with shared vectors and a React interoperability harness. It does
not yet implement production phone control. The next slice adds QR enrollment,
durable paired identities and a hosted development relay; see
[pairing/relay v1](docs/pairing-relay-v1.md). The
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

`pnpm --filter @remote/web dev` serves `/crypto.html`, a development-only React
harness with a browser self-check. It is not the consumer viewer. Existing
phone demos retain temporary root asset symlinks and the root server launcher;
new prototype commands run from `spike/`.

## Evidence and plans

See [crypto session v1](docs/crypto-session-v1.md) for the exact construction,
[acceptance](docs/crypto-proof.md) for measured scope, and the
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
