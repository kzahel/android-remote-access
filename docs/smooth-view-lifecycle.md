# Smooth-view consent and lifecycle investigation

Owner direction, 2026-10-21: investigate the smooth-view startup problems before
changing the product; the subsequent request authorizes implementation and a
commit. Smooth view is now one client on/off toggle with Balanced chosen
internally. Quality selection is no longer in the main flow. **Off ends screen
sharing**, rather than retaining a hidden projection for later resumption.
This document separates baseline investigation from the implementation below.

## Baseline investigation and limits

Experiments use owned Google APIs Android 15/API 35 and Android 16/API 36
emulators, the existing production `ControlSession`, `ScreenAccessService`,
`ProjectionConsentActivity`, `VideoStream` and `VideoService`, and a test-only
instrumentation fixture. No production source was modified during the baseline investigation. The instrumentation
exercises binary control commands, observes actual encoded frames and request
identity, and checks Android's projection manager independently with `dumpsys`.
The production source revision tested is `882fe84`.
Normal consent buttons and test-only activity lifecycle operations are operated
through instrumentation. Secure-lock tests use disposable emulator credentials.

Each final scenario starts with a fresh host process. Exploratory runs exposed
orphan dialogs that could contaminate later scenarios; those runs are not the
sole evidence for any final lifecycle conclusion. Logs, screenshots, temporary
source/build injection and runners remain in ignored `.local/smooth-experiments/`.
Neither physical phone nor the pre-existing emulator is used.

The final private evidence index selects 22 named cases per image, without
unexplained scenario errors in the selected records. This is characterization,
not a claim that every behavior passed: several cases deliberately reproduce
bugs, and the API 35 system-chip action was unavailable. Process-death cases
intentionally terminate instrumentation; the runner checks Android's projection
state before and after the kill. First-attachment accessibility setup failures
were retried before counting the affected cases.

These are capture/consent lifecycle experiments. Transport ownership replacement
is exercised through the real command session's `close()` and a new owner; it
is not a new end-to-end network-handoff qualification. Emulator observations do
not establish OEM-wide behavior, Play acceptance or physical-phone behavior.

## Platform requirements

Android delivers approval/cancellation as an activity result. Approval grants a
single projection session; a stopped session cannot be restarted with its old
token. Android 15 QPR1+ also stops projection on screen lock. An app must release
resources and update its UI when Android calls `MediaProjection.Callback.onStop`.
Sources, reviewed 2026-10-21:

