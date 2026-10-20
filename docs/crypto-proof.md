# First production slice: paired crypto interoperability

Implemented and locally tested **2026-10-20**. The [wire specification](crypto-session-v1.md)
was written and self-reviewed before implementation. This is a bounded
cryptographic interoperability proof, not independent security certification,
consumer phone-control acceptance or a production relay deployment.

## Delivered

- Preserved the Java/JS remote-control prototype under `spike/`, with its own
  package lock, Android project and acceptance runners. Its private state
  remains root `.local/`, reached through an ignored symlink. Temporary root
  server/asset compatibility paths keep pre-move phone demos running.
- Established strict TypeScript, React/Vite, Vitest, Biome and a pnpm workspace;
  established a Kotlin protocol library and Android Keystore adapter with
  a checksum-pinned Gradle wrapper, lint and ktlint. Root commands build, check
  and test the new code. CI is configured; no hosted CI result is claimed yet.
- Implemented a fixed binary, mutually authenticated P-256 ephemeral exchange,
  directional HKDF-SHA256/AES-GCM records, key confirmation, bounded key usage,
  terminal error behavior and local current-authority checks.
- Checked in conspicuously synthetic vectors for transcript, P-256 agreement,
  signature verification, key derivation and exact record bytes. Scalar 1..4
  fixture keys are public test inputs, never an application identity.
- Added a small React development harness and a loopback forwarding runner.
  Only the instrumentation APK contains the native test HTTP bridge; the
  application APK has no server, remote-control operations or test Activity.

## Local acceptance

macOS ARM64, JDK 17, Node 26.7.0, Chromium from Playwright 1.58.2; Android
API 35 Google APIs ARM64 emulator, explicitly created and owned by this runner.

| Check | Result |
| --- | --- |
| Preserved spike host tests | 19 pass; revocation assertion fixed to await durable asynchronous persistence |
| TypeScript adversarial/vector tests | 35 pass |
| Kotlin JVM adversarial/vector tests | 11 pass |
| Web/protocol build, TS checking, Biome | Pass |
| APKs, Android lint and ktlint | Pass |
| Real Chromium → Android Keystore exchange | Pass: 3 confirmed Unicode/binary exchanges, fresh reconnect, 6 expected browser/native rejections |
| Native identity storage | Private key reports no export encoding; reload retains the same public identity; disposable alias deleted afterward |
| Forwarder observation | Forwarded 24 fixture requests, 2,846 request bytes; plaintext application canary absent from record requests |
| Resource cleanup | Owned browser/emulator terminated and owned ADB forward removed; no shared ADB server killed |

The six live negative cases are native replay, altered ciphertext, old-session
ciphertext, a forged phone signature at the browser, a revoked native channel,
and a revoked native handshake. Unit suites additionally cover malformed
headers/points, wrong identities/scope, directional reflection, altered proofs
and key confirmation, oversize frames, concurrent encryption and revocation
across asynchronous work. The maximum binary frame is exercised in both
implementations. The forwarder's canary observation is a smoke check; the
security argument comes from endpoint key ownership and authenticated record
construction, not from failing to find a particular string in ciphertext.

Run from root:

```sh
pnpm build
pnpm test
pnpm lint
pnpm format:check
pnpm build:android
pnpm exec playwright install chromium
pnpm test:interop
npm --prefix spike ci --ignore-scripts
pnpm test:spike
```

Private reports/logs are under `.local/crypto-proof/`. The runner refuses an
occupied selector/port and never selects a physical phone. Its API-35 image
architecture follows the host CPU. GitHub CI's optional manual interop job
installs the x86_64 image and enables KVM; that environment is configured but
not locally measured here.

## Remaining boundaries

Pinned identities are provisioned by the trusted test harness. Production QR
enrollment and persistent browser phone-key pins are not implemented in this
slice. Authority is an in-memory fixture predicate; a durable registry must
supply exact-generation/identity/expiry checks and active session cancellation.
The test bridge is not the relay protocol or a production enrollment endpoint.
There is no FCM, WebRTC, phone capture/input, PIN entry, saved credential,
public listener, production deployment or Play submission in this slice.

The suite is an experimental protocol composition built on standard primitives.
Independent security review, protocol compatibility/version rollout, session
expiry/rekey orchestration, transport replacement and smooth-media protection
remain required before production. Hosted JavaScript and compromised endpoints
remain in the trust boundary. No sibling implementation code was copied.
