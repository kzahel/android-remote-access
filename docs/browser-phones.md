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
`lastContactAt`. The connected viewer records status responses at most every
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
