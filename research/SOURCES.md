# Sources and research method

Review date: **2026-10-18**. Initial research is read-only. Public sources were
retrieved over HTTPS; vendor article bodies were also read through their public
help-center APIs where useful. No competitor app, paid plan, Android permission,
ADB listener, PIN, phone or sibling working tree was changed.

## Evidence vocabulary

- **Platform-documented:** an official platform/API requirement or capability;
  not proof that our future app behaves correctly on every OEM.
- **Vendor-documented/claimed:** the vendor describes a feature or workflow;
  not an independently measured usability or reliability result.
- **Repository documentation reviewed:** exact README/guide/license content was
  read. This is not an implementation audit, build or security certification.
- **Source-reviewed:** specific implementation paths inspected at an exact Git
  revision; not proof of a successful build or behavior on a real phone.
- **Sibling evidence:** a dated experiment/implementation record in another
  repository. Preserve that record's device, scope and limitations.
- **Hypothesis/proposal:** analysis or candidate design requiring validation.

No hands-on competitive ranking or new physical acceptance result is claimed.
No search-result snippets or third-party affiliate reviews serve as evidence
for features/prices. Dates on vendor articles may precede this review date.

## Android and Firebase primary sources

| Source | URL | What was established |
| --- | --- | --- |
| AccessibilityService API | https://developer.android.com/reference/android/accessibilityservice/AccessibilityService | User-enabled native service, gestures, screenshot API levels and refusals |
| Android accessibility security guidance | https://android-developers.googleblog.com/2025/12/enhancing-android-security-stop-malware.html | Android 16 sensitive-view restrictions and warning against falsely declaring accessibility-tool status |
| Play AccessibilityService policy | https://support.google.com/googleplay/android-developer/answer/10964491?hl=en | Declaration/disclosure/consent; autonomous-action prohibition and qualifying accessibility-tool exception |
| MediaProjection guide | https://developer.android.com/media/grow/media-projection | Capture consent/token lifetime; Android 15 QPR1+ projection termination on lock |
| KeyguardManager API | https://developer.android.com/reference/android/app/KeyguardManager | `requestDismissKeyguard` displays credential UI when secure authentication is required |
| ADB guide | https://developer.android.com/tools/adb | Wireless pairing, USB-to-TCP setup, version-specific Wi-Fi behavior; not an unlock bypass |
| Doze/App Standby | https://developer.android.com/training/monitoring-device-state/doze-standby | Ordinary networking/wake-lock restrictions, FCM guidance and partial battery exemptions |
| FGS background starts | https://developer.android.com/develop/background-work/services/fgs/restrictions-bg-start | Enumerated exemptions; high-priority FCM/companion cases; independent while-in-use restrictions |
| FGS types | https://developer.android.com/develop/background-work/services/fgs/service-types | Projection, connected-device, remote-messaging and special-use purposes/prerequisites |
| User stopping an FGS | https://developer.android.com/develop/background-work/services/fgs/handle-user-stopping | Android 13+ Task Manager Stop removes the whole app, not only its service |
| Android 15 behavior changes | https://developer.android.com/about/versions/15/behavior-changes-all | Stopped-package changes and cancelled pending intents; projection status/lock behavior |
| Companion pairing | https://developer.android.com/develop/connectivity/bluetooth/companion-device-pairing | Genuine Bluetooth/BLE/Wi-Fi association, background permission names and presence lifecycle |
| Companion profiles | https://source.android.com/docs/core/connect/companion-device-profile | Association profiles/privileges are specific platform facilities |
| BLE background work | https://developer.android.com/develop/connectivity/bluetooth/ble/background | Native BLE/background connection and companion considerations; no generic vendor battery protocol |
| FCM receive messages | https://firebase.google.com/docs/cloud-messaging/android/receive-messages | Android message processing and delivery integration; no standalone remote-control authority |
| FCM priority | https://firebase.google.com/docs/cloud-messaging/android-message-priority | Normal-priority Doze delay, limited high-priority processing, user-visible intent and downgrade/delegation |
| FCM Direct Boot | https://firebase.google.com/docs/cloud-messaging/customize-messages/android-direct-boot | Explicit direct-boot support can receive before unlock; does not unlock protected app state |

