# Continuous touch experiment

Authorized 2026-10-19: extend the emulator demo with finger-following scrolling,
slider dragging and two-finger zoom/rotation, paired with a smoother screen feed.
Keep physical-phone settings and Internet deployment outside this experiment.

## Acceptance

- Browser Pointer Events preserve distinct fingers and curved movement. Send
  bounded, ordered accessibility continuation batches while fingers are down.
- A native slider changes before lift-off; two fingers change scale and rotation
  together; adding/removing a finger preserves the remaining contact.
- Verify effects through Android fixture state and native MotionEvents, not just
  a drawn browser cursor. Exercise scrolling in ordinary Android UI too.
- Release held contacts on viewer loss, pause, interruption, timeout and Stop;
  refuse stale, malformed, out-of-order or competing streams. Never replay.
- Test a consented MediaProjection/MediaCodec screen feed, preserve still-view
  fallback and distinguish capture consent/revocation from input authority.
- Use managed Chromium touch injection and record its limitations. A physical
  touchscreen-browser result requires an actual hardware trial.

## Platform references

Reviewed 2026-10-19, platform source/documentation:

- [GestureDescription, Android 16 release](https://github.com/aosp-mirror/platform_frameworks_base/blob/android-16.0.0_r1/core/java/android/accessibilityservice/GestureDescription.java):
  immutable scheduled paths, continuation and runtime stroke limits. No pressure
  or stylus fidelity claim. A continuation must start at the previous endpoint.
- [AccessibilityService](https://developer.android.com/reference/android/accessibilityservice/AccessibilityService#dispatchGesture(android.accessibilityservice.GestureDescription,%20android.accessibilityservice/AccessibilityService.GestureResultCallback,%20android.os.Handler)):
  dispatch can cancel existing touch. This is not unrestricted MotionEvent input.
- [MediaProjection](https://developer.android.com/media/grow/media-projection):
  visible consent, foreground-service type and one capture session per consent.
  Android 15 QPR1+ stops projection on lock; do not silently re-authorize it.
- [Pointer Events](https://www.w3.org/TR/pointerevents3/): pointer identities,
  capture and cancellation. Browser/OS-reserved gestures remain separate.

Implementation and measurements will be recorded here after verification.
