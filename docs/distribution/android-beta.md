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
