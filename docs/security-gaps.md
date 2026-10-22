# Security decisions and open gaps

Reviewed 2026-10-22. This document records the current security boundary,
accepted product decisions and gaps found in a source review of the production
pairing, relay, wake and control paths. It is not an independent audit or a
claim that the service is ready for broad release. The preserved `spike/`
implementation is outside this review.

## Summary

| ID | Topic | Status | Required disposition |
| --- | --- | --- | --- |
| SG-1 | Paired-controller authority | Intentional product behavior | Explain the trust granted to an active controller. |
| SG-2 | Enrollment-origin pinning | Implemented in source; release delivery pending | Ship the origin-pinned Android build. |
| SG-3 | Relay enrollment-storage exhaustion | Mitigated for development/self-hosting; public-service policy open | SQLite and small admission budgets bound work; distributed abuse can still deny new enrollment. |
| SG-4 | FCM before the end-to-end session | Protocol behavior accepted; abuse controls open | Preserve endpoint authentication while adding fair wake quotas and monitoring. |
| SG-5 | Pair-again semantics | Open, high priority | Do not present another pairing as revocation or repair. Define an explicit replacement flow. |
| SG-6 | Hosted viewer origin | Intentional trust boundary | Treat deployment integrity as endpoint security. |
| SG-7 | HSTS | Open deployment gap | Enable HSTS after confirming every covered subdomain is HTTPS-only. |

## SG-1: a paired controller is highly trusted

The owner accepts that a paired, enabled browser can operate the phone UI with
the authority of the enabled screen-control service. That includes navigating
ordinary YepControl management screens, enabling supported background-access
features, managing other browser grants and opening relevant Android settings.
This is intentional product behavior, not an isolation boundary between an
active controller and the phone's on-screen UI.

The product should say plainly that enabling control is comparable to handing
someone an unlocked phone for the duration of the session. Pairing approval,
granting saved-PIN access and other actions explicitly designated local-only
remain separate security boundaries. Global and per-browser access switches
remain useful for the local owner to pause or revoke access, but they must not
be described as protection from a malicious controller that is already active
and allowed to operate those same screens.

## SG-2: release builds must pin the enrollment origin

Implemented 2026-10-22. The scanner and incoming links use the same invitation
parser, which requires both the outer URL and the invitation to match the exact
selected build-configured HTTPS origin before approval or network activity.
Release builds accept only `SHARING_WEBSITE`, currently
`https://yepcontrol.com`. This pins a service origin, not a TLS certificate.

Debug builds can select an explicitly compiled `DEV_SHARING_WEBSITE` in Settings;
a scanned invitation cannot select it. The switch applies to new enrollment.
Existing grants on either configured origin remain usable when the debug switch
changes. Separate deployments must build with their own `sharingWebsite` value.
Release builds have no development origin or development switch.

Saved grants for unconfigured services remain visible as unavailable for local
removal. They cannot authorize a session, synchronize policy, register push or
contact that service, including for revocation. Removing one forgets it locally;
it does not claim an acknowledgement from the old relay. Valid configured-origin
grants retain their storage and identity; no protocol or database change is needed.
HTTP and WebSocket entry points also enforce the build's configured origins.

Approval always shows the configured host and identifies the browser name as
text supplied by the other device. Labels reject controls, invisible formatting
and Unicode line/paragraph separators while retaining ordinary Unicode names.
This prevents those label tricks; it does not authenticate the displayed name.

