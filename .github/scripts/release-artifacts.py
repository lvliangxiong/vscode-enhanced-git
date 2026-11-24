"""Validate tagged versions and the VSIX artifacts shared by release jobs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import zipfile

PACKAGES = {
    "vsgit.vsix": ("package.json", "vsgit", "workspace"),
    "vsgit-icon-theme.vsix": ("icon-theme-bridge/package.json", "vsgit-icon-theme", "ui"),
}


def version_from_tag(tag):
    if not re.fullmatch(r"v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)", tag):
        raise ValueError("Use a stable release tag such as v0.1.285")
    return tag[1:]


def validate_sources(root, tag):
    version = version_from_tag(tag)
    manifests = [json.loads((root / info[0]).read_text()) for info in PACKAGES.values()]
    for manifest, (_, name, host) in zip(manifests, PACKAGES.values()):
        if manifest["version"] != version:
            raise ValueError(f"{name} version must match {tag}")
        if manifest["name"] != name or manifest.get("extensionKind") != [host]:
            raise ValueError(f"Unexpected extension identity or host for {name}")
    lock = json.loads((root / "package-lock.json").read_text())
    if lock.get("version") != version or lock.get("packages", {}).get("", {}).get("version") != version:
        raise ValueError("package-lock.json version must match the release tag")
    publisher = manifests[0]["publisher"]
    if not publisher or manifests[1]["publisher"] != publisher:
        raise ValueError("Both extensions must use the same nonempty publisher")
    return version, publisher


def describe_packages(root, directory, tag, commit):
    version, publisher = validate_sources(root, tag)
    if not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", commit):
        raise ValueError("Expected a full commit SHA")
    result = {"tag": tag, "commit": commit, "version": version, "packages": {}}
    for filename, (_, name, host) in PACKAGES.items():
        archive = directory / filename
        with zipfile.ZipFile(archive) as package:
            manifest = json.loads(package.read("extension/package.json"))
        if (manifest.get("publisher"), manifest.get("name"), manifest.get("version"), manifest.get("extensionKind")) != (publisher, name, version, [host]):
            raise ValueError(f"Unexpected manifest in {filename}")
        result["packages"][filename] = {
            "id": f"{publisher}.{name}",
            "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
        }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["validate", "record", "verify"])
    parser.add_argument("--tag", required=True)
    parser.add_argument("--commit")
    parser.add_argument("--directory", type=Path, default=Path("dist"))
    args = parser.parse_args()
    root = Path.cwd()
    version, _ = validate_sources(root, args.tag)
    if args.command == "validate":
        commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
        tagged = subprocess.check_output(["git", "rev-parse", f"refs/tags/{args.tag}^{{commit}}"], text=True).strip()
        if commit != tagged:
            raise ValueError("Checkout does not match the release tag")
        if output := os.environ.get("GITHUB_OUTPUT"):
            with open(output, "a") as stream:
                stream.write(f"version={version}\ncommit={commit}\n")
        print(f"Validated {args.tag} at {commit}")
        return
    if not args.commit:
        parser.error("--commit is required for artifact commands")
    record = describe_packages(root, args.directory, args.tag, args.commit)
    manifest_path = args.directory / "release-manifest.json"
    if args.command == "record":
        manifest_path.write_text(json.dumps(record, indent=2) + "\n")
    elif json.loads(manifest_path.read_text()) != record:
        raise ValueError("Release artifact identity or checksum mismatch")
    print(f"{args.command}: both VSIX packages verified for {args.tag}")


if __name__ == "__main__":
    main()