Key conclusions were cross-checked against the actual relevant passages, rather
than inferred from the names of permissions. In particular, `remoteMessaging`
is documented for text-message continuity, and companion presence/association
is not automatically provided by any remote Internet viewer.

## Competitor and adjacent-product sources

| Source | URL | Use in this review |
| --- | --- | --- |
| AirDroid Personal control guide | https://help.airdroid.com/hc/en-us/articles/360004121114 | Same-account phone, desktop/web viewers, remote control and authorization paths |
| AirDroid Control Add-on | https://help.airdroid.com/hc/en-us/articles/4405983257243 | Separate accessibility add-on and guided permission handoff |
| AirDroid non-root setup | https://help.airdroid.com/hc/en-us/articles/360005061394 | USB/debugging setup and vendor's newer-Android accessibility direction |
| AirDroid Samsung background | https://help.airdroid.com/hc/en-us/articles/7495536854299 | Main/add-on lifecycle settings and OEM support burden |
| AirDroid Xiaomi background | https://help.airdroid.com/hc/en-us/articles/14760418803355 | Additional manufacturer-specific instructions |
| AnyDesk Android/ChromeOS | https://support.anydesk.com/docs/anydesk-for-android | Plugins, capture prompt despite unattended access, ADB workarounds, battery settings and input modes |
| TeamViewer Host listing | https://play.google.com/store/apps/details?id=com.teamviewer.host.market&hl=en&gl=US | Vendor's Android unattended-host positioning and listed capabilities |
| TeamViewer QuickSupport listing | https://play.google.com/store/apps/details?id=com.teamviewer.quicksupport.market&hl=en&gl=US | Attended-support role and foreground app/consent flow |
| TeamViewer attended mobile support | https://www.teamviewer.com/en/global/support/knowledge-base/teamviewer-remote/mobile/provide-attended-remote-support-for-mobile/ | Documented setup, connect by ID and local screen-sharing approval |
| RustDesk Android guide | https://rustdesk.com/docs/en/client/android/ | Share Screen grants/startup, remote IDs, input modes and custom server QR setup |
| RustDesk pricing | https://rustdesk.com/pricing/ | Free self-hosted offering and displayed paid self-hosting plans; explicitly not SaaS pricing |
| droidVNC-NG README | https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/README.md | Capture/control, noVNC, reverse/repeater, boot, encryption warning, OS limits |
| scrcpy README | https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/README.md | ADB-based mirroring/input, prerequisites, use cases and Apache license text |
| scrcpy device options | https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/doc/device.md | Distinguishes stay awake, timeout and display power; not secure unlock |
| scrcpy connection options | https://github.com/Genymobile/scrcpy/blob/a60891aea193d92e7e5c3942700eca63f9d19a5f/doc/connection.md | USB/TCP debugging and connection requirements |
| Vysor landing/pricing | https://www.vysor.io/ | Desktop/web messaging, Share screen/ADB positioning and displayed Pro prices |
| AlfredCamera setup | https://support.alfred.camera/hc/en-us/articles/360039719851 | Viewer/Camera roles, account/QR linking and operating guidance |
| Alfred Android connection tips | https://support.alfred.camera/hc/en-us/articles/4416553672218 | Battery, screen-lock, overlay and OEM setup advice |
| Alfred background/camera errors | https://support.alfred.camera/hc/en-us/articles/360040217771 | Background termination/camera contention and repair advice |
| Alfred Open after Restart | https://support.alfred.camera/hc/en-us/articles/360040099551 | Version-limited restart feature; not extrapolated to all modern Android |
| Shizuku setup | https://shizuku.rikka.app/guide/setup/ | Root/wireless/computer-assisted start, re-arming and OEM limits |
| Tailscale Android installation | https://tailscale.com/docs/install/android | Network-access alternative and Android app/sign-in setup |

AirDroid and Alfred sources were discovered/read through their official
`/api/v2/help_center/articles/search.json` endpoints, including article bodies,
titles and canonical `html_url` fields. Search queries included “unattended
remote control,” “Control Add-on Accessibility,” “android background” and
“set up AlfredCamera.” The canonical articles above are the references to use.

