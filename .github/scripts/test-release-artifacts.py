"""Offline tests for the release identity and artifact checks."""
import importlib.util
import json
import os
import re
import subprocess
import textwrap
from pathlib import Path
import tempfile
import unittest
import zipfile

spec = importlib.util.spec_from_file_location("release_artifacts", Path(__file__).with_name("release-artifacts.py"))
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleaseArtifactsTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="vsgit-release-validation-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        self.dist = self.root / "dist"
        self.dist.mkdir()
        self.tag = "v1.2.3"
        self.commit = "a" * 40
        for filename, (source, name, host) in release.PACKAGES.items():
            manifest = {"publisher": "fixture", "version": "1.2.3", "name": name, "extensionKind": [host]}
            path = self.root / source
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(json.dumps(manifest))
            self.write_package(filename, manifest)
        (self.root / "package-lock.json").write_text(json.dumps({"version": "1.2.3", "packages": {"": {"version": "1.2.3"}}}))

    def write_package(self, filename, manifest, content="compiled code"):
        with zipfile.ZipFile(self.dist / filename, "w") as archive:
            archive.writestr("extension/package.json", json.dumps(manifest))
            archive.writestr("extension/out/example.js", content)

    def describe(self):
        return release.describe_packages(self.root, self.dist, self.tag, self.commit)

    def test_valid_pair_is_bound_to_tag_commit_and_both_ids(self):
        record = self.describe()
        self.assertEqual(record["tag"], self.tag)
        self.assertEqual(record["commit"], self.commit)
        self.assertEqual(record["packages"]["vsgit.vsix"]["id"], "fixture.vscode-git")
        self.assertEqual(record["packages"]["vsgit-icon-theme.vsix"]["id"], "fixture.vscode-git-icon-theme")
        self.assertEqual(record, self.describe())

    def test_changed_package_contents_change_checksum(self):
        before = self.describe()
        manifest = json.loads((self.root / "package.json").read_text())
        self.write_package("vsgit.vsix", manifest, "tampered code")
        after = self.describe()
        self.assertNotEqual(before, after)
        self.assertEqual(before["packages"]["vsgit-icon-theme.vsix"], after["packages"]["vsgit-icon-theme.vsix"])

    def test_mismatched_tag_bridge_and_lock_versions_are_rejected(self):
        with self.assertRaises(ValueError):
            release.validate_sources(self.root, "v1.2.4")
        for path in [self.root / "icon-theme-bridge/package.json", self.root / "package-lock.json"]:
            original = path.read_text()
            data = json.loads(original)
            data["version"] = "1.2.4"
            path.write_text(json.dumps(data))
            with self.assertRaises(ValueError):
                self.describe()
            path.write_text(original)

    def test_wrong_archive_identity_version_or_host_are_rejected(self):
        manifest = json.loads((self.root / "package.json").read_text())
        for key, value in [("name", "other"), ("publisher", "other"), ("version", "2.0.0"), ("extensionKind", ["ui"])]:
            with self.subTest(field=key):
                self.write_package("vsgit.vsix", {**manifest, key: value})
                with self.assertRaises(ValueError):
                    self.describe()

    def test_missing_package_and_invalid_commit_are_rejected(self):
        with self.assertRaises(ValueError):
            release.describe_packages(self.root, self.dist, self.tag, "main")
        (self.dist / "vsgit-icon-theme.vsix").unlink()
        with self.assertRaises(FileNotFoundError):
            self.describe()

    def test_workflow_guard_allows_dry_run_on_main_but_publishes_only_the_selected_tag(self):
        workflow = (Path(__file__).parents[1] / "workflows/publish-release.yml").read_text()
        body = re.search(r"        run: \|\n((?:          .*\n|\n)+)", workflow).group(1)
        for tag, ref, dry_run, allowed in [
            ("v1.2.3", "refs/heads/main", "true", True),
            ("v1.2.3", "refs/heads/main", "false", False),
            ("v1.2.3", "refs/tags/v1.2.3", "false", True),
            ("v1.2.3", "refs/tags/v1.2.4", "false", False),
            ("v1.2.3-beta.1", "refs/tags/v1.2.3-beta.1", "true", False),
            ("v1.2.3; exit 0", "refs/heads/main", "true", False),
        ]:
            with self.subTest(tag=tag, ref=ref, dry_run=dry_run):
                result = subprocess.run(["bash", "-c", textwrap.dedent(body)], env={**os.environ, "RELEASE_TAG": tag, "GITHUB_REF": ref, "DRY_RUN": dry_run}, capture_output=True)
                self.assertEqual(result.returncode == 0, allowed)

    def test_invalid_and_prerelease_tags_are_rejected(self):
        for tag in ["main", "1.2.3", "v01.2.3", "v1.2.3-beta.1", "v1.2.3+build", "v1.2.3\nextra", "v1.2.3; echo unsafe"]:
            with self.subTest(tag=tag):
                with self.assertRaises(ValueError):
                    release.version_from_tag(tag)


if __name__ == "__main__":
    unittest.main()
