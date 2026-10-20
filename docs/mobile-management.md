# Mobile access management

Owner-approved implementation plan, 2026-10-20. Keep the plain native Android
appearance and generic utility language. This slice manages the existing
pairing/encrypted-check functionality; it does not claim screen control exists.

## Behavior

- Pair multiple independently pinned browsers without replacing existing trust.
  Give each a local, editable nickname. A nickname is not authenticated identity.
- Main screen: global Remote access switch, honest readiness/session status,
  compact paired-browser list, Pair browser, Activity and Settings.
- Browser details: nickname, pairing/last-connection timestamps, Allowed switch,
  Disconnect and confirmed removal. Manual transport admission is a test-fixture
  helper, not a consumer control.
- Global Off and per-browser Disabled retain pairings, immediately invalidate
  authority, close affected sessions and cancel pending work. Re-enable locally.
  Disconnect ends only the current connection. Removal permanently revokes trust;
  failed relay cleanup remains locally blocked and can be retried.
- One phone session at a time. Connection activity is ephemeral and must not be
  confused with the persistent Allowed preference or last-connected timestamp.
- Settings: automatic connection-request/wake switch, notification repair,
  registration retry and app version. Show setup failure separately from intent.
- Room/SQLite stores browser grants/public pins, nicknames, policy and bounded
  local activity. Migrate the existing preference grant transactionally, preserving
  local revocation and wake intent. Private signing keys remain in Keystore.
- Activity records pairing, renaming, policy changes, authenticated sessions,
  successful checks, disconnects and failures. Retain at most 30 days/10,000 rows;
  no PINs, QR secrets, push addresses, screen content or arbitrary remote text.
  This is local history, not a tamper-proof audit service.

## Authority and transport

Phone policy is authoritative for foreground and background work and every
handshake/record. Persist policy generations; queued work and delayed pushes
from an earlier generation cannot become valid after re-enabling. Wake hints
identify a pairing and generation but confer no authority: the selected grant,
relay challenge and E2E handshake still authenticate the actual browser.

Synchronize signed phone-only access policy with the relay, canceling affected
pending routes on policy changes. Keep management sockets separate from sessions
so pausing/removing a browser never needs active session admission. Push
registration is per pairing; one installation can serve multiple browser grants.
Preserve v1 enrollment/crypto wire compatibility and existing relay state.

## Delivery and verification

1. Commit this plan.
2. Add Room, transactional legacy migration and bounded history with native tests.
3. Implement policy-aware sessions, multi-browser wake routing and relay tests.
4. Implement compact native screens and instrument normal controls.
5. Run builds, type checking, lint, meaningful policy/migration tests and a real
   two-isolated-browser / owned-emulator acceptance, including actual FCM,
   persistence, global/per-browser pause, stale work, disconnect and revocation.
   Capture the real UI. Deploy the compatible relay revision through the existing
   Pi runbook and commit working slices. Keep private artifacts under `.local/`.

Physical lock/debugging settings, unrelated apps, existing transports and services
are unchanged. Natural overnight/reboot qualification remains separate.

## Implementation and acceptance

Implemented in the root Android host and hosted relay on 2026-10-20. The UI uses
plain native views, AndroidX back handling and a scrollable status/list rather
than the earlier HTML mockups. Up to 32 independently pinned browser grants can
be retained; owners can rename, pause, disconnect and remove each one. Settings
separates automatic requests from global permission. Activity is local, loads history in batches, and is pruned at startup/read/write to 30 days/10,000 rows. Room schemas are
exported for future migrations. Database/preferences/files are explicitly
excluded from cloud backup and device transfer; signing keys remain in Keystore.

`pnpm test:mobile` requires the normal Android build with the operator's ignored
Firebase client configuration and `HOSTED_ORIGIN` pointing at the compatible
hosted relay. It owns an API-35 Google APIs emulator and two isolated Chromium
contexts. It never selects a physical phone. It tests rendered-QR decoding,
ordinary Grant/rename/switch/confirmation controls, both encrypted checks, real
FCM wake with the app process absent for each browser, persisted aliases and
last-connected timestamps, global/per-browser gating, active route closure,
disconnect without unpairing, isolated removal and subsequent rejection.
The native Room tests cover transactional legacy import, preserved revocation,
independent authority, superseded generations and bounded/redacted history.

Private screenshots, native logs and the result receipt live under
`.local/mobile-proof/`. Fixture writes are atomic. A previous interrupted owned
fixture is revoked with its retained native key before any app-data reset; failed
cleanup preserves the AVD for repair. Both normal acceptance and management
acceptance close their browser/emulator processes.

