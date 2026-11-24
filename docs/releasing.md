# Marketplace and GitHub releases

English | [简体中文](releasing.zh-CN.md)

`.github/workflows/publish-release.yml` publishes a stable version when a `vMAJOR.MINOR.PATCH` tag is pushed. Its jobs run in this order:

1. Check that both extension manifests match the tag, install locked dependencies, typecheck, build, test, and package both VSIX files.
2. Publish the UI bridge, then the main extension, to Visual Studio Marketplace using OIDC.
3. Create a GitHub Release for the existing tag, generate release notes, and attach both VSIX packages.

The publishing and release jobs download the exact build artifact rather than rebuilding it. A manifest records the commit, extension IDs, versions, and SHA-256 checksums; each downstream job verifies it. Failed validation, tests, packaging, or Marketplace publishing prevents the GitHub Release job from running.

## One-time setup

The Marketplace publisher must exist and belong to an account you control. This repository uses `lvliangxiong`.

1. In GitHub repository **Settings → Environments**, create an environment named `marketplace`. Configure its allowed deployment tags to include `v*`. Required reviewers are optional; if configured, Marketplace publishing waits for approval.
2. In the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage), open publisher `lvliangxiong`, select **Trusted Publishing**, and create a policy with:

   | Field            | Value                 |
   | ---------------- | --------------------- |
   | Repository owner | `lvliangxiong`        |
   | Repository       | `vscode-enhanced-git` |
   | Workflow         | `publish-release.yml` |
   | Environment      | `marketplace`         |

3. Ensure repository Actions policies permit the pinned official checkout, Node setup, artifact upload, and artifact download actions, plus `contents: write` for release creation.

The policy covers the publisher used by both extensions. No Marketplace PAT or GitHub PAT is required: Marketplace publishing requests short-lived OIDC credentials, while GitHub Release creation uses the workflow's `GITHUB_TOKEN`.

The project lockfile uses `vsce 4.0.0` for packaging. The publishing job separately installs `@vscode/vsce@4.1.1`, which supports `--oidc`, into the runner's temporary directory. Each extension publish invocation acquires its own credential. This does not change project dependencies.

See the [official Trusted Publishing instructions](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing).

## Publish a version

On local `main`, set both extension manifests and the root lockfile to the same unused stable version and commit the changes. Run the following from the repository root.

```sh
(
  set -e
  release_tag=$(node -p '"v" + require("./package.json").version')
  git fetch origin --tags
  git tag -a "$release_tag" -m "Enhanced Git for Visual Studio Code $release_tag"
  git push --atomic origin HEAD:refs/heads/main "refs/tags/$release_tag"
)
```

Fetching the remote tags first makes an existing local or remote tag stop the sequence before the push. The atomic push sends the new tag and `main` together and starts production publishing. Each release uses a stable `vMAJOR.MINOR.PATCH` tag pointing to the commit with that version.

## Manual checks and retries

To rehearse an existing tag, open **Actions → Publish extensions and GitHub Release → Run workflow**. Select the default branch in **Use workflow from**, enter a tag that contains the workflow and its validation helper, and leave `dry_run: true` selected.

- `dry_run: true` is the default for manual runs. It runs validation, tests, and packaging and uploads an Actions artifact, without publishing to Marketplace or creating a GitHub Release.
- `dry_run: false` runs the complete publishing flow. Select the same tag in **Use workflow from**; checking out a tag from a branch-triggered run does not change the GitHub environment or OIDC ref. The workflow rejects publishing runs whose triggering ref is not the requested tag.
- Tag pushes run the complete publishing flow automatically.

After a partial failure, prefer **Re-run failed jobs** so the same built packages are reused. Marketplace publishing skips an already-published version, allowing the main extension to retry if bridge publication succeeded first. An existing published version cannot be replaced; use a new version for changed contents. If the Marketplace is still processing the first bridge publication, wait until it is available before retrying the main extension.

GitHub Release retries upload only missing named assets and publish an existing draft; they do not overwrite existing assets. A run for a tag is serialized with other runs for that same tag. Actions artifacts are retained for 30 days; GitHub Release attachments are separate from Actions artifact retention.
