# YepControl

An approachable, standalone way to reach an Android phone left somewhere else.
**YepControl is the product name** (owner decision, 2026-10-21). The hosted website is **https://yepcontrol.com**, and the Android application ID
is **`com.yepcontrol.app`** (owner request, 2026-10-21). The repository, Kotlin
namespace and source packages retain their working names.

The motivating example is an old phone in an RV: open the battery vendor's app
and check whether solar is charging the big power station. Other examples are
using the phone as a camera, recovering an app login, and operating a dedicated
phone without visiting it physically.

**Stage: hosted development remote control.** The Kotlin host and React viewer
pair by QR, manage multiple browsers, and carry end-to-end encrypted screen
images, video and input through the hosted relay. The owned-emulator acceptance
covers tap/swipe/navigation/text/app launch, held dragging, long press, pinch and
rotation, manual/saved-PIN unlock, failed-attempt recovery, H.264 quality changes,
lost-packet input release and revocation. See [control acceptance](docs/control-acceptance.md).
The [FCM wake slice](docs/fcm-wake-v1.md) has separate emulator and physical
Pixel 7a evidence, including process-absent, screen-off forced Doze. Combined
Pixel 7a control/video and native direct WebRTC acceptance also pass, including
mid-drag direct loss and encrypted relay recovery without input replay. The
combined emulator run also covers reboot/first local unlock, forced-Doze FCM,
saved-PIN unlock, video, display rotation and teardown. Natural overnight and
broader OEM/network qualification remain; see the
[completion plan](docs/control-completion.md).
Android manages browser nicknames, per-browser/global access and SQLite activity
history; see [mobile management](docs/mobile-management.md).
This project is independent of Yep Anywhere and needs no AI runtime.

## Product direction: YepControl

Proposed **2026-10-20**; the owner adopted the name on **2026-10-21**. The
relationships to sibling products below remain proposals, not completed
integrations.

- **YepControl** is the public device-access/control brand, starting with this
  Android app and browser viewer, which now use the name. **YepControl — Remote
  Phone** is a candidate initial listing name; wider device support can follow
  implementation.
- **Machine Control** would remain the reusable control toolkit and CLI. Its
  desktop app could later adopt YepControl branding while existing commands,
  repository names and documentation remain compatible. Reusable Android
  wake, input and guarded PIN-unlock components could move into its Android
  platform implementation and be consumed here.
- **YepAnywhere**, including its experimental **Android host**, would remain
  the agent/session product. Android host runs agents on the phone; YepControl
  provides manual access to the phone, including repairing a host/provider
  login when agent authentication has failed. Shared native components could
  support both experiences with separate permissions and credential custody.

