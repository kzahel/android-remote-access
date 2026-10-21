# Saved phones in the browser

Owner-approved direction, 2026-10-20: a responsive local phone library, independent
phone pages/tabs, names and successful-contact history. No account or server-side
inventory is introduced.

## Identity, routes and storage

- `/` lists saved phones; `/pair` enrolls another phone without removing existing
  ones. An optional name can be supplied before enrollment.
- `/phones/<phoneId>` selects one saved phone. `phoneId` is the lowercase hex
  SHA-256 digest of its canonical SEC1 public key. It is stable while the Android
  Keystore identity is preserved; a new installation identity is a new phone.
  The pairing ID remains a separate browser/phone authorization identifier.
- Ordinary links support bookmarks, Back/Forward and opening separate tabs.
  Unknown IDs explain that this browser needs pairing; they never select a
  different saved phone. URLs carry no pairing secret, private key or grant.
- IndexedDB `remote-access-v1`, schema 3, retains the non-exportable browser key
  in `state` and stores records keyed by phone ID in `phones`. Each has its pinned
  grant, pairing time, optional local alias, the phone's latest device report
  (manufacturer, model, the phone's own device name, Android version and API
  level, YepControl app version) with when it was reported, contact time, access
  state and this browser's own history (latest 200 events). Concurrent
  transactions merge metadata rather than replacing a shared array.
- Schema 3 discards earlier phone records instead of migrating them (initial
  development keeps no compatibility); pair again after the upgrade.
  Re-pairing the same phone replaces its grant and device report and retains
  alias, contact time and history; an active tab using the old grant is closed.
- The device report arrives sealed inside the pairing offer, so a new phone is
  named immediately, and refreshes on every authenticated check and control
  state. The displayed name is the local alias, else the phone's device name,
  else its model. History records pairing, renames, explicit checks and control
  sessions, access removed/paused/allowed, and changes in the reported Android
  version, app version or device name. `/phones/<id>/details` shows the report,
  pairing/contact/access state and history, with rename, open and forget.

## Contact and tab behavior

Only an authenticated successful check or control state response advances
`lastContactAt`. Successful Connect operations and automatic checks update it.
The connected viewer throttles background status recording to once every
15 seconds; it does not timestamp
page loads, failed connections, raw relay responses or accepted push requests.
The list shows relative time with the exact local timestamp on hover and does
not poll/wake all phones or infer global online status. Clearing site storage
removes this browser's names/history and identity; other browsers do not share it.

BroadcastChannel plus focus/visibility refresh keep names, history and removals
in sync across tabs. Forgetting a phone removes its local record and closes its
active/pending tab connections. It does not remotely revoke the grant; the
confirmation explains removal from the phone app. Late metadata writes cannot
recreate a forgotten record.

Web Locks coordinate one session/check per phone across tabs in the same browser,
before any socket/wake request. Another tab gets an ordinary "already in use"
message; different phone IDs have independent locks. The relay and Android still
apply their authoritative admission/policy checks across other browsers and
computers. Browsers without Web Locks rely on that existing admission behavior.
Cancellation, failed connection, session end, navigation and tab closure release
the local lease. Back/Forward cache restoration performs a fresh check,
rather than reusing a closed session. The connected layout keeps the fixed status
area and screen/control stage; names and management dialogs do not expand it.

## Verification

`pnpm test:viewer-phones` runs the actual React app, IndexedDB, Web Crypto and
Web Locks in isolated Playwright Chromium, with synthetic control/check adapters.
It tests simultaneous v1 migration and key preservation, adding another phone
through the rendered QR and signed enrollment receipt, two independent live
phone tabs, same-phone rejection without a wake request, cancellation, failed
contact timestamps, shared rename/history, concurrent metadata writes, reloads,
unknown deep links, removal/session teardown and responsive overflow. Artifacts
stay under ignored `.local/viewer-phones-proof/`. The fixture is not a production
entry point and never selects a physical phone. Hosted native pairing/control
acceptance remains separate.

All those browser checks pass, including preserved metadata/no duplicate on
re-pair and rejection of a saved-phone URL in a fresh unpaired browser. Visual
captures at 1280×1000, 390×844 and 320×680 show the two-phone library without
horizontal overflow; the existing four-size stable-viewer checks also pass.
All 92 TypeScript tests, type checks, production build and Biome checks pass.

