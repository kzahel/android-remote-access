# Android Remote Access — agent instructions

## Product intent

Build understanding of a potential standalone consumer product for remotely
reaching an Android phone. Its brand, distribution, architecture and business
model are open. Do not fold it into Yep Anywhere merely because YA and Machine
Control contain useful pieces.

The inspiration is a phone left in an RV near an Anker power station: the owner
wants to check battery level and solar charging through its Bluetooth app.
Adjacent uses are an old-phone security camera, a remote app that needs manual
login repair, and a dedicated phone that runs simple home/RV automations.
Repairing YA Android-host provider authentication is a concrete example of
manual control remaining useful when AI authentication has failed. It is not a
requirement to use YA, an AI account, an agent session or a subscription model.

The intended experience is approachable to someone who does not know ADB,
Tailscale, ports or foreground services. Explain readiness and repair actions
in ordinary language. Manual access must be useful on its own. Do not silently
expand the project into autonomous phone control, an agent harness, MDM or a
combined camera/Bluetooth product.

## Current authorization and reading

This repository began with research and an explicitly authorized emulator spike.
Later implementation authorization is recorded below. The originating request
authorizes repository creation, use-case and sibling documentation,
competitive/UX research, Git initialization and a
commit of that work. Brainstorming and “we should build this” are not sufficient
reason to choose a brand, impose a YA integration, install software on phones
or change their lock/debugging settings. Follow later explicit instructions.

The later spike request authorizes emulator setup, synthetic lock credentials,
implementation, tests and incremental commits. It does not authorize changing
physical-phone settings, publication or a production architecture. See
`spike/README.md` and `docs/spike.md` for the runbook and measured scope.

The subsequent explicit request to control the attached Pixel 7a authorizes
installing this test host and accepting its visible accessibility/screen-sharing
permissions, with automated physical-host tests and incremental commits. Keep
this separate from the earlier Pixel browser-client trial. Preserve other
services, apps and transports; do not change lock credentials or debugging
settings. Physical credential entry, reboot/Doze qualification and publication
are outside this extension. See `docs/phone-spike.md`.

A later 2026-10-19 owner request authorizes installing the host on the
attached Pixel 9 and testing remote unlock with the owner's own PIN, entered by
hidden prompt or saved in an owner-only `.local/` file. It does not authorize
reading that file, changing lock settings or retrying a failed attempt.
The owner then authorized a Tailscale transport spike with Tailscale already
running on the computer and the Pixel 9, including turning the phone's Wi-Fi off
and on through the remote control. It does not authorize changing Tailscale
configuration, other network settings or debugging settings.

The 2026-10-19 follow-up authorizes continuous touch/smooth viewing, automated
tests and use of the attached Pixel 7a. The current hardware trial uses it as
the browser client; it does not install the host APK or change its lock/debugging
settings. See `docs/touch-spike.md` for the measured role and limits.

The 2026-10-20 owner request to use the attached Pixel 7a for testing extends
its role to the new hosted pairing/FCM host acceptance. This includes temporary
test-package installation, normal Grant/notification consent, process reclamation
and screen-off forced-Doze checks with battery/idle overrides restored afterward.
Preserve the earlier spike and other applications. This does not authorize PIN
entry, lock/debugging changes or reboot testing. See `docs/fcm-wake-v1.md` for
the measured result; natural unplugged overnight qualification remains separate.

Read README.md and the applicable documents under docs/ before proposing work.
Keep product decisions separate from hypotheses and implementation evidence.
Do not mark something implemented or authorized beyond what the user requested.
Do not create approval rituals for ordinary reversible research or docs edits.

The 2026-10-20 owner decision authorizes proceeding with the standalone product
in this repository, preserving the existing executable prototype under `spike/`
and building clean production components at the root. Use TypeScript for the
relay/protocol and React viewer, and Kotlin for Android, with reproducible
builds, tests and lint. See `docs/production-plan.md` for the planned layout,
implementation defaults and open release decisions. This supersedes the earlier
new-repository proposal; it does not authorize publication, production deployment,
new device-setting changes or changes to unrelated sibling products. Use the
pinned YA FCM reference in `docs/sibling-repositories.md` without making YA a
runtime dependency.

The later 2026-10-20 owner request authorizes implementing the next pairing/relay
slice, deploying its development service on the Pi, adding the proposed HTTPS
hostname and DNS/Caddy configuration in dotfiles, and committing both repositories.
Keep the service independent of existing products. This does not authorize Play
publication, new physical-phone lock/debugging changes or unrelated service changes.

## Research discipline

- Prefer official Android/Firebase documentation, official vendor help, and
  pinned source over marketing summaries or recollection.
- Record review date, exact URLs, important version limits and whether evidence
  is platform-documented, vendor-claimed, source-reviewed or physically tested.
- A product listing is not proof of reliable unattended control or Play approval
  for our eventual implementation. Distinguish remote viewing, input, secure
  unlock and unattended recovery in every comparison.
- Do not infer UI behavior from marketing alone. Label documentation-based
  walkthroughs and proposed flows; do not present them as hands-on UX research.
- Recheck prices and licensing at decision time. Do not invent prices, session
  limits, security guarantees or absent competitor features.
- Keep screenshots, raw web captures, logs, credentials, device selectors and
  machine-specific inventories out of Git. Use .local/ for private evidence.
- Native code and APK reuse require exact-component license review. A sibling
  repository's license does not license all of its bundled dependencies.

## Technical boundaries to preserve

Keep process wake, display wake, keyguard dismissal, credential entry, first
unlock after reboot, capture consent, input authority and network reachability
distinct. ADB is a candidate advanced route, not root or an unlock bypass.
Accessibility input and screenshots have OS, app and OEM restrictions.

FCM is a best-effort wake hint, not remote authentication or a command channel.
A persistent WebSocket does not override Doze. Foreground services, battery
exemptions, companion-device associations and nearby-device permissions each
have a specific purpose; do not claim they guarantee survival or use unrelated
permissions just to keep a process alive.

Never commit PINs, tokens, ADB keys, OAuth state or app data. Optional saved-PIN
design must account for native storage, backup exclusion, explicit opt-in,
one-attempt delivery, lockout policy, local forgetting and unattended key
availability. Do not silently weaken device lock or boot security.

## Working with siblings and verification

See docs/sibling-repositories.md. Read each sibling's own AGENTS.md and local
instructions before changing it. Keep reusable device primitives in their
proper owner when that makes sense; do not assume this product needs YA's
server, Alpine/PRoot or an AI runtime. Preserve concurrent edits.

Prefer deterministic CLIs, official APIs, existing capture/test runners and
isolated fixtures. Use explicit device selection. Do not kill a shared ADB
server, change debugging listeners, install a competitor or enter credentials
on a real phone without task authorization. Hands-on tests must preserve state
and distinguish foreground success from reboot/Doze/overnight acceptance.

For documentation-only changes, verify links, evidence consistency and
`git diff --check`; do not add shallow tests or an application scaffold solely
to make this research repository look implemented. Commit on the current
branch unless instructed otherwise. Attribute model contributions with only a
`Contributing-model: <short-model-name>` trailer, not model authorship banners
or Co-Authored-By lines. Do not publish/push without authorization.
