# Android beta distribution

Owner-authorized 2026-10-21. Initial settings: **YepControl – Remote Phone**,
`com.yepcontrol.app`, Tools, English (US), free installation, no ads, no required
account, intended audience 13–15 / 16–17 / 18+. Content rating is assigned from
the truthful utility questionnaire, separately from intended audience.
The first track is internal testing. Verify the Play-installed build on the
owned test phone before expanding to a closed beta. Production rollout is not
authorized by this work.

Store copy is in [listing.en-US.txt](listing.en-US.txt), editable artwork in
[artwork](../../artwork/README.md), and the privacy URL is
`https://yepcontrol.com/privacy/`. E2E content is separate from retained
connection metadata and Firebase installation identifiers; never claim the
service collects no data whatsoever. Play AccessibilityService and foreground
service declarations must match the APK and include the required review demo.

## CI and signing

Ordinary push/PR **Checks** builds/tests/lints TypeScript and Kotlin, builds the
debug app and instrumentation, tests the preserved spike and release publisher,
and scans full Git history for secrets. It receives no signing or Play secrets.
Third-party actions are pinned to immutable commits. Android setup uses the
current v4 action rather than the old v3 default that installs removed SDK tools.

`android/version.properties` owns the version. Increment its code for each new
Play bundle; never reuse a consumed code for changed bytes. On clean `main`:

1. Commit/push the candidate; wait for **Checks** to pass for that exact source.
2. Dispatch **Android release artifacts** (`android-release.yml`) on `main`.
3. The build job checks exact-source CI and builds/lints the actual release AAB
   without credentials. A separate main-only `android-release` environment
   signs the exact unsigned artifact using a dedicated project upload key.
4. Download `yepcontrol-play-CODE`: it contains the signed AAB, its public upload
   certificate, SHA-256 and source/version/run receipt. The private key is
   removed from the runner and never included in the artifact.
5. The first app/bundle and declarations need Play Console setup. Google Play
   App Signing owns the final install signer. Add its SHA-256 certificate to
   `/.well-known/assetlinks.json`; the upload key is a different identity.
6. Dispatch **Android Play beta publication** (`android-publish.yml`) on `main`
   with that build run ID, English release notes and status `check`, then
   `draft` or `completed` as appropriate. It consumes the already signed bytes;
   it does not rebuild or accept an arbitrary source SHA/version.

The publisher verifies the successful main-only build workflow, source ancestry,
tracked version, exact-source passing Checks, artifact receipt and checksum
before Google authentication. It uses transactional Play edits; mismatched
bytes, downgrades, unrelated drafts and active rollouts fail. It validates
before commit and does not retry an ambiguous commit. A submitted receipt
means API acceptance; verify actual Play availability separately.

The initial publisher accepts **internal only**, with no production route.
Changing branch code alone or pushing a tag never publishes to Play.

## Configuration contract

Private signing/IAM resources, backups and tester contacts live in the owner's
private operational inventory. The public contract contains no operator paths,
cloud account IDs, service-account credentials or tester emails.

- Main-only environment `android-release`: secrets
  `ANDROID_UPLOAD_KEYSTORE_BASE64`, `ANDROID_UPLOAD_PASSWORD` (PKCS#12, alias
  `upload`, same store/key password). Provision through stdin without logging.
- Main-only environment `android-play-beta`: variables
  `ANDROID_PLAY_WIF_PROVIDER`, `ANDROID_PLAY_SERVICE_ACCOUNT`.
- Google Workload Identity Federation must bind the immutable repository/owner
  IDs, exact main ref, exact `android-publish.yml@refs/heads/main` workflow and
  exact `android-play-beta` environment subject. Read the repository's actual
  OIDC subject customization; immutable subjects differ from older examples.
- A dedicated service account receives only app-scoped Play information/testing
  release access. No unrelated app, financial, account administration or
  production-release permission, broad Google project role or JSON key.
- Google IAM/STS/IAM Credentials and Android Publisher APIs must be enabled.

The signing and transactional publisher adapt the owner's MIT-licensed
[Babytrack implementation](https://github.com/kzahel/babytrack), with YepControl's
package, native-library verification, version contract and beta-only authority.

## Qualification status

Local release AAB building/lint and strict upload signature verification pass.
Publisher regressions cover source/workflow mismatch, corruption, stale drafts,
downgrade, production refusal, validation failure and unknown commit outcome.
Live CI signing, Play access, listing setup and actual beta availability must be
recorded below when verified; this document alone does not establish publication.


## CI candidate receipt — 2026-10-21

Source `23da3af464dd5724e1a6ba35e3d89b39a5e3d415` passes full
[Checks 39648064549](https://github.com/kzahel/yepcontrol/actions/runs/39648064549).
[Release artifacts 39648579086](https://github.com/kzahel/yepcontrol/actions/runs/39648579086)
then builds and signs **0.6.0 / code 4** successfully. The downloaded artifact's
receipt, checksum and strict JDK signature match the exact source/run/version
and dedicated upload certificate. AAB SHA-256:
`a8b81e12c87cac911b8f546acd7dbb571d46dbdb4416722b39ca75b3fd21c6e7`.
Both 64-bit WebRTC ELF ABIs have load-segment alignment of at least 16 KiB;
the two 32-bit ABIs have 4 KiB alignment. This is a binary inspection, not a
claim of testing on a 16 KiB device or Play's server-side acceptance.

The physical Pixel 7a (API 37) passes public QR/Grant pairing, encrypted reconnect,
process-absent real FCM and revocation with the new app identity. A separate
ordinary-control run passes viewing, input/text/navigation/app launch, H.264,
quality changes, held dragging, long press, pinch/rotation gestures, native
WebRTC and mid-drag direct loss with encrypted relay recovery/no replay. No
physical PIN, reboot, Doze or lock/debugging changes are involved. Owned test
packages are removed afterward. This is debug-build device evidence; it is
separate from verification of an actual Play-installed release.
The runner selectors now match the native management test's renamed method.

The live privacy page and native navigation/theme suite pass. **Play app
creation and publication remain pending** the owner's required policy/export
declarations and app-scoped publisher grant. The CI signer is verified; live
Google Play authentication/upload and Play's final signing fingerprint are not
yet verified. No beta install link exists yet. Do not call this candidate a
published or reviewed release.
