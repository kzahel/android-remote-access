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
- IndexedDB `remote-access-v1`, schema 2, retains the non-exportable browser key
  in `state` and stores records keyed by phone ID in `phones`. Each has its pinned
  grant, most recent pairing time, optional local alias/model and contact time.
  Concurrent transactions merge metadata rather than replacing a shared array.
- The original single `state.grant` migrates once, atomically with its removal,
  retaining the grant and browser identity. Existing contact time is unknown.
  Re-pairing the same phone replaces its grant and retains alias/model/history;
  an active tab using the old grant is closed. An older tab blocking the database
  upgrade must be closed and the page reloaded, as the error guidance explains.

## Contact and tab behavior

Only an authenticated successful check or control state response advances
`lastContactAt`. Explicit successful Connect/Check operations always update it.
The connected viewer throttles background status recording to once every
15 seconds (or immediately when a new model is learned); it does not timestamp
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
the local lease. Back/Forward cache restoration presents a disconnected page,
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
lists saved phones, All phones, Add phone and Settings. The top-left menu button
can collapse it. Smaller viewports use a modal navigation drawer, with native
focus containment, Escape, a close button and outside-tap dismissal. Phone links
remain real `/phones/<phoneId>` links, including opening another phone in a new
tab. An information button opens local name/model/contact details without
leaving the current viewer. “In use” reflects a browser-held phone lease, including
other tabs; it does not claim that an uncontacted phone is online. Lock queries,
local notifications and cross-tab broadcasts refresh that indicator without
contacting the phone or waking it.

The fixed top bar contains the page/phone name and one dedicated live status
area. Android navigation, wake/lock, viewing quality, typing/app launch and
disconnect form a compact vertical rail to the right of the screen. The rail
scrolls internally in short landscape windows. Status changes, unlocking,
permission loss, dialogs and phone rotation preserve the screen/rail geometry
and page scroll. Canvas aspect ratio and input mapping remain intact.

Settings opens over the viewer and preserves the live session. Appearance defaults
to System and follows live OS changes; Light and Dark override it. Optional control
labels and desktop sidebar visibility are also local preferences. These values
use `remote-access-preferences-v1` in localStorage, synchronize between tabs and
survive reloads. Pairings and private browser keys remain in IndexedDB. An
external same-origin appearance bootstrap applies an override before rendering
and works with the existing production Content Security Policy. Unavailable or
malformed preference storage falls back to defaults; failed preference writes
show an error in Settings.

The four-size isolated layout suite passes drawer dismissal/focus restoration,
desktop collapsing, breakpoint changes, right-side rail placement, stable
lock/unlock/error/rotation/dialog geometry, sequential text entry, appearance
changes, saved overrides and cross-tab settings. The phone-library suite passes
cross-tab lease indicators, local phone details, sequential rename entry and
changing appearance without reconnecting or closing the live session, alongside
its existing migration/pairing/multi-phone coverage. Type checks, production
build, Biome and all 92 TypeScript tests pass. Hosted native control is verified
separately after deploying the committed revision.
