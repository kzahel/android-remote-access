# Product inspiration and use cases

Research notes, 2026-10-18. These are user motivations, hypotheses and open
decisions, not a committed feature roadmap. [Platform limits](android-platform.md)
and [competitive evidence](competitors.md) constrain what can be promised.
The product-family direction below was recorded on 2026-10-20; the name was
adopted on 2026-10-21.

## Product direction: YepControl

**Proposal, 2026-10-20:** the owner asked to record YepControl as the proposed
direction after discussing its relationship to YepAnywhere and Machine Control.
**Decision, 2026-10-21:** YepControl is the product name, and the Android app
and browser viewer use it. The application ID is `com.yepcontrol.app`, selected
during the owner-requested 2026-10-21 domain cutover. Repository and Kotlin
package names keep their working names. The roles of Machine Control and
YepAnywhere below remain proposals, not a repository merger or integration.

| Name | Proposed role |
| --- | --- |
| YepControl | Public device-access/control brand, beginning with this standalone Android app and browser viewer. |
| Machine Control | Reusable control toolkit, native platform implementations and CLI; its desktop app could gradually adopt YepControl branding. |
| YepAnywhere | Agent sessions, projects and supervision, including the experimental Android-host distribution that runs agents on the phone. |

**YepControl — Remote Phone** is a candidate first Play listing name. Broader
branding leaves room for computer/device control as those product experiences
are implemented and qualified. Existing Machine Control repository and command
names can remain compatible during a partial public rebrand. The owner
registered yepcontrol.com on 2026-10-21 and requested its use for the hosted
service and HTTPS pairing links; see [App Links](app-links.md).
The final listing name and any desktop rebrand are still open; none of this
authorizes publication.

### Shared Android capabilities

Prefer one reusable implementation of Android device primitives in Machine
Control's existing Android platform area, exposed through a focused Kotlin
module where appropriate. Candidate extractions from this app include
wake/keyguard observation, supported keypad discovery, accessibility input,
guarded one-attempt PIN delivery and attempt-state handling, together with
their meaningful regression/acceptance tests.

Machine Control's existing ADB helper and this app's accessibility route have
different authorities and operating limits. Preserve those provider distinctions
and qualify each consumer instead of assuming identical behavior. Extraction
should follow a concrete integration that proves reuse. The browser viewer,
consumer pairing, hosted relay and Play onboarding remain this product's work.

Each consumer retains its own grants and credential custody. Sharing a library
does not share a saved PIN, authorize an agent to unlock a phone, or transfer a
browser's unlock permission to another application. Phone-local saved-PIN
storage, local forgetting, one-attempt behavior and first-unlock limits remain
explicit product requirements.

### Relationship to YepAnywhere Android host

The experimental [Android host](../../yepanywhere/topics/android-host.md)
runs YepAnywhere and provider processes on the phone. It is a related consumer
of native device capabilities, alongside this app's manual remote-control
experience. A concrete complementary use is reaching the phone to repair a
provider sign-in or inspect a stalled host when an agent cannot help.

