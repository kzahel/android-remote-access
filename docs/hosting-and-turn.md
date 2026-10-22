# Relay hosting and TURN direction

Updated **2026-10-22**. The owner chose a small SQLite/hardening investment in
the Node relay, followed by a Cloudflare proof/investigation. Node remains useful
for development and self-hosting; Workers + Durable Objects is a candidate for
the future hosted service. Neither a production Cloudflare cutover nor a TURN
installation has been selected or performed.

## Current service and sequence

The development/beta service already runs at **https://yepcontrol.com** on the
Pi behind HTTPS/WSS ingress. The Node SQLite release is deployed; see
[storage, admission limits and recovery](relay-storage.md). Existing pairings
keep their keys, origin, policy and tombstones. The relay stays single-process:
both endpoints of a pairing must meet in the same process.

1. Keep the Node service simple: SQLite row writes, bounded enrollment/connection
   admission, durable revocations and verified backups. Distributed enrollment
   exhaustion and wake fairness remain [open](security-gaps.md).
2. Use an isolated Cloudflare experiment to establish runtime feasibility,
   then a separate hosted proof for FCM, real clients/video and operating costs.
3. Decide the hosted architecture from that evidence. Preserve the enrolled
   origin or define an explicit migration; silently moving clients to another
   hostname would strand existing grants.
4. Investigate Pi coturn as a separate WebRTC transport improvement. It can work
   with either relay host; a Worker/DO is not a TURN server.

## Cloudflare proof and findings

The [local runnable proof](../experiments/cloudflare-relay/README.md) passes
signed pairing, the existing E2E handshake, encrypted forwarding, forced
hibernation with authenticated sockets preserved, and durable revocation across
a runtime restart. A synthetic 30-record/second stream of 16 KiB records ran at
3.93 Mbps for three seconds. This was local Miniflare/workerd, not a deployed
Cloudflare service or a real H.264/network benchmark.

A front Worker can route each pairing ID to one SQLite-backed Durable Object.
The client must supply that ID when opening its socket; the proof uses
`/api/socket?id=…` and still verifies the signed ID/role/key. Current Android and
browser clients send the ID only after connection, so they need a URL change.
Keep signing against the configured origin and keep identifiers out of logs.

Use the hibernation API, serialized socket attachments and alarms. Memory resets
on eviction, so authentication/policy must be restored and authoritative state
re-read after asynchronous verification. Ordinary timers can prevent hibernation.
These are [documented platform behaviors](https://developers.cloudflare.com/durable-objects/best-practices/websockets/);
the local proof exercises explicit eviction, not production idle-time billing.
Its authentication alarm produced a clean 4003 close observed at about 20 seconds
for a 10-second deadline over loopback. Qualify actual hosted rejection and
resource-cleanup timing before relying on that budget.

FCM remains an outbound HTTPS operation. A Worker port could use OAuth access
tokens and the [FCM HTTP v1 API](https://firebase.google.com/docs/cloud-messaging/send/v1-api),
whose [message schema](https://firebase.google.com/docs/reference/fcm/rest/v1/projects.messages)
supports the FID target used by the pinned SDKs. That is documentation/source
feasibility, not a tested Worker sender. Keep credentials server-side, preserve
exact request/generation binding, coalescing, expiry and invalid-target handling,
and test process-absent wake before claiming parity.

The [platform receive limit is 32 MiB](https://developers.cloudflare.com/durable-objects/platform/limits/),
not the earlier 1 MiB estimate. Keep our tighter 1,048,608-byte record limit.
Real slow-peer backpressure and reconnect/no-replay behavior still need work;
the proof is intentionally incomplete and gated to fixtures.

Abuse can become a bill before it exhausts memory. Reject malformed/unsigned
creation before allocating objects, but valid self-generated keys are not a
scarce identity. Arbitrary lookups/upgrades, abandoned objects, completed
pairings and FCM sends need edge and aggregate budgets. Cloudflare's
[rate-limiter binding](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
is local to a Cloudflare location and is not a precise global quota. Object
storage limits and per-pair limits alone do not cap account-wide cost.

[Durable Object pricing](https://developers.cloudflare.com/durable-objects/platform/pricing/)
charges active duration and storage operations as well as requests. Incoming
WebSocket messages use a 20:1 request-billing ratio; outgoing messages have no
request charge. Idle eligible sockets can avoid duration charges, while active
video must be measured. For the hosted proof, record messages/bytes per second,
active duration, storage reads/writes, wake attempts and actual usage. Local
latency numbers cannot predict deployed latency or the final bill.

The next evidence bar is an isolated hosted namespace/hostname with policy and
wake parity, bounded admission, owned-emulator Android/browser acceptance,
forced WebSocket H.264 fallback, rapid reconnect, revocation races, real idle
hibernation and a slow/disconnected peer. Keep the current Pi service available
while this is investigated. Avoid a generic multi-backend framework now.

## Pi coturn direction

Today both clients use public STUN; failed direct WebRTC falls back to encrypted
WebSocket records. No TURN service or credential-issuance path is implemented.
TURN would add another route for the WebRTC lane, preserving its encryption
and keeping WebSocket fallback available.

The proposed small trial is **self-hosted coturn on the Pi** for owner/dev/tester
use, with managed TURN considered later for restrictive networks or wider use.
Before installation, define these concrete prerequisites:

- Short-lived credentials from coturn's `use-auth-secret` mechanism; keep its
  shared secret only on servers. Issue credentials after authenticating an
  enabled pairing, with issuance, allocation and bandwidth budgets. Accountless
  self-pairing is still possible, so authenticated issuance alone is insufficient.
- A dedicated TURN hostname, reachable public address, bounded UDP relay-port
  range and explicit firewall/router forwarding. Example ports are 3478 UDP/TCP
  plus an operator-chosen relay range; verify NAT/external-address handling and
  CGNAT reachability before promising access. Existing HTTPS ingress already owns
  TCP 443; do not assume coturn can share it.
- Deny relay access to private, loopback, link-local, carrier-NAT and multicast
  peers, including IPv6 equivalents and the service's own infrastructure.
  Bound per-user/total allocations and per-session/aggregate bytes per second;
  keep management/metrics private. Review the exact packaged coturn version
  before producing a deployable configuration.
- Change both clients to consume issued ICE servers. Force `iceTransportPolicy`
  to relay for acceptance so a successful direct route cannot disguise a broken
  TURN service. Measure chosen candidates, frame rate, loss recovery and traffic
  on cellular and restrictive Wi-Fi, including Pi failure and credential expiry.

The [coturn reference configuration](https://github.com/coturn/coturn/blob/596c48bff27e82ecfb15f42327688348f3b49f23/examples/etc/turnserver.conf)
documents timed shared-secret credentials, peer restrictions and allocation/
bandwidth quotas. This direction is source-reviewed, not a security-qualified
configuration. A home relay consumes both home download and upload; measure
capacity before selecting users or limits. Do not depend on a particular ICE
server order to guarantee that Pi UDP wins over another provider.

[Cloudflare Realtime TURN](https://developers.cloudflare.com/realtime/turn/)
is a separate managed option, with UDP/TCP/TLS listeners including TLS 443.
Its [credential API](https://developers.cloudflare.com/realtime/turn/generate-credentials/)
returns short-lived ICE credentials from a server-held long-term key. The listed
standalone price reviewed today is $0.05 per outbound real-time GB; recheck at
decision time. Neither service nor credentials have been provisioned here.

Platform/vendor references above were reviewed **2026-10-22**. Measured evidence
is limited to the deployed Node acceptance and the local Cloudflare proof.
