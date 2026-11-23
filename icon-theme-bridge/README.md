# VS Git File Icon Theme Bridge

The local UI companion for VS Git. Its extension ID is `lvliangxiong.vsgit-icon-theme`; the main extension is `lvliangxiong.vsgit`.

## Responsibilities

- Resolves requested file icons using the active VS Code file icon theme and file associations.
- Provides editor theme settings and installed TextMate grammars for historical Merge Diff views.
- Reads resources from installed UI extensions and returns them through VS Code commands.

The bridge uses the `ui` extension host. Git commands run in the main extension's `workspace` host, beside the repository. In Remote-SSH windows the bridge runs locally and the main extension runs remotely. No bridge-specific configuration is required.

## Build and install

Run the following commands from the repository root:

```sh
npm ci
npm run package
code --install-extension dist/vsgit-icon-theme.vsix --force
code --install-extension dist/vsgit.vsix --force
```

The packaging script uses the main extension's publisher and version for the bridge. Install the bridge on the local VS Code client and the main extension where the repository is open, then run `Developer: Reload Window`.

See the [main README](../README.md) and [development guide](../docs/development.md) for usage and verification.

## License

Copyright (c) 2026 VS Git contributors.

Original bridge code is licensed under GNU GPL version 3 only (SPDX: GPL-3.0-only); see [LICENSE](LICENSE). Distributors must provide the corresponding source and build instructions as required by that license.

Bundled jsonc-parser and vscode-textmate retain their MIT licenses, included as `out/jsonc-parser-LICENSE.md` and `out/vscode-textmate-LICENSE.txt`. Installed third-party themes and language grammars are read at runtime and are not redistributed in this extension's VSIX.
