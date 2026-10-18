# Relevant sibling repositories

Read-only review, 2026-10-18. Paths are relative to this checkout's expected
parent (`~/code`); use them as navigation, not installed-product requirements.
No sibling was modified for this research. Working trees may contain newer,
uncommitted work; revision pins identify the committed baseline only.

| Sibling | Reviewed baseline | Relevant material | Reuse boundary |
| --- | --- | --- | --- |
| [machine-control](../../machine-control/) | `9b0c532` | Android ADB adapter, protected known-PIN route, resident accessibility spike, native operation/grant lifecycle | Most relevant source of reusable device primitives; its agent interface and desktop product need not become this product's UX |
| [yepanywhere](../../yepanywhere/) | `c52e07e39` | Android-host lifecycle, native setup, provider-auth recovery use case, encrypted remote access, device streaming and push broker | Inspiration/components only; this product is not a YA feature and does not need its provider runtime |
| [jstorrent](../../jstorrent/) | `fe4be51c` | Standalone native Android product, foreground/background lifecycle, remote access/pairing and hosted controller UX | Study concrete product/setup lessons, permissions and lifecycle; do not import the torrent engine |
| [agent-auth-router](../../agent-auth-router/) | `263bbf2` | Inference authentication infrastructure and the failure mode that motivates manual repair | Context only; no inference service should be a runtime prerequisite |
| [web-server-chrome](../../web-server-chrome/) | Unpinned orientation reference | Android bootstrap, simple user-facing server setup and private native bridging | Candidate for a focused later source review; no implementation acceptance claimed here |

## Buddy Android: primary phone-resident reference

[Buddy Android](https://github.com/ghorbelhamdi/buddy-android/tree/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18)
is an external reference checked out under YA's ignored `references/` directory,
not a direct sibling or a required runtime dependency. Its native accessibility
screenshots, gestures and focused-field editing, with a local API boundary, are
especially relevant to this standalone manual-access spike. See the pinned
[YA source review](../../yepanywhere/docs/competitive/buddy.md) and
[spike provenance](spike.md#source-references).

The app declares Apache-2.0; bundled assets/native components have separate
terms. We reviewed the native control and API code without importing Buddy code,
binaries, art, Alpine/PRoot, provider CLIs or its agent loop. The current spike is
an independent implementation of Android SDK primitives. This review does not
establish Buddy's unattended, secure-unlock or reboot behavior.

## Machine Control entry points

- [Android platform guide](../../machine-control/platforms/android/README.md):
  exact-device ADB readiness, wake/dismiss, known-PIN path and prerequisites.
- [Android family topic](../../machine-control/topics/android-family-control.md):
  platform boundaries, native operations and remaining acceptance gaps.
- [Platform/API research](../../machine-control/research/platforms/android.md):
  ADB versus app-resident authority and phone-local experiments.
- [Resident spike](../../machine-control/platforms/android/resident-spike/README.md):
  a native AccessibilityService, a bounded grant, fixture-scoped semantic control
  and inline screenshots. Real local Codex/Claude runs were accepted there;
  remote/background/reboot/general-app control was not.
- [Protected unlock work](../../machine-control/docs/tactical/016-device-readiness-and-android-unlock.md):
  one-shot PIN delivery over private stdin, readiness/credential/wipe-policy
  checks and independent effect observation. Correct-PIN physical acceptance
  remains explicitly open in the reviewed record. Do not claim it already
  solves consumer unlock.

MC's existing unlock controller builds a helper using a JDK/Android SDK. That
is not proof the same route can run phone-locally in an ordinary APK. A product
would need deliberate helper packaging or another audited native integration.

## Yep Anywhere entry points

- [Android-host contract](../../yepanywhere/topics/android-host.md) and
  [host package](../../yepanywhere/packages/android-host/README.md): user-started
  foreground service, native state, sign-in shortcuts and explicit lifecycle
  limitations. The host runs provider CLIs in Alpine/PRoot. This standalone app
  has no established need for Alpine, Node or an agent runtime.
- [Manual stream client](../../yepanywhere/packages/client/src/pages/EmulatorPage.tsx),
  [input/video component](../../yepanywhere/packages/client/src/components/EmulatorStream.tsx)
  and [device bridge](../../yepanywhere/packages/device-bridge/): Android hardware
  capture and a WebRTC/manual-input path, independent of AI inference.
- [Existing streaming design](../../yepanywhere/docs/project/android-emulator-remote-control.md):
  signaling uses YA transport; video is direct WebRTC with STUN and no TURN
  fallback in the reviewed source. That is a networking limitation to resolve,
  not a complete consumer remote-access architecture.
- [Push contract](../../yepanywhere/topics/android-fcm-push.md): credential-free
  generic notification delivery, revocable subscriptions and native lifecycle
  tests. It is not acceptance of remote phone wake or secure unlock.
- [Buddy research](../../yepanywhere/docs/competitive/buddy.md),
  [Shizuku research](../../yepanywhere/docs/competitive/shizuku.md) and
  [Termux research](../../yepanywhere/docs/competitive/termux.md): pinned upstream
  studies with policy/provenance boundaries. Consult original sources before
  adopting components; Buddy's AI harness is not needed for manual access.

## Licensing and ownership

MC and JSTorrent declare MIT in their repository documentation; examine exact
files and bundled component notices before copying. Review YA's current license
and every extracted component rather than inferring rights from common ownership.
RustDesk, droidVNC-NG, scrcpy and Shizuku have different upstream licenses; see
the competitor analysis. No upstream code, APK, artwork, credentials, device
inventory or generated state has been copied into this repository.

Use the common MC CLI and platform guides for future machine tests, with private
target selection kept outside Git. Read each sibling's AGENTS.md/local rules
before any edits or device work. Shared Git history is not authorization to
rewrite an unrelated working tree.
