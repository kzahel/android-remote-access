# Relay hosting and TURN direction

Updated **2026-10-22**. The hosted service at **https://yepcontrol.com** now
runs on Cloudflare Workers and SQLite Durable Objects, deployed through versioned
CI. Existing pairing authority was migrated at the same origin; the Pi relay
is disabled. See the [production cutover receipt](cloudflare-production.md).
Node/SQLite remains the development and self-hosted implementation. Pi coturn
remains a separate, unimplemented direction.

The owner subsequently agreed to retain Node/SQLite for local development and
self-hosting, with FCM optional, and pursue Cloudflare for hosted operation.
Hosting and background wake are separate choices. True internet-disconnected
LAN access still needs explicit acceptance; the current development helper uses
Tailscale HTTPS. Normal clients now supply the pairing ID in the socket URL for
either relay; Node also accepts installed clients' bare socket route. Relay releases should be versioned independently and deployed by
CI; see [release workflow and staging boundaries](relay-releases.md).

## Current service and sequence

The production relay, normal viewer and FCM sender run independently of the Pi.
Android 0.7.0/code 5 and the current viewer support both Node and Cloudflare;
installed older Android builds require an update for Cloudflare's routed sockets
and flow receipts. Existing identities and pairings survive the update.

Keep Node simple: SQLite row writes, bounded admission, durable revocations and
verified backups. Distributed enrollment exhaustion and wake fairness remain
[open](security-gaps.md). Retain local/self-hosted acceptance separately from
hosted operation; a Worker/DO is not a TURN server. The measured proof records
below describe the investigation that preceded the production cutover.

## Cloudflare proof and findings

The [local runnable proof](../experiments/cloudflare-relay/README.md) passes
signed pairing, the existing E2E handshake, encrypted forwarding, forced
hibernation with authenticated sockets preserved, and durable revocation across
a runtime restart. A synthetic 30-record/second stream of 16 KiB records ran at
3.93 Mbps for three seconds. That first run used local Miniflare/workerd.
Neither it nor the live protocol runs below are real H.264/native-client
qualification.

Two subsequent live protocol runs on an isolated workers.dev service passed
bidirectional E2E, real idle hibernation, reconnect and revocation across actual
redeployment. Both forwarded 900 × 16 KiB records over 30 seconds at 3.93 Mbps.
Observed median/p95 latencies were 32.5/146.6 ms and 26.0/37.1 ms respectively.
The second run recovered a five-second paused receiver and verified exact
record-size acceptance/refusal. These are synthetic endpoints on one machine,
not real phone video or a network-diversity qualification. The test gate was
closed afterward; details and remaining limits are in the
[live receipt](../experiments/cloudflare-relay/README.md#live-cloudflare-receipt--2026-10-22).

A front Worker can route each pairing ID to one SQLite-backed Durable Object.
The client must supply that ID when opening its socket; the proof uses
`/api/socket?id=…` and still verifies the signed ID/role/key. Normal Android and
browser builds now send this routing field, and Node binds it to the same signed
authentication ID. The proof-only Android flag supplies fixture admission only.
Keep signing against the configured origin and keep identifiers out of logs.

Use the hibernation API, serialized socket attachments and alarms. Memory resets
on eviction, so authentication/policy must be restored and authoritative state
re-read after asynchronous verification. Ordinary timers can prevent hibernation.
These are [documented platform behaviors](https://developers.cloudflare.com/durable-objects/best-practices/websockets/);
the local proof exercises explicit eviction, not production idle-time billing.
Its authentication alarm produced a clean 4003 close observed at about 20 seconds
for a 10-second deadline over loopback. The live protocol runs observed clean
closes at 10.16 and 10.11 seconds, matching the configured 10-second deadline.

The live product proof now sends outbound FCM HTTP v1 directly from Cloudflare
with a short-lived token from the existing dedicated sender. Its private key
stays on the Pi. Real process-absent API 35 Android wake passed, followed by a
fresh encrypted exchange in about 1.5–1.6 seconds. Management sockets, push
registration, generation-bound policy, coalescing, expiry and send budgets are
implemented for the proof. [Automatic credential renewal](cloudflare-fcm.md)
now removes the need for a Pi-minted token; production cutover remains separate.

Owned-emulator and real React-browser acceptance also passed QR/Grant pairing,
restart persistence, tap/text/swipe/navigation/app launch, disabling access and
revocation. Forced WebSocket fallback rendered 77 decoded H.264 frames in
5.003 seconds, receiving 1,355,057 encrypted binary bytes (about 2.17 Mbps).
These runs used one computer, not independent mobile networks or physical-phone
background qualification. See the [product receipt](../experiments/cloudflare-relay/README.md#live-androidbrowser-product-receipt--2026-10-22).

The [platform receive limit is 32 MiB](https://developers.cloudflare.com/durable-objects/platform/limits/),
not the earlier 1 MiB estimate. Keep our tighter 1,048,608-byte record limit.
Receive ACKs now bound stalled peers across hibernation, with fresh-session
reconnect tests. A bounded admission directory also prevents random-ID object
allocation and caps growth; see [hardening and limits](cloudflare-hardening.md).
The hosted runtime remains gated to fixtures.

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

The authenticated dashboard confirms the current Workers Free plan and $0.00
Durable Object billable cost for this small proof. Recovered namespace metrics
included about 2.33k raw invocations, 3.18 GB-s and 40.96 kB stored, plus 2,408
rows read and 95 written. These cumulative metrics include synthetic and native
runs; they are not a per-minute video price or a posted invoice. Hibernatable
incoming messages appear as invocation events and still receive the 20:1
billing ratio. A representative longer cost sample remains open.

The next evidence bar is public enrollment fairness/lifecycle,
network diversity, sustained slow-peer bounds, and representative cost. The
private product test gate remains closed after acceptance. Keep the current Pi
service available. Avoid a generic multi-backend framework now.

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
includes deployed Node acceptance and gated local/live Cloudflare proofs;
public production operation is not qualified by those tests.
