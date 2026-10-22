# Cloudflare relay runtime proof

Local proof completed 2026-10-22. This is an isolated experiment, outside the
production workspace and its dependency graph. It is not a deployable replacement
for the Node relay. The checked-in Worker has no public route, workers.dev or
preview URL, uses `https://proof.invalid`, and refuses all requests unless a
`PROOF_KEY` binding and matching fixture header are supplied. The test generates
that key only in memory. No Cloudflare account, DNS, Firebase credential or real
phone is involved.

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

## What passed

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
network measurements and live Cloudflare billing are **not implemented or
qualified here**. The platform's 32 MiB receive limit does not replace our own
1,048,608-byte binary-record limit. Keep that application bound.

For the next hosted proof, use a separate namespace and hostname, preserve the
current relay origin, add policy/wake parity and bounded admission first, then
run the owned-emulator hosted/control suites with FCM and forced WebSocket
fallback. Capture payload/message rates, active duration, storage reads/writes,
selected lane, recovery and actual billed usage before choosing production.
See [hosting and TURN direction](../../docs/hosting-and-turn.md).
