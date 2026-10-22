#!/usr/bin/env python3
"""Deploy only the gated Cloudflare staging relay, using the verified CI bundle."""
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

from relay_release import verify_bundle


def configuration(account, worker, origin, bundle, tag, source):
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ValueError("Missing or invalid Cloudflare account ID")
    if not re.fullmatch(r"yepcontrol-relay-(?:proof|staging)", worker):
        raise ValueError("Only the isolated proof or staging Worker is allowed")
    url = urlparse(origin)
    if (url.scheme != "https" or url.netloc != url.hostname or url.path or url.query or url.fragment
            or not re.fullmatch(re.escape(worker) + r"\.[a-z0-9-]+\.workers\.dev", url.hostname or "")):
        raise ValueError("Expected the matching isolated workers.dev origin")
    return {
        "name": worker, "account_id": account, "main": str((bundle / "worker.js").resolve()),
        "compatibility_date": "2026-10-01", "workers_dev": True, "preview_urls": False,
        "assets": {"directory": str((bundle / "web").resolve()), "binding": "ASSETS",
                   "run_worker_first": True, "html_handling": "none"},
        "observability": {"enabled": False},
        "version_metadata": {"binding": "CF_VERSION_METADATA"},
        "vars": {"PUBLIC_ORIGIN": origin, "PROOF_EXPIRES": "1", "PROOF_BUILD": tag,
                 "RELEASE_VERSION": tag.removeprefix("relay-v"), "REVISION": source},
        "durable_objects": {"bindings": [{"name": "PAIRINGS", "class_name": "Pairing"},
                                          {"name": "WAKE_BUDGET", "class_name": "WakeBudget"}]},
        "migrations": [{"tag": "v1", "new_sqlite_classes": ["Pairing"]},
                       {"tag": "v2", "new_sqlite_classes": ["WakeBudget"]}],
    }


def deployed_health(health, receipt):
    deployment = health.get("deployment")
    return (health.get("status") == "ok" and health.get("version") == receipt["version"]
            and health.get("revision") == receipt["source"] and health.get("admission") == "closed"
            and isinstance(deployment, str)
            and bool(re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", deployment)))


def main():
    bundle = Path(".local/relay-release")
    receipt = verify_bundle(bundle, os.environ["RELEASE_TAG"], os.environ["RELEASE_SOURCE"])
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise ValueError("Configure the relay-staging environment's dedicated Cloudflare API token")
    config = configuration(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""),
                           os.environ.get("RELAY_WORKER_NAME", ""), os.environ.get("RELAY_ORIGIN", ""),
                           bundle, receipt["tag"], receipt["source"])
    for value in (config["account_id"], config["name"], config["vars"]["PUBLIC_ORIGIN"]):
        print(f"::add-mask::{value}", flush=True)
    config_path = Path(".local/relay-staging.json")
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    subprocess.run(["pnpm", "--dir", "experiments/cloudflare-relay", "exec", "wrangler", "deploy",
                    "--config", str(config_path.resolve()), "--no-bundle", "--tag", receipt["tag"]], check=True)
    health = {}
    for attempt in range(12):
        try:
            request = urllib.request.Request(config["vars"]["PUBLIC_ORIGIN"] + "/health",
                                             headers={"Cache-Control": "no-cache"})
            with urllib.request.urlopen(request, timeout=10) as response:
                health = json.load(response)
            if deployed_health(health, receipt):
                break
        except (OSError, ValueError):
            pass
        time.sleep(2)
    result = {"tag": receipt["tag"], "source": receipt["source"], "run": os.environ["GITHUB_RUN_ID"],
              "workerVersion": health.get("deployment"), "verified": deployed_health(health, receipt),
              "admission": health.get("admission")}
    Path(".local/relay-deployment.json").write_text(json.dumps(result, indent=2) + "\n")
    if not result["verified"]:
        raise RuntimeError("Deployed relay did not report the exact expected source/version with closed admission")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write("```json\n" + json.dumps(result, indent=2) + "\n```\n")


if __name__ == "__main__":
    main()
