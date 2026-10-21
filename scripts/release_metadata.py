#!/usr/bin/env python3
"""Read the tracked Android version; no credentials or machine inventory."""
import argparse
import json
from pathlib import Path
import re


def read_version(text):
    entries = [line.split("=", 1) for line in text.splitlines() if line.strip() and not line.startswith("#")]
    if any(len(entry) != 2 for entry in entries) or len(entries) != 2:
        raise ValueError("Expected exactly VERSION_NAME and VERSION_CODE")
    values = dict(entries)
    name, code = values.get("VERSION_NAME", ""), values.get("VERSION_CODE", "")
    if not re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+(?:[-+][A-Za-z0-9.-]+)?", name):
        raise ValueError("Invalid Android version name")
    if not re.fullmatch(r"[1-9][0-9]*", code) or int(code) > 2100000000:
        raise ValueError("Invalid Android version code")
    return name, int(code)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--github-output", type=Path)
    args = parser.parse_args()
    name, code = read_version(Path("android/version.properties").read_text())
    if args.github_output:
        with args.github_output.open("a") as out:
            out.write(f"version_name={name}\nversion_code={code}\n")
    print(json.dumps({"versionName": name, "versionCode": code}))
