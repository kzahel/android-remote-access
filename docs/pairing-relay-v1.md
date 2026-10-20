# Pairing and hosted relay v1

Experimental development service, specified 2026-10-20 before implementation.
This slice establishes durable trust and forwards the existing encrypted session;
it does not grant screen capture, input, unlock, FCM or WebRTC capability.

## Enrollment

The browser creates a non-exportable P-256 identity in IndexedDB and an ephemeral
256-bit QR secret. The QR URI fragment contains version, HTTPS relay origin,
random 16-byte pairing ID (hex), viewer SEC1 public key (base64), expiry (Unix
seconds, at most five minutes), and secret (hex). The secret never goes to the
relay. The phone receives this through the scanner or normal pairing deep link,
validates it, displays the relay host, and requires Grant. Test instrumentation
supplies the decoded rendered QR at this same boundary and presses Grant.

Signed/HMAC messages are UTF-8 fields joined by newline; fields cannot contain
newlines. Public keys are canonical base64, IDs/secrets lowercase hex, timestamps
decimal integers. Phone grant G is `ara/pair/grant/v1`, relay origin, ID,
viewer key, phone key, expiry. The phone signs G and computes HMAC-SHA256(secret,
G). The browser verifies both and signs G. The relay verifies both endpoint
signatures before durably recording the relationship. The phone also verifies
the browser signature before persisting its grant. Enrollment IDs are single-use;
expired or consumed requests cannot overwrite durable authority. No relay-held
secret can manufacture a phone HMAC for a fresh QR. An attacker who obtains
the QR can enroll; it must not enter URLs sent to a server, logs or analytics.

Create requests are viewer-signed over `ara/pair/create/v1`, origin, ID, viewer
key, expiry. Pending enrollment is bounded, memory-only and lost on restart.
Public polling returns only a phone's signed offer, never the QR secret.
The browser holds the QR secret only until completion/expiration. A completed
receipt can be fetched by ID but contains only public keys and signatures.
Phone confirmation polls are bounded. Losing the final receipt may leave a
browser-only grant; re-pair with a fresh QR, never silently replace a pin.

## Routing and authority

WebSocket clients select a durable pairing ID and role. The relay supplies a
fresh 32-byte challenge. Authenticate by signing newline fields:
`ara/relay/auth/v1`, relay origin, pairing ID, role, challenge. Challenges expire
in ten seconds and are single-use. Each pair admits at most one socket per role;
a second live connection is rejected rather than displacing an existing peer.
Origin is exact for browser WebSocket clients; native clients may omit Origin.
The relay sends `ready` only when both endpoints authenticate. It forwards
binary frames only, with bounded sizes/queues, to the authenticated counterpart.
Loss of either peer closes both; reconnect always starts fresh ECDH and counters.
The relay never interprets encrypted application content.

Phone revocation uses newline fields `ara/pair/revoke/v1`, origin, ID, signed
by the stored phone key. Revocation is persisted before acknowledgement and
closes both routes. Endpoints also forget their local grant; the phone's
current-authority predicate rejects work after local revocation. The relay
retains tombstones to prevent reenrollment with an old ID. Losing/rolling back
a relay database must never create endpoint trust: both endpoints retain exact
peer-key pins. Backup/restore must preserve tombstones; restoring an old backup
requires reconciling subsequent revocations before admission resumes.

## Limits and deployment

Bound JSON bodies, pending enrollments, sockets and per-source-IP mutations.
Proxy headers are trusted only from the loopback Caddy hop. Records are at most
1 MiB plus 32 bytes; a slow receiver closes the pair rather than buffering
unbounded input. No automatic replay of application messages is supported.
Public health contains a revision and status, no pairing identifiers.

Private host selection, service configuration, DNS, deployment, backup and
rollback belong in dotfiles. The product repository contains a reproducible
web/relay build and public acceptance runner. This is a development deployment,
not an audited consumer release. Physical camera and overnight FCM acceptance
remain separate from automated decoded-image enrollment.


## Mobile policy extension (2026-10-20)

Each browser has its own pairing ID and pinned grant; a phone identity can grant
multiple browsers. Enrollment and encrypted session formats remain v1. The phone
now persists grants and access policy in Room, with private keys still in Keystore.

An authenticated phone `mode: "registration"` socket may send `setAccess` with
`enabled` and a fresh 16-byte hex `generation`, receiving `accessUpdated` before
registering/removing push delivery. Only the phone management role may change
policy. A changed policy is persisted and closes that pair's pending/active route.
Paused viewers are rejected. Session-role phones must present the current
`generation` once the pairing has opted into this extension. Unextended old grants
remain readable and usable under their original contract.

Push registrations attach that generation. Hints include `pairingId` and
`generation`; the new native host requires both and rejects superseded generations
before scheduling and throughout execution. They select a local pin, never grant
trust. Local disarm/disable/revoke applies immediately even if relay synchronization
fails. Re-enabling rotates the generation again; old requests cannot revive.
Only one native session lease is admitted across all pairings. Management refresh
with unchanged policy does not displace an active encrypted session.
