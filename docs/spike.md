# Manual-access emulator spike

Authorized 2026-10-18: build a working demo, test emulator screen lock/unlock,
and commit milestones. Physical-phone setup and lock changes are outside this
spike. This is implementation evidence gathering, not a product architecture
or distribution decision.

## Completion criteria

- A browser can view and manually operate a native Android fixture through an
  outbound app connection, without ADB forwarding or shell input in that path.
- Simple navigation, pointer gestures, text editing and honest readiness are
  useful before opening optional diagnostics.
- Separately measure process reachability, display wake, keyguard state,
  capture and input. Exercise secure lock and a disposable known credential on
  an isolated emulator. No credential in Git, arguments or captured evidence.
- Demonstrate reconnect, revocation and protected-screen refusal. Never replay
  an uncertain action or credential automatically.
- Provide repeatable setup, meaningful live acceptance and a reviewable demo.

## Implementation sequence

1. Native accessibility host, outbound authenticated demo transport and fixture.
2. Browser controller with core controls and optional diagnostics.
3. Emulator lock/unlock experiments, regression acceptance and visual review.
4. Document measured limits and reproducible demo commands.

## Source references

Buddy Android at `ffd2ec84c7498c9e10e22889b4f4d1f52c293e18`:
[Tools.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/Tools.java),
[McpServer.java](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/java/app/buddy/assistant/McpServer.java),
and [accessibility configuration](https://github.com/ghorbelhamdi/buddy-android/blob/ffd2ec84c7498c9e10e22889b4f4d1f52c293e18/app/src/main/res/xml/accessibility_config.xml).
Reviewed for screenshot/gesture/text primitives and the native API boundary.
Machine Control's resident spike supplies evidence about fixture verification
and independent effect observations. No upstream code, binaries, fonts or icons
are copied. The spike uses Android SDK and Node built-ins.

## Results

Pending implementation and emulator acceptance.
