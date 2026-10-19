# Android Remote Access

Research for an approachable, standalone way to reach an Android phone left
somewhere else. The repository name is a working name, not a chosen brand.

The motivating example is an old phone in an RV: open the battery vendor's app
and check whether solar is charging the big power station. Other examples are
using the phone as a camera, recovering an app login, and operating a dedicated
phone without visiting it physically.

**Stage: research plus emulator and USB-connected phone prototypes.** The
[manual-access spike](docs/spike.md) is experimental; its acceptance evidence
does not establish consumer readiness. This project is
independent of Yep Anywhere (YA) and must work without AI subscriptions or an
agent being signed in. Repairing YA Android-host authentication is one useful
test case, not the product's identity.

- [Run the emulator demo](spike/README.md)
- [Control an attached phone](docs/phone-spike.md)
- [Continuous touch and smooth-view experiment](docs/touch-spike.md)
- [Product inspiration, use cases and open decisions](docs/product.md)
- [Production plan: gates, architecture and phases toward a Play release](docs/production-plan.md)
- [Android capabilities, unlock, wake and background reliability](docs/android-platform.md)
- [Competitors and alternatives](docs/competitors.md)
- [UX analysis and research questions](docs/ux.md)
- [Relevant sibling repositories and reuse boundaries](docs/sibling-repositories.md)
- [Sources, review method and evidence limits](research/SOURCES.md)
- [Instructions for future agents](AGENTS.md)

Initial research: **2026-10-18**. It uses official platform documentation,
vendor support material, public project documentation and selected sibling
repository evidence. It is not a hands-on competitor test or a phone experiment.

The most consequential findings are that screen capture, input, waking the
process, waking the display and unlocking are separate capabilities; FCM and
background permissions do not combine into an unconditional availability
guarantee. See the platform analysis before choosing an implementation.
