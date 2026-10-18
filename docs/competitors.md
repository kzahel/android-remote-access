# Competitors and alternatives

Documentation-based research, **2026-10-18**. No apps were installed, purchases
made, competitor accounts created or devices reconfigured. The UX observations
describe published onboarding/support flows, not measured usability. “Not
established” means the reviewed sources did not prove the capability; it does
not mean the competitor lacks it. Source links and retrieval limitations are
in [SOURCES.md](../research/SOURCES.md).

## Findings that change the opportunity

Remote Android control is an established category. Accessibility-based input,
browser viewers, ADB-assisted setup and unattended-access marketing already
exist. The opportunity cannot credibly be “nobody lets you control Android.”

The narrower opportunity is a consumer who leaves a spare phone elsewhere and
wants reliable access to a particular app. Published competitor setup flows
often combine separate apps/add-ons, remote-service passwords/accounts,
capture consent, accessibility settings and OEM battery instructions. Several
explicitly disclose limits that conflict with a naive reading of “unattended.”
There may be room for clearer preparation, honest readiness, a real departure
test and useful recovery. That is a hypothesis to validate against actual apps.

## Comparison

| Product | Documented Android-target approach | Setup and UX evidence | Unattended/lock boundary | Relevance |
| --- | --- | --- | --- | --- |
| AirDroid Personal + AirMirror | Accessibility Control Add-on; an older USB non-root authority route; desktop and web control | Sign into the same account, enable Remote Control, install add-on and enable accessibility; AirMirror is the other-phone viewer | Vendor documents OEM background steps and directs newer Android users toward accessibility; current secure-unlock/reboot acceptance not established | Closest consumer account/device-list comparison |
| AnyDesk | Android app plus universal or OEM control plugin; Unattended Access password | Plugin detection, accessibility setup, per-OEM battery guidance; session menu offers input modes and navigation | Official Android guide says Android 10+ capture prompt may still need someone physically present despite Unattended Access | Strong example of the gap between unattended session acceptance and screen readiness |
| TeamViewer Host / QuickSupport | Separate unattended-host and attended-support products | Host advertises unattended Android access; QuickSupport requires open app, connection consent and screen-sharing approval | Host listing is not proof that every phone's secure keyguard or capture lifecycle is recoverable; QuickSupport is intentionally attended | Learn clear roles and consent; do not compare QuickSupport's local confirmation as a Host defect |
| RustDesk | Share Screen service with screen/input grants; Android viewer/controller; self-hosted relay option | Share Screen permission panel and Start Service; viewer supports touch/mouse modes and historical devices | Android guide says Screen Capture and Input Control must be requested again on starting RustDesk; secure-unlock/reboot outcome not established | Open reference for capability controls, cross-platform input and self-hosting |
| droidVNC-NG | No-root Android VNC server using accessibility input and capture; built-in noVNC browser client | Start server, password/port, permissions; reverse VNC/repeater and discovery options | README describes capture-consent issues, ADB/app-op workarounds/fallback capture and Android 16 sensitive-input limits; boot-start claim is not a universal secure-unlock guarantee | Closest lightweight/open native server; exposes how much consumer setup remains |
| scrcpy | Desktop/controller uses authorized ADB to a shell-owned Android server | USB/network debugging and CLI setup; low-latency screen and keyboard/mouse control | Stay-awake/display-off options do not bypass secure authentication; no built-in consumer Internet enrollment service | Strong control/capture reference and advanced-user alternative |
| Vysor / Vysor Share | Desktop/web mirroring and control; vendor advertises sharing screen and ADB access across locations | Direct “use your Android on your computer” positioning; browser and desktop entry points | Reviewed landing page does not establish phone-only unattended hosting or post-reboot secure-unlock recovery | Benchmark simple messaging and computer-assisted preparation; architecture needs further review |

## AirDroid: close to the original consumer use case

