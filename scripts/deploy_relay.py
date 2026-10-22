#!/usr/bin/env python3
"""Deploy the selected isolated relay using its verified CI bundle."""
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


def configuration(account, worker, origin, bundle, tag, source, fcm_project=None):
    if not re.fullmatch(r"[0-9a-f]{32}", account):
        raise ValueError("Missing or invalid Cloudflare account ID")
    if not re.fullmatch(r"yepcontrol-relay-(?:proof|staging)", worker):
        raise ValueError("Only the isolated proof or staging Worker is allowed")
    url = urlparse(origin)
    if (url.scheme != "https" or url.netloc != url.hostname or url.path or url.query or url.fragment
            or not re.fullmatch(re.escape(worker) + r"\.[a-z0-9-]+\.workers\.dev", url.hostname or "")):
        raise ValueError("Expected the matching isolated workers.dev origin")
    if fcm_project and not re.fullmatch(r"[a-z][a-z0-9-]{4,28}[a-z0-9]", fcm_project):
        raise ValueError("Invalid Firebase project ID")
    return {
        "name": worker, "account_id": account, "main": str((bundle / "worker.js").resolve()),
        "compatibility_date": "2026-10-01", "workers_dev": True, "preview_urls": False,
        "assets": {"directory": str((bundle / "web").resolve()), "binding": "ASSETS",
                   "run_worker_first": True, "html_handling": "none"},
        "observability": {"enabled": False},
        "version_metadata": {"binding": "CF_VERSION_METADATA"},
        "vars": {"PUBLIC_ORIGIN": origin, "PROOF_EXPIRES": "1", "PROOF_BUILD": tag,
                 "RELEASE_VERSION": tag.removeprefix("relay-v"), "REVISION": source,
                 **({"FCM_PROJECT": fcm_project} if fcm_project else {})},
        "durable_objects": {"bindings": [{"name": "PAIRINGS", "class_name": "Pairing"},
                                          {"name": "WAKE_BUDGET", "class_name": "WakeBudget"},
                                          {"name": "ADMISSION", "class_name": "Admission"}]},
        "migrations": [{"tag": "v1", "new_sqlite_classes": ["Pairing"]},
                       {"tag": "v2", "new_sqlite_classes": ["WakeBudget"]},
                       {"tag": "v3", "new_sqlite_classes": ["Admission"]}],
        "ratelimits": [{"name": "HTTP_LIMITER", "namespace_id": "340001",
                        "simple": {"limit": 240, "period": 60}},
                       {"name": "START_LIMITER", "namespace_id": "340002",
                        "simple": {"limit": 10, "period": 60}}],
    }


def production_configuration(account, worker, origin, bundle, tag, source, fcm_project, mode="maintenance"):
    if worker != "yepcontrol-relay" or origin != "https://yepcontrol.com":
        raise ValueError("Production requires the dedicated Worker and canonical origin")
    if mode not in ("maintenance", "production") or not fcm_project:
        raise ValueError("Production requires explicit admission and FCM configuration")
    config = configuration(account, "yepcontrol-relay-staging", "https://yepcontrol-relay-staging.example.workers.dev",
                           bundle, tag, source, fcm_project)
    config["name"] = worker
    for limiter, namespace in zip(config["ratelimits"], ("340101", "340102")):
        limiter["namespace_id"] = namespace
    config["vars"].pop("PROOF_EXPIRES")
    config["vars"].pop("PROOF_BUILD")
    config["vars"].update(PUBLIC_ORIGIN=origin, RELAY_MODE=mode)
    # Custom domains are provisioned once by the operator. This deployment token
    # edits only this Worker, never DNS, zones or another Worker's domains.
    return config


