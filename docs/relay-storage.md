# Node relay storage and bounded hardening

Owner direction, 2026-10-22: invest only in a simple, usable development and
self-hosting relay, then investigate Workers + Durable Objects for a possible
hosted service. This does not choose the final production architecture.

## Implemented scope

The single Node 24 process uses built-in `node:sqlite`; no native npm addon or
separate database service is needed. `STATE_DIRECTORY/relay.sqlite` holds one
row per pairing (including policy and revocation tombstones), private push
registrations, and an import marker. JSON values preserve the existing wire
format; indexed creation timestamps implement admission accounting. The
in-memory routing/authentication model stays single-process. Do not run two
relay processes against one state directory.

Each change writes only its row. Revocation and deletion of its push target
commit together before acknowledgement. SQLite uses the simple rollback journal
and `synchronous=FULL`; acknowledged authority changes must not be casually
weakened to faster, less durable settings. Authority write failures mark the
relay unhealthy and terminate sockets. The directory is private and the database
is mode 0600. Backup files contain private push metadata and must be protected.

On first startup, one transaction imports `pairings-v1.json` and
`push-registrations-v1.json`, including paused policy and revoked IDs. An invalid
import fails startup and rolls back. Once the import marker commits, SQLite is
the only authority: retained JSON is never reimported. Existing grants, origin,
keys and protocol remain unchanged, so clients do not need to re-pair.

## Admission budgets

| Resource | Bound |
| --- | --- |
| All ordinary HTTP requests / WebSocket upgrades | Existing 240/IP/minute |
| Pairing starts | Additional 10/IP/minute, including rejected attempts |
| Pending invitations | Existing 1,000, rechecked after signature verification |
| Completed enrollments | 100 in a rolling hour, counted durably across restarts |
| Durable pairing rows including tombstones | Existing 10,000 lifetime cap |
| WebSockets awaiting authentication | 64, within the existing 1,000 total sockets |
| Authenticated management sockets | One per pairing, independent of live control sockets |

The completion budget is checked immediately before insertion with no intervening
await. A capacity refusal returns 429 and `Retry-After: 3600`; existing routes,
revocation and policy changes remain available. Imported rows do not consume the
new hourly budget. Per-IP windows reset on restart; no IP addresses are stored
in SQLite. Forwarded IPs remain trusted only through the configured loopback
proxy. Existing body/message bounds, authentication deadlines, heartbeat,
backpressure and FCM cooldown/global budgets remain in place.

These are small-service guardrails, not fair admission under distributed abuse.
An attacker can consume the shared budget and eventually the lifetime cap.
Do not delete tombstones or expire unattended phones to reclaim capacity.
Public-service lifecycle, edge admission, wake fairness and cost controls remain
open; see [security gaps](security-gaps.md#sg-3-public-clients-can-exhaust-durable-relay-enrollment-state).

## Deployment and recovery

Before activation, take an encrypted backup of both legacy files. Candidate
startup must use a disposable snapshot of live authority. After cutover, use
SQLite's online backup API, not a live file copy; encrypt the resulting database
and verify a decrypted scratch copy with `PRAGMA quick_check`, import marker,
row and tombstone counts. Never overwrite live authority as a restore drill.
The private infrastructure runbook owns concrete paths and commands.

SQLite-aware releases can roll back normally. A JSON-only release must be refused
once SQLite exists: it would restore stale authority and potentially undo
revocations. Recover by deploying a SQLite-compatible fix. Restoring an old
snapshot is an explicit recovery operation requiring reconciliation of every
later revocation; keeping a backup is not proof that such a restore is safe.

Tests cover one-time and failed imports, preserved policy/tombstones, atomic
revocation/push removal, private file mode, online backup, persistent quotas,
connection budgets, fail-closed writes, and existing encrypted relay/wake flows.

References reviewed 2026-10-22:
[Node 24 SQLite API](https://github.com/nodejs/node/blob/v24.22.1/doc/api/sqlite.md)
(the module is release-candidate status in this pinned runtime),
[SQLite synchronous guarantees](https://www.sqlite.org/pragma.html#pragma_synchronous),
[SQLite online backup](https://www.sqlite.org/backup.html).
