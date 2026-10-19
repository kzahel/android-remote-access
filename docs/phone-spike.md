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

Plain `stop` leaves the app installed. Setup refuses a pre-existing installation
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

Physical-host measured results are recorded after qualification below.
