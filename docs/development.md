# Development, verification, and installation

English | [简体中文](development.zh-CN.md)

## Requirements and commands

For development, use npm and Git with Node.js 22.x (22.22.2 or later in that series). The main manifest's `engines.vscode` field declares the supported VS Code version range. `package-lock.json` pins dependency versions.

```sh
npm ci
npm run check
npm test
```

| Command                | Purpose                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------- |
| `npm run build`        | Rebuilds `out/`, compiles TypeScript, React entry points, and Less, and copies assets and dependency licenses.  |
| `npm run lint`         | Runs Oxlint correctness and React Hooks rules on source, scripts, and tests.                                    |
| `npm run typecheck`    | Checks TypeScript types in application code, scripts, and tests. All files under `src/` use strict null checks. |
| `npm run check`        | Runs formatting, lint, type checks, and the build.                                                              |
| `npm test`             | Builds and runs `test/*.test.ts`.                                                                               |
| `npm run format`       | Formats source, scripts, tests, and documentation.                                                              |
| `npm run format:check` | Checks formatting.                                                                                              |
| `npm run package`      | Checks the build and produces the main and bridge VSIX packages.                                                |

`scripts/` and `test/` use TypeScript executed with the project's `tsx`. `tsconfig.tools.json` configures the script and test environment; component tests use jsdom.

## Debugging and testing

After building, launch an extension development window with a test repository. Use `--user-data-dir` with a temporary directory if you need isolated user configuration:

```sh
code --extensionDevelopmentPath=. /path/to/test-repository
```

Run individual tests with:

```sh
npm run build
npx tsx --test test/graph.test.ts
npx tsx --test test/stash-history.test.ts test/reference-labels.test.ts
npx tsx --test test/merge-three-way.test.ts test/file-history.test.ts
npx tsx --test test/branch-selection.test.ts test/reference-layout.test.ts test/column-resize.test.ts
npx tsx --test test/switch-repositories.test.ts test/open-working-file.test.ts
```

Tests that write to Git use temporary repositories and local bare remotes. Coverage includes history filters, topology, stashes, comparison endpoints, renames, branch operations, cherry-picking, caching, and isolation between repository sessions.

React/jsdom tests cover selection, keyboard interaction, menus, hovers, file trees, and view lifecycles. jsdom does not perform real layout; tests supply dimensions and Canvas doubles. Focus, zoom, themes, file icons, and Remote-SSH behavior require verification in VS Code.

## Packaging and installation

```sh
npm run package
code --install-extension dist/vscode-enhanced-git-icon-theme.vsix --force
code --install-extension dist/vscode-enhanced-git.vsix --force --do-not-include-pack-dependencies
```

Outputs are `dist/vscode-enhanced-git.vsix` and `dist/vscode-enhanced-git-icon-theme.vsix`. `scripts/package-icon-bridge.ts` synchronizes the bridge's publisher and version with the main extension. Run `Developer: Reload Window` after installation.

| Extension                           | ID                                            | Host        |
| ----------------------------------- | --------------------------------------------- | ----------- |
| Enhanced Git for Visual Studio Code | `lvliangxiong.vscode-enhanced-git`            | `workspace` |
| Enhanced Git File Icon Theme Bridge | `lvliangxiong.vscode-enhanced-git-icon-theme` | `ui`        |

Use `code --list-extensions --show-versions` to inspect local installations and `code --locate-extension lvliangxiong.vscode-enhanced-git` to locate the main extension. Check the publisher and version of a remote installation in the Extensions view of the corresponding Remote-SSH window.

In Remote-SSH, the main extension runs in the remote workspace host. The local UI bridge supplies file icons, editor themes, and grammar resources. Their `extensionKind` values are `workspace` and `ui`, respectively.

Installing the main extension from the Marketplace includes the bridge through its `extensionPack`. For manual VSIX installation, install the local bridge first and use `--do-not-include-pack-dependencies` for the main package to avoid Marketplace resolution. Install the main package in the remote workspace host when using Remote-SSH.

Both manifests declare the source repository, homepage, Issues URL, and `media/icon.png`. The 256×256 Marketplace icons share a V-shaped commit graph mark. The main icon is `media/icon.png`, rendered from `media/marketplace-icon.svg`. The bridge icon is `media/bridge-icon.png`, rendered from `media/marketplace-bridge-icon.svg` with a connected link badge, and copied to `icon-theme-bridge/media/icon.png` during packaging. SVG sources and PNG assets are version-controlled. Main README relative links are rewritten against GitHub's `main` branch; the bridge README uses its repository subdirectory as the base URL.

VSIX packages include compiled outputs, documentation, Marketplace icons, and licenses. React and other browser dependencies, along with host-side `jsonc-parser`, are bundled at build time. Runtime does not depend on the development checkout's `node_modules`. Build scripts copy runtime dependency licenses.

When distributing GPL-covered packages, provide the corresponding source and build scripts matching the distributed version as required by the license. Source includes the main extension, bridge, shared modules, and build configuration. See [Third-party notices](../THIRD_PARTY_NOTICES.md).

For documentation changes, check Markdown formatting and whitespace in the Git diff.

```sh
npx prettier --check 'README*.md' 'docs/*.md' 'icon-theme-bridge/README*.md' 'THIRD_PARTY_NOTICES*.md'
git diff --check
```

For feature or UI changes, run relevant tests and verify real layout, themes, focus, and actions in VS Code. Packaging and installation checks do not replace UI verification.

## Documentation languages

English is the default language in `README.md`, the guides in `docs/`, and the bridge README. Each guide has a sibling `.zh-CN.md` translation and a language link at the top. Links within each language point to the corresponding translation where one exists. The English and Chinese third-party notices retain upstream attribution; bundled license texts remain in their original language.

Both VSIX packages include their Chinese README, and the main package includes both guide and notice languages. Marketplace descriptions use the English `README.md`. Update the language pairs together when documenting a behavior change.

## Local configuration and generated files

`.gitignore` excludes build outputs, VSIX files, test logs, editor configuration, environment files, and personal helper-tool configuration. Documentation uses generic example paths; machine-specific configuration belongs in ignored locations.

The Enhanced Git Performance output channel records query, indexing, and file comparison timings. Diagnostic output can contain runtime repository paths or Git errors; review environment information before sharing logs.