The deployed per-phone page passed the combined owned-emulator hosted control
suite: actual screenshots/input/navigation/app launch, held/multitouch gestures,
manual/saved synthetic-PIN unlock, all H.264 modes, rotation, failed-unlock guard,
disarm and revocation. No browser errors; Save data decoded 50 frames in 5.002
seconds with 267,388 encrypted relay bytes. The retained owner browser also
migrated its existing pairing, opened the Pixel 9 URL, connected over direct
WebRTC and displayed its authenticated model/contact time in a separate library
tab. The physical phone was locked; no physical PIN was read or submitted.

The separate hosted two-browser management regression passes with the new routes
and storage: independent pairing/checks, permission revoke/repair, real
process-absent FCM for both, persistence, global/per-browser pause, stale-generation
rejection and isolated revocation/cleanup. Fresh receipt-to-exchange intervals
were 184 and 238 ms; these are measurements, not wake availability guarantees.

## Responsive navigation and client settings — 2026-10-20

The website uses one shared shell. At desktop widths (900px and up), the sidebar
lists saved phones, All phones, Add phone and Settings, and is always shown;
there is no menu button. Smaller viewports use a modal navigation drawer, opened
from the top-left menu button, with native
focus containment, Escape, a close button and outside-tap dismissal. Phone links
remain real `/phones/<phoneId>` links, including opening another phone in a new
tab. On All phones, each card opens its phone; a pencil renames it inline
(blank restores the reported model) and a trash button forgets it after one
confirmation. Sidebar rows and the phone header carry no extra details button. “In use” reflects a browser-held phone lease, including
other tabs; it does not claim that an uncontacted phone is online. Lock queries,
local notifications and cross-tab broadcasts refresh that indicator without
contacting the phone or waking it.

The fixed top bar contains the page/phone name and one dedicated live status
area. Android navigation, wake/lock, viewing quality, typing/app launch and
disconnect form a compact vertical rail to the right of the screen. The rail
scrolls internally in short landscape windows. Status changes, unlocking,
permission loss, dialogs and phone rotation preserve the screen/rail geometry
and page scroll. The workspace is centered and uses a fixed portrait
frame so wide desktop windows keep the rail beside the phone. Short
windows retain enough width for unlock/setup controls. Canvas aspect ratio and input mapping remain intact.

Settings opens over the viewer and preserves the live session. Appearance defaults
to System and follows live OS changes; Light and Dark override it. Optional control
labels are also a local preference. These values
use `remote-access-preferences-v1` in localStorage, synchronize between tabs and
survive reloads. Pairings and private browser keys remain in IndexedDB. An
external same-origin appearance bootstrap applies an override before rendering
and works with the existing production Content Security Policy. Unavailable or
malformed preference storage falls back to defaults; failed preference writes
show an error in Settings.

The five-size isolated layout suite (including a wide desktop) passes drawer dismissal/focus restoration,
an always-visible desktop sidebar without a menu button, breakpoint changes, right-side rail placement, stable
lock/unlock/error/rotation/dialog geometry, sequential text entry, appearance
changes, saved overrides and cross-tab settings. The phone-library suite passes
cross-tab lease indicators, local phone details, sequential rename entry and
changing appearance without reconnecting or closing the live session, alongside
its existing migration/pairing/multi-phone coverage. Type checks, production
build, Biome and all 92 TypeScript tests pass. Hosted native control is verified
separately after deploying the committed revision.

Deployment `8f62fc3` is live through the existing Pi service/Caddy setup. The
retained owner browser rendered the real phone library in system dark mode;
its existing pairing was preserved. Before the final spacing refinement, its
Pixel 9 page also connected through native direct WebRTC and showed one live
status. No physical PIN was read or submitted, and no Android update was needed.

Reliability follow-up: one initial owned-emulator run completed saved-PIN unlock,
then timed out during the following manual-PIN unlock. SystemUI still displayed
the entered synthetic credential; the host latched local recovery and did not
retry. The runner cleared its synthetic credential during cleanup. The next
fresh emulator run completed both unlock paths. This UI slice does not resolve
or isolate that intermittent native unlock failure; private evidence is retained
under `.local/shell-unlock-failure/`. A separate acceptance selector also needed
updating because live status moved from the screen region into the top bar.

