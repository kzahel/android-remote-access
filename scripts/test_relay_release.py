#!/usr/bin/env python3
"""Release provenance, byte integrity and staging boundary regressions."""
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from deploy_relay_staging import configuration, deployed_health, uploaded_version
from relay_release import file_hashes, validate_source, verify_bundle, version


class RelayReleaseTest(unittest.TestCase):
    def test_source_requires_matching_tag_and_successful_exact_main_checks(self):
        source = "a" * 40
        run = {"head_repository": {"full_name": "owner/repo"}, "head_sha": source,
               "head_branch": "main", "event": "push", "path": ".github/workflows/checks.yml",
               "status": "completed", "conclusion": "success"}
        for changed in ({}, {"head_sha": "b" * 40}, {"conclusion": "failure"}, {"event": "pull_request"}):
            def fake(*args):
                if args[0] == "gh":
                    return json.dumps({"workflow_runs": [run | changed]})
                return "" if args[1] == "merge-base" else source
            with patch.dict("os.environ", {"GITHUB_REPOSITORY": "owner/repo"}), patch("relay_release.command", side_effect=fake):
                if changed:
                    with self.subTest(changed=changed), self.assertRaises(ValueError):
                        validate_source("relay-v0.1.0")
                else:
                    self.assertEqual(validate_source("relay-v0.1.0"), ("0.1.0", source))
        with patch("relay_release.command", side_effect=[source, "b" * 40]), self.assertRaises(ValueError):
            validate_source("relay-v0.1.0")

    def test_strict_version_names(self):
        self.assertEqual(version("relay-v1.2.3-rc.4"), "1.2.3-rc.4")
        for tag in ("main", "v1.2.3", "relay-v01.2.3", "relay-v1.2.3\nsource=other", "relay-v1.2.3-rc.0"):
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                version(tag)

    def test_receipt_refuses_source_changes_modified_missing_and_extra_files(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "web").mkdir()
            (root / "worker.js").write_text("fixture worker")
            (root / "web/viewer.html").write_text("fixture viewer")
            receipt = {"tag": "relay-v0.1.0", "version": "0.1.0", "source": "a" * 40,
                       "files": file_hashes(root)}
            (root / "release.json").write_text(json.dumps(receipt))
            verify_bundle(root, "relay-v0.1.0", "a" * 40)
            with self.assertRaises(ValueError):
                verify_bundle(root, "relay-v0.1.0", "b" * 40)
            for extra in ("extra", "web/release.json"):
                (root / extra).write_text("unexpected")
                with self.subTest(extra=extra), self.assertRaises(ValueError):
                    verify_bundle(root, "relay-v0.1.0", "a" * 40)
                (root / extra).unlink()
            (root / "worker.js").write_text("modified")
            with self.assertRaises(ValueError):
                verify_bundle(root, "relay-v0.1.0", "a" * 40)
            (root / "worker.js").unlink()
            with self.assertRaises(ValueError):
                verify_bundle(root, "relay-v0.1.0", "a" * 40)
            (root / "worker.js").symlink_to(root / "web/viewer.html")
            with self.assertRaises(ValueError):
                verify_bundle(root, "relay-v0.1.0", "a" * 40)

    def test_staging_config_cannot_select_production_or_open_admission(self):
        args = ["a" * 32, "yepcontrol-relay-staging", "https://yepcontrol-relay-staging.example.workers.dev",
                Path("bundle"), "relay-v0.1.0", "b" * 40]
        config = configuration(*args)
        self.assertEqual(config["vars"]["PROOF_EXPIRES"], "1")
        self.assertFalse(config["preview_urls"])
        self.assertNotIn("FCM_PROJECT", config["vars"])
        fcm = configuration(*args, fcm_project="firebase-fixture")
        self.assertEqual(fcm["vars"]["FCM_PROJECT"], "firebase-fixture")
        self.assertEqual(fcm["vars"]["PROOF_EXPIRES"], "1")
        self.assertNotIn("FCM_SERVICE_ACCOUNT", json.dumps(fcm))
        with self.assertRaises(ValueError):
            configuration(*args, fcm_project="https://unexpected.invalid")
        for index, invalid in ((0, ""), (1, "yepcontrol-relay"), (2, "https://yepcontrol.com"),
                               (2, args[2] + "/"), (2, args[2] + "?unexpected")):
            candidate = args.copy()
            candidate[index] = invalid
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                configuration(*candidate)

    def test_health_requires_exact_release_and_closed_gate(self):
        receipt = {"version": "0.1.0", "source": "a" * 40}
        health = {"status": "ok", **receipt, "revision": receipt["source"],
                  "deployment": "a" * 8 + "-" + "a" * 4 + "-" + "a" * 4 + "-" + "a" * 4 + "-" + "a" * 12,
                  "admission": "closed"}
        uploaded = health["deployment"]
        self.assertTrue(deployed_health(health, receipt, uploaded))
        for key, value in (("version", "other"), ("revision", "b" * 40), ("deployment", ""), ("deployment", None),
                           ("admission", "gated"), ("status", "failed")):
            with self.subTest(key=key):
                self.assertFalse(deployed_health(health | {key: value}, receipt, uploaded))
        self.assertFalse(deployed_health(health | {"deployment": "b" * 8 + uploaded[8:]}, receipt, uploaded),
                         "A previous deployment of the same source/tag must not pass")

    def test_uploaded_identity_comes_from_one_structured_wrangler_deploy_result(self):
        worker = "yepcontrol-relay-staging"
        uuid = "01234567-89ab-cdef-0123-456789abcdef"
        event = {"type": "deploy", "version": 1, "worker_name": worker, "version_id": uuid}
        self.assertEqual(uploaded_version([{"type": "other"}, event], worker), uuid)
        for events in ([], [event, event], [event | {"worker_name": "other"}],
                       [event | {"version": 2}], [event | {"version_id": ""}],
                       [event | {"type": "version-upload"}]):
            with self.subTest(events=events), self.assertRaises(ValueError):
                uploaded_version(events, worker)


if __name__ == "__main__":
    unittest.main()
