# Cloudflare relay runtime proof

Local and live protocol proofs completed 2026-10-22. This experiment is outside
the production workspace and its dependency graph. It is not a deployable
replacement for the Node relay. The checked-in Wrangler config disables public
routes, workers.dev and preview URLs, uses `https://proof.invalid`, and refuses
all requests unless a
`PROOF_KEY` binding and matching fixture header are supplied. The test generates
that key only in memory for local runs. The local suite needs no Cloudflare
account, DNS, Firebase credential or real phone. Live runs use a separate gated
workers.dev service; see the receipt below.

With the repository's pinned Node 24 and pnpm:

```sh
cd experiments/cloudflare-relay
pnpm install --frozen-lockfile
pnpm typecheck
pnpm test
```

`build` is a Wrangler **dry run**. `test` runs its bundle in Miniflare/workerd,
uses disposable SQLite-backed Durable Objects and synthetic endpoint identities,
uses real loopback WebSockets for transport, then disposes the runtime and removes its temporary storage in `finally`.
Wrangler 4.149.0 uses Miniflare 5.20261006.1-alpha; this experiment pins the same
version and its development-only eviction API. Revisit that tooling before
promoting any code. Production dependencies are unchanged.

## What passed locally

- Invalid creation signatures are rejected before allocating an object.
- Signed enrollment and concurrent duplicate creation/completion have one winner.
- Each pairing's phone/viewer sockets meet in one SQLite-backed object.
- The existing protocol library performs its real encrypted handshake and
  authenticated record exchange. The relay forwards ciphertext.
- Explicit runtime eviction with `webSockets: "hibernate"` preserves authenticated
  sockets and attachment state; the next encrypted record succeeds.
- Ninety 16 KiB encrypted records, paced at 30/second for three seconds, pass at
  3.93 Mbps of plaintext payload. Observed local p95 exchange time was about
  5 ms. This is synthetic local traffic, not a video/network/cost benchmark.
- The authentication alarm closes an idle unauthenticated socket with code 4003.
  A real loopback WebSocket observed clean closure at about 20 seconds for a
  10-second authentication deadline; hosted close/cleanup timing remains to be
  checked. The test allows 45 seconds and reports the measured time.
- Duplicate viewer and wrong-key revocation are refused; a valid phone revocation
  survives disposing and recreating the entire runtime against its stored state.

## Findings and deliberate gaps

The front Worker needs the pairing ID **before** choosing an object. This proof
uses `/api/socket?id=…`, then requires the signed authentication ID to match the
stored pair. Current clients provide the ID only after opening `/api/socket`;
both clients need a small URL change. The ID remains routing metadata, not
proof of authority. Query strings must not become identifiers in request logs.

Hibernation requires `acceptWebSocket`, serialized attachments, and no ordinary
per-socket timers. Alarms enforce authentication/session/invitation deadlines.
Authentication re-reads authority after crypto awaits; persistent state must win
against revocation and duplicate attempts. The Node relay is not refactored into
a generic multi-backend framework for this experiment.

The fixture gate is not a proposed product login or production abuse policy.
Random valid-looking reads/upgrades can still allocate objects behind that gate;
valid self-generated enrollment signatures do not establish a scarce identity.
Public edge admission, aggregate object/storage budgets, cleanup of abandoned
objects, per-target wake quotas, monitoring and spend containment still need a
design. Do not expose this Worker anonymously.

FCM, push registration, access policy/generation synchronization, management
sockets, detailed viewer refusal codes, held HTTP polls, slow-peer backpressure,
heartbeat behavior, real Android/browser interoperability, real H.264 delivery,
network diversity and live Cloudflare billing are **not implemented or
qualified here**. Live synthetic network measurements are recorded below. The
platform's 32 MiB receive limit does not replace our own 1,048,608-byte binary
record limit. Keep that application bound.

For the next product acceptance proof, keep the separate namespace and hostname,
preserve the current relay origin, and add policy/wake parity and bounded
admission. Then run the owned-emulator hosted/control suites with FCM and forced WebSocket
fallback. Capture payload/message rates, active duration, storage reads/writes,
selected lane, recovery and actual billed usage before choosing production.
See [hosting and TURN direction](../../docs/hosting-and-turn.md).

## Live test runner