The final management run passed all the checks above, including real
FCM receipt and encrypted exchanges for both browser identities, persisted global
disarm after process restart, and pausing one browser while the other remained
connected. The existing single-browser hosted/FCM regression also passed against
the final deployed relay: three encrypted exchanges, restart/reload persistence,
process-absent wake, revocation and rejection. Build, Android
lint, ktlint, TypeScript checking, Biome, 63 TS tests and 14 Kotlin protocol tests
pass. Three native Room tests and the command-driven native management flow pass.
This is emulator evidence; it does not extend the earlier physical Pixel receipt
to the new management UI or qualify natural overnight/reboot recovery. Screen
capture/input and WebRTC remain separate product slices.

## Consumer copy and system readiness

The owner's follow-up removes development banners, future-feature promises,
manual connection-check controls, raw session diagnostics and the build suffix
from the mobile UI. Home shows access, connection status and paired browsers;
an actionable Settings link appears when setup needs attention. Settings holds
notification repair, unused-app settings, connection setup and About. About
accurately describes this version's pairing/secure-check scope.

On startup and every Activity resume, query the actual notification permission,
app-wide notification setting and connection channel. A changed result refreshes
the UI and resynchronizes push registration, including after permission restoration.
Saved owner preferences are retained; they are not evidence of OS permission.
Background push handling and every automatic session still check current permission.

Also query AndroidX's unused-app restrictions API asynchronously on resume. Show
whether Android's permission removal/hibernation setting is enabled, disabled,
unavailable or could not be read, with the supported system settings action.
This reports configuration, not proof that hibernation occurred, nor a promise
of overnight reachability. The app does not change the setting or request a
battery exemption automatically.

Official API references, reviewed 2026-10-20:

- [PackageManagerCompat.getUnusedAppRestrictionsStatus](https://developer.android.com/reference/androidx/core/content/PackageManagerCompat#getUnusedAppRestrictionsStatus(android.content.Context))
- [IntentCompat.createManageUnusedAppRestrictionsIntent](https://developer.android.com/reference/androidx/core/content/IntentCompat#createManageUnusedAppRestrictionsIntent(android.content.Context,java.lang.String))
- [App hibernation behavior](https://developer.android.com/topic/performance/app-hibernation)

The mobile acceptance now checks an external notification-settings round trip,
notification blocking/restoration while resuming the existing Settings screen,
and runtime permission revocation/restoration across process startup. The same
run then verifies real process-absent FCM delivery to both paired browsers.
All permission mutations are restricted to the runner's owned emulator.

This follow-up acceptance passed on 2026-10-20, including the unused-app and
notification system-settings round trips, channel blocking and repair through
Android Settings, runtime permission revoke/regrant, both real FCM wakes, all
existing multi-browser policy checks and signed fixture removal. Android builds,
lint/ktlint, TS checking and Biome passed. Actual native screenshots were inspected;
private receipts and captures remain in `.local/mobile-proof/`. No physical phone
or deployed relay change was required.

## Sharing setup and independent feature permissions

Owner direction, 2026-10-20:

- Empty Home has one Set up sharing action; paired Home has Add browser and
  How to connect. Instructions live in a dismissible native setup dialog.
- The dialog gives the configured website, Copy/Android Share, optional website
  QR, and Scan pairing code immediately. A website QR is a public navigation
  link, never a pairing grant. Typing the address on a laptop remains supported.
- Scanning/deep-link approval and durable browser trust have no accessibility,
  notification or capture prerequisite. After pairing, show a separate feature
  setup screen with a Done action. Each available feature explains its purpose
  before the owner chooses its permission. Permission denial keeps the pairing.
- Connection requests can be enabled in this host. Screen viewing and touch
  control are not implemented in the root host: report their unavailability
  honestly, without unrelated system permission prompts or fake Enable actions.
- While the phone app is visible, allowed browsers can connect without Android
  permissions or FCM opt-in. Foreground listeners do not reserve session leases;
  actual connections still enforce one session, current grant generations and
  all global/per-browser policies. Leaving the app closes those listeners.
- Send a small optional E2E-encrypted feature report after the existing canary
  reply. Preserve the existing handshake/canary contract for older viewers and
  tolerate absence of a report from older hosts. The viewer explains per-feature
  availability after connecting; it never infers capabilities from relay data.
- Extend the owned-emulator/two-browser acceptance: empty-state setup and website
  QR, pairing and real foreground exchange before permissions, feature setup
  skipping/denial, authenticated feature reporting, then existing FCM/policy
  regression and cleanup. Capture actual native screens and deploy the updated
  viewer through the existing Pi runbook after verification.
