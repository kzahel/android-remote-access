#!/usr/bin/env python3
"""Validate tagged relay source and receipt the exact built files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

from verify_android_release import has_source_checks


def version(tag):
    match = re.fullmatch(r"relay-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-rc\.[1-9][0-9]*)?", tag)
    if not match:
        raise ValueError("Expected relay-vMAJOR.MINOR.PATCH, optionally -rc.N")
    return tag.removeprefix("relay-v")


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def validate_source(tag):
    release = version(tag)
    source = command("git", "rev-parse", "--verify", f"refs/tags/{tag}^{{commit}}")
    if source != command("git", "rev-parse", "HEAD"):
        raise ValueError("Checkout must match the release tag")
    command("git", "merge-base", "--is-ancestor", source, "origin/main")
    repository = os.environ["GITHUB_REPOSITORY"]
    runs = json.loads(command("gh", "api", f"repos/{repository}/actions/workflows/checks.yml/runs?head_sha={source}&status=success&per_page=100"))
    if not has_source_checks(runs["workflow_runs"], repository, source):
        raise ValueError("Full Checks must pass on main for the exact relay source")
    return release, source


def file_hashes(directory):
    result = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink():
            raise ValueError("Release must not contain symlinks")
        if path.is_file() and path != directory / "release.json":
            result[path.relative_to(directory).as_posix()] = hashlib.sha256(path.read_bytes()).hexdigest()
    if "worker.js" not in result or "web/viewer.html" not in result:
        raise ValueError("Missing built relay or viewer")
    return result


def verify_bundle(directory, tag, source):
    if not re.fullmatch(r"[0-9a-f]{40}", source):
        raise ValueError("Invalid source revision")
    receipt = json.loads((directory / "release.json").read_text())
    if receipt.get("tag") != tag or receipt.get("version") != version(tag) or receipt.get("source") != source:
        raise ValueError("Release source or version differs")
    if receipt.get("files") != file_hashes(directory):
        raise ValueError("Release checksum mismatch")
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("source", "receipt", "verify"))
    parser.add_argument("--tag", required=True)
    parser.add_argument("--directory", type=Path)
    parser.add_argument("--source")
    args = parser.parse_args()
    if args.mode == "source":
        release, source = validate_source(args.tag)
        with open(os.environ["GITHUB_OUTPUT"], "a") as output:
            output.write(f"version={release}\nsource={source}\ntag={args.tag}\n")
    elif args.mode == "receipt":
        receipt = {"tag": args.tag, "version": version(args.tag), "source": args.source,
                   "run": os.environ["GITHUB_RUN_ID"], "files": file_hashes(args.directory)}
        (args.directory / "release.json").write_text(json.dumps(receipt, indent=2) + "\n")
    else:
        verify_bundle(args.directory, args.tag, args.source)


if __name__ == "__main__":
    main()
