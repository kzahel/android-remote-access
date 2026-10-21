# FCM wake slice

Implementation and hosted emulator acceptance: **2026-10-20**. A separate
Firebase project, Android registration and dedicated relay sender are provisioned.
Real Firebase delivery from the hosted relay passes with the application process
and socket absent. Private sender identities and Pi credential paths belong
in the private dotfiles runbook; public Android client configuration is checked
in with the app. A physical Pixel 7a also passes screen-off
forced-Doze wake; natural overnight reliability remains unqualified.

## Decision and wire behavior

Use the existing hosted relay as the Firebase sender. It has a dedicated service
account, independent of sibling products; no separate broker is required. Google
ADC reads a systemd credential mount, never an APK/browser configuration value.
`FIREBASE_PROJECT_ID` enables the sender. Omitting it preserves the foreground
pairing behavior. Android's public client config is checked in at
`android/app/google-services.json`; it contains client/project identifiers and
an API key embedded in the APK, not the relay's private sending authority.
The Google Services plugin is required for normal builds, so missing client
configuration fails the build instead of silently producing an APK without
remote wake. For a separate deployment, replace this config with the matching
Android registration from that deployment's Firebase project and configure its
relay sender separately. Never commit service-account keys.

Firebase Messaging 25.1.1 (BoM 34.16.0) uses installation IDs and `onRegistered`.
The relay pins Firebase Admin 14.2.0, with FID delivery support. The installed SDKs
compile against these APIs. The manifest must explicitly set
`firebase_messaging_installation_id_enabled=true`; otherwise `register()` fails
before network registration. This follows the pinned
[YA lifecycle reference](sibling-repositories.md#yep-anywhere-fcm-implementation-reference)
without reusing its registration, sender identity or application runtime.

1. The phone owner pairs normally, enables **Connect while the app is closed** in Settings
   and allows connection notifications. Global Remote access and the individual
   browser must also be enabled. Disabled notifications or revoked local grants
   prevent wake work. Firebase registration is explicit rather than automatic.
2. The native callback saves the current delivery address and uses a short-lived
   management socket to refresh it at the relay. That socket authenticates with
   the existing fresh challenge/signature and `mode: "registration"`. Only the
   phone role can send `registerPush` with a validated FID or `unregisterPush`.
   A management connection cannot displace or inject into an active session.
3. An authenticated browser socket creates a pending request if the phone has no
   session socket. It expires in 60 seconds. The sender sends data fields
   `intent: "connect-v1"`, a random 16-byte hex `requestId`, and Unix-seconds
   `expires`, plus the selected `pairingId` and current access `generation`
   for managed pairings. Android priority is high, TTL 60 seconds and collapse key
   `connect-v1`. No input, PIN, session credential or E2E key goes through FCM.
4. Native receipt validates shape/version/expiry and checks the local opt-in,
   notification permission and pairing. It presents a visible connection
   notification and schedules bounded WorkManager work, expedited on API 31+. API 30 uses
   ordinary scheduled work and may be delayed. Duplicate
   active work is kept, rather than starting parallel connections.
5. The phone connects outward using its locally pinned origin and identity. It
   includes the request ID in its authenticated socket admission. The relay
   requires a current matching request and a still-connected, authorized browser;
   expired, canceled and revoked requests cannot admit a wake session. This
   challenge exchange is the authenticated pending-request lookup. The phone and
   browser then perform the existing E2E handshake and fixed encrypted canary.
6. The worker closes the socket after the check, failure or its bounded deadline.
   It does not start an indefinite foreground service or hold an idle socket.
   This slice still exposes only the fixed connection check, not phone control.

The signed challenge and pinned grant establish authority; push delivery does
not. Request IDs bind a response to a pending viewer, but are not credentials.
Pending requests are ephemeral and disappear on viewer disconnect or relay
restart. Registered delivery addresses persist in a private file separate from
public pairing responses and durable authority. Revocation deletes the address
and blocks admission even if a push was already sent. Disabled wake takes effect
locally immediately and attempts an authenticated server-side removal; reopen or
repeat disable if that removal cannot reach the relay.

Sends are coalesced for 30 seconds per pairing and capped at 100/minute globally.
An invalid-target provider response removes only the still-current target;
a concurrent refresh survives. Transient failures retain registration. There
are no unbounded automatic retries. A request canceled within the cooldown may
need an owner retry after 30 seconds. Existing API/IP, socket and payload bounds
still apply. These are development-instance admission defaults, not a capacity
qualification.

## Verification and measured acceptance

Local checks pass: **59 TypeScript tests**, **13 Kotlin JVM tests**, TS build and
type checking, Biome, ktlint, Android lint, debug APK and instrumentation APK.
Tests cover target replacement/persistence, invalid-target races, provider
outcomes, expiry, coalescing/global rate limits, role restrictions, metadata
privacy, management/session isolation, disable and revocation. Kotlin validates
untrusted malformed, expired, future and overflowed hints.

The new APK (without Firebase client configuration) passed the existing public
HTTPS/WSS QR/Grant, two encrypted exchanges, browser reload/native process
restart, removal and subsequent refusal against the previously deployed relay.
This is backward compatibility evidence, **not FCM delivery evidence**. The
owned emulator and isolated Playwright Chromium were reaped.

Build with the checked-in client config and run:

```sh
HOSTED_FCM=1 HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN pnpm test:hosted
```

That opt-in mode additionally enables wake through the normal native button,
waits for authenticated registration, backgrounds the app, reclaims its process
with `am kill` (not force-stop), verifies process absence, and requests the browser
check. Acceptance requires a new native Firebase receipt timestamp, a new native
encrypted exchange and the browser's successful canary. Delivery addresses are
neither printed nor injected through the runner. Only safe checkpoint/latency
results are reported.

The configured build passed this mode against the public HTTPS/WSS relay:

| Checkpoint | Result |
| --- | --- |
| Normal QR/Grant and foreground E2E check | Pass |
| Explicit native wake opt-in and authenticated FID registration | Pass |
| App process and application socket absent before request | Pass; process reclamation with `am kill`, not force-stop |
| Fresh native Firebase receipt | Pass; 84 ms after browser request |
| Fresh native E2E exchange and browser canary | Pass; 379 ms after request |
| Native restart and browser reload | Pass; identities retained |
| Phone removal and later connection refusal | Pass |
| Owned emulator and isolated Chromium cleanup | Pass |

These latencies describe one API-35 ARM64 Google APIs emulator run, not an SLA.
Three encrypted exchanges and both native instrumentation invocations passed.
The first live attempt exposed the missing manifest opt-in; after correcting it,
the failed fixture's grant was removed through the normal native flow before
rerunning. Private checkpoint evidence stays in `.local/hosted-proof/`.

## Physical Pixel 7a acceptance

Owner-authorized and measured **2026-10-20**, Pixel 7a, Android 17/API 37,
against the same public HTTPS/WSS relay. The current host APK is a separate
package from the preserved accessibility spike. The physical mode requires an
exact selector and expected model, current owner user, unlocked/awake readiness,
and both test packages absent globally. It refuses to replace existing app data
or existing battery/forced-idle overrides.

```sh
HOSTED_DEVICE="$PHONE_SERIAL" HOSTED_DEVICE_MODEL='Pixel 7a' \
HOSTED_FCM=1 HOSTED_DOZE=1 HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN \
pnpm test:hosted
```

Omit `HOSTED_DOZE=1` for a foreground/background wake run without screen/idle
changes. Physical mode accepts the normal notification permission prompt;
emulator mode retains its owned-fixture permission setup. Neither mode enters
a lock credential. QR screenshot decoding still enters through the normal
pairing intent and Grant UI, without a camera photo.

| Checkpoint | Result |
| --- | --- |
| Grant, notification prompt and authenticated registration | Pass |
| Ordinary background wake with process/socket absent | Push receipt 810 ms; E2E exchange 2366 ms |
| Deep Doze, screen off, host not battery exempt | `IDLE` verified before wake; 31 s without ADB polling |
| FCM wake from that forced-idle state, process/socket absent | Push receipt 1005 ms; E2E exchange 2339 ms |
| Native restart and viewer reload | Pairing retained; four encrypted exchanges in total |
| Authenticated phone-side cleanup and later viewer refusal | Pass; native test key signs ordinary revocation behind keyguard |
| Device restoration | Both temporary packages removed; battery simulation reset; forced idle released; original task requested |

Latency uses a device-clock offset estimate with ±19 ms sampling uncertainty.
These are two individual wakes, not reliability statistics. Native UI pairing,
reconnect and locked-fixture revocation instrumentation passed. Cleanup checks
confirmed normal powered battery reporting and deep/light idle `ACTIVE`; the
phone's normal PIN keyguard remained visible after waking the display. No PIN,
lock/debugging setting, accessibility grant, network setting or other package
was changed. Private logs and witnesses stay in `.local/physical-hosted-proof/`.
A locked physical phone is refused before installation on a subsequent run;
unlock it locally to repeat. Failed enrollment retains owned fixture state for
signed revocation/repair rather than silently erasing its keys.

This forced-idle experiment used a USB-connected phone with charging simulated
as unplugged, not hours of natural unplugged idle. Natural overnight acceptance
remains next. No claim is made about
force-stop recovery, non-GMS devices, first unlock after reboot, display wake,
keyguard dismissal, screen capture/input, battery cost or Play review.

Relevant platform guidance:
[message handling](https://firebase.google.com/docs/cloud-messaging/android/receive),
[priority and visible-notification requirements](https://firebase.google.com/docs/cloud-messaging/android/message-priority),
[FCM server authorization](https://firebase.google.com/docs/cloud-messaging/auth-server),
[public client configuration](https://firebase.google.com/docs/projects/learn-more#config-files-objects).
These links describe platform boundaries; this implementation's acceptance is
limited to the checks above.


## Multi-browser management extension

The [mobile-management slice](mobile-management.md) moves grants/access policy
from a single preference record into Room, preserves existing wake opt-in, and
registers each browser relationship against the installation address. Management
first synchronizes that pair's phone-only access generation. The native host
requires a matching pairing/generation in wake hints and rechecks local policy
for scheduling, handshake and records. Disarm/disable closes sessions and
invalidates older work; disabling automatic requests is a separate setting.
The historical receipts above describe the original single-browser UI.