The complete final hosted regression against `8f62fc3` passes with the corrected
top-bar status selector: native tap/swipe/navigation/text/app launch, held and
multitouch input, watchdog release, manual/saved synthetic-PIN unlock, all H.264
modes, rotation/touch mapping, wrong-PIN guard, global disarm, revocation and
cleanup. No browser errors. The Save data sample decoded 50 frames over 5.001
seconds, receiving 254,876 encrypted relay bytes. This is a fixture measurement,
not a capacity guarantee. The successful rerun does not close the intermittent
unlock follow-up above. The runner reaped its emulator and isolated Chromium.

### Saved-PIN interaction — 2026-10-20

**Use saved PIN** now acts immediately, without a browser confirmation or routine
“One attempt” warning. The native one-attempt/failure guard is unchanged; recovery
instructions appear only when an unlock fails or is blocked. The existing
five-viewport browser regression now rejects confirmation dialogs, verifies
successful direct saved-PIN unlock and checks that both unlock buttons remain
disabled after the guard blocks another attempt. Hosted control fixtures no
longer auto-accept the removed confirmation. This is a website change and needs
no Android reinstall.

### Automatic refresh and screen preview — 2026-10-20

Opening a saved phone page checks its encrypted connection once, without a
separate Check connection button. A successful check updates contact history and
shows “Ready to connect” in the existing top-bar status area. The phone library
still does not wake every saved phone. Metadata updates do not restart checks;
returning from the Back/Forward cache performs a fresh check.

The screen frame and right-side controls appear before connecting. A compact
Connect overlay starts viewing/control; unavailable controls remain disabled.
Feature readiness appears in a permanent icon row with enabled/off/unknown badges.
Preview, connecting, live viewing and disconnected states share the same frame,
so their screen and control geometry stays stable. The canvas retains the actual
phone aspect ratio and touch mapping inside that frame.

Connect can supersede a pending automatic check, with cancellation and Web Lock
release completing before the replacement acquires its own lease. Another tab's
lease is still rejected immediately, before any socket or wake request.
Disconnect and session loss return to the preview without another automatic
request; Connect remains available to retry.

The isolated phone acceptance covers automatic checks, successful/failed contact
history, no recheck on metadata changes or disconnect, pending-check cancellation
and replacement, the persisted-pageshow lifecycle, session loss/reconnect and
identical preview/live/disconnected geometry at four viewport sizes. The existing
five-viewport live-viewer regression and all 92 TypeScript tests also pass.

Revision `126603e` is deployed. Its hosted owned-emulator control regression
passes real screen/input/navigation/app launch, held/multitouch input, synthetic
manual/saved-PIN unlock, H.264 quality changes, rotation, failed-PIN guard,
global disarm, revocation and cleanup, with no browser errors. The Save data
sample decoded 50 frames over 5.001 seconds with 266,810 encrypted relay bytes.
This run does not resolve the previously recorded intermittent native unlock
failure. No physical phone was selected or updated.

The hosted two-browser management regression also passes against this revision:
independent pairing/checks, permission revoke/restore, process-absent FCM for both,
persisted nicknames/access after restart, global and per-browser pause,
stale-generation rejection, disconnect and isolated revocation. Fresh Firebase
receipt-to-exchange intervals were 193 and 189 ms; these are fixture measurements.
This run used a clean archive of the committed Android sources, separate from
concurrent mobile UI edits. Both fixture grants were removed, and the runners
reaped their emulators and isolated Chromium processes.

### Stable connection card and capability icons — 2026-10-20

The centered Connect card now reserves fixed rows for its action, contact time,
capabilities and cancellation. Cancel becomes visible in its reserved space;
checks and connection attempts do not resize or recenter the card. Screen,
Touch and Requests icons are always visible, including before the first report.
Each has a check, minus or question-mark badge for enabled, off or unknown.
Accessible names and hover titles give the full capability/status and any repair
action. The former capabilities disclosure is removed.

The isolated phone regression now measures the card, both buttons, contact row
and individual capability icons as well as the outer screen/rail. Their geometry
and page/overlay scroll remain identical through delayed checks/connections,
enabled/disabled/unknown reports, errors, cancellation and light/dark changes at
1280×1000, 390×844, 320×680 and 844×390. Existing five-size live-viewer geometry,
multi-phone/tab and lifecycle checks also pass, along with type checks, Biome and
the production build. This presentation-only change needs no Android reinstall.
