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
  Disconnect, manual Connect (development fallback), and confirmed removal.
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
