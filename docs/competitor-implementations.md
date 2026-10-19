# How the reference implementations handle our spike capabilities

Source review: **2026-10-19**. Checkouts and exact commits are recorded in
[repos.yaml](../repos.yaml); [checkout instructions](../research/README.md) keep
them under the ignored `references/` directory. No competitor was built,
installed or tested on a phone. The findings below describe reviewed code,
not measured compatibility, security or unattended reliability. Proprietary
products use documentation-only evidence, with review dates below.

## Main findings

- **droidVNC-NG is the closest native reference for our fallback:** accessibility
  still capture and input, with MediaProjection as an upgrade. It explicitly
  falls back when projection stops and restores service state after a crash.
- **scrcpy's panel-off control comes from ADB shell authority.** It can keep
  mirroring with the physical display powered off. That is different from
  sleeping/locking Android and is not an ordinary app API we can transplant.
- **RustDesk separates screen wake from input:** the first touch while asleep
  requests wake rather than delivering that touch. Capture still depends on
  MediaProjection. Its reviewed transport code includes WebRTC and native
  direct/relay alternatives; it is not simply a PeerJS implementation.
- **No dedicated Android known-PIN transaction was found in the reviewed app
  paths.** Generic taps/text are not evidence of safe saved-PIN handling or
  pre-first-unlock operation. Connection passwords authenticate the remote
  service; they are not the Android lock credential.
- **None of the reviewed Android integration paths establishes our planned
  FCM-to-on-demand-session flow.** That remains work to implement and qualify.

## Capability comparison

“Not found” below is scoped to the source paths described in each section,
not a claim about every version, OEM add-on or commercial build.

| Capability | scrcpy | droidVNC-NG | RustDesk Android | Buddy Android |
| --- | --- | --- | --- | --- |
| Authority | Authorized ADB shell server | Installed app + accessibility; optional MediaProjection | Installed app + accessibility + MediaProjection | Accessibility tool service; related agent reference, not a manual remote-desktop competitor |
| Turn display on | Inject POWER when initially off | Screen-dim wake lock with wake flag when VNC client connects | Five-second bright wake lock on first touch/left-down when noninteractive | No dedicated wake tool found; observes screen/keyguard state |
| Keep awake | User activity, plugged-in stay-awake setting, configurable timeout | Screen wake lock held for connected clients | Temporary wake lock; floating overlay can request keep-screen-on | Partial wake lock during rules keeps CPU running; visible terminal has separate screen-on option |
| Turn off / lock | Privileged panel power control; separately POWER/sleep behavior | Reviewed shortcut opens power menu; dedicated lock/panel-off operation not found | POWER key opens power menu; dedicated lock/panel-off operation not found | Dedicated lock/panel-off tool not found |
| Enter Android PIN | Generic authorized input; no dedicated safety transaction found | Generic accessibility input; no dedicated safety transaction found | Generic accessibility input; no dedicated safety transaction found | No secure-unlock tool found |
| Capture | Privileged display capture, no MediaProjection dialog | MediaProjection or API 30+ accessibility screenshot loop | MediaProjection virtual display / image reader in reviewed default path | API 30+ accessibility JPEG screenshots |
| Touch / text | Shell input injection; other input modes also available | Continued accessibility strokes; input-method connection on API 34+, node fallback | Continued accessibility gestures; input-method connection on API 33+, older node route | Accessibility node actions/gestures, focused-field text |
| Restart / boot | Controller must reconnect/start shell server; ADB readiness is external | Opt-in BOOT_COMPLETED, accessibility prerequisite on API 30+; persisted crash/update restart | Opt-in BOOT_COMPLETED with overlay/battery prerequisites; capture request still separate | Service-bound tools; no boot receiver found in reviewed main manifest |
| Before first unlock | No reviewed consumer recovery guarantee | No direct-boot route found | No direct-boot route found | No direct-boot route found |
| Network model | USB or reachable ADB TCP/IP | VNC/noVNC; outbound reverse VNC/repeater | Rendezvous, direct paths and relay; WebRTC included in this pin | Local authenticated tool server; optional agent remote session |

## scrcpy: shell privileges explain the screen-off advantage

