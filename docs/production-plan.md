# Production plan

Written 2026-10-19 at the owner's request, updated 2026-10-20 with repository
and stack decisions. Production implementation is authorized in this repository;
the remote-control runtime remains the preserved spike. Crypto and hosted
pairing/relay slices are implemented; see [hosted acceptance](hosted-pairing-proof.md).
No store listing exists. Evidence references distinguish the preserved phone
spike from current production-slice acceptance; untested behavior is a hypothesis.

## Goal

Turn the manual-access spikes into an Android app that can be published on
Google Play, plus a web viewer and a hosted relay, for someone who wants to
reach their own spare phone left somewhere else. The RV power-station check is
the reference job: open one app on an unattended phone, read it, act on it.

Manual, human-directed control remains the product. Autonomous or AI control,
MDM, a combined camera/Bluetooth product and a remote-support suite are out of
scope.

## Decisions made so far

These are owner decisions from 2026-10-19 and 2026-10-20. Implementation defaults
and open questions are identified separately below.

1. Aim for a Play-published consumer app, not a research artifact.
2. We host and operate the relay, following the existing projects' hosting and
   deployment patterns documented in dotfiles. Consumers will not need a VPN;
   Tailscale was only the spike's stand-in. The 2026-10-20 follow-up selects the Pi and
   `android-remote.graehlarts.com` for the hosted development instance.
3. Account-free pairing comes first: a QR code shown in the browser, scanned on
   the phone, confirmed with **Grant**. Sign-in may be added later as an option.