- [MediaProjectionManager consent/result API](https://developer.android.com/reference/android/media/projection/MediaProjectionManager)
- [MediaProjection consent, stop and lock lifecycle](https://developer.android.com/media/grow/media-projection)
- [Activity.finishActivity for a previously launched child](https://developer.android.com/reference/android/app/Activity#finishActivity(int))
- [Foreground-service startup deadlines](https://developer.android.com/develop/background-work/services/fgs/troubleshooting)

The browser must distinguish request acceptance, consent approval, encoder startup
and working video. A successful start-command acknowledgement is not proof that
the user approved or that video is arriving. The baseline host marked a request
active before encoder setup completes.

## Baseline observations

The repeated pending-consent failures are in native lifecycle handling as well as
the browser UI:

- Off clears the capture request but leaves the outstanding Android dialog on
  screen. Approving that canceled request does not start capture, which is
  correct, but leaving the dialog present creates avoidable confusion.
- On → Off → On while consent is outstanding creates two consent activities.
  Approving the newer request produces frames; canceling the older dialog then
  terminates the newer stream. The old activity's failure branch closes by
  command owner, rather than checking the exact request identity.
- Explicit activity recreation can leave a visible dialog whose approval
  produces no frames. A subsequent nonzero-quality command only updates the
  existing request, so Start alone does not recover. The recreated activity exits
  when saved state is present without resolving the pending request.
- The exploratory rotation probe used action-button visibility as its dialog
  signal. Later screenshot inspection showed Android 15/16 can retain the dialog
  with its buttons clipped in landscape; missing buttons alone did not establish
  that the dialog disappeared. Implementation regressions distinguish dialog
  presence from button visibility and preserve the request across rotation.
- An unanswered prompt remains pending after the ten-second observation window.
  Repeated Start changes the same request's quality and does not stack another
  prompt. There is no pending-consent deadline in the current source.

Normal cancellation and Back clear the request without automatically prompting
again. A later deliberate start asks again and produces frames after approval.
Turning off active capture clears Android's projection, and immediately turning
it on again works with fresh consent. Active orientation and quality changes
continue producing frames without fresh consent.

Revocation and capture-owner closure prevent late approval from starting capture;
active revocation and owner closure end capture. A pending Android dialog can
remain after owner closure. Replacing the command owner, as current transport
handoffs do, therefore ends smooth capture and requires fresh consent for a new
stream. A browser must not keep claiming that smooth viewing is active across
that transition.

The production screenshot and coordinate-tap command path can see and approve the
system consent dialog on these emulator images, with actual H.264 frames after
the tap. This was an explicitly operated test command, not automatic consent
approval. It does not qualify physical devices or every Android/OEM security
configuration. Removing the covering browser dialog is necessary to make this
interaction usable where Android permits it.

In a test-only cancellation experiment, calling `finishActivity(41)` and finishing
the exact owning consent activity after Off dismissed the system dialog. Waiting
for that activity to finish, then making a fresh request, produced one new prompt
and working video. This establishes an available cleanup mechanism on the tested
images; production cleanup now uses this mechanism.

Secure lock ended active sharing and left no Android projection. A fresh start
after fixture-local unlock required consent again. Locking with a pending request
also exposed a stop-command problem: the host returns "phone locked" for quality
zero, even when no capture remains to stop. On API 36, the request was still
present at that moment and cleared later during unlock/activity result delivery;
on API 35, it had already cleared by the locked-state observation. Stop must be
allowed independently of start's unlocked-phone precondition.

Stopping through Android's actual sharing chip and its confirmation ended capture
and cleared the projection on API 36. The shell service has no `stop` command on
this image; an earlier shell-command attempt did not exercise system stop and is
not counted as evidence for that path. The tested API 35 image did not expose the
sharing chip/stop action used by this fixture, so that UI path is qualified only
on API 36; an unchanged stream after a failed action lookup is not a host defect.

Force-stopping the host while capturing removed the active Android projection.
Force-stopping it while consent was pending left no projection. Subsequent fresh
processes started with no active capture, and the later retry smoke check required
fresh consent and produced frames. Disabling the actual accessibility service
also stopped active projection; while consent was pending, it cleared the capture
request but left the Android dialog until that dialog received a result. Late
approval in that state did not start video.

## Lifecycle requirements

- One outstanding consent request per capture owner; repeated On must not stack
  dialogs. Every asynchronous result belongs to one exact request identity.
  Carry that identity through foreground-service startup as well: source review
  showed the baseline service reading the global current request when it received
  a consent intent. The baseline did not reproduce that service-dispatch race;
  implementation regressions now exercise stale request-ID delivery.
- Off invalidates that request immediately, stops projection/encoding, clears
  queued media and dismisses its pending consent UI. A late result from an old
  request cannot start capture or terminate a newer request.
- Pending consent and encoder startup have explicit states and bounded deadlines.
  Cancellation, lifecycle interruption and failure return to an actionable Off
  state. Automatic status polling must not reopen a declined consent prompt.
- Report approval separately from readiness. Show On only when video is usable;
  show inline waiting/starting feedback and preserve an available Off action.
- On lock, system stop, process loss, access revocation or owner loss, reconcile
  the browser with actual host state and continue still frames when permitted.
  Require a new deliberate On action for fresh consent after sharing ends.
- Keep orientation/quality changes inside an existing live projection when
  possible. Pending-activity recreation must either preserve its outstanding
  request correctly or terminate it cleanly; it must not leave a phantom request.
- Off must remain safe and idempotent while locked or after resources have already
  ended. A start-only precondition must not prevent stop/cleanup.

## Implementation

The browser uses a direct, labeled switch, inline consent/start feedback and no
quality dialog. It requests Balanced (quality 2); there is no adaptive “Auto”
claim. Still frames and remote input remain available while awaiting consent.
The switch reports On only after WebCodecs displays a frame. Off closes the
local decoder immediately and sends native stop; inline feedback distinguishes
stopping from a confirmed stop. Rapid clicks are coalesced while preserving an
Off before a subsequent On. Native end reasons return the switch to Off without
an automatic re-prompt. Browser consent/start/decode/stall deadlines send stop
and leave an explicit retry available; unsupported decoding falls back to stills.

Native requests have process-local IDs carried in consent-activity and service
intents. Stale results and worker completions can affect only their own request.
Consent is limited to 60 seconds, startup to 15 seconds and encoded-frame stalls
to 10 seconds. Readiness requires an accepted keyframe, rather than merely
starting the service. Cleanup clears queued media, dismisses the owned child
activity and ends projection. Stop is idempotent with the phone locked or screen
access absent. Owner loss, permission loss, system stop and lock also clean up.
Ordinary rotation is handled in place; explicit activity recreation cancels
cleanly and permits a fresh request.

Consent returns to a visible activity, which starts the service normally. The
service validates request identity before promoting itself to a media-projection
foreground service and obtaining the projection. This avoids promising Android
a foreground startup for a dispatch that has already been canceled. The stale
service regression exposed an unfulfilled-foreground-start crash with the prior
startup approach. Runs and resize callbacks are scoped to their request; a late
old encoder completion cannot stop a new service start.

The encrypted control status adds optional `video: {id, phase, reason}` capability
metadata, with strict validation when present, and retains `videoActive` for
existing beta viewers. A new viewer with an older beta host retains still frames
and input; its smooth switch asks for a phone-app update instead of guessing
consent state. No protocol rewrite, storage migration or release publication is
part of this change.

## Retained verification

- `pnpm test` covers bounded wire states, native lifecycle deadlines/terminal
  states, browser click ordering, late acknowledgements, decoder readiness and
  stall/cancellation recovery, alongside existing regressions.
- `pnpm test:viewer-layout` exercises the real React switch on desktop/mobile,
  cancellation reasons, retry, missing-capability guidance and stable geometry.
- `pnpm build:android && pnpm test:smooth-view` owns an API 35 emulator. Set
  `ANDROID_TEST_API=36` for the installed API 36 image. The runner tests real
  consent, cancellation/Back, pending Off, rapid toggles, stale service delivery,
  rotation/recreation, actual consent expiry, live encoding/quality changes,
  owner/policy/permission loss, secure emulator lock, system stop where available,
  remote consent input, process death and fresh consent after restart.
- Its `browser` scenario runs real React/WebCodecs against native binary commands
  through a test-only local fixture. It requires displayed H.264 before On,
  verifies native Off, cancellation/retry and rapid toggling, and checks for
  browser errors. This validates viewer/native integration; it is not a new
  public-relay, authentication or network-handoff qualification.

The host APK contains no fixture commands or test activities. The regression
fixture and owned-emulator runner are committed; raw logs/screenshots and the
exploratory harness remain ignored. Physical phones and the pre-existing
emulator remain outside these runs.


### Verification result — 2026-10-21

The implementation passes 119 TypeScript tests, Kotlin protocol tests (including
three capture-lifecycle tests), lint, formatting, type checking and both builds.
The responsive viewer run passes five viewport sizes and the new desktop/mobile
switch recovery checks. Focused owned-emulator runs cover all 22 named lifecycle
scenarios on each API; the system-chip action is explicitly skipped on API 35
because that image does not expose it. Browser/native integration passes on both
images with actual decoded H.264, confirmed native stop, cancellation and rapid
retry. Consent expiry is measured for the full native one-minute deadline on
both images. Process-death cases verify Android projection cleanup independently;
a subsequent normal start requires fresh consent and produces video.

Each regression case owns a fresh app process. The runner uses normal
instrumentation startup after waiting for the app launch, so an intentionally
killed attachment does not leave the SDK's stale no-restart instrumentation
record. Synthetic-lock markers recover interrupted owned fixtures. Normal host
APKs are checked to exclude fixture classes. Test browsers and owned emulators
are reaped; physical phones and the existing emulator are preserved. No new
public-relay deployment, Play publication or physical-phone qualification is
claimed by these tests.
