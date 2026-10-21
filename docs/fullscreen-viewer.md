# Fullscreen web viewer

The live viewer's **Fullscreen** button expands the remote screen on mobile and
desktop. Back, Home and Recents stay visible in a bottom navigation bar beside
**More controls** and **Exit fullscreen**. More controls contains screen wake,
lock, quality, typing/app launching and disconnect. The image preserves its
aspect ratio and fits above the bar; status and repair messages stay visible.
Client control-label preferences continue to apply.

The browser Fullscreen API is requested directly from the user's button press.
If unavailable or rejected, the viewer uses the same layout within the visible
browser viewport; browser chrome may remain. Safe-area padding accommodates
display cutouts and the local home indicator where the browser exposes them.

The client device's system Back gesture remains controlled by its OS/browser.
When the browser exits fullscreen, the viewer returns to its ordinary layout
without reconnecting or issuing remote Back. Use the bottom **Back** button to
navigate on the remote phone. Escape also exits the viewport fallback. These
transitions release held remote input; they do not promise rollback of an action
already delivered. Disconnect or removal of the live viewer exits native
fullscreen. No history entries or automatic fullscreen re-entry are used.

## Verification

`pnpm test:viewer-layout` uses an isolated Playwright Chromium and synthetic
session, with no physical device or relay. It exercises native fullscreen,
unsupported-API and rejected-request fallback at desktop, wide desktop, mobile,
small mobile and landscape viewport sizes. It checks bottom navigation, contained
image aspect, remote navigation without fullscreen exit, quality-dialog access,
the same canvas across transitions, held-input release on external fullscreen
exit, dialog-first fallback Escape, fallback button exits, labeled bottom-bar
touch targets, native fullscreen cleanup on unmount and restored ordinary
geometry. Screenshots and results stay under ignored `.local/viewer-layout-proof/`.

This is automated Chromium evidence. It does not qualify physical OS edge
gestures, iPhone/Safari behavior or every mobile browser. The browser's exit
authority and user-activation requirement follow the
[Fullscreen standard](https://fullscreen.spec.whatwg.org/#ui) (reviewed
2026-10-21); the exact local gesture remains browser/platform behavior.
