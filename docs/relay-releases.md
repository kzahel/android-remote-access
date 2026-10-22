# Relay releases and CI deployment

Relay versions are independent of Android versions. Use immutable tags such as
`relay-v0.1.0` or `relay-v0.2.0-rc.1`; never move a released tag. The selected
commit must belong to `main` and have a successful complete **Checks** run for
that exact SHA. A tag push runs **Relay release and staging deployment**.

The workflow tests the Node/shared code and the Cloudflare runtime, builds the
matching Cloudflare viewer and Worker, and retains a version/SHA-labelled artifact
for 90 days. `release.json` records the source, CI run and SHA-256 of every file.
No credentials, Firebase key, pairing database or phone state enters the bundle.

To deploy, dispatch the same workflow on `main` with an existing tag and
`deploy=true`. The deployment job downloads and verifies the exact bytes built
by its build job, then uses the `relay-staging` GitHub environment. Deployments
are serialized; an in-progress deployment is never canceled by a newer request.
The deployment receipt records the tag, commit, CI run, actual Cloudflare Worker
version and a matching HTTPS health check.

This first target is the isolated **gated Cloudflare staging service**. CI always
deploys with closed application admission (`PROOF_EXPIRES=1`), no production
domain route, no preview URL and no FCM sender credential provisioning. It cannot
select the production hostname or normal production Worker name. Existing
Durable Object namespaces and authority remain intact. The Pi remains live;
this workflow neither connects to it nor changes its service or DNS.

`GET /health` exposes only release identity and whether admission is closed.
It does not look up a pairing, allocate an object or prove Android/FCM acceptance.
All application paths remain behind the existing fixture gate. Reopening staging
for a bounded live acceptance run remains a separate operation until the public
admission and durable FCM credential work is complete.

## Environment provisioning

Create a `relay-staging` environment restricted to deployment workflows on
`main`, with these environment values:

| Name | Kind | Meaning |
| --- | --- | --- |
| `CLOUDFLARE_API_TOKEN` | Secret | Dedicated token with Individual Workers Editor access to the existing isolated Worker. |
| `CLOUDFLARE_ACCOUNT_ID` | Variable | Account containing the isolated staging service. |
| `RELAY_WORKER_NAME` | Variable | `yepcontrol-relay-staging`, or the existing isolated `yepcontrol-relay-proof`. |
| `RELAY_ORIGIN` | Variable | Matching HTTPS workers.dev origin, without trailing slash. |

Keep concrete infrastructure values and token provisioning receipts in the
private infrastructure repository. Do not upload the developer's Wrangler OAuth
session or Firebase private key to GitHub. Cloudflare CI authentication requires
an API token; scope it to the one existing Worker using **Individual Workers Editor**,
which can deploy and update that Worker without creating/deleting Workers or
accessing other Workers. Bootstrap a new staging Worker separately before
granting CI access. Avoid account-wide or unrelated zone/DNS permissions.
[Workers permissions](https://developers.cloudflare.com/workers/authorization/workers/)
documents this scope. [Cloudflare CI authentication](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/)
and [GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
were reviewed 2026-10-22.

The workflow fails clearly if environment provisioning is absent. The checked-in
pipeline is not evidence that credentials are installed or a CI deployment ran.

## Releasing and recovery

1. Commit and push the intended source to `main`; wait for complete Checks.
2. Create and push its version tag, for example `git tag relay-v0.1.0 COMMIT` and
   `git push origin relay-v0.1.0`. The tag build needs no Cloudflare credentials.
3. Dispatch **Relay release and staging deployment** on `main`, specifying that
   tag and enabling deployment. Inspect the resulting deployment receipt.
4. To redeploy earlier compatible code, dispatch an earlier immutable tag whose
   workflow contains this release pipeline. This rebuilds that pinned source and
   deploys its newly verified bundle; it is not promotion of an older CI artifact.

Code redeployment does not restore SQLite data, deleted authority or an older
schema. Durable Object migration rollback has separate constraints; use a forward
fix when an older release cannot read the current data. Do not restore a stale
pairing database to roll code back. Production promotion and a CI-driven Pi
installer remain future targets; neither is enabled by this staging workflow.

For local development, keep the Node/SQLite runner and its optional FCM sender.
CI deployment does not change offline/manual operation or couple the Android
release version to the relay version.
