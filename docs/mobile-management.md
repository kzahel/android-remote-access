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
