# Cloudflare production relay

The owner authorized moving the hosted relay to Cloudflare on 2026-10-22.
The Node/SQLite relay remains the local and self-hosted implementation. Hosted
operation uses an independent Worker with SQLite Durable Objects, the normal
viewer, and its own send-only Firebase identity with automatic token renewal.
Staging retains separate state, credentials, rate-limit namespaces and its closed fixture gate.

## Release and cutover contract

Production uses `https://yepcontrol.com`, including the viewer, enrollment,
privacy policy and Android App Links. `www` redirects to the apex. Preserve the
existing security headers. The workers.dev address exposes health for deployment
verification; application requests there must use the canonical origin.

Normal clients require the pairing ID in `/api/socket?id=…` and acknowledge the
bounded ciphertext receipt extension. Deploy the Node routing compatibility
patch before distributing Android 0.7.0/code 5. Update installed Android hosts
before connecting through Cloudflare; older builds require an app update, not
new pairing identities. The browser loads the updated viewer at the same origin.

The tagged CI bundle contains the matched viewer, Worker and temporary importer.
Use the `relay-production` environment, restricted to main, with a dedicated
single-Worker Editor token. DNS/custom domains and Google credentials are
provisioned separately; CI has no zone/DNS rights. Production admission is
explicit: `RELAY_MODE=maintenance` returns 503 for application requests;
`production` enables the bounded authenticated protocol. No proof key is used
for production. CI never enables migration authority.

## One-time authority migration

1. Verify full exact-source CI and deploy the tagged production bundle in
   maintenance. Provision its dedicated FCM sender and CI token.
2. Complete an encrypted Pi backup/restore verification. Pause only the Pi relay
   and take a consistent final SQLite snapshot while its writer is stopped.
3. Export version 1 JSON with the unchanged origin and rows containing `pair`,
   `created` and optional `target`. Preserve grant keys/signatures, paused access,
   policy generations, revocation tombstones, FIDs and registration generations.
   Keep the manifest private; do not include FCM OAuth caches or private keys.
4. Pin the exact manifest SHA-256 and a short expiration in the destination's
   maintenance configuration. Deploy the temporary importer with bindings to
   that Worker's Pairing and Admission classes, the same hash/deadline, and a
   random secret bearer token. Its only HTTP operation is POST `/import`.
5. Send the exact frozen manifest over HTTPS. The importer validates stored keys, signature encodings, policy and all rows
   before allocating objects. The SHA-256-pinned source database is existing
   authority, including historical grants signed under retired hostnames; it is
   not a new enrollment. Fresh socket authentication still binds the current
   origin and a new challenge. It writes only empty
   destinations, checks each stored record's digest and the complete route
   directory, and reports only digest/counts. Identical retries resume; a changed
   manifest or existing destination authority refuses. This small-service tool
   caps the manifest at 500 records / 8 MiB; larger migrations need a batched
   implementation before use.
6. Remove this zone from the Pi DDNS desired state before switching the apex and
   `www` to Worker custom domains. Preserve other zones and services.
7. Deploy the same verified bundle through CI with production admission. This
   clears the migration hash/deadline. Delete the temporary importer and token.
8. Verify live migrated FCM wake, encrypted reconnect, revocation, new enrollment,
   rendered video/input and static/app-link responses. Disable the retired Pi
   relay after acceptance. Retain the final authority snapshot and encrypted
   backup privately.

`HOSTED_MIGRATION=1 HOSTED_FCM=1` adds an owned-emulator checkpoint to the normal
hosted runner after pairing and push registration, with the native process absent
and browser disconnected. It writes `migration-ready.json` under its private
state directory and waits for an explicit `migration-continue` file before
reconnecting at the unchanged origin. Physical devices are refused in this mode.

## Recovery and limits

Before public Cloudflare writes begin, a failed migration can leave the Node
writer stopped while the identical import resumes, or can return to the unchanged
Node authority if the domain cutover is abandoned. After Cloudflare accepts any
new policy, revocation or enrollment, the Pi snapshot is stale: do not restart it
as public authority or restore an older Durable Object bookmark without reconciling
those changes. Prefer a forward code fix. Code deployment does not restore data.

Existing edge/global/request, enrollment, socket, message, backlog and FCM quotas
remain in force. They bound resources but do not guarantee fair anonymous
admission or impose an account billing ceiling. Keep alerts/usage review and
credential rotation in the private operations runbook. No coturn service is
required for this cutover; the separate Pi TURN investigation remains planned.

References reviewed 2026-10-22: [Worker custom domains](https://developers.cloudflare.com/workers/configuration/routing/custom-domains/)
manage DNS/certificates; [SQLite Durable Object storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
describes storage and recovery. Live cutover evidence is recorded after execution.

Rate-limit namespaces are account-scoped; production and staging use distinct IDs
to avoid sharing per-IP counters across Workers. See the
[Cloudflare binding contract](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