## Pinned public repository material

**2026-10-19 implementation follow-up:** [repos.yaml](../repos.yaml) pins four
ignored local source checkouts, adding Buddy Android to the three repositories
below. [The source comparison](../docs/competitor-implementations.md) records
the inspected paths and immutable anchors; [checkout instructions](README.md)
record the setup and dependency exclusions. No competitor was built, installed
or physically tested. The older hashes below remain documentation evidence.

The same follow-up retrieved AnyDesk's Android guide again and AirDroid's
[Find Phone article](https://help.airdroid.com/hc/en-us/articles/360005115473)
(official help-center article API, ID `360005115473`). The latter documents
Device Administration and Lost Mode; exiting that mode is not evidence of
general Android keyguard/PIN unlock. Official AirDroid help-center searches
for unlock, black, wake and screen off were orientation only; search omissions
were not treated as missing product capabilities. No proprietary internals
were inferred from these articles.

The following heads were obtained through the repositories' GitHub commit API.
The listed files were fetched again at those exact commits and compared with
the moving-branch content initially read. See [source-pins.json](source-pins.json)
for hashes and comparison outcomes. This pins documentation, not tested builds.

| Repository | Exact commit | Material reviewed |
| --- | --- | --- |
| Genymobile/scrcpy | `a60891aea193d92e7e5c3942700eca63f9d19a5f` | README, device and connection docs |
| bk138/droidVNC-NG | `5ec28c925b1df06082059d93bc3a79f89dc3ec13` | README and COPYING |
| rustdesk/rustdesk | `53996e3c404ea5083df0775057e4149e49102084` | LICENCE; the Android guide/pricing are live website sources, not pinned to this client commit |

License text references:
[RustDesk LICENCE](https://github.com/rustdesk/rustdesk/blob/53996e3c404ea5083df0775057e4149e49102084/LICENCE),
[droidVNC-NG COPYING](https://github.com/bk138/droidVNC-NG/blob/5ec28c925b1df06082059d93bc3a79f89dc3ec13/COPYING).
Individual source headers, optional proprietary components and dependencies
need a separate reuse audit. No implementation reuse is selected here.

## Retrieval problems and exclusions

- AnyDesk's pricing page returned HTTP 403. No current numeric price is stated.
- Attempted AirDroid `/personal/pricing/` and `/personal/premium/` and Alfred
  `/pricing/` URLs returned 404. No numeric price or plan limit is inferred.
- A guessed TeamViewer Android article redirected to a category page. It was
  replaced as evidence by the actual attended article and official Host/
  QuickSupport listings; a category redirect does not establish Host details.
- An old Tailscale `/kb/1239/android` address redirected to unrelated user-approval
  documentation. The actual Android installation page was located and used.
- An old guessed FCM direct-boot address returned 404. The current address was
  discovered from Firebase's own navigation and retrieved successfully.

Do not treat a successful HTTP response as evidence that a guessed URL still
contains the expected article. A blocked price page is a research limit, not
a reason to fill in remembered pricing.

## Sibling and conversational evidence

[Sibling repositories](../docs/sibling-repositories.md) lists the local committed
baselines and exact files used for orientation/evidence. Device claims in those
documents retain their original scope; none is a physical acceptance of this
standalone product. Machine-private inventories, selectors, credentials and
captures were not copied.

The product/use-case history comes from the owner's brainstorming: an RV phone,
an Anker battery/solar check, possible camera/automation use, and manual recovery
when YA Android-host AI authentication is unavailable. Brand, implementation,
architecture and pricing remain open. This repository creation/research commit
is authorized; an earlier withdrawn YA implementation plan is not a design
decision for this app.

## Follow-up evidence still needed

Actual competitor onboarding and checkout, manufacturer/device compatibility,
protected-auth behavior, same-phone ADB preparation, push/Doze/force-stop/reboot
experiments, relay costs, usability sessions and any store submission outcome
remain unverified. Recheck live policies, prices and platform docs when choosing
an implementation or publishing product claims.