`pnpm test:live` targets only an explicitly configured, secret-gated
`yepcontrol-relay-proof.*.workers.dev` deployment. It requires
`PROOF_LIVE_CONFIG` and `PROOF_LIVE_SECRETS` pointing to private JSON files.
Concrete account, hostname, secrets and deployment receipts belong in private
infrastructure records. The runner refuses the production origin.

Deploy with the pinned Wrangler, a separate SQLite Durable Object namespace,
workers.dev enabled, preview URLs disabled, and the fixture secret supplied via
`--secrets-file`. Configure `PROOF_EXPIRES` to at most two hours in the future;
the Worker refuses new requests after that time. Disable invocation logging for
the proof so URLs carrying fixture IDs are not collected as request logs.
The default checked-in config remains local-only and closed.

The live suite uses one synthetic pairing, actual HTTPS/WSS and the existing
E2E implementation. It bounds streaming to 900 encrypted 16 KiB records over
30 seconds, checks both directions, a five-second paused receiver, the exact
record-size boundary, wrong keys/routing IDs, duplicates, idle
hibernation via a changed constructor boot ID, authentication alarms, abrupt
loss/reconnect and revocation. It redeploys only that proof Worker to verify
revocation survives code replacement. Every client socket is terminated and
completed fixture authority is revoked during cleanup. Reports and deploy logs
stay beside the private config. This runner does not implement Android, FCM or
TURN support.

## Live Cloudflare receipt — 2026-10-22

Two bounded protocol runs passed against an actual deployed Worker and its own
SQLite-backed Durable Object namespace, using synthetic endpoints over HTTPS/WSS.
The Pi service and production hostname were unchanged. Invocation logging was
disabled; fixture IDs, secrets, account details and raw evidence remain private.

| Measurement | First run | Second run |
| --- | --- | --- |
| Stream | 900 × 16 KiB records / 30 seconds | Same |
| Payload throughput | 3.93 Mbps | 3.93 Mbps |
| Sender-to-receiver median | 32.5 ms | 26.0 ms |
| Sender-to-receiver p95 | 146.6 ms | 37.1 ms |
| Maximum observed latency | 359.5 ms | 96.9 ms |
| Idle unauthenticated clean 4003 close | 10.16 seconds | 10.11 seconds |

Both runs verified signed pairing with one concurrent winner, rejection of wrong
keys/routing IDs, the actual bidirectional E2E handshake and records, duplicate
viewer refusal without displacing the live session, abrupt disconnect with peer
closure, fresh reconnect, and phone-signed revocation disconnecting both sides.
Revoked state and refusal survived an actual Worker redeployment with a distinct
build marker, not just a local runtime restart.

Real hibernation was observed in both runs after 25 seconds without application
traffic: the constructor boot ID changed, both authenticated socket attachments
remained, and encrypted exchange resumed on those same sockets.

The second run additionally paused the viewer's network reader for five seconds
while sending 150 encrypted 16 KiB records; all were received and authenticated
in order after resume. A maximum-size 1,048,608-byte encrypted record passed.
A 1,048,609-byte message was rejected with 4003, its peer disconnected, and a
fresh session worked. The bounded pause test does not qualify indefinitely slow
peers or prove a production queue/memory bound.

These are one machine's synthetic endpoints traversing Cloudflare, not two
independent mobile networks or decoded H.264. The jitter difference between runs
is part of the result. Do not use a single p95 sample as a video responsiveness
or availability guarantee.

Namespace-scoped GraphQL queries succeeded but returned no populated invocation
or periodic counters during the test window. No zero-usage or measured-cost claim
is made. Hosted billing and a longer representative usage sample remain open;
see [Cloudflare metrics](https://developers.cloudflare.com/durable-objects/observability/metrics-and-analytics/).

All test grants were revoked and client sockets closed. After testing, admission
was closed by deploying an expired `PROOF_EXPIRES` value and verifying that even
the valid fixture key receives 403. Reopening requires an explicit new short
lease in the private config. The namespace is retained for further investigation;
this is not a public service or production cutover.

Next work remains Android/browser integration, policy/generation synchronization,
process-absent FCM wake, real H.264 fallback, network diversity, sustained slow-peer
behavior and measured cost. Pi coturn is still a separate, unimplemented direction.
