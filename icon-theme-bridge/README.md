# Enhanced Git File Icon Theme Bridge

English | [简体中文](README.zh-CN.md)

The local UI companion for Enhanced Git. Its extension ID is `lvliangxiong.vscode-enhanced-git-icon-theme`; the main extension is `lvliangxiong.vscode-enhanced-git`.

## Responsibilities

- Resolves requested file icons using the active VS Code file icon theme and file associations.
- Provides editor theme settings and installed TextMate grammars for historical Merge Diff views.
- Reads resources from installed UI extensions and returns them through VS Code commands.

The bridge uses the `ui` extension host. Git commands run in the main extension's `workspace` host, beside the repository. In Remote-SSH windows the bridge runs locally and the main extension runs remotely. No bridge-specific configuration is required.

## Installation relationship

Installing the [main extension from the Marketplace](https://marketplace.visualstudio.com/items?itemName=lvliangxiong.vscode-enhanced-git) also installs this bridge through its `extensionPack`. For offline installation, download both VSIX packages from the same [GitHub Release](https://github.com/lvliangxiong/vscode-enhanced-git/releases/latest) and install the bridge first.

[Source repository](https://github.com/lvliangxiong/vscode-enhanced-git/tree/main/icon-theme-bridge) · [Report an issue](https://github.com/lvliangxiong/vscode-enhanced-git/issues)

## Build and install

Run the following commands from the repository root:

```sh
npm ci
npm run package
code --install-extension dist/vscode-enhanced-git-icon-theme.vsix --force
code --install-extension dist/vscode-enhanced-git.vsix --force --do-not-include-pack-dependencies
```

The packaging script uses the main extension's publisher and version for the bridge. Install the bridge on the local VS Code client and the main extension where the repository is open, then run `Developer: Reload Window`.

See the [main README](https://github.com/lvliangxiong/vscode-enhanced-git/blob/main/README.md) and [development guide](https://github.com/lvliangxiong/vscode-enhanced-git/blob/main/docs/development.md) for usage and verification.

## License

Copyright (c) 2026 Enhanced Git contributors.

Original bridge code is licensed under GNU GPL version 3 only (SPDX: GPL-3.0-only); see [LICENSE](LICENSE). Distributors must provide the corresponding source and build instructions as required by that license.

Bundled jsonc-parser and vscode-textmate retain their MIT licenses, included as `out/jsonc-parser-LICENSE.md` and `out/vscode-textmate-LICENSE.txt`. Installed third-party themes and language grammars are read at runtime and are not redistributed in this extension's VSIX.

The Marketplace icon shares Enhanced Git's V-shaped commit graph mark and adds a connected link badge to identify the companion extension. The SVG and PNG are original Enhanced Git artwork covered by GPL-3.0-only; source artwork is in `media/marketplace-bridge-icon.svg` in the main repository.
