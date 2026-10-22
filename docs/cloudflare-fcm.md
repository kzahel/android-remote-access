# Cloudflare FCM credential renewal

Implemented **2026-10-22**. The hosted relay obtains its own Google OAuth access
tokens on demand. It needs no Pi, user login, cron job or CI token-refresh job.
This change does not move the production origin or existing pairing authority.

## Credentials and token lifetime

Use a dedicated Google service account in the Android app's Firebase project.
Grant a project custom role containing only `cloudmessaging.messages.create`.
Keep the Pi sender and other service accounts unchanged. A service-account key
is long-lived: revoke/rotate it independently of the automatically renewed access
tokens. The relay still has no access to encrypted session content or phone PINs.

Provision the account's JSON credential directly as the Cloudflare Worker secret
`FCM_SERVICE_ACCOUNT`. Set `FCM_PROJECT` to its Firebase project ID. The account's
`project_id` must match that deployment setting. Never put the key in source,
Wrangler vars, GitHub artifacts, client builds or command arguments. CI retains
the already provisioned Worker secret; it only supplies the public project ID
through the `relay-staging` environment variable `FCM_PROJECT`.

The existing global SQLite-backed `WakeBudget` object coordinates token renewal.
After reserving the existing 100/minute global and 10/minute per-FID send budgets,
it returns an unexpired token to the pairing object through its private DO binding.
No public route exposes token retrieval, invalidation or storage. The pairing
rechecks current authority, target, viewer and wake expiry after that await and
before sending the FCM hint.

The credential helper uses pinned `jose` and Workers Web Crypto to sign an RS256
JWT with the fixed `firebase.messaging` OAuth scope and Google's fixed token
endpoint. It ignores credential-file endpoint overrides, does not delegate to a
user and refuses HTTP redirects. A successful token response supplies the lifetime
(at most one hour); renewal starts when less than one minute remains. No renewal
is scheduled while idle.

The private key remains only in the Worker secret. One short-lived bearer token,
its expiry and a credential fingerprint are stored in the object's SQLite table
so a runtime restart does not repeatedly mint tokens. Expired entries are replaced
on the next request. Treat this internal storage as sensitive; do not export it
with pairing data or log the token. Changing the project or secret discards the
old cache and backoff. Removing the configuration disables wake immediately.

## Failure and rotation

Concurrent wakes share one exchange. Failed exchanges, malformed responses and
timeouts fail closed, with a persisted one-minute retry delay. Google error bodies,
assertions, tokens and keys are never returned to clients or logged by this code.
FCM 401 invalidates only the matching cached token and applies the same delay;
an older in-flight rejection cannot invalidate a newer token. The send is not
automatically replayed. Only FCM's explicit `UNREGISTERED` response removes a
phone's wake target; credential and permission failures preserve it.

For rotation, create a new key for this same dedicated identity, replace the
Worker secret, verify a fresh process-absent native wake, then delete the old key
in Google IAM. Revoke any newly created key if its secret installation fails.
Do not change the Pi's account/key during this operation. Application deployments
and key rotation are separate operations; a code rollback does not restore an
old secret or deleted key.

## Verification

`pnpm --dir experiments/cloudflare-relay test` verifies actual RSA signatures and
JWT claims, concurrent exchanges, pre-expiry renewal, expiry after reconstruction,
rotation, deleted/mismatched configuration, provider failure and durable backoff.
The workerd test exercises real Workers signing and SQLite storage, a full runtime
restart, controlled persisted expiry and token invalidation. It uses generated
test keys and a mocked Google endpoint; it does not contact Google or a phone.

Live Google/Android staging acceptance is recorded separately below when run.

Official references reviewed 2026-10-22:
[Google service-account OAuth](https://developers.google.com/identity/protocols/oauth2/service-account),
[FCM HTTP v1 authorization](https://firebase.google.com/docs/cloud-messaging/send/v1-api),
[FCM IAM permissions](https://docs.cloud.google.com/iam/docs/roles-permissions/firebasecloudmessaging),
[Workers secrets](https://developers.cloudflare.com/workers/configuration/secrets/).
