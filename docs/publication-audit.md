# Public source audit

Reviewed **2026-10-21** before the owner-requested public/MIT transition.
The audit covers the 114 commits reachable from all local Git refs through
`336f27d`, not only the working tree. Private raw reports stay in `.local/`.

- Gitleaks 8.30.1 scanned all history with redacted reporting: two findings,
  both reviewed public inputs. `android/app/google-services.json` contains
  Firebase's public Android client identifier/API key, not IAM credentials.
  The actual cloud configuration was checked: the auto-created Android key is
  restricted to Firebase-related APIs, with no Gemini Generative Language API.
  The other finding is an encryption output in the deterministic public
  `protocol/vectors/session-v1.json` fixture. Its private test scalars are 1–4
  and the file explicitly prohibits application use.
- A separate history search reviewed home paths, SSH commands, email addresses,
  private/LAN/tailnet addresses and deployment hostnames. Matches were the
  historical public development hostname, standard Android emulator gateway,
  documented CGNAT range, synthetic test IP, and preserved upstream copyright
  contact. No concrete private device selector, operator home path, server
  inventory or SSH target was found. Ordinary Git author attribution remains.
- All tracked paths and Git symlinks were inspected. Symlinks point to the
  preserved repository-local spike assets. Credentials, runtime state, captures,
  recordings, local SDK config, downloaded reference repositories and build
  output remain ignored. No service-account JSON, upload keystore, real lock
  credential, ADB key or production session key is tracked.
- Machine-specific deployment, service-account/signer inventory and tester
  contacts remain in private operational configuration. Public product endpoints
  and Firebase client configuration are deliberately public.
- The root MIT license covers project-owned source. Existing WebRTC, Chromium
  third-party and ZXing notices retain their original terms. Research references
  listed in `repos.yaml` are ignored checkouts, not copied dependencies.

`.gitleaks.toml` extends the default rules and scopes each reviewed exception
to its particular rule and file. It does not ignore commits, private credential
formats, all test data or the Android source tree. Reproduce with:

```sh
gitleaks git . --redact --log-opts=--all
```

This is a publication exposure check, not an independent cryptographic or
application security audit. See [the protocol](crypto-session-v1.md) and
[remaining release qualification](production-plan.md#gates-before-broad-release).

Sources: [Firebase client keys are public by design](https://firebase.google.com/docs/projects/api-keys)
and [Gitleaks scoped allowlists](https://github.com/gitleaks/gitleaks/blob/v8.30.1/README.md#configuration).
