# YepControl domain, Android identity and App Links

Owner-requested cutover: **2026-10-21**. The canonical website/relay origin is
`https://yepcontrol.com`; `www` redirects to it. The Android application ID is
`com.yepcontrol.app`: reverse domain ownership with room for future products.
The Kotlin namespace `dev.remoteaccess.app` and reusable protocol source packages
remain internal implementation names. The preserved `spike/` is unchanged.

The renamed app is a separate Android installation. Reinstall/re-pair development
fixtures; no data, browser-origin or old-link compatibility is provided. Existing
browser IndexedDB identities stay on their original origin. Relay signatures bind
the origin, so old grants cannot be reused at the new origin.

## QR and installation behavior

Pairing QR codes encode `<relay origin>/enroll#<base64 invitation JSON>`.
Both TypeScript and Android validate HTTPS, `/enroll`, no credentials/query,
expiry, keys and equality between the outer origin and invitation origin.
The fragment contains the short-lived secret and never goes to HTTP servers.
The app still requires explicit **Grant** after a scan or link open.

Android declares an auto-verified HTTPS filter only for
`https://yepcontrol.com/enroll`. The website directly serves JSON at
`/.well-known/assetlinks.json` with `com.yepcontrol.app` and the certificate
SHA-256 fingerprint. Other viewer routes continue opening in the browser.
Local development origins work through the in-app scanner; they do not claim
verified links for arbitrary development domains.

With the associated app installed, an external QR scanner that opens the URL can
route to YepControl. Without the app, `/enroll` serves an install page with a
Google Play link to `https://play.google.com/store/apps/details?id=com.yepcontrol.app`.
It clears the fragment from browser history and never appends it to Play URLs,
stores it or sends it to analytics. After installing, open the app and scan a
fresh code. This is not deferred deep linking; installation does not resume or
approve a pairing. Scanner/browser behavior can vary.

**The internal beta is available to invited testers.** Accept the tester
invitation with the Google account used on the phone before opening the Play
listing. The install page explains this restriction. Public availability and
Google review remain separate from this internal release.

## Firebase and signing

The Firebase project/sender stay the same. A real new Firebase Android client is
registered for `com.yepcontrol.app`; its downloaded public client configuration
is checked in. Merely editing the old package name in the config would not create
this registration. No sender credentials or signing private keys belong in Git.

The association trusts the existing development APK certificate and all three
**Play app signing certificate** SHA-256 fingerprints copied from Play Console
on 2026-10-21, including its quantum-ready signing lineage. The fingerprints are
public in `assetlinks.json`; none is the upload certificate. Other machines'
debug keys will not verify automatically. Actual Play-installed verification is
recorded in the [beta guide](distribution/android-beta.md).

## Verification and sources

Run the ordinary build/type/lint/test checks and
`HOSTED_ORIGIN=https://yepcontrol.com HOSTED_FCM=1 pnpm test:hosted`.
The owned-emulator runner waits for Android's actual `verified` domain state,
checks native URL validation, opens the rendered/decoded QR through Android's
implicit App Link resolver, exercises Grant/E2E/reconnect/revocation and checks
the browser install page. FCM mode separately tests the renamed registration.
Private reports and screenshots stay under `.local/hosted-proof/`.

Official documentation reviewed **2026-10-21** (platform-documented, separate
from test receipts):

- [Website association format and Play signing fingerprint](https://developer.android.com/training/app-links/configure-assetlinks).
- [Android domain verification commands](https://developer.android.com/training/app-links/verify-applinks).
- [Google Play listing URLs](https://developer.android.com/distribute/marketing-tools/linking-to-google-play).
- [Firebase Android registration: package names cannot be changed](https://firebase.google.com/docs/android/setup).

## Acceptance receipt — 2026-10-21

Deployed product revision `94ec227c1fa09f1436b2ba7945b34a3d4eab148d` passes
public HTTPS/WSS health. `www` returns 301 to the canonical origin.
`/.well-known/assetlinks.json` returns 200 with `application/json`, no redirect;
a missing association file returns 404 instead of the viewer HTML.

The owned API-35 emulator reports `yepcontrol.com: verified` for
`com.yepcontrol.app` and the actual development signing certificate. Native
URL-validation instrumentation passes, and the real rendered QR opens the
Grant screen through Android's implicit App Link resolver. Pairing, three or
more encrypted exchanges, persisted reconnect after Android process restart and
browser reload, durable revocation and rejection after revocation all pass.
The renamed Firebase client receives a real wake after process reclamation with
no application socket: 427 ms to native receipt and 724 ms to the native
encrypted exchange in this run (clock estimate uncertainty 9 ms). These are one
emulator run's observations, not latency guarantees or overnight/OEM evidence.
The runner's revocation expectation now recognizes the current viewer copy.

Isolated Playwright Chromium checks the install page and exact Play destination,
fragment removal and a 360 × 800 mobile viewport without horizontal overflow or
heading clipping. Build, type checks, TypeScript/Android lint, formatting, 105
TypeScript tests and Kotlin protocol tests pass. The Node transport-status test
mocks its browser storage sink so it does not open IndexedDB outside a browser.
The browser and owned emulator are reaped. No physical phone was selected and
no Play listing or release build was published.
