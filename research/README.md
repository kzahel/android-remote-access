# Pinned implementation references

[repos.yaml](../repos.yaml) is the tracked inventory. `references/` is ignored:
source checkouts are research material, not submodules, production dependencies
or APK inputs. The [implementation comparison](../docs/competitor-implementations.md)
records what was actually inspected. Proprietary products are documentation-only
entries; do not substitute unofficial APK/source mirrors.

For each `checkouts` entry, use its literal repository URL, revision and path:

```sh
git init references/NAME
git -C references/NAME remote add origin REPOSITORY_URL
git -C references/NAME fetch --depth=1 origin EXACT_REVISION
git -C references/NAME checkout --detach FETCH_HEAD
git -C references/NAME rev-parse HEAD
git check-ignore references/NAME/
```

The four checkouts were populated this way on **2026-10-19**. Compare HEAD to
the manifest before reviewing. Do not silently update to a branch head; a new
review should update the pin and evidence together. Existing checkouts should
be inspected for local edits before checkout. Builds, dependency installation,
submodule initialization and phone installation are not part of this setup.
In particular RustDesk's `libs/hbb_common` submodule was not fetched/reviewed.

Source links in the report use immutable GitHub commit URLs so evidence remains
usable without local clones. A source review establishes a mechanism, not its
physical reliability or current store acceptance. Review exact component and
dependency licenses before reuse. Keep captures, logs and private device data
under `.local/`, never in the manifest or tracked research.