Verification is recorded in [App Links](app-links.md#enrollment-origin-pinning-2026-10-22).
The existing Play beta is unchanged until a new Android build is released.

## SG-3: public clients can exhaust durable relay enrollment state

The accountless relay lets a client create both endpoints and complete a
cryptographically valid pairing without access to a victim. Pending requests
are bounded, but completed and revoked pair records share a fixed durable cap.
They survive restart and count against the cap indefinitely under the current
protocol. On 2026-10-22, the Node relay moved pairing/policy/tombstone and push
state to SQLite row writes, preserving existing grants through a one-time import.
Pairing starts have a separate 10/IP/minute budget; completed pairings share a
persistent rolling limit of 100/hour and the existing 10,000 lifetime cap.
Admission is rechecked after asynchronous verification. There are at most 64
unauthenticated sockets and one authenticated management socket per pairing.
See [the bounded relay hardening](relay-storage.md).

This is deliberately a small development/self-hosting investment. A distributed
client can still consume the completion budget or eventually fill the durable
cap and deny new enrollment. Existing grants remain usable at capacity; no
pairings or tombstones are silently expired. SQLite removes whole-file rewrite
amplification, not accountless enrollment abuse.
Before broader public use, move this state to storage with bounded mutation
cost, set defensible lifecycle and capacity rules, apply edge and per-principal
quotas where a meaningful principal exists, and alert on growth and rejection
rates. An IP rate limit alone is not a distributed-abuse defense. Revoked IDs
cannot simply be forgotten: tombstone retention and any compaction scheme must
preserve the rule that rollback or reuse never restores authority.

## SG-4: FCM wake precedes the end-to-end application handshake

This ordering is necessary when the phone process is absent, but it does not
mean that knowing a pairing ID is enough to wake a victim phone. The sequence
is:

1. The viewer opens a relay route for a pairing ID.
2. The relay supplies a fresh, short-lived challenge.
3. The viewer signs the relay origin, pairing ID, role and challenge with the
   viewer key pinned during pairing.
4. Only after verifying that signature may the relay queue an FCM hint if the
   phone is absent.
5. The phone checks the local pairing and access generation, then requires the
   endpoint-authenticated, end-to-end encrypted session before accepting a
   control command.

A random party with only the pairing ID cannot trigger that wake path. An
authorized or compromised viewer key can request repeated wakes, and a
compromised relay can originate hints because it holds the push registration.
Neither condition gives the relay the phone or viewer endpoint key needed to
complete the encrypted control handshake. Separately, an attacker can create
its own valid pairings and consume a shared FCM send quota, but those records
point to attacker-controlled registrations rather than a victim phone.

The remaining gap is availability and nuisance-abuse control: use fair quotas,
cooldowns and monitoring so one pairing or self-enrolled client cannot consume
the service-wide wake budget. Moving FCM after the application handshake is not
a solution because the wake hint exists to make that handshake possible.

## SG-5: pairing again is not revocation

Another successful pairing creates another durable authorization. It does not
prove that an earlier browser grant has been deleted from the phone or revoked
at the relay. The browser may replace the grant it displays locally while the
older authorization remains usable elsewhere. Consequently, “re-pair” must not
be offered as a generic recovery or security-repair action.

Recommended product model:

- Call the ordinary operation **Pair a new browser** or **Add access**. It
  creates an independent grant.
- If the same browser identity and phone are already paired, either return the
  user to the existing grant or offer an explicit **Replace access** operation.
- Replacement must identify the old grant, durably revoke it, and only then
  make the new grant the visible authority. Failure must not hide the old
  grant or imply that it was revoked.
- If browser storage or its identity key is lost, instruct the owner to remove
  that browser locally on the phone and then pair the replacement browser.
- Treat loss of the final enrollment receipt as an incomplete transaction with
  an explicit recovery design, not as a reason to silently accumulate grants.

Until replacement is implemented, documentation and UI must warn that pairing
again adds access and does not revoke an earlier pairing.

## SG-6: the hosted viewer origin is an endpoint

The browser's private key is non-exportable, but JavaScript running at the same
origin can use it and can observe control input, including a PIN entered into
the viewer. Compromise of the hosted viewer, its deployment credentials or its
supply chain is therefore endpoint compromise, not merely relay compromise.
Strict content security policy, dependency review, narrowly held deployment
authority and reproducible immutable releases belong in the endpoint threat
model.

## SG-7: enable HSTS

The live site did not send `Strict-Transport-Security` when checked on
2026-10-22. Configure an appropriate long-lived HSTS policy after confirming
that every covered subdomain is HTTPS-only. Use `includeSubDomains` only when
that condition is true, and evaluate browser preload separately. An HTTP-to-
HTTPS redirect does not protect a first visit from an active network attacker;
HSTS protects returning clients, while preload can cover the first visit.

## Lower-priority hardening

- Return a purpose-built public enrollment-status projection instead of the
  relay's complete stored pair object. Pairing IDs are high entropy and the
  exposed policy fields do not grant authority, but the public response should
  disclose only what enrollment and tombstone checks require.
- Resolve the current production dependency audit advisory for the transitive
  `uuid@9.0.1` when its dependency chain permits it. No use of the advisory's
  affected API was identified in this review.

## Review result and release gate

No practical break was found in the reviewed transcript signatures, P-256
ephemeral key agreement, HKDF key separation, directional AES-GCM framing,
sequence checks or endpoint key pinning. That is a limited source-review result,
not a cryptographic proof. The SG-2 fix must reach the distributed Android build,
SG-3 and SG-5 need explicit resolution before wider release, SG-7 needs deployment
resolution, and the complete protocol and
hosted endpoint should receive an independent security review.
