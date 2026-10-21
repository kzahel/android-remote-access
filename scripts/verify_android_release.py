#!/usr/bin/env python3
"""Require exact-source successful CI and a main-only signed artifact before Play access."""
import json
import os
import re
import subprocess
from release_metadata import read_version


def verify_build(run, repository, source):
    expected = {
        "event": "workflow_dispatch", "head_branch": "main", "head_sha": source,
        "path": ".github/workflows/android-release.yml", "status": "completed", "conclusion": "success",
    }
    if run.get("head_repository", {}).get("full_name") != repository:
        raise ValueError("Build must come from this repository")
    for key, value in expected.items():
        if run.get(key) != value:
            raise ValueError(f"Release build differs: {key}")


def has_source_checks(runs, repository, source):
    return any(
        run.get("head_repository", {}).get("full_name") == repository
        and run.get("head_sha") == source and run.get("head_branch") == "main"
        and run.get("event") in ("push", "workflow_dispatch")
        and run.get("path") == ".github/workflows/checks.yml"
        and run.get("status") == "completed" and run.get("conclusion") == "success"
        for run in runs
    )


def main():
    run_id = os.environ.get("BUILD_RUN")
    repository = os.environ["GITHUB_REPOSITORY"]

    def command(*args):
        return subprocess.check_output(args, text=True).strip()

    def api(path):
        return json.loads(command("gh", "api", f"repos/{repository}/{path}"))

    if run_id:
        if not re.fullmatch(r"[1-9][0-9]*", run_id):
            raise ValueError("Invalid build run ID")
        run = api(f"actions/runs/{run_id}")
        source = run["head_sha"]
        verify_build(run, repository, source)
    else:
        source = os.environ["GITHUB_SHA"]
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Invalid source revision")
    command("git", "merge-base", "--is-ancestor", source, "origin/main")
    tracked = command("git", "show", f"{source}:android/version.properties")
    name, code = read_version(tracked)
    checks = api(f"actions/workflows/checks.yml/runs?head_sha={source}&status=success&per_page=100")
    if not has_source_checks(checks["workflow_runs"], repository, source):
        raise ValueError("Full Checks must pass on main for the exact app source")
    with open(os.environ["GITHUB_OUTPUT"], "a") as out:
        out.write(f"source={source}\nversion_code={code}\nversion_name={name}\n")


if __name__ == "__main__":
    main()
