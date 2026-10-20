# Direct transport decision

Implementation direction, reviewed 2026-10-20. Direct data channels carry the
same bounded application commands/media as the hosted fallback. Signaling goes
inside the established encrypted relay session, so it needs no separate PeerJS
server or new signaling identity. No TURN server is configured or operated.
Google's public STUN service is a best-effort discovery dependency; it sees
network addresses, not application records. Failed setup keeps the relay usable.

A direct lane performs a **fresh** pinned-identity E2E handshake. It never reuses
the relay's record key or nonce stream. An upgrade happens between commands,
releases old held input and creates a new control-session owner. Direct loss
releases input/capture; fallback starts a fresh control owner and does not replay
the interrupted command. Projection consent is not carried across owners.

Reliable ordered SCTP messages use bounded 16 KiB fragments, one record assembly,
a 1 MiB record limit, exact offsets and a five-second partial-record deadline.
Control and video stay serialized and bounded. The relay remains the authority
and fallback connection during a direct session; an idle application does not
need a persistent connection. Direct connectivity is best effort across NATs.

## Native dependency review

Selected component: Maven Central `io.github.webrtc-sdk:android:150.7871.01`,
not a sibling APK/native library. POM declares BSD-3-Clause; the packaging
repository has an additional MIT license. Pinned packaging source:
[`7b6390fb`](https://github.com/webrtc-sdk/android/tree/7b6390fb098303b31af76906bf15f7decaa4ef95),
[release](https://github.com/webrtc-sdk/android/releases/tag/v150.7871.01),
[exact POM](https://repo.maven.apache.org/maven2/io/github/webrtc-sdk/android/150.7871.01/android-150.7871.01.pom).
Downloaded Maven AAR SHA-256:
`0a1627b1a48c2bc17d9a40d62fc47bd45166f44a311e95917f147c402de379b0`.
It contains Java classes and `libjingle_peerconnection_so.so` for four ABIs;
no notices are embedded in the AAR. The pinned component's complete upstream
[notice bundle](https://github.com/webrtc-sdk/android/blob/7b6390fb098303b31af76906bf15f7decaa4ef95/Licenses/WEBRTC.md)
and packaging MIT license are therefore included as APK assets in `third-party/`.
The bundle records individual third-party terms; the repository's MIT license
alone is not treated as licensing the native dependencies. This is a component
and notice review, not a comprehensive legal or security audit. Distribution
review remains a release gate. No audio/video tracks or native WebRTC codecs
are used: H.264 is produced by Android MediaCodec and stays application-encrypted.
Native internal tracing and info-level logging are disabled.
