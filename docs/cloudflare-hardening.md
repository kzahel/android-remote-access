# Cloudflare client compatibility and bounded admission

Implemented and locally verified **2026-10-22**. The isolated Cloudflare service
remains behind the fixture gate; production remains on the Pi. This slice makes
the normal clients compatible and adds conservative staging limits. Automatic
FCM credential renewal, broader network qualification and public rollout remain
separate work.

## Client routing and compatibility

Normal Android and browser builds open `/api/socket?id=PAIRING_ID`. The ID selects
a Durable Object; it conveys no authority. Both relays require the fresh
challenge signature for that same ID, origin and role. Node also accepts the
bare socket URL used by the installed beta. No grant, database or encryption
format changes are needed. The Android proof flag now supplies only the fixture
admission header; there is no special viewer build mode.

Roll out the Node routing change before publishing the next Android/viewer build:
the currently deployed Pi version accepts only the bare socket URL. Existing
installed clients keep working throughout that order. No new Android build or
Pi update is published as part of this staging slice.

## Admission and resource bounds

Before resolving a pairing object, the Worker checks edge admission and a
single SQLite-backed Admission object. Only a valid signed creation can reserve
a previously unknown ID. Random reads, offers, revokes and socket URLs cannot
allocate pairing objects. Failed reservations are never followed by a pairing
object call. Missing required bindings fail closed.

| Resource | Default bound |
| --- | --- |
| API requests / upgrades at an edge location | Approximate 240/IP/minute |
| Pairing-start attempts, including invalid signatures | Approximate 10/IP/minute |
| Requests reaching the admission directory | Strict 3,000 per durable 60-second window |
| Upgrade attempts reaching the directory | Strict 60 per durable 60-second window |
| All reserved IDs, including failed/abandoned starts | 10,000 lifetime |
| New ID reservations | 100 in a rolling hour |
| WebSocket connection leases across all pairs | 128 |
| WebSockets in one pairing object | 8, including unauthenticated sockets |
| Authentication / authenticated session lifetime | 10 seconds / one hour |
| Binary record size | 1,048,608 bytes |
| Unacknowledged binary data per receiving socket | 2 MiB and 128 records |
| Ingress per authenticated socket, including ACKs/metadata | 4 MiB and 128 messages per one-second window |
| Existing wake budget | 100 sends/minute globally, 10/minute per FID, 30-second pair cooldown |

The IP key comes from Cloudflare ingress, never a forwarded address supplied by
the caller. Shared IPs can share these coarse budgets. Edge counters are local
and approximate; the Admission object's counters, reservations and connection
leases persist across hibernation/restart. Its tables contain no IP addresses.
The two rate-limiter namespace IDs in the staging config must be kept distinct
from unrelated Workers' namespaces on the same account.

Leases are reserved before forwarding an upgrade and released on failed upgrade,
close or transport error. Release is idempotent. An unreleased lease expires
after the maximum authentication-plus-session lifetime, with a small margin;
capacity is rechecked atomically after pruning expired leases. Missing close
events can therefore temporarily reduce available capacity without exceeding it.

Reservations deliberately count abandoned invitations and never expire. Paired
authority and revocation tombstones are not deleted to reclaim space. This bounds
pairing-object growth but lets a distributed self-enrolling client consume new
enrollment capacity. Existing IDs remain routable at capacity, subject to request
and connection budgets. Shared budgets can themselves be exhausted; they do not
provide fair admission or guarantee a hard account-wide spending ceiling. The
fixture gate stays closed until a public admission/lifecycle policy is selected.

Capacity, hourly starts, directory requests and socket capacity can be lowered
using `PAIRING_CAPACITY`, `PAIRING_STARTS_PER_HOUR`, `REQUESTS_PER_MINUTE` and
`SOCKET_CAPACITY`. Invalid or above-default values are refused. Admission is a
new SQLite Durable Object class (`v3`); future code rollback must retain the
directory and its reservations. Existing completed proof fixtures were already
revoked before this change; no active hosted grants require import. This does
not define a production pairing migration.

## Receive acknowledgements and backpressure

Cloudflare advertises `relayFlow: 1` in the challenge. After forwarding binary
records it sends `{type: "relayReceipt", nonce}` on that same ordered socket.
The nonce is an unpredictable 128-bit value bound to a byte/record checkpoint.
Clients return `{type: "relayAck", nonce}` after reading the receipt. A client
cannot restore credit by inventing counters; even two cooperating endpoints
must read past the covered data to discover the receipt. Only one checkpoint
is outstanding per receiver, keeping attachment state small. ACKs cannot be
replayed to restore credit twice. Node does not advertise this extension, so
normal clients send it no acknowledgements.

Before forwarding, the relay checks the receiver's outstanding byte/record
credit. Counters and the current checkpoint live in the hibernatable socket
attachment. Forged/replayed ACKs, excess ingress and stalled receivers end the
live route. Ciphertext is neither stored for retransmission nor replayed to a
reconnected session. A receipt proves transport progress, not video decoding;
the clients retain their own bounded receive/send queues. These tests do not
qualify cellular or restrictive Wi-Fi.

## Verification

`pnpm --dir experiments/cloudflare-relay test` runs isolated workerd/SQLite tests
for random-ID isolation, malformed creation, concurrent reservation, lifetime
and hourly capacity, edge rejection, strict shared request/upgrade quotas,
connection lease admission/release, restart/eviction persistence, and existing
routes at capacity. Flow tests cover byte/record credit, forged ACKs and ingress
budgets. Real loopback sockets verify a 2 MiB stalled receiver across forced
hibernation, fresh reconnect, encrypted exchange and durable revocation.

The normal suite includes real browser-transport cryptographic handshakes and
more than 3 MiB of records with and without flow negotiation, Node query-ID
binding, malformed routing and the older bare route. Typechecks, Android Kotlin
compilation/format checks, and the release-config regression suite also pass.
Live deployment and native acceptance receipts are recorded separately.

Official references reviewed 2026-10-22:
[Cloudflare rate limits and their locality/accuracy](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/),
[hibernation and serialized socket attachments](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[WebSocket API](https://developers.cloudflare.com/workers/runtime-apis/websockets/),
and [Durable Object limits](https://developers.cloudflare.com/durable-objects/platform/limits/).