def uploaded_version(events, worker):
    deployments = [event for event in events if event.get("type") == "deploy"]
    if len(deployments) != 1:
        raise ValueError("Expected one Wrangler deployment result")
    deployment = deployments[0]
    version = deployment.get("version_id")
    if (deployment.get("version") != 1 or deployment.get("worker_name") != worker
            or not isinstance(version, str)
            or not re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", version)):
        raise ValueError("Invalid Wrangler deployment identity")
    return version


def deployed_health(health, receipt, uploaded, admission="closed"):
    deployment = health.get("deployment")
    return (health.get("status") == "ok" and health.get("version") == receipt["version"]
            and health.get("revision") == receipt["source"] and health.get("admission") == admission
            and deployment == uploaded
            and isinstance(deployment, str)
            and bool(re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", deployment)))


def main():
    bundle = Path(".local/relay-release")
    receipt = verify_bundle(bundle, os.environ["RELEASE_TAG"], os.environ["RELEASE_SOURCE"])
    if not os.environ.get("CLOUDFLARE_API_TOKEN"):
        raise ValueError("Configure the selected environment's dedicated Cloudflare API token")
    target = os.environ.get("RELAY_TARGET", "staging")
    if target not in ("staging", "production"):
        raise ValueError("Invalid relay target")
    build_config = configuration if target == "staging" else production_configuration
    mode = os.environ.get("RELAY_MODE", "maintenance")
    config = build_config(os.environ.get("CLOUDFLARE_ACCOUNT_ID", ""),
                           os.environ.get("RELAY_WORKER_NAME", ""), os.environ.get("RELAY_ORIGIN", ""),
                           bundle, receipt["tag"], receipt["source"], os.environ.get("FCM_PROJECT"), **({"mode": mode} if target == "production" else {}))
    admission = "closed" if target == "staging" else ("public" if mode == "production" else "maintenance")
    health_origin = os.environ.get("RELAY_HEALTH_ORIGIN") or config["vars"]["PUBLIC_ORIGIN"]
    if health_origin != config["vars"]["PUBLIC_ORIGIN"] and not re.fullmatch(r"https://" + re.escape(config["name"]) + r"\.[a-z0-9-]+\.workers\.dev", health_origin):
        raise ValueError("Unexpected health origin")
    for value in (config["account_id"], config["name"], config["vars"]["PUBLIC_ORIGIN"]):
        print(f"::add-mask::{value}", flush=True)
    config_path = Path(f".local/relay-{target}.json")
    config_path.write_text(json.dumps(config, indent=2) + "\n")
    output_path = Path(".local/relay-wrangler.jsonl").resolve()
    output_path.unlink(missing_ok=True)
    subprocess.run(["pnpm", "--dir", "experiments/cloudflare-relay", "exec", "wrangler", "deploy",
                    "--config", str(config_path.resolve()), "--no-bundle", "--tag", receipt["tag"]], check=True,
                   env={**os.environ, "WRANGLER_OUTPUT_FILE_PATH": str(output_path)})
    worker_version = uploaded_version([json.loads(line) for line in output_path.read_text().splitlines() if line.strip()], config["name"])
    health = {}
    for attempt in range(30):
        try:
            request = urllib.request.Request(health_origin + "/health",
                                             headers={"Cache-Control": "no-cache",
                                                      "User-Agent": "YepControl-Relay-CI/1.0"})
            with urllib.request.urlopen(request, timeout=10) as response:
                health = json.load(response)
            if deployed_health(health, receipt, worker_version, admission):
                break
        except (OSError, ValueError):
            pass
        time.sleep(2)
    result = {"tag": receipt["tag"], "source": receipt["source"], "run": os.environ["GITHUB_RUN_ID"],
              "workerVersion": worker_version, "observedWorkerVersion": health.get("deployment"),
              "verified": deployed_health(health, receipt, worker_version, admission),
              "admission": health.get("admission"), "target": target}
    Path(".local/relay-deployment.json").write_text(json.dumps(result, indent=2) + "\n")
    if not result["verified"]:
        raise RuntimeError("Deployed relay did not report the exact expected source/version with the expected admission")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a") as output:
        output.write("```json\n" + json.dumps(result, indent=2) + "\n```\n")


if __name__ == "__main__":
    main()