4. The pairing flow was prototyped in this repository before any production
   code ([QR pairing](phone-spike.md#qr-pairing-without-an-account)).
5. Aim for best-effort direct WebRTC, with PeerJS as a candidate for simplifying
   setup, and a low-tech hosted fallback when direct setup fails. The fallback
   must support manual control and still images over HTTPS/WebSocket; smooth
   relayed video is optional. No TURN service is planned. Library choice,
   Android interoperability and transport details still need validation.
6. Include FCM for waking the app to establish a session on demand. An always-open
   application connection to our relay is not a product requirement. Validate
   idle disconnection and push-triggered connection before relying on them.
7. Keep the product in this repository. Move the current runnable prototype,
   its tests and runners under `spike/`, preserving it as a working reference.
   Keep docs, research and ignored competitor references at the root.
8. Use TypeScript for the relay, shared protocol package and React web viewer.
   Use clean Kotlin for the Android app. Establish reproducible builds,
   automated tests, type checking, formatting and lint from the start.

## What the spikes established

Physically tested on a Pixel 9 (Android 17) unless noted; see the linked
sections for exact limits.

| Capability | Evidence | Limit to carry forward |
| --- | --- | --- |
| Screen stills and input through accessibility | [phone spike](phone-spike.md) | Protected screens and Android 16+ sensitive views can refuse |
| Continuous touch and smooth H.264 video | [touch spike](touch-spike.md), [video quality](phone-spike.md#video-quality) | Video needs fresh screen-sharing consent after lock or restart |
| Saved-PIN remote unlock, one attempt | [owner PIN unlock](phone-spike.md#owner-pin-unlock) | Not before first unlock after a restart; Play-policy fit untested |
| Resume after restart, opt-in | [start after restart](phone-spike.md#start-after-restart) | Owner must unlock once on the phone after every restart |
| Connection survives forced deep Doze | [forced Doze](phone-spike.md#forced-doze) | Natural overnight idle and a real relay untested |
| Reconnect across Wi-Fi/cellular changes | [Tailscale route](phone-spike.md#tailscale-route) | Measured over Tailscale, not a relay |
| Account-free QR pairing and revocation | [QR pairing](phone-spike.md#qr-pairing-without-an-account) | Camera scan, multi-phone and end-to-end encryption untested |

## Gates before broad release

Each gate can stop or reshape the product. Address policy and saved-PIN design
early, and run implementation-dependent experiments as the required pieces
become available. These gates do not block authorized build setup or core
implementation. Record results in this repository.

1. **Play accessibility policy.** Read the current
   [accessibility API policy](https://support.google.com/googleplay/android-developer/answer/10964491?hl=en)
   and draft the in-app prominent disclosure and Play Console declaration for
   human-directed remote control. Do not set `isAccessibilityTool`. Submit an
   early closed-testing build to get a real review verdict.
2. **Saved-PIN unlock.** Decide whether version 1 ships it. It is the feature a
   reviewer is most likely to read as weakening the lock screen. Options: omit
   it, ship it behind explicit opt-in with clear disclosure, or keep it for a
   later release once the base app is approved.
3. **Developer account.** Choose personal or organization. Recheck the current
   new-account testing requirement (reported as a closed test with about 12
   testers for 14 days for new personal accounts) and organization verification.
4. **Natural overnight test.** Unplugged phone, normal screen timeout, real
   idle for several hours, then remote wake and control. Repeat once a relay
   exists, including with no application relay socket open: request access from
   the viewer, deliver FCM, authenticate the phone and establish a session.
   The forced-Doze run went through Tailscale's own process and does not test
   this on-demand path.
5. **Camera scan.** Pair by actually scanning the code; check the Play services
   scanner's availability and first-use module download.
6. **Licenses.** Review Google's code-scanner terms, `uqr` (MIT) and any code
   ported from scrcpy, RustDesk or droidVNC-NG (see [competitors](competitors.md#pricing-and-reuse-limits)).

## Architecture to decide

Write a short decision record for each before building it.

- **Relay and transport.** Try direct WebRTC within a bounded setup window, then
  fall back automatically to manual control and refreshed still images through
  our HTTPS/WebSocket relay. PeerJS is a candidate, not a selected dependency:
  review its signaling model, self-hosting, Android WebRTC interoperability and
  license before choosing it. Bind either transport to the same paired
  identities and session authority. Direct connectivity is best effort; no TURN
  service is required for the fallback. Avoid a long connection spinner when
  only the simpler route works. Define protocol versioning, frame limits,
  backpressure and reconnect behavior; never replay uncertain input during a
  transport change. Evaluate relayed encoded video separately if its bandwidth,
  browser decoding and TCP behavior justify it. Core remote access must remain
  useful with control and stills alone.
- **End-to-end encryption.** Recommended direction discussed 2026-10-20:
  application content encrypted between the browser and phone, including input,
  screenshots, video payloads and any entered PIN. HTTPS/WSS remains the outer
  transport; terminating TLS at our relay must not reveal application plaintext.
  Use QR-paired identities to authenticate a fresh ephemeral key exchange for
  each session. Persist counterpart key pins at the endpoints, bind both
  identities, roles, nonces, ephemeral keys and protocol version into the
  authenticated transcript, confirm keys and check current authority before
  admitting commands. Derive independent directional/channel keys; authenticate
  record headers and reject replay. Never reuse a record key/nonce allocation
  across reconnects or independent transport lanes. The lock PIN and FCM
  delivery registration are not encryption keys.
  Follow the [JSTorrent live-session reference](sibling-repositories.md#babytrack-and-jstorrent-encryption-references)
  rather than Babytrack's group-history model or OPAQUE passphrase login for
  this QR-first product. The first experimental slice is specified in [crypto session v1](crypto-session-v1.md).
  Production adoption and independent review remain open:
  the proof uses native WebCrypto/Android cryptography with authenticated
  ephemeral P-256 ECDH, HKDF-SHA256 and AES-GCM records. This is implemented
  experimental interoperability evidence, not an audited production construction. Reusing sibling Rust/native-Wasm crypto is
  another option with a stack cost. The slice specifies the handshake, record
  limits, nonce/rekey rules and shared TS/Kotlin vectors; independent review
  remains a prerequisite for production adoption.
  The same security identity must hold over direct and relayed paths. WebRTC
  DTLS alone is insufficient if signaling can substitute the peer: authenticate
  its negotiated channel/fingerprint through the E2E session, or carry the
  application-encrypted records through its data channels. Decide smooth-media
  integration explicitly; plaintext video must never be sent through fallback.
  The relay still sees routing/timing/size metadata and can deny service. A
  compromised hosted viewer can access plaintext at the browser endpoint;
  immutable assets/CSP reduce risk but do not remove that trust. An independently
  distributed viewer would be a separate future delivery decision.
- **Identity and sessions.** Keep pairing (QR prototype; hosted enrollment implemented), device identity (Keystore
  key, implemented), session authority (short-lived grants, step-up before unlock) and
  optional account sign-in separate. Sign-in, if added, recovers and syncs
  paired keys; it must not be required for an unattended phone to reconnect.
- **Wake.** Prefer an on-demand application connection: an authorized viewer
  asks to connect, our service sends an FCM wake hint, and the phone connects
  outward to fetch the pending request through an authenticated channel.
  Push payloads carry no credentials or control commands. Choose idle timeouts,
  bounded reconnect behavior and whether an optional warm connection improves
  latency enough to justify its battery cost. FCM wakes the process where
  Android permits; display wake, unlock, capture consent and input authority
  remain separate. Delivery may be delayed or unavailable. High priority must
  fit FCM's time-sensitive, user-visible requirements; it is not an indefinite
  silent keepalive. Treat force-stop as requiring local recovery and design
  any non-GMS route separately. See the documented [FCM and background limits](android-platform.md#fcm-and-a-persistent-relay-connection-solve-different-problems).
- **Multiple phones and browsers.** The spike server holds one phone. The relay
  needs per-account or per-pairing routing, rate limits for anonymous pairing,
  and revocation that takes effect immediately.
- **Capacity and cost.** Hosting ownership is settled: we operate the relay.
  Measure relayed video bandwidth, concurrent sessions and host
  capacity to set limits and estimate operating cost. No pricing has been decided.

## Relay hosting and operations

Follow the existing relay operations patterns rather than choose a new managed
relay provider. Source-reviewed 2026-10-19 against the private dotfiles
[YepAnywhere relay deployer](../../dotfiles/scripts/deploy-yepanywhere-relay.sh)
and [JSTorrent relay runbook](../../dotfiles/runbooks/rstorrent-remote-access.md).
This is deployment precedent, not evidence that the phone relay is implemented
or has enough capacity for production video.

- Public HTTPS/WSS through Caddy, with the application listener on loopback.
  This serves the fallback and WebRTC signaling; direct media travels between
  endpoints. Review signaling/STUN dependencies when selecting the WebRTC
  library; no TURN service is planned.
- A separately supervised service with its own identity, configuration, state
  and resource limits. Keep it independent of the other products' services and
  pairing records.
- Immutable releases selected by exact revision, a disposable candidate smoke
  test, health checks after activation and rollback to the previous release.
- Durable pairing authority outside release directories, encrypted backups and
  a tested restore procedure. Binary rollback must preserve current authority
  and revocations.
- Health and aggregate capacity monitoring, admission limits and an operator
  action to stop new sessions without inspecting screen or credential content.

Product code and protocol tests belong in this repository. Concrete
host selection, domains, ports, DNS/TLS configuration, service units, deployment
scripts and private operator runbooks belong in dotfiles. Select the host and
domain before provisioning; this plan does not deploy or reconfigure a service.

## On-demand session lifecycle

This is the intended flow to implement and test, not measured spike behavior:

1. A paired browser authenticates and requests a short-lived session for one
   phone. The service checks revocation and admission limits before sending a
   wake hint. Repeated requests are bounded and coalesced.
2. If the phone is already connected, notify it over that connection. Otherwise
   send FCM using its current registration. Account-free pairing still applies;
   Firebase delivery registration does not require product account sign-in.
3. The phone connects outward, proves its identity and fetches the pending
   request. It checks the paired browser and current local access grant;
   receiving a push alone never authorizes control. Expired or revoked requests
   cannot start a session.
4. Attempt authenticated direct WebRTC for a bounded time. If it cannot connect,
   use the hosted HTTPS/WebSocket control-and-stills path automatically. A
   failed direct path during use must also recover through that fallback without
   replaying uncertain input. Start viewing and input only with their respective
   native authority; smooth video still needs valid screen-sharing consent.
5. After the session ends, release input and capture resources. The application
   relay/signaling connection may close after a bounded idle period. Show the
   viewer "Contacting phone" until the phone answers, then the actual readiness
   or repair state; a disconnected idle socket alone does not prove the phone
   is unreachable. Bound waiting when FCM or connection setup does not succeed.

Acceptance must include natural idle with the socket closed, process reclamation,
FCM registration refresh, delayed/duplicate wake hints, expired requests,
revocation during wake, direct WebRTC success, direct setup failure, mid-session
direct-path loss, control-and-stills fallback under packet loss and slow
receivers, network changes and session teardown. Record wake-to-ready latency
and idle battery cost. A push delivery receipt is not proof of a usable remote
session.

## Repository and build structure

Preserve the spike while building the product in the same repository. The
2026-10-20 owner decision supersedes the earlier new-repository proposal.
Layout established by the crypto and hosted pairing/relay slices:

```text
android/       Kotlin Android app
relay/         TypeScript hosted service
web/           React + TypeScript viewer
protocol/      Versioned wire schemas, TS types and cross-language fixtures
spike/         Existing prototype, its tests and runners
docs/          Product decisions, runbooks and evidence
research/      Research method and source inventory
references/    Ignored pinned competitor checkouts
```

The executable prototype was moved as one unit, retaining its own package manifest,
lockfile and Android build. Runbooks now select `spike/`; its ignored `.local`
symlink preserves the root private state. Temporary root server/asset
compatibility paths keep already-running demos serving. Remove those paths
once the old demos are stopped. The pairing-revocation test now awaits the
asynchronous atomic persistence it asserts; all 19 preserved spike tests pass.
No private credential was moved into Git or active phone demo interrupted.

Port proven pieces deliberately, each with its relevant regression coverage:

- Android: Kotlin and Jetpack Compose. Port the accessibility capture and
  input, touch relay, video encoder, unlock sequence, start-after-restart and
  Keystore pairing. Leave behind the fixtures, ADB provisioning and test-only
  shell paths.
- Hosted services: pairing records, challenge sign-in, pending session requests,
  routing, revocation, FCM registration/sending, WebRTC signaling and the
  HTTPS/WebSocket control-and-stills fallback.
- Web viewer: rebuilt around the readiness model below; reuse the spike
  viewer's interaction lessons rather than its code wholesale.

Implementation defaults, chosen to make the owner's stack requirements concrete
without further framework decisions:

- Node LTS with pnpm workspaces and a committed lockfile. Strict TypeScript,
  explicit package boundaries and runtime validation at network boundaries;
  TypeScript types alone do not validate a phone or browser message.
- React + Vite for the viewer; Vitest and React Testing Library for behavior
  tests, Playwright Chromium for browser acceptance. Keep frame decoding and
  pointer transport outside React render-state updates so screen traffic does
  not delay typing or touch feedback.
- Biome for TypeScript/React formatting and lint; separate TypeScript checking.
  Build relay and protocol packages with explicit build/typecheck scripts.
- Kotlin, Jetpack Compose, coroutines and explicit lifecycle/resource ownership
  on Android. Separate transport, pairing/session authority, accessibility
  capture/input, PIN delivery and MediaProjection. Use a committed Gradle
  wrapper, Android lint and ktlint; no shell helpers or test activities in the
  production APK. Kotlin must validate the same protocol constraints as TS.
- Root commands for `build`, `typecheck`, `lint`, `format:check` and `test`, with
  documented Android prerequisites. CI builds the web/relay and debug APK and
  runs static checks plus meaningful TS/Kotlin tests. Device acceptance is an
  explicit separate command, not a silently skipped unit-test dependency.

Test protocol compatibility across TS/Kotlin, pairing and revocation, stale or
expired authority, uncertain command delivery without replay, touch release on
disconnect, capture lifecycle and slow receivers. Keep browser tests focused on
complete user paths and sequential typing under incoming screen updates.
Use emulator instrumentation for Android framework behavior and a small
authorized physical-device acceptance run per release. Avoid tests that merely
assert scaffolding exists or mirror implementation details.

Start with build/CI and spike preservation, then one complete product path:
pair, connect through the hosted fallback, view stills and control touch. Add
on-demand FCM wake and direct WebRTC against that working fallback. Preserve the
tested native mechanisms as they are ported; this is not a reason to reinvent
continued gestures, codec edge cases or known-PIN checks. Consult the pinned
[Yep Anywhere FCM reference](sibling-repositories.md#yep-anywhere-fcm-implementation-reference)
before implementing push registration and delivery.

## Onboarding and readiness

Design the readiness model before the screens. Each state maps to one
plain-language next step: paired, screen access allowed, input working,
reachable from another network, locked-phone preparation, battery and
restart settings, last successful test. The candidate first-run flow is in
[UX](ux.md#candidate-first-run-flow). Main screens:

1. Welcome and role: the phone being left behind, or the viewer.
2. Pair (the QR flow) and name the phone.
3. The accessibility disclosure, written as the policy requires, then the
   system settings step.
4. Test drive from the viewer.
5. "Before you leave" checklist, including start after restart and what
   happens if the phone loses power.
6. Status home with paired browsers and Stop.

Material 3 with light branding is enough for testing; a designer helps most on
the disclosure and the checklist. Prototype screens in Compose previews and
emulator screenshots.

## Phases

| Phase | Done when |
| --- | --- |
| 0. Foundation | Spike preserved under `spike/`; TS/React/Kotlin builds, tests and lint run locally and in CI |
| 1. Decisions and early gates | Transport, encryption, wake and routing decisions recorded; saved-PIN scope settled; hosting target selected; policy review starts early and remaining release gates have owners |
| 2. Core | New app pairs, wakes on demand, tries direct WebRTC and automatically falls back to hosted control/stills; overnight test passes with no idle application relay connection |
| 3. Onboarding | First-run flow and readiness checks complete; a non-technical tester sets up a phone unaided |
| 4. Closed testing | Play closed track with the accessibility declaration accepted; issues from testers fixed |
| 5. Production | Store listing, privacy policy, support page and a tested recovery story |

## Open owner decisions

- Name and brand.
- First audience: spare-phone owners, owners of remote Android workloads, or
  broader remote support.
- Whether version 1 includes saved-PIN unlock and smooth video.
- Pricing and what a free tier includes.
- Supported Android versions, OEMs and devices without Google Play services.
- Play-only or also a direct APK.

## Hosted pairing/relay slice (2026-10-20)

The owner authorizes the Pi development deployment, DNS/Caddy configuration and
commits in this repository and dotfiles. The service and automated public flow
are now tested; see [acceptance](hosted-pairing-proof.md). See [pairing/relay v1](pairing-relay-v1.md)
for enrollment and routing. Root `pnpm test:hosted`, with `HOSTED_ORIGIN` supplied
by the operator, owns an emulator and real Chromium, decodes the rendered QR
screenshot, supplies it through the normal Android pairing intent, taps Grant,
checks encrypted exchanges, restarts the native process/reloads the browser,
and revokes the paired browser. Camera optics are a separate physical check.

The [FCM wake slice](fcm-wake-v1.md) passes deterministic tests and real hosted
Firebase delivery to an owned emulator with the app process/socket absent.
Physical Doze and overnight acceptance remain pending. Its acceptance has three
layers: deterministic sender/registration/revocation tests; real Firebase delivery with the application
relay socket closed and native receipt → authenticated exchange evidence; then
physical forced-Doze and natural overnight runs. Include token replacement,
duplicate/expired wake hints, offline recovery and revoked requests. An accepted
Firebase send is not delivery evidence, and force-stop expects local recovery.
Use an app-specific Firebase registration and authorized sender configuration;
never borrow YA registrations or credentials. Pairing and crypto tests alone
do not establish real FCM delivery; the separate opt-in FCM acceptance does.
