# USB-connected phone host spike

Authorized 2026-10-19 by the explicit request to control the attached Pixel 7a.
The phone is the controlled Android host. The earlier
[physical browser-client trial](touch-spike.md#physical-browser-client) controlled
an emulator and is separate evidence.

## Run the demo

The phone must already be unlocked, connected over USB and authorized for ADB.
Install the same SDK/JDK/Node prerequisites as the [emulator demo](../spike/README.md).
The sibling Machine Control Android adapter supplies read-only handheld doctor
checks. Create an ignored mode-0600 selector file containing `{"serial":"YOUR_DEVICE"}`.
All commands use that exact device, including when other phones are attached.

```sh
python3 scripts/phone.py start --selector-file .local/phone-selector.json
python3 scripts/phone.py allow
python3 scripts/phone.py smooth
```

Open **http://127.0.0.1:4318** on the computer. The separate emulator viewer
may remain on port 4317. The sidebar identifies the actual phone model.
Touch/click the screen, drag, pinch/turn with two contacts, use Android navigation,
edit a focused field or choose an installed app under Advanced controls.
The power-station readings and touch playground are synthetic fixtures.

`allow` accepts the test app's visible accessibility permission and presses its
local Start button; `smooth` accepts Android's visible screen-sharing consent.
These are authorized automated setup actions, not background permission grants.
They currently expect English Android labels. The app also supports doing the
same steps by hand. Physical setup does not consume the emulator's debug
auto-start request or modify the list of other enabled accessibility services.

The browser's Stop ends native access and screen sharing. Restart locally:

```sh
python3 scripts/phone.py rearm
python3 scripts/phone.py smooth
# After server-code changes, preserves the owned native USB mapping:
python3 scripts/phone.py rearm --restart-server
```

To remove the test app, its permission, the owned USB mapping and demo server,
and reopen the previous foreground app:

```sh
python3 scripts/phone.py stop --restore
```

Plain `stop` leaves the app installed and retains the receipt so a subsequent
`stop --restore` can remove it. Use `stop --restore` before a fresh `start`.
Setup refuses a pre-existing installation
without an owned receipt rather than silently replacing someone else's app.
Private receipts, pairing material and evidence stay in `.local/phone/`.

## Transport and boundaries

The native app makes outbound authenticated control/video connections to phone
loopback. A fresh selected-device `adb reverse tcp:0` mapping carries them to
the computer's loopback server; existing mappings are preserved. Accessibility
executes ordinary input and screenshots on the phone, and MediaProjection plus
MediaCodec supplies consented H.264. ADB performs setup, USB transport and
independent effect observation; it does not inject ordinary browser gestures.

This is a USB demo. It stops being reachable when its USB transport is removed.
Internet access, pairing/encryption for deployment, Doze, overnight survival and
reboot recovery remain unqualified. Lock/debugging settings and credentials are
preserved. Credential experiments are hidden and refused by the phone server;
unlock this phone locally. No physical secure-unlock acceptance is claimed.

## Automated verification

Use managed Playwright Chromium, leaving the user's desktop browser alone:

```sh
npm test
node scripts/touch-acceptance.mjs --phone
node scripts/browser-acceptance.mjs --phone
node scripts/touch-boundaries.mjs --phone  # ends access; rearm afterward
```

The runners verify an owned physical setup receipt and model, then independently
read native fixture effects through app-private witnesses. They never run the
emulator rotation-setting experiment on a phone. Recordings and reports remain
private. These are scripted browser inputs, not a physical-finger usability test.

## Measured results

Physically tested 2026-10-19: Pixel 7a, Android 17/API 37, APK target SDK 36,
USB transport, managed desktop Chromium client. Eleven continuous-touch checks,
five browser editing/layout checks and seven native boundary checks passed.
Android assembly/lint and ten host authority/viewer tests also passed.

- The independent native fixture observed slider changes before lift, a held
  stationary contact, two simultaneous contacts, 1.63× zoom and 36° rotation,
  partial lift with continued pan, and curved scrolling. Ordinary continuation
  produced zero unexpected native cancellations.
- The defined interaction window decoded 114 native H.264 frames over 7.07
  seconds (16.1 fps). Touch-batch acknowledgements were 48.6 ms median, 78.7 ms
  p95 and 101.4 ms maximum, including native execution. These are local scripted
  measurements, not physical motion-to-photon latency.
- Viewer socket loss, missing touch packets and Pause released held contacts
  without replay. The native watchdog release was observed within 1.09 seconds,
  including polling and ADB observation overhead. No phone rotation setting
  was changed; that specific test remains emulator-only.
- Browser pointer input refreshed the native power-station reading. Sequential
  typing, cursor deletion and Unicode matched independent native state. A late
  field read did not overwrite newer local edits. Desktop/mobile layouts fit
  and no uncaught browser errors occurred.
- A curved held gesture scrolled ordinary Android Settings, observed through
  changed native visible nodes before lift. No setting was changed.
- Malformed and out-of-order touch was refused. Unsupported video configuration
  recovered through the fallback. A protected native window covered the viewer
  and stopped decoding; leaving it resumed under the existing consent. Stop
  released touch, ended projection, hid video and remained stopped.

The first physical pinch run exposed a still-capture race: starting touch
advances the scene while an earlier screenshot may still be completing. The
viewer formerly treated that transient refresh as revoked input authority.
It now distinguishes transient capture refresh from permission/protected-screen
failure and lets an additional finger use the active gesture's pinned frame.
Native window/rotation checks remain in force. The repeated physical touch and
protected-window suites passed after the fix; a host regression checks joining
during refresh and continued refusal when input authority is unavailable.

The cleanup run also passed five independent checks: the test package was
removed, both the enabled-service set and global accessibility-enabled value
matched their original state, the owned reverse was gone, and the previous
foreground app was restored. The phone demo was then installed and consented
again for the live handoff. No lock credential or debugging setting was changed.
