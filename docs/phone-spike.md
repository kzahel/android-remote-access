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
The same `adb reverse` route also works over an already-paired wireless-debugging
transport; select it by its `host:port` serial.

An ADB route can drop while the armed app keeps retrying. A clean disconnect
removes the reverse mapping (connections refused); a wireless TLS timeout once
stranded it (phone loopback accepted connections, adbd forwarded nothing). The
first incident coincided with attaching USB, but the adb server log places the
cause at the wireless transport timing out two minutes later; an apparent native
disarm in the same incident was a truncated notification listing. After the app
has connected once and then been silent for six seconds, the server re-creates
only its owned port: first on the selected serial, otherwise on another ADB route
whose `ro.serialno` matches the same phone. It backs off after three attempts and
does nothing after a viewer Stop. `rearm` also re-asserts the mapping.

Physically tested 2026-10-19 on the Pixel 9 with USB and wireless both attached:
dropping wireless restored the link over USB in about six seconds; a simulated USB
replug (`adb reconnect` of that transport) then restored it over wireless in about
seven. Both reconnected without a manual step. The stranded-mapping timeout was
not reproduced on demand; its fix is the same remove-and-recreate step that
recovered the original incident by hand.
Internet access, pairing/encryption for deployment, Doze, overnight survival and
reboot recovery remain unqualified. Lock/debugging settings are preserved.

## Tailscale route

A stand-in for a hosted relay while that is designed. With Tailscale running on
both the computer and the phone:

```sh
python3 scripts/phone.py start --selector-file .local/phone-selector.json --tailnet
python3 scripts/phone.py rearm --restart-server --tailnet   # existing session
```

The server adds a second phone listener bound only to this computer's Tailscale
address; it refuses any address outside 100.64.0.0/10, so it never opens a LAN
listener. Browser access stays on loopback. Pairing lists routes in preference
order, the owned ADB reverse then the Tailscale address. The app rotates on
failure and keeps a route only after the server has answered on it, so a
stranded ADB reverse cannot hold it. Video follows the control connection's
route. The same per-session token authenticates; WireGuard encrypts the path.
Tailscale occupies Android's single VPN slot, and nothing here addresses Doze.

ADB is still used for installation and setup. Wireless debugging chooses a new
port each time it is re-enabled; `phone.py` and the link supervisor select any
connected ADB route whose `ro.serialno` matches the recorded phone, so a changed
port needs only `adb connect` to the new address.

Physically tested 2026-10-19 on the Pixel 9, USB unplugged: an accessibility tap
on the Quick Settings Wi-Fi tile turned Wi-Fi off, and the app reconnected over
Tailscale on cellular data (a direct path, about 73 ms). Over that route: still
frames round-tripped in 0.30–0.41 s (about 50 KB each); a lock, saved-PIN unlock,
reopen and accessibility screen-sharing consent completed in about 17 s; Auto
chose Data saver and delivered 7.7 frames/s during swipes. A second tile tap
restored Wi-Fi with the phone still connected. Wireless debugging came back by
itself on a new port. Overnight, Doze and a relayed (DERP) path were not tested.

## Video quality

The viewer's **Video quality** selector sets a mode remembered on the phone:
Smooth (60 fps, 4 Mbps), Standard (30 fps, 2 Mbps), Data saver (10 fps,
0.6 Mbps) or Auto. Auto uses Standard when Android reports the phone's active
network as unmetered and Data saver otherwise, rechecking every three seconds;
a phone on a hotspot's Wi-Fi is usually reported metered. The cap uses
`KEY_MAX_FPS_TO_ENCODER`, because `KEY_FRAME_RATE` is only a hint: on the
Pixel 9's 120 Hz display the uncapped encoder delivered 88.5 frames/s during
continuous swipes. A change rebuilds only the encoder; the projection and its
consent continue. Auto reflects the phone's network, not the ADB route, so it
may choose Data saver while a USB-connected phone has cellular as its network.

Physically tested 2026-10-19 on the Pixel 9 over unmetered Wi-Fi, frames received
by the host during the same scripted swipes: Smooth 43.2, Standard 22.4, Data
saver 8.7 and Auto 21.7–23.7 (chose Standard). Video stayed active through each
switch. On cellular data over Tailscale, Auto chose Data saver, then returned to
Standard on its own when Wi-Fi came back.

## Owner PIN unlock

Authorized 2026-10-19 by the owner for the Pixel 9 host. The phone server now
accepts one known-PIN unlock per lock. The PIN comes from a hidden terminal
prompt, the webpage PIN field, or an owner-saved file read only by the local
server; it never enters command arguments, logs or the browser for the saved route.

```sh
( umask 077; read -rs "PIN?Phone PIN: "; echo; printf '%s\n' "$PIN" > .local/phone/pin; unset PIN )
python3 scripts/phone.py unlock --saved   # or: unlock, for a hidden prompt
```

The server refuses a saved file readable by group or others. The native route
wakes the display, requests keyguard dismissal, taps once past Pixel's
fingerprint-only alternate bouncer, waits for the PIN field, presses each digit
once and submits once. It refuses, entering nothing, when a digit is missing or
ambiguous, the field is not empty, or a wipe policy is set. After one attempt it
refuses again until the phone is unlocked. This is a spike convenience, not a
consumer saved-PIN design: the host file is a standing secret on the computer.

Pixel 9 SystemUI is Compose-based. `pinEntry` and `key_enter` carry IDs, but
the platform view-ID and text searches do not find them; digits have no IDs.
The service therefore walks the visible tree, preferring AOSP `keyN` IDs and
otherwise using exactly one clickable SystemUI node whose text is the digit.

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

Physically tested 2026-10-19 on a Pixel 9, Android 17/API 37, over wireless
debugging: after a requested lock, the saved-PIN route unlocked on its first and
only attempt. The native keyguard state and an independent ADB window dump both
reported the keyguard gone. Earlier attempts in the same session refused before
entering any digit (PIN field not yet found). Reboot/first-unlock remains local:
the app does not run before user storage is unlocked. The webpage PIN field is
enabled on this profile but was not separately exercised.

Separately, an accessibility tap on Android's "Share screen" consent dialog
restored projection without ADB input; the dialog is visible to accessibility
inspection and screenshots on this phone.

The cleanup run also passed five independent checks: the test package was
removed, both the enabled-service set and global accessibility-enabled value
matched their original state, the owned reverse was gone, and the previous
foreground app was restored. The phone demo was then installed and consented
again for the live handoff. No lock credential or debugging setting was changed.
