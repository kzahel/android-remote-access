# Manual-access emulator spike

Authorized 2026-10-18: build a working demo, test emulator screen lock/unlock,
and commit milestones. Physical-phone setup and lock changes are outside this
spike. This is implementation evidence gathering, not a product architecture
or distribution decision.

## Completion criteria

- A browser can view and manually operate a native Android fixture through an
  outbound app connection, without ADB forwarding or shell input in that path.
- Simple navigation, pointer gestures, text editing and honest readiness are
  useful before opening optional diagnostics.
- Separately measure process reachability, display wake, keyguard state,
  capture and input. Exercise secure lock and a disposable known credential on
  an isolated emulator. No credential in Git, arguments or captured evidence.
- Demonstrate reconnect, revocation and protected-screen refusal. Never replay
  an uncertain action or credential automatically.
- Provide repeatable setup, meaningful live acceptance and a reviewable demo.

## Implementation sequence

1. Native accessibility host, outbound authenticated demo transport and fixture.
2. Browser controller with core controls and optional diagnostics.
3. Emulator lock/unlock experiments, regression acceptance and visual review.
4. Document measured limits and reproducible demo commands.

## Source references

Buddy Android at `ffd2ec84c7498c9e10e22889b4f4d1f52c293e18`:
[Tools.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Tools.java),
[McpServer.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/McpServer.java),
and [accessibility configuration](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/res/xml/accessibility_config.xml).
Reviewed for screenshot/gesture/text primitives and the native API boundary.
Machine Control's resident spike supplies evidence about fixture verification
and independent effect observations. No upstream code, binaries, fonts or icons
are copied. The spike uses Android SDK and Node built-ins.

## Results

### Android 15 emulator milestone

Live-tested 2026-10-18 on Google APIs ARM64 API 35 (Android 15, security patch
2024-09-05), target SDK 36. This older base image is not Android 15 QPR1+
MediaProjection acceptance. **23 native/control checks passed.**

- Browser-directed gestures changed synthetic solar/output values, independently
  confirmed through app-private fixture files. Fresh frames matched an advancing
  fixture clock. Unicode editing, portrait/landscape and stale-frame refusal
  passed. The normal operation path used an outbound native connection with no
  ADB forwarding.
- Display capture alone could return a successful blacked-out image for a
  protected fixture window. A window-capture probe now distinguishes that case;
  the viewer reports protected capture instead of presenting it as a live view.
- Secure locking preserved process reachability. The native activity could wake
  the display and request the credential UI without bypassing the lock.
  Accessibility keypad actions submitted the correct synthetic PIN once;
  native keyguard state and an independent OS trust-state observation confirmed
  unlock. An explicitly labeled emulator shell helper also passed.
- Capture pauses during credential delivery and briefly afterward. No wrong-PIN
  case was run. PINs remain in private test data and one-shot delivery; this is
  not a consumer saved-PIN implementation.
- Connection interruption repaired the transport without action replay. Stop
  acknowledged revocation, closed the native connection, refused subsequent
  control and stayed stopped until explicit local preparation.

Browser acceptance used a separately identified Playwright Chromium, closed
in `finally`. Real sequential typing, cursor Delete, Backspace and Unicode
matched independent Android app data while frames and state continued updating.
The measured maximum local keyboard acknowledgement was **41.8 ms** in that run;
this is not a network-delivery latency claim. Desktop and mobile layouts passed
without horizontal overflow or uncaught browser errors.

Five host transport tests cover browser authority/Origin/Host checks, device-token
refusal, uncertain delivery without reconnect replay, late-result isolation and
overlapping credential/input refusal.
Android debug assembly and lint pass (English-only/deprecation warnings remain).

The API 35 lifecycle run also passed force-stop revocation, explicit local
re-arming and a real reboot. After reboot, OS user state was `RUNNING_LOCKED`
and the ordinary app did not reconnect. One explicit host-assisted known-PIN
submission opened user storage, but did not recreate the native grant. Local
preparation then restored viewing. This is an emulator with a host-held test
credential and emulator ADB authority; it does not prove phone-local recovery.

### Android 16 emulator qualification

Live-tested 2026-10-18 on Google APIs ARM64 API 36 (Android 16, security patch
2025-07-05), target SDK 36. **25 native/control checks, five browser checks and
nine lifecycle checks passed.** This repeats the viewing, pointer, Unicode,
rotation, protected-window, reconnect, Stop and both known-PIN routes above.
The browser regression deliberately delays a real native field-read response by
900 ms while typing; the late response cannot overwrite newer keys. The maximum
local keyboard acknowledgement was **48 ms** in the final API 36 run.

SystemUI on this image uses auto-confirm for the six-digit synthetic PIN and
omits the Enter key. The native route delivers the observed keypad digits once
and then checks keyguard state; the shell comparison omits Enter too. Neither
route tries a second submission or assumes delivery means unlock.

Force-stop and reboot each revoked the native grant. First-unlock user storage
was observed locked, the app stayed disconnected, host-assisted first unlock
did not restore a grant, and explicit local preparation restored verified screen
capture. This is a measured local recovery procedure, not unattended recovery.
Android 16 exposed an asynchronous accessibility teardown race during APK
replacement: the runner now waits for this fixture's enabled, binding, bound and
crashed entries to clear before reinstalling and enabling it again. It preserves
other services and requires an actual successful capture before reporting ready.

Raw reports, captures, exact selectors, boot identifiers, credentials and logs
remain in ignored `.local/`.

### What this establishes

A native Android accessibility service can make manual remote viewing, input and
known-PIN experiments useful without an AI runtime or ordinary ADB input. This
spike uses live JPEG stills rather than video. ADB remains an explicitly labeled
emulator setup, independent-observation and optional shell-comparison tool.

Physical Pixel 7a behavior, secure unlock across OEMs, phone-local first unlock,
Doze/overnight endurance, Bluetooth/vendor-app behavior, Internet relay and
production pairing/encryption are untested. The current transport is confined
to the local emulator host gateway. No attached physical phone was changed.

### Implementation observations

- Android refuses network response writes from the main thread; native writes
  and image encoding use separate bounded workers.
- New stills must not invalidate the image a person is currently clicking.
  Native capture keeps bounded five-second frame leases for the same scene and
  rotation; actions, screen changes, failures and credential pauses revoke them.
  The live regression acts on one frame after a newer capture arrives, then
  separately verifies that navigation invalidates stale coordinates.
- Screenshot callbacks can fail to arrive during a window transition. Requests
  have a bounded timeout and invalidate late results instead of wedging capture.
- Wake and dismissal can reuse an existing activity; `onNewIntent` must update
  the pending request and cancel the previous finish timer.
- Stock UIAutomator dumping suppresses other accessibility services. The final
  setup and shell preflight instead use a read-only shell-UID observer with
  `FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES`. It redacts passwords in process
  and returns only bounded metadata; no raw XML dump is written. Its reflective
  framework entry point is an emulator-lab helper, not an adopted app API.
- Automated emulator preparation creates a short-lived, one-use request in the
  debug app's private storage and opens its setup activity. Only an emulator
  debug build consumes that request. Normal Stop cannot be reversed over the
  remote API. This is a testbed bootstrap, not consumer pairing UX.