Reviewed server sources under
[`com/genymobile/scrcpy`](https://github.com/Genymobile/scrcpy/tree/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy).
The controller's startup checks the primary display and injects POWER if needed
([Controller.java:229](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/control/Controller.java#L229)).
This turns the display on; it does not authenticate the owner.

`setDisplayPower()` uses internal `SurfaceControl`/`DisplayControl` paths with
version-specific handling, including an Honor workaround
([Device.java:145](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/device/Device.java#L145)).
`powerOffScreen()` separately checks interactivity and injects POWER. The
controller tracks the panel-off state, re-applies it after wake-related keys
and arranges restoration on exit
([Controller.java:857](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/control/Controller.java#L857)).
Do not call this an Android keyguard bypass, or equate it to our accessibility
`GLOBAL_ACTION_LOCK_SCREEN` operation.

Capture uses internal display APIs, with a SurfaceControl fallback
([ScreenCapture.java:134](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/video/ScreenCapture.java#L134)).
Input goes through shell-authorized event injection
([Controller.java:734](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/control/Controller.java#L734)).
Neither mechanism demonstrates what a Play-installed ordinary app can do.

The [device guide](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/doc/device.md)
distinguishes periodic user activity, stay-awake **only while plugged in**,
screen timeout and physical display power. Changed settings are restored on
exit; cleanup code preserves that state
([CleanUp.java](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/server/src/main/java/com/genymobile/scrcpy/CleanUp.java)).
The [connection guide](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/doc/connection.md)
requires debugging reachability/authorization. It supplies no account-free
phone relay or push wake service. Reboot/ADB recovery cannot be inferred from
successful desktop mirroring.

## droidVNC-NG: stills survive as a separate capture capability

Reviewed Java service/input/capture/autostart code under
[`net/christianbeier/droidvnc_ng`](https://github.com/bk138/droidVNC-NG/tree/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng),
manifest, build configuration and README. This pin sets minSdk 24 and targetSdk 36.

**Wake:** MainService creates `SCREEN_DIM_WAKE_LOCK | ACQUIRE_CAUSES_WAKEUP |
ON_AFTER_RELEASE`, acquires for each connected client and releases on disconnect
([MainService.java:336](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/MainService.java#L336),
[client lifecycle:781](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/MainService.java#L781)).
These are legacy/deprecated screen-wake APIs, not proof of current background
launch eligibility, Doze reachability or secure unlock. The reviewed input
shortcuts implement BACK/HOME/RECENTS and `GLOBAL_ACTION_POWER_DIALOG`
([InputService.java:559](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/InputService.java#L559)).
A power menu is not a lock command or panel-off mode.

**Capture:** API 30+ fallback repeatedly calls accessibility `takeScreenshot`,
updates the VNC framebuffer, slows down on rate-limit errors and stops the
callback on other failures
([InputService.java:1210](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/InputService.java#L1210)).
That does not bypass protected surfaces. MediaProjection consent requests
whole-display sharing on API 34+ because input cannot be confined to a selected
app
([MediaProjectionRequestActivity.java:75](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/capture/mediaprojection/MediaProjectionRequestActivity.java#L75)).
When projection stops, MainService clears its old result and restarts capture
into fallback; connecting while in fallback offers an upgrade dialog
([MainService.java:463](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/MainService.java#L463)).
This is a concrete precedent for keeping stills independent of smooth sharing.

**Input:** API 26+ uses continued strokes for streaming pointer movement;
older versions submit completed paths
([InputService.java:1317](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/InputService.java#L1317)).
Keyboard handling prefers accessibility InputMethod/InputConnection on API 34+
(intentionally skips API 33 because of an AOSP bug), then falls back to node
editing
([InputService.java:713](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/InputService.java#L713)).
These are generic input routes, without the blank-PIN-field, policy preflight
and single-attempt transaction we tested.

**Recovery/network:** persisted start parameters support crash recovery,
waiting for accessibility on Android 11+. Some active branches return
`START_STICKY`; null-intent recovery and inactive/unknown paths return
`START_NOT_STICKY`
([MainService.java:425](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/MainService.java#L425)).
The [boot receiver](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/autostart/OnBootReceiver.java#L54)
requires opt-in, checks accessibility on API 30+, selects fallback if needed and
optionally schedules a delayed foreground-service start. The
[package-update receiver](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/autostart/OnPackageReplacedReceiver.kt)
also restores prior active state. These do not establish access before the
first local unlock. Network callbacks reset outbound reconnect backoff and
handle interface changes
([MainService.java:150](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/app/src/main/java/net/christianbeier/droidvnc_ng/MainService.java#L150)).

The [README](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/README.md#L65)
documents noVNC, reverse VNC and Mode-2 repeaters, but warns that traffic except
password exchange is unencrypted. Its ADB `PROJECT_MEDIA` workaround is an
advanced setup path, not our proposed consumer permission flow. It also records
Android 16 sensitive-app input restrictions. No FCM integration was found in
the reviewed Android sources/build files.

## RustDesk: wake on input, projection lifecycle, multiple transports

Reviewed native Android code under
[`com/carriez/flutter_hbb`](https://github.com/rustdesk/rustdesk/tree/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb),
Android manifest/resources/build settings and selected Rust transport/UI entry
points. minSdk 22, targetSdk 36. The `libs/hbb_common` submodule and its WebRTC
implementation were **not** fetched or audited; this is not a full protocol or
cryptographic review.

**Wake and power:** when noninteractive, first touch or left-button-down
acquires a five-second wake lock instead of forwarding that event. Later input
is passed through normally
([MainService.kt:66](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/MainService.kt#L66)).
The lock uses `ACQUIRE_CAUSES_WAKEUP | SCREEN_BRIGHT_WAKE_LOCK`
([MainService.kt:189](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/MainService.kt#L189)).
The floating overlay can set `FLAG_KEEP_SCREEN_ON`
([FloatingWindowService.kt:381](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/FloatingWindowService.kt#L381)).
POWER maps to the accessibility power **dialog** on key-up
([InputService.kt:498](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/InputService.kt#L498)).
No privileged physical-panel-off operation or dedicated Android lock/PIN
transaction was found in these native paths. The named `get_unlock_pin` and
`set_unlock_pin` UI functions explicitly return empty on Android/iOS
([ui_interface.rs:1689](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/src/ui_interface.rs#L1689));
their names must not be cited as Android keyguard support.

**Capture/input:** the default reviewed capture path uses MediaProjection,
a virtual display and RGBA ImageReader buffers passed to native code
([MainService.kt:386](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/MainService.kt#L386)).
Projection stop releases the display, clears readiness and rechecks permission;
recovery can launch a new consent request. The reviewed accessibility service
configuration does not request screenshot capability. Thus this pin does not
show our independent accessibility-stills fallback. Do not infer native H.264
capture from desktop codec features. Input uses continued accessibility strokes
and API 33+ InputConnection; older text handling edits nodes
([InputService.kt:290](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/InputService.kt#L290),
[keyboard:397](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/InputService.kt#L397)).

**Recovery:** MainService deliberately returns `START_NOT_STICKY` because its
comment says auto-restart loses control; a missing projection result launches
the permission-request activity
([MainService.kt:346](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/MainService.kt#L346)).
The [boot receiver](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/flutter/android/app/src/main/kotlin/com/carriez/flutter_hbb/BootReceiver.kt#L20)
requires explicit opt-in, battery-optimization exemption and overlay permission,
then starts the service. This is not proof of automatic capture readiness or
pre-first-unlock recovery. No FCM integration or direct-boot route was found in
the reviewed Android source/build/manifest paths.

**Transport:** the pinned client races WebRTC against other transports, holds
a relay result for a bounded opportunity for direct connection, and closes
unused streams
([client.rs:215](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/src/client.rs#L215)).
The mediator handles relay requests, WebRTC SDP/ICE answer setup and UDP/TCP
punching
([rendezvous_mediator.rs:661](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/src/rendezvous_mediator.rs#L661),
[answerer:858](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/src/rendezvous_mediator.rs#L858),
[path selection:1042](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/src/rendezvous_mediator.rs#L1042)).
TURN-related policy exists; that does not require us to operate TURN. This is
a useful precedent for bounded direct attempts plus fallback, not evidence of
PeerJS interoperability, Android build acceptance or our control/stills protocol.

## Buddy Android: related device primitives, different product

Reviewed app Java sources, manifest and build configuration at the manifest pin;
minSdk 30, targetSdk 36. Its tool surface provides screen-tree reading,
accessibility taps/text/swipes and screenshots
([Tools.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Tools.java)).
Screenshot capture hides the bubble, calls accessibility `takeScreenshot` and
returns JPEG; it is not a MediaProjection video implementation
([Tools.java:877](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Tools.java#L877)).

The bound accessibility service observes screen-on/off/user-present broadcasts
to hide the bubble when locked
([BuddyService.java:61](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/BuddyService.java#L61)).
Observing keyguard does not unlock it. Rules acquire a bounded 15-minute
`PARTIAL_WAKE_LOCK`, which keeps the CPU active rather than the display
([Triggers.java:569](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Triggers.java#L569)).
The local authenticated tool server binds loopback
([McpServer.java:76](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/McpServer.java#L76));
its optional [RemoteSession](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/RemoteSession.java)
starts an agent CLI session in its Linux environment. This is not our standalone
browser-to-phone relay. No dedicated unlock/wake/lock tool, boot receiver or FCM
integration was found in the reviewed tool/service/manifest paths. Useful
primitives do not imply we need its AI/runtime architecture.

## Proprietary competitors: what we can actually establish

These remain **vendor-documented**; internals and current phone behavior were
not inspected. The original comparison was reviewed 2026-10-18; the AnyDesk
Android guide and AirDroid Find Phone article below were retrieved 2026-10-19.
See [the original comparison](competitors.md) for setup flows and retrieval limits.

| Product | Documented approach | Screen / unlock / recovery evidence limit |
| --- | --- | --- |
| [AirDroid / AirMirror](https://help.airdroid.com/hc/en-us/articles/360004121114) | Main app + [accessibility Control Add-on](https://help.airdroid.com/hc/en-us/articles/4405983257243); [older USB non-root setup](https://help.airdroid.com/hc/en-us/articles/360005061394) | No reviewed implementation establishes exact wake/lock API, safe Android PIN storage/entry, panel-off capture or first-unlock recovery. OEM background setup is separately documented. |
| [AnyDesk](https://support.anydesk.com/docs/anydesk-for-android) | Universal/OEM control plugins, accessibility, Unattended Access authentication | Vendor explicitly distinguishes unattended authentication from Android 10+ recording approval that can require local acceptance. Its connection password is not proof of Android PIN handling. Exact power/unlock implementation unknown. |
| [TeamViewer Host](https://play.google.com/store/apps/details?id=com.teamviewer.host.market&hl=en&gl=US) / [QuickSupport](https://play.google.com/store/apps/details?id=com.teamviewer.quicksupport.market&hl=en&gl=US) | Host claims unattended access; QuickSupport has an attended consent workflow | Host's listing does not establish secure-keyguard, panel-off capture or reboot recovery on our target phone. QuickSupport's local approval is part of its intended role. OEM/plugin implementation unknown. |
| [Vysor / Share](https://www.vysor.io/) | Desktop/web mirroring; sharing screen and ADB access | Reviewed landing page does not establish phone-only unattended hosting, exact power APIs or first-unlock recovery. No source clone claimed. |

AirDroid's separate [Find Phone article](https://help.airdroid.com/hc/en-us/articles/360005115473)
documents Device Administration activation, Lost Mode locking with a passcode
and an **Unlock** action to exit Lost Mode. That is a vendor-described lost-phone
workflow, not evidence that its remote-control host safely enters an existing
Android PIN or bypasses modern keyguard. The article itself notes Android
fragmentation. We did not enable it or exercise its lock/wipe controls.

The AnyDesk guide still explicitly requires manual acceptance of Android's
recording/casting prompt when it appears, even with unattended authentication.
Neither this recheck nor an AirDroid help-center search establishes proprietary
power APIs or universal first-unlock recovery.

## Implications for our next implementation

Our [physical spike](phone-spike.md#owner-pin-unlock) already separates display
wake, dismissal UI and a single known-PIN attempt. Its WakeActivity uses
`setTurnScreenOn`/`requestDismissKeyguard`; its accessibility lock command uses
`GLOBAL_ACTION_LOCK_SCREEN`. It does not have scrcpy's shell-powered panel-off
mode. The Pixel 9 credential experiment remains narrower than general OEM
support, and optional server-local saved PIN remains a spike convenience.

1. Keep explicit **Wake**, **Lock**, **Unlock with PIN**, **Stills** and
   **Smooth sharing** capabilities. A power-menu action is not interchangeable
   with any of them. Do not advertise “screen off while controlling” based on
   scrcpy without a separately qualified privileged route.
2. Preserve accessibility stills/input when MediaProjection ends. droidVNC-NG
   provides a concrete lifecycle reference; RustDesk shows why service/network
   readiness cannot stand in for capture readiness. Modern Android stops
   projection on lock; the [platform record](android-platform.md) retains that
   boundary and the protected-surface/input limits.
3. Keep the one-attempt PIN checks and native authority separate from viewer
   authentication. None of these source reviews establishes a ready-made safe
   saved-PIN design or removes our storage/backup/lockout work. First unlock
   after reboot remains local in our supported spike flow.
4. Implement the [planned on-demand lifecycle](production-plan.md#on-demand-session-lifecycle)
   and test it with no idle relay socket: FCM hint, authenticated request fetch,
   bounded direct WebRTC, automatic hosted control/stills fallback. Source
   precedents do not prove overnight wake, FCM eligibility, force-stop recovery
   or Play approval. No reviewed app removes those acceptance gates.
5. Study mechanisms before selecting dependencies. scrcpy is Apache-2.0,
   droidVNC-NG GPL-2.0, RustDesk AGPL-3.0 and Buddy's app Apache-2.0, with separate
   dependencies/notices. This review imports no implementation code and is not
   a component reuse/license approval.
