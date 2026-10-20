# UX research and candidate experience

2026-10-18. This is an analysis of official setup/support documentation and a
set of **proposed** flows. It contains no rendered mockup, observed user test,
measured competitor task time or chosen final navigation.

## What the documented journeys reveal

| Observed pattern | Evidence | Design implication to test |
| --- | --- | --- |
| Several installations or permission owners | AirDroid Control Add-on; AnyDesk plugins; TeamViewer product roles | Explain which component enables which capability; avoid extra apps unless they have a real purpose |
| “Unattended” authentication still leaves capture approval | AnyDesk Android guide; Android MediaProjection lifecycle | Test remote viewing after lock/restart before declaring a phone ready |
| OEM background instructions are substantial | AirDroid Samsung/Xiaomi; AnyDesk battery guidance; Alfred connection tips | Ask for relevant settings in context, then verify; do not equate opening Settings with success |
| Role-first setup can make a complex system legible | Alfred Viewer/Camera account or QR flow | Try “This is the phone I will leave here” and “This is how I will reach it” |
| Powerful connection options expose networking concepts | droidVNC ports/repeaters; RustDesk custom server configuration | Consumer defaults should handle Internet routing and safe pairing |
| Viewing, input and richer management are different capabilities | RustDesk grant panel; remote-control plugin docs | Show view-only honestly; do not let a connected screen imply a working keyboard |

These are clues, not proof a redesigned flow will perform better. Read the
[competitor analysis](competitors.md) before making competitive claims.

## Candidate first-run flow

1. **Explain the job.** “Use this phone from somewhere else.” Ask whether this
   is the phone being left behind or a viewer. Keep brand and account decisions
   open; avoid starting with “configure a relay.”
2. **Choose the relationship.** Begin with an owner pairing their own phone.
   Show a phone name and a short, expiring pairing code/QR with confirmation
   on the intended endpoints. A QR is a transport for pairing information, not
   an automatic security boundary or a reason to skip identity confirmation.
3. **Enable seeing and controlling separately.** Explain each permission's
   purpose immediately before its Android prompt. Return to a verified state:
   screen access allowed, input allowed, or a specific missing capability.
4. **Test real use.** From the viewer, open a synthetic test screen and tap/type.
   Explain view-only, protected-screen and capture-consent failures clearly.
   This is not a demand to disclose a real password just to finish onboarding.
5. **Offer optional locked-screen preparation.** Ask “Do you need to reach this
   phone after it locks?” Explain the supported advanced setup and limitations.
   Basic setup must not falsely imply secure unlock is included.
6. **Check leaving it behind.** Verify Internet reachability across a different
   network, screen-off/lock behavior and applicable background settings.
   Say what happens if it reboots or is unplugged. Show the last successful
   test and device/OS context, not an unconditional “Always available.”

Do not ask for all-files, contacts, notification reading, microphone, camera or
device-admin permissions simply to provide basic phone control. Notifications
for visible service/request status are different from reading notifications.

## State should explain the next useful action

One Online/Offline badge hides the most important failure modes. A candidate
device card could combine a simple summary with capability detail:

| State | Candidate plain-language explanation | Useful action |
| --- | --- | --- |
| Ready for viewing and input | “Ready to use” | Open screen |
| Connected, secure lock blocks access | “Phone is locked” | Unlock if prepared; otherwise explain local preparation |
| Process reachable, capture consent missing | “Screen sharing needs approval on the phone” | Show exact local repair step; do not retry indefinitely |
| Capture works, input unavailable | “You can view this phone; control needs permission” | Open relevant local setup instructions |
| Push sent, no response yet | “Trying to reach the phone” | Cancel, show elapsed attempt and last-seen time |
| Prepared ADB route lost | “Unlock preparation needs to be renewed” | Explain whether a phone or computer is needed |
| Viewer removed or access disabled | “Remote access is off” | Require legitimate new setup rather than silent reconnect |
| No recent response | “Not responding; last seen …” | Show evidence, not a fabricated cause like “battery dead” |

“Trying to wake” is an attempt, not evidence that the process woke. A last-known
battery level or screenshot must have a timestamp and must not masquerade as
current telemetry.

## Remote-screen interaction

The smallest useful candidate surface is the phone screen, obvious
Back/Home/Recents, a way to type, connection status and Disconnect. Wake/Unlock
appear according to actual readiness. More complex mouse/touch modes, file
transfer, debugging, camera and automation can remain later choices.

Input must remain responsive while frames arrive. Test sequential keystrokes,
cursor edits, deletion, paste and Unicode/composition; acknowledge locally
within 100 ms and distinguish that from remote delivery latency. When the
screen changes or rotates, do not apply stale coordinates to a different
window. After an uncertain network delivery, never automatically replay a tap
or PIN. Show lost ownership or permission immediately.

The phone should have a visible ongoing-access explanation and an accessible
local Stop. Viewer management should make removal easy. Do not copy an IT tool's
full console into a small consumer app just because it is technically available.

## Unlock and saved-PIN experience

Treat these as separate questions: can the display wake, is credential entry
needed, is a supported input route prepared, and did Android confirm unlock?
Use “Enter the phone's PIN” only when that operation is actually supported.
Do not claim a generic unlock bypass or quietly disable the lock.

Remembering a PIN is optional and sensitive. Explain where it is stored and
which app/device can use it; provide Forget. Do not send it through push or
place it in logs, URLs, transcripts or browser persistence. Do not ask a user
to re-enter it repeatedly during a lockout or failed delivery. A saved PIN with
no usable pre-unlock process/key path is a broken promise, even if the settings
screen says it was saved successfully.

## Research to do before promising ease of use

- Ask RV/spare-phone owners what they actually need: occasional app access,
  reliable telemetry/alerts, camera viewing or control of an Android workload.
  The most valuable solution may be narrower than generic remote desktop.
- Observe first setup on an ordinary phone without coaching. Record permission
  handoffs, wrong-component installs, confusion and successful task completion.
  Do not invent task-time targets from documentation page length.
- Run the same task through AirDroid, AnyDesk, TeamViewer Host and an open
  alternative on the same OS/OEM. Record whether payment is needed to test
  compatibility and whether screen/input/unlock are actually available.
- Perform a leave-and-return study: network change, screen lock, a day of idle,
  unplug/replug and a reboot. Test whether the owner can predict which state
  needs local intervention.
- Test two distinct people: a technical owner willing to run an advanced helper
  and a consumer who wants no computer setup. Do not average away the mismatch.
- Compare phone-screen control with a battery-specific telemetry dashboard for
  the RV case before investing in unrelated features.

Hands-on work would require a separately authorized scope and disposable
accounts/fixtures. The current research makes no claim that these studies have
been performed or that a particular flow has won.


## Current mobile management (2026-10-20)

The owner selected the simple implemented native Android style, generic utility
copy, a compact status home, paired-browser management, Settings and local Activity.
The earlier proposed journeys above remain research, not a description of all
implemented screens. See [the implementation plan](mobile-management.md).
Browser nicknames are local labels; Allowed/Disabled is persistent authority,
Connected is live session state, and Last connected is timestamped history.