Shared native capabilities and later product entry points are possible. The
integration mechanism and APK packaging remain open. This proposal does not
make the phone viewer depend on a YA session, AI account, Alpine/PRoot runtime
or subscription, and it does not add autonomous phone control to this product.
See [sibling relationships](sibling-repositories.md#yepcontrol-relationship).

The proposed sequence is to develop the Android product under YepControl,
extract reusable Android capabilities with an actual Machine Control consumer,
and consider gradual desktop branding afterward. These are proposed follow-ups,
not changes implemented by recording this direction.

## The originating problem

The owner previously left an Android phone in an RV and wanted to check the
large Anker power station's battery level over Bluetooth, including solar
charging. Remote-desktop apps were difficult to get working and some asked for
payment. The exact phone, power-station model, app versions and failure causes
are not known; this recollection motivates research, not a finding that no
existing product works.

Android-host and Buddy's accessibility approach suggested a new possibility:
an ordinary phone can expose screen observations and actions, while optional
ADB offers stronger device administration. But asking an AI to operate the
phone introduces an unnecessary dependency: its login, subscription or inference
service can fail. Manual remote access would remain useful in that failure.

The central job is: **“Let me use the phone I left somewhere, and tell me before
I leave whether I'll actually be able to reach it.”** YepControl is the
consumer brand within the related product family described above.
YA auth repair is a complementary use case; integration remains proposed and
does not define the market boundary.

## Use cases and evidence of success

| Use case | What the person wants to do | Useful proof | Important boundary |
| --- | --- | --- | --- |
| RV power/solar check | Open the battery vendor's app and read charge/input watts | Read fresh values remotely with no person at the RV | Phone must remain near the battery; model/protocol/cloud support varies |
| Repair a remote app login | Open the app/browser, enter credentials and complete the supported authorization flow | Recover access while the original AI/provider login is unavailable | Some auth screens block capture/input; MFA may require another device or local approval |
| Reach a dedicated Android host | Navigate Android settings or restart/reconfigure an app | Perform an allowed recovery without starting an agent | Cannot recover its own force-stopped process by assuming that same process is running |
| Repurpose a phone as a camera | Check the RV/room/vehicle using an existing camera app, or a later native camera feature | Open the intended view over the real mobile uplink | Camera access is separate from screen capture and has background/while-in-use restrictions |
| Recover a simple automation | Inspect a stalled task or Bluetooth app and manually repair it | Resume the task and observe the real effect | Generic remote control does not guarantee the task's background execution |
| Help with someone else's phone | Explain a permission or repair an app during a consented session | Clear session consent and immediate local Stop | Attended support has a different trust model from owning an unattended phone; later candidate |

For the RV, direct battery telemetry is a possible alternative to remote UI:
read Bluetooth GATT or a supported vendor/cloud API and show battery percentage,
charging watts and alerts. It may be more efficient, but it is a separate,
model-specific integration. Do not promise arbitrary Anker BLE support or make
it a prerequisite for generic phone access.

## Desired qualities

- Manual access works without an AI account, model provider or agent session.
- Everyday setup describes outcomes: see the screen, control it, reconnect, and
  optionally recover from a lock. ADB terminology belongs in advanced detail.
- Pair a trusted viewer clearly, with a readable phone name and a real test.
- A connection works through normal consumer networks, including carrier NAT;
  direct-only transport is insufficient as a universal promise.
- Readiness is observable. “Online” must not imply “screen accessible” or
  “unlock available.” Show what needs fixing while someone is still nearby.
- Local owners can see and stop access. Remote viewers can be removed.
- Paying should not be necessary merely to discover that a phone's protected
  screen cannot be controlled. The pricing model itself is still open.
- An owner should understand what reboots, unplugging, app updates and local
  force-stop will do before relying on a phone left unattended.

## Candidate access levels, not selected packaging

**Basic access:** an explicitly enabled native app provides remote viewing and
input while the necessary Android permissions and screen state allow it. The
phone can be left charging/already unlocked as an operational choice, with
honest limits. Accessibility screenshots versus MediaProjection remain a
technical decision requiring experiments.

**Prepared recovery:** optional guided ADB or another legitimate shell-privilege
route supports stronger wake/input and known-PIN entry. It must explain how it
is armed, whose ADB key is authorized, and whether it survives reboot/network
changes. Remembering a PIN is a separate choice from enabling remote access.

**Dedicated appliance:** a spare phone deliberately configured for long-running
use may be easier to support than a person's primary phone. Device-owner/kiosk
provisioning could offer different controls, but enrollment/reset requirements
may make it unsuitable for an approachable ordinary app. This is an alternative
to assess, not a selected requirement.

These levels could be capabilities within one app rather than separate paid
tiers. A technical privilege level must not be confused with a subscription.

## Open product decisions

1. Is the initial audience people repurposing spare phones, owners of remote
   Android workloads, or general remote support? The RV/spare-phone scenario
   currently provides the clearest unattended-access motivation.
2. Is basic still-frame control sufficient, or does smooth video materially
   change usefulness? Start with task completion measurements, not a codec.
3. Does a computer-assisted preparation step fit the consumer promise? Can a
   helper make it understandable, and what happens after the next reboot?
4. Can actual secure unlock work on the chosen OS/OEMs without keeping the
   device insecure? This is a feasibility gate, not just a UI checkbox.
5. What is the smallest trustworthy pairing/account system? Account sign-in,
   key-based pairing, discovery and ongoing control authority are distinct.
6. Should camera/telemetry be native features or simply uses of other apps?
7. Which Android versions, Google-services configurations and OEMs are worth
   supporting? Do not inherit YA's version floor automatically.
8. Is distribution Play-first, direct APK, or both? Store policy and background
   behavior must be evaluated for the actual implementation.
9. What can be free, what costs relay bandwidth, and what is the fair consumer
   price? No pricing or subscription commitment has been made.

## What would justify implementation

The later authorized [emulator spike](spike.md) supplies initial implementation
evidence for a subset of these questions. It does not select a product
architecture, pricing, distribution or supported physical-phone range.

A small set of device experiments should establish capture after lock,
known-PIN delivery, process recovery and carrier-network reachability before
promising unattended availability. A documented prototype can be useful even
if it proves that only a dedicated-phone mode is viable. See the
[validation questions](android-platform.md#experiments-that-would-resolve-the-main-unknowns)
and [UX studies](ux.md#research-to-do-before-promising-ease-of-use).
