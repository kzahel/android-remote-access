# Paired crypto session v1 — first interoperability slice

Written and self-reviewed 2026-10-20 before implementation. This is an
experimental protocol composition, not an independently audited construction
or a production security claim. The proof starts with **already trusted**
endpoint keys and one pairing scope. QR enrollment, durable browser pins,
registry persistence, FCM, WebRTC and remote input are later slices.

## Construction and trust

Follow JSTorrent's separation of endpoint identity, ephemeral session keys and
opaque transport; see the pinned [source comparison](sibling-repositories.md#babytrack-and-jstorrent-encryption-references).
We implement the specified bytes with WebCrypto and Java cryptography; no
Rust or custom cipher primitive is introduced. Identity keys are ECDSA P-256
with SHA-256. Agreement uses separate fresh P-256 ECDH keys. HKDF-SHA256 derives
AES-256-GCM keys. The phone's identity can sign through Android Keystore without
exporting its private key; browser private keys are non-extractable handles.

Each endpoint is constructed with its own identity, the exact pinned peer
public key, a 16-byte pairing ID, a uint32 authorization generation and a
synchronous current-authority check. The phone must consult its local authority,
not accept a relay assertion. Revocation closes an existing channel and rejects
handshake completion. A real registry must supply that check in production.
The proof's in-memory registry is a test fixture, not that implementation.

All integers are unsigned big-endian. Public keys are exactly 65-byte
uncompressed SEC1 P-256 points, on-curve and not infinity. Signatures are exactly
64-byte IEEE P1363 r||s. Nonces are 32 random bytes. No JSON canonicalization is
used: the handshake is fixed-length binary. Every header is 8 bytes:
ASCII `ARA1`, message type (1..4), version 1, suite 1, reserved zero.
Unknown versions, suites, reserved bits, extra/missing bytes or invalid points
are errors. Handshake instances are single-use and terminal on error.

## Exchange

The viewer speaks first. Concatenation is `||`; domain strings below are UTF-8
and end in one NUL byte. Context fields have fixed widths.

1. **Hello (type 1, 255 bytes):** header || pairing ID16 || generation4 ||
   viewer identity65 || pinned phone identity65 || viewer nonce32 || viewer
   ephemeral public65. A phone checks both identities and current pairing scope
   before generating its fresh ephemeral key/nonce. A hello alone authorizes no
   application action.
2. **Offer (type 2, 169 bytes):** U || phone signature64. U = header ||
   phone nonce32 || phone ephemeral public65. Transcript T = SHA256(
   `ara/session/transcript/v1\0` || hello || U). The phone signs
   `ara/session/phone-proof/v1\0` || T. The viewer verifies it against its pinned
   phone identity before producing its proof.
3. ECDH produces the 32-byte shared x coordinate Z. HKDF extract uses T as salt
   and Z as input. Each HKDF expand uses `ara/session/v1/` followed by one label:
   `viewer-key`, `phone-key` (32 bytes), `viewer-nonce`, `phone-nonce` (4 bytes).
   Signing and agreement keys are never interchanged. The shared secret bytes
   are cleared where mutable storage permits; platform handles are dropped.
4. **Proof (type 3, 119 bytes):** header || viewer signature64 || viewer
   confirmation record47. The viewer signs `ara/session/viewer-proof/v1\0` || T.
   Its confirmation is the record encryption of ASCII `viewer-finished` (15
   bytes), using viewer->phone sequence zero. The phone verifies signature,
   current scope and confirmation before exposing an application channel.
5. **Finish (type 4, 54 bytes):** header || phone confirmation record46, sealing
   ASCII `phone-finished` (14 bytes) with phone->viewer sequence zero. The viewer
   checks current authority and confirmation before exposing its channel. Both
   application send/receive counters now start at one. No plaintext application
   frame is accepted through a handshake object. Fresh handshake instances and
   keys are required after any failure, disconnect or authority-generation change.

The transcript binds roles through distinct signature domains and binds both
identities, both ephemeral keys, both challenges, pairing scope, protocol and
suite. Mutual key confirmation proves possession of the derived record keys.
Recorded proofs cannot authenticate a new challenge/transcript. There is no
negotiation or silent plaintext/older-suite fallback in v1.

## Records and lifecycle

A record is header16 || ciphertext || GCM tag16. Header = ASCII `ARR1` ||
direction1 (0 viewer->phone, 1 phone->viewer) || reserved zero3 || sequence8.
The header is authenticated associated data. AES-GCM uses a 128-bit tag and
nonce = derived directional nonce prefix4 || sequence8. Each lane has its own
key, prefix and strictly increasing sequence. Empty application messages are
allowed; maximum plaintext is 1 MiB. Sequence must be < 2^20 and total plaintext must not exceed 1 GiB per
direction, including key confirmation. Either limit requires a fresh handshake,
never counter reset. These conservative usage limits bound AES-GCM key use;
they are part of the suite, not an application-controlled override.

A channel serializes each direction by refusing overlapping operations. A
failed record, wrong direction/sequence/size/header, failed current-authority
check or cryptographic failure makes the entire channel terminal. No late
record, duplicate or out-of-order message can be delivered after failure.
Counters are allocated before asynchronous encryption; failures cannot cause
nonce reuse. Different WebRTC lanes, transport replacement and smooth-media
integration are not specified here: they must get independent key/nonce scope
or a fresh handshake before use. The proof is one reliable ordered lane.

A revoked pairing can neither establish a new session nor use an existing
channel. The local authority check occurs at asynchronous completion as well
as entry, so revocation during key generation, signature verification or AEAD
work cannot release an authenticated channel or plaintext. Callers must also
close sessions on transport loss and actively close on revocation; checks do
not replace that resource ownership.

## Proof and limits

Shared synthetic vectors cover transcript, P-256 ECDH, HKDF, signatures and
record bytes. Unit tests cover identity/scope substitution, malformed frames,
reflection, tamper, replay/order, confirmation, fresh reconnect, concurrency and
revocation. Real Chromium and an explicitly selected owned emulator exchange
binary records through a loopback forwarding harness; the phone signs with
Android Keystore. Test setup injects pinned public keys out of band. Its local
HTTP bridge is instrumentation-only and is not packaged in the app.

The harness never sends a phone credential, issues input, installs on a physical
phone, uses production Firebase or opens a public listener. Generated test
identity material is disposable. Checked-in deterministic vector private keys
are conspicuously synthetic fixtures and must never be used by an app.

The relay can see endpoints, timing and sizes and can deny service. E2E does not
hide plaintext from a compromised endpoint, compromised hosted JavaScript,
extension or OS. Non-extractable keys do not prevent an active origin from
asking the key to sign. Forward secrecy depends on fresh ephemeral randomness,
erasure and endpoint security; it is not a defense against endpoint compromise
while a session is active. Android first-unlock/storage restrictions remain.

Self-review checklist: fixed encodings and bounded parsing; validate EC points;
separate signature roles; bind scope/version/keys/challenges; mutual key
confirmation; unique directional nonces; terminal errors; authority checks
across awaits; no resumed record keys; explicit browser-hosting trust limit.
An independent protocol/security review remains a release gate. This slice
provides reproducible interop and adversarial evidence, not certification.
