# Hosted pairing and encrypted relay acceptance

Implemented and tested 2026-10-20. This extends the first
[crypto slice](crypto-proof.md) with the [enrollment/routing contract](pairing-relay-v1.md).
It is a hosted development service, not consumer phone-control acceptance or an
independent security review. Concrete infrastructure and operations are in the
private dotfiles `runbooks/android-remote-access.md`.

## Delivered

- TypeScript relay with bounded JSON/WebSocket ingress, challenge signatures,
  exact pairing/role routing, bounded queues, disconnected-peer rejection,
  terminal circuit teardown and persistent revocation tombstones.
- QR enrollment that keeps the bootstrap secret at endpoints, verifies a
  phone-signed/HMAC offer and browser-signed confirmation, and pins exact peer
  identities. The relay cannot synthesize a fresh trusted phone offer.
- React viewer with a non-exportable signing identity stored in IndexedDB,
  rendered QR, durable phone pin, encrypted connection check and local forgetting.
- Kotlin foreground host with Keystore identity, normal scanner/deep-link entry,
  explicit Grant, durable browser pin, connection check and phone-side removal.
  Local revocation blocks reconnect even when hosted removal has not completed.
- Hosted web and relay service, exact-revision package deployment, candidate
  smoke test, public DNS/TLS/WSS, service isolation, rollback, encrypted authority
  backup and a non-destructive restore drill. Operator-specific files belong
  to dotfiles rather than product source.

## Measured acceptance

Real Playwright Chromium on macOS ARM64 and an owned API-35 Google APIs ARM64
emulator reached the deployed Linux ARM64 relay through public HTTPS/WSS.
No ADB reverse/forward or local test bridge carried their relay traffic.

| Check | Result |
| --- | --- |
| TS protocol and adversarial relay tests | 47 pass (35 crypto + 12 relay) |
| Kotlin JVM crypto tests | 11 pass |
| Preserved prototype tests | 19 pass |
| Web/relay build, TS checking, Biome, ktlint, Android lint/APKs | Pass |
| Rendered QR screenshot decoded | Pass; no direct DOM payload shortcut |
| Normal Android pairing intent and Grant button | Pass |
| E2E message through public relay | Pass, including fresh reconnect: 2 encrypted exchanges |
| Android process restart + browser page reload | Both retain paired keys and reconnect |
| Phone-side removal | Durable relay revocation; subsequent browser connection rejected |
| Native instrumentation | Two passing invocations (pair, then reconnect/revoke) |
| Owned emulator/browser cleanup | Pass |
| Pi candidate and public health | Pass, exact deployed revision |
| Encrypted authority backup / isolated restore | Pass, including revoked tombstone |
| Binary rollback and return to current | Pass; exact authority digest preserved |

The real native run caught two integration details: default Android button
labels are transformed to uppercase (acceptance now selects stable resource IDs),
and OkHttp sends JSON with a charset parameter (accepted with a regression test).
Shared algorithms alone would not have established this application interoperability.

Run after installing the documented build/emulator prerequisites:

```sh
pnpm build
pnpm build:android
HOSTED_ORIGIN=https://YOUR_DEVELOPMENT_ORIGIN pnpm test:hosted
```

Private QR images, instrumentation logs and result JSON stay under ignored
`.local/hosted-proof/`. The URI enters through the same enrollment boundary as
the scanner; the test automates the ordinary Grant action. It does not exercise
camera optics, Play-services scanner module download or real-phone ergonomics.

## Remaining boundaries

The Android host supports one paired browser. The original pairing acceptance
uses a foreground connection; the subsequent [FCM slice](fcm-wake-v1.md) adds a
bounded background connection check after real push delivery. The only encrypted
application operation is a fixed connection check, not a general command handler. Durable
pairing metadata contains public authority; private signing keys stay in their
platform stores. The relay sees routing, timing and sizes and can deny service;
compromised hosted viewer JavaScript remains an endpoint compromise.

This original pairing run does not qualify FCM. The subsequent
[FCM acceptance](fcm-wake-v1.md#verification-and-measured-acceptance) establishes
real native receipt and an authenticated session with the process/socket initially
absent. WebRTC, capture/input, PIN entry, indefinite foreground-service lifecycle,
physical-camera acceptance, natural idle/reboot qualification and Play submission
remain outside these measured slices. Follow with authorized physical
Doze/overnight qualification.
The deployment's backups and backup key currently share a host; off-host
recovery is separate operator work. This protocol composition remains subject
to independent review before a consumer release.