The [official control walkthrough](https://help.airdroid.com/hc/en-us/articles/360004121114)
supports remote access to an unattended Android phone, both desktop and web
viewers, and a same-account model. On the phone, users sign in, enable remote
control under Security & Remote Features and complete control authorization.
The web viewer can start from a browser, reducing desktop-install friction.

The [Control Add-on guide](https://help.airdroid.com/hc/en-us/articles/4405983257243)
adds a separately installed accessibility service on Android 7+. The
[non-root setup article](https://help.airdroid.com/hc/en-us/articles/360005061394)
documents a USB/debugging route and directs devices above Android 12 toward
the accessibility method. Its overlapping version wording should not be
reinterpreted as a precise compatibility matrix for all devices.

The [Samsung background guide](https://help.airdroid.com/hc/en-us/articles/7495536854299)
shows that the add-on and main app both have lifecycle considerations. The
Xiaomi guide is another separate support path. This is evidence that permission
setup and continued readiness are distinct jobs, not evidence that their app
necessarily fails on those phones.

**Lesson:** a friendly account/device list and browser viewer are already
available. A new app must demonstrate a materially clearer successful setup or
a better-supported unattended scenario. Do not ship another unexplained add-on
chain without testing whether the split is needed for platform/distribution.

## AnyDesk: “unattended” can still require a person

The [Android guide](https://support.anydesk.com/docs/anydesk-for-android) documents
universal `ad1` and manufacturer-specific plugins. The app detects a required
plugin, but users may still need to install it and enable accessibility.
Input compatibility depends on the device and plugin.

Its Unattended Access section explicitly says the Android screen-recording
prompt can require physical acceptance even when an unattended password is
configured. The guide includes ADB `PROJECT_MEDIA` workaround commands and OEM
battery instructions. These are vendor-documented operational workarounds,
not evidence that modern Android consent/lock restrictions disappear.

The session UI has direct-touch, mouse and touchpad modes, special keys and
Android navigation shortcuts. That breadth is useful but increases the number
of interaction concepts a casual phone owner can encounter.

**Lesson:** show whether remote screen capture itself is ready, not merely
whether the remote-service password is set. Keep everyday navigation obvious;
hide specialized input modes until needed. Test the exact Android version.

## TeamViewer: separate attended support from the host product

The [Host Play listing](https://play.google.com/store/apps/details?id=com.teamviewer.host.market&hl=en&gl=US)
advertises permanent/unattended Android access, screen sharing, device info,
file transfer and other administration. These are vendor claims, not our
physical acceptance on a particular phone.

The [QuickSupport listing](https://play.google.com/store/apps/details?id=com.teamviewer.quicksupport.market&hl=en&gl=US)
and [attended-support guide](https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/mobile/provide-attended-remote-support-for-mobile/)
describe a deliberately different workflow: the target app is open, the remote
partner connects via device ID, the target allows access, and Android screen
sharing is approved. Documentation mentions mobile-device-support licensing;
exact current eligibility/pricing was not established here.

**Lesson:** onboarding should ask what relationship is intended—your own phone
left elsewhere or helping a person who is present—without confusing one role's
security flow with the other. A recovery promise must be tested in Host-like
unattended conditions rather than inferred from an attended-support demo.

## RustDesk: open/self-hosted is already an option

The [Android guide](https://rustdesk.com/docs/en/client/android/) puts screen,
input, file and audio permissions beside service startup. It describes remote
ID/history, mouse/touch modes, QR-based custom-server configuration and the
screen-sharing flow. Its language about requesting screen/input permissions
again is a documentation claim; actual behavior may differ by OS and service
lifetime and needs hands-on qualification.

The [pricing page](https://rustdesk.com/pricing/) explicitly says its prices are
for **self-hosting, not a SaaS subscription**. On the review date it lists a free
self-hosted plan and Individual Pro at USD 11.88/month billed annually, with
one login user and 20 managed devices. Do not mistake that for a minimum price
to use every RustDesk client or for an equivalent hosted consumer subscription.

**Lesson:** “open source” and “self-hostable” alone are insufficient
differentiation. A consumer default should not require typing ID/relay server
settings. Study permission/status presentation, but verify the real phone-left-
behind scenario rather than extrapolating from the desktop product.

## droidVNC-NG: unusually relevant technical/UX reference

The [README at the reviewed revision](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/README.md)
documents no-root capture/control, input via accessibility, a built-in noVNC web
viewer, password/port configuration, discovery, reverse connections/repeaters,
intent automation and start-on-boot. Keyboard support has explicit Android
version/widget limits. Do not repeat an outdated claim that it has no browser
client or no remote connection mechanism.

It also warns that VNC traffic other than password exchange is currently not
encrypted, documents per-start capture permission and ADB/fallback options,
and notes Android 16 accessibility-sensitive input exclusions. Its instructions
for Internet access include router/port concepts that are a high burden for
the target consumer. Use an appropriately protected transport when evaluating
it; a password alone is not the product's end-to-end privacy story.

**Lesson:** useful native building blocks already exist. A consumer opportunity
could be secure pairing/relay, clear recovery status and less setup, rather
than rebuilding the same controls with a new logo. Reuse requires license review.

## scrcpy and Vysor: computer-assisted alternatives

[scrcpy](https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/README.md)
works over USB or TCP/IP and needs no permanent ordinary app installation.
It uses authorized ADB and supports physical keyboard/mouse-style input,
hardware video, display-off and stay-awake controls. Debugging preparation and
a controller remain real parts of the user journey. Adding Tailscale/ADB can
solve a technical owner's reachability problem but does not become a dead-simple
consumer setup by itself.

[Vysor](https://www.vysor.io/) presents the simple value “a window to your
Android” and offers desktop/web entry points. Vysor Share advertises remote
screen and ADB access by link. The landing page lists Pro at USD 2.50/month,
USD 10/year or USD 40/lifetime on the review date. That is the displayed offer,
not a verified checkout price, tax treatment or full Android host/recovery
capability matrix. The dependency on a computer/host for each sharing scenario
needs closer documentation or hands-on review.

**Lesson:** optional preparation could borrow a simple guided-computer model.
The product must still show whether that computer remains a runtime dependency.
It cannot quietly require a workstation after promising “just leave the phone.”

## Adjacent alternatives

**AlfredCamera** is especially relevant to the spare-phone motivation. Its
[setup guide](https://support.alfred.camera/hc/en-us/articles/360039719851) uses
Viewer/Camera roles and account or QR linking. This is a strong example of
organizing a product around the job rather than transport. Its
[Android connection guidance](https://support.alfred.camera/hc/en-us/articles/4416553672218)
includes battery, lock and OEM settings. Another
[troubleshooting article](https://support.alfred.camera/hc/en-us/articles/360040217771)
warns about background termination/camera conflicts and even possible periodic
relaunch. These are camera-specific documented limitations, not a judgment of
its current reliability on every device. It does not replace general UI access.

**Tailscale** provides network reachability and device identity/routing;
[its Android setup](https://tailscale.com/docs/install/android) requires installing
and signing in. It is an advanced deployment option, not screen capture,
keyguard unlock or an app-lifetime guarantee.

**Shizuku** provides a user-started privilege broker and phone-only wireless
debugging startup on supported devices. Its
[guide](https://shizuku.rikka.app/guide/setup/) describes non-root restart after
reboot. It can inform optional preparation; it is not remote desktop, a relay
or a universal consumer background permission.

## Pricing and reuse limits

Only the RustDesk and Vysor displayed offers above were successfully verified.
The attempted AnyDesk price page returned HTTP 403; guessed AirDroid/Alfred
pricing endpoints returned 404. Do not publish invented comparable monthly
costs or infer that unverified products are necessarily expensive. Future
hands-on comparison should record trial limits, remote bandwidth limits,
Android-target licensing and annual-versus-monthly billing from actual offers.

scrcpy supplies Apache-2.0 license text; RustDesk supplies AGPL-3.0 text and
droidVNC-NG supplies GPL-2.0 text in their reviewed repositories. These are
material reuse constraints; determine exact file SPDX terms, dependency notices
and distribution obligations before copying. Proprietary vendor docs and visual
assets were studied, not licensed for inclusion. No competitor code or art was
imported, and this project's eventual source license is undecided.

## Competitive hypothesis to test

A small product for **your own phone left elsewhere**, with a pre-departure
readiness check and a working manual fallback, may be more approachable than
general IT-support suites. Validate that claim on a real supported phone against
AirDroid, AnyDesk, TeamViewer Host and at least one open alternative. If one
already solves the scenario cleanly, that is valuable evidence to narrow or
stop the new product rather than invent differentiation.