Manual phone access remains useful on its own. Module extraction, sibling
integration, desktop rebranding and Play publication remain future work.
The domain and Android identity are configured; see [App Links and installation](docs/app-links.md). See the [product direction](docs/product.md#product-direction-yepcontrol)
and [sibling relationships](docs/sibling-repositories.md#yepcontrol-relationship).

## Develop

Requirements: Node 22+, pnpm 10.30.3, JDK 17 and Android SDK platform 36 / build
tools 35.0.0 or 36.0.0. Set `ANDROID_HOME` to the SDK. Gradle is supplied by the
committed wrapper with a pinned distribution checksum.

The public Android Firebase client configuration is checked in at
`android/app/google-services.json`, so ordinary builds include remote wake.
The relay's private Firebase service-account credentials are provisioned
separately and must never be committed. A separate deployment needs its own
Android Firebase registration/client config and matching relay sender project.

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

Android builds can exercise the full native management UI with two
independent browsers and real process-absent wake delivery:

```sh
HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN pnpm test:mobile
```

This owns an emulator and isolated Chromium; it never selects a physical phone.
Private screenshots/results stay in `.local/mobile-proof/`.

`pnpm test:viewer-layout` exercises the actual React viewer in isolated Chromium
against a synthetic session. It checks screen/control geometry and page scroll
through lock/unlock, messages, permission loss, rotation and dialogs at desktop,
mobile and landscape sizes. It needs Playwright Chromium, no Android device or
relay. Private screenshots/results stay in `.local/viewer-layout-proof/`.

The website has a desktop phone sidebar, a mobile navigation drawer and a fixed
phone/status bar. Remote controls sit to the right of the screen. Client Settings
provides System/Light/Dark appearance, optional control labels and sidebar
visibility without leaving the live viewer.

The website's home page lists all phones saved in this browser, with local names
and last successful contact times. **Add phone** preserves existing phones;
`/phones/<phoneId>` is bookmarkable and separate phones can connect in separate
tabs. Names/history live in IndexedDB, alongside existing browser pairing storage.
Opening a phone checks its status automatically. Its screen frame and disabled
control rail are visible immediately, with a **Connect** overlay to start viewing.
See [browser phone management](docs/browser-phones.md). Run
`pnpm test:viewer-phones` for isolated browser migration, multi-phone/tab and
responsive acceptance; no Android device or relay is selected.

The Android app has a fixed title bar and a drawer for **Home**, **Devices**,
**Activity** and **Settings**. Home keeps the access switch and current connection,
a large **Scan pairing code** tile that opens the scanner directly, a website row
with copy, share and an inline website QR, and up to three paired devices.
**Devices** lists paired clients
(browsers today) with per-device permissions. **Settings → Appearance** offers System/Light/Dark with
a green accent. Approval works before Android permissions; **Finish setup** is a
skippable checklist of switches that show Android's actual state, the same
checklist that heads Settings.
Run `pnpm test:mobile-ui` for relay-independent native navigation/theme acceptance;
see [mobile navigation](docs/mobile-management.md#simplified-navigation-and-appearance).
Allowed browsers can check the secure connection while the app is visible without
notification permission. Optional
background requests require their own opt-in and notification setup. Screen
viewing/input use the separately enabled Android screen-access service. Smooth
video asks for fresh system screen-sharing consent. Manual PIN entry remains
visible while locked, whether or not a PIN is saved locally; each browser needs
its own unlock permission.

Android's public website link is compiled from the `sharingWebsite` Gradle
property (HTTPS origin, no trailing slash); its default is the hosted website.
For a separate deployment, supply `-PsharingWebsite=https://YOUR_ORIGIN` to the
Android build. QR encoding uses the pinned Apache-2.0 ZXing **core** 3.5.3 Java
library; its license is included in APK assets under `third-party/`.

### Local relay over Tailscale

With Tailscale running on this computer and the phone, `pnpm dev` runs the relay
(`tsx watch`, state in `.local/dev-relay/`) and the Vite viewer, and publishes
them at `https://<this-machine>.<tailnet>.ts.net` with a foreground
`tailscale serve`. Ctrl+C removes the serve configuration. Set `DEV_HTTPS_PORT`
if port 443 is already served. Remote wake is off unless the relay environment
has `FIREBASE_PROJECT_ID` and Firebase credentials.

Open that address on a tailnet device and scan its pairing code with the phone.
The phone uses the relay named in each pairing code, so any build can pair with
it and hosted pairings keep working. To make sharing setup show the local link,
add `devSharingWebsite=https://<this-machine>.<tailnet>.ts.net` to the ignored
`android/local.properties` (or pass `-PdevSharingWebsite=…`); debug builds then
offer **Use development website** under Settings.

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
- [Hosting and TURN options (potential future direction)](docs/hosting-and-turn.md)
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

## License

Project-owned source is [MIT licensed](LICENSE). Bundled third-party components
retain their original licenses and notices; see [dependency review](docs/direct-transport.md)
and Android assets under `third-party/`. The [public-source audit](docs/publication-audit.md)
records the pre-publication history and infrastructure review.
