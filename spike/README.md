# Remote-access demo

Experimental manual Android control on an **isolated emulator**. The attached
physical phones are not selected, installed on, or reconfigured by these tools.
The product identity and eventual architecture remain open.

## Run

Requirements: Node 22+, Python 3.10+, JDK 17, Gradle 8.13, Android SDK platform
36/build-tools, emulator and an ARM64 Google APIs system image for API 35 or 36.
Set `ANDROID_HOME` and optionally `GRADLE_BIN` when discovery needs help. The
current runner targets ARM64 hosts; x86 system-image selection is not implemented.

```sh
npm ci
npm run demo
# Browser: http://127.0.0.1:4317
```

The runner builds/lints the APK, creates a project-local AVD, starts a headless
emulator and loopback demo server, provisions only that emulator, enables its
accessibility service and explicitly arms it through a one-use debug fixture
request in private app storage. It also enrolls a synthetic PIN through Settings
on first use. An existing emulator
at the chosen port causes refusal. No shared AVD, ADB server, debugging listener
or physical device is changed. First boot may take several minutes.

```sh
python3 scripts/demo.py start --api 35 --emulator-port 5582 --port 4318
python3 scripts/demo.py rearm          # explicit local setup after Stop
python3 scripts/demo.py build         # assembleDebug + lint
npm run stop
```

Re-arm installs the current debug APK, explicitly arms it locally and opens the fixture; the phone
must be unlocked. A secure lock is not dismissed by claiming setup succeeded.
Logs, pairing material, AVD disks, credentials and captures stay under ignored
`.local/`. Stop terminates only the owned demo; AVD data remains for review.

## Interaction

Click the phone to tap, drag to swipe, hold to long-press. Back/Home/Recents sit
below the screen. Open the synthetic power-station app for a task with fresh
values, an output switch and a station-name field. It does not access Bluetooth
or an actual power station.

Tap an editable field, then use **Read focused field**. Edits acknowledge locally
as you type and are delivered in order. Screen refresh does not rewrite the
browser draft. Cursor selection, deletion and Unicode use Android's focused-field
accessibility actions. Password fields are deliberately separate.

Advanced controls expose Android navigation, ordinary app wake/dismiss requests,
lock-state details, visible UI inspection and optional emulator shell comparisons.
Pause stops viewing; **Stop access on the phone** revokes the native grant and
requires local Start to resume. Connection repair never replays an uncertain tap
or credential.

## Credential experiment

Only on the disposable demo AVD, with no screen recording running:

```sh
python3 scripts/credential.py
python3 scripts/demo.py rearm
```

Enrollment uses Android Settings and a one-shot stdin key helper. A read-only
shell observer uses `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES` and redacts
password text before returning metadata; it writes no raw UI dump. The synthetic
credential is stored in an owner-readable `.local` fixture for repeatable tests,
not in the app, Git, arguments, browser storage or logs. This is test data handling,
not an implementation of a consumer saved-PIN feature. No wrong-PIN cases are run.

The accessibility experiment requires a visible SystemUI PIN field and keypad,
zero wipe threshold, an empty field and one explicit submission. The optional
shell route uses the explicitly selected emulator's already-authorized shell UID;
it does not establish same-phone ADB, physical-phone or post-reboot availability.

The advanced **Use disposable test PIN** button reads this host's fixture file
for the selected route; the PIN itself never enters the browser. Manual PIN entry
is also available. Capture pauses around either route. This convenience applies
only to the disposable test fixture.

## Verify

```sh
npm test                         # host authority and delivery regression tests
npm run acceptance               # live native/control checks; ends with Stop
python3 scripts/demo.py rearm
node scripts/browser-acceptance.mjs  # real sequential input + visual captures
python3 scripts/lifecycle.py     # force-stop/reboot/first-unlock observations
```

Private reports and screenshots are written to `.local/`. Browser checks use
Playwright Chromium and reap it after the run. Install that test browser with
`npx playwright install chromium` if needed; the user's primary browser is unused.

## Record the walkthrough

With a fresh armed demo and the synthetic PIN enrolled:

```sh
node scripts/record-demo.mjs
```

The managed test browser records pointer control, sequential typing, secure
lock/wake/unlock and a real Android Settings launch. It checks the saved field
and observed app/unlock state before finishing. The video and desktop capture
stay under ignored `.local/evidence/`; the PIN never enters the browser.
The runner closes its browser even if a check fails. A failed run may leave a
partial recording, so use a successful exit as the evidence of completion.

## Transport and limits

The Android app makes an outbound authenticated TCP connection to the host via
the emulator's built-in host gateway. ADB handles installation, setup, independent
fixture-file observations and explicitly labeled lab operations. There is no ADB
forward/reverse in ordinary screen/input control.

Both host listeners bind loopback. The browser API uses an ephemeral HttpOnly
SameSite cookie, strict Host/Origin checks and CSP. Device authentication is a
random per-demo secret. Traffic is plaintext **inside this local emulator demo**;
this is not a LAN/Internet deployment. Pairing, TLS/end-to-end encryption, accounts,
relay, Play approval and a hardened multi-viewer security boundary remain work.

The user-armed native service holds a four-hour in-memory grant and a visible
notification. It does not claim foreground-service endurance, autonomous control,
reboot recovery or Doze exemptions. See [scope and evidence](../docs/spike.md).
