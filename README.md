# VS Code Git

English | [简体中文](README.zh-CN.md)

VS Code Git is a three-pane Git history extension for local and Remote-SSH workspaces in VS Code. It uses VS Code themes, file icon themes, and the native Diff editor. Branch and reference presentation and history navigation take inspiration from Rebased / JetBrains; changed file names use Rebased status colors.

The main extension is `lvliangxiong.vscode-git`. Its local UI companion is `lvliangxiong.vscode-git-icon-theme`.

## Core features

- **Three-pane history and multiple repositories**: browse branches, the commit graph, changed files, and commit details together, with independent filters and view state for each repository.
- **History filters and navigation**: filter by branch, author, date, path, commit message, or hash. Use recent selections, regular expressions, case matching, and hash / branch / tag navigation.
- **Commit graph and reference labels**: choose date or topological ordering, load history in pages, follow graph links, and adjust column order and widths. Colored reference groups show full names and copy actions on hover.
- **Stashes**: search stash numbers and descriptions in the first pane, ordered newest first, and locate them in the graph. Each stash has one graph node; its file list includes tracked changes and untracked files.
- **File comparisons**: use the File Diffs sidebar for endpoint snapshot comparisons, changes from selected commits, and comparisons with the working tree.
- **File history**: use History Up To Here or Show File History to browse a file up to a specified commit, including rename tracking, native diffs, working-tree comparisons, and navigation back to the log.
- **Historical merge comparisons**: inspect both parents and the committed result in a read-only three-pane Merge Diff, with difference navigation, synchronized scrolling, resizable panes, and Native / JetBrains display styles.
- **Branch switching across repositories**: search for a branch name and switch matching repositories from the Command Palette. Independent repositories run concurrently; worktrees sharing Git data run sequentially. Results appear in native notifications.
- **Branch and commit actions**: create, check out, update, delete, fetch, push, and favorite branches; create tags, export patches, copy hashes, and run, continue, skip, or abort cherry-picks.
- **Themes and remote workspaces**: the local UI bridge supplies file icons, editor themes, and grammar resources to remote workspaces. Git commands run on the host containing the repository.

## Opening and navigating the log

Open a Git repository in VS Code and press `Option+G` on macOS or `Alt+G` on other platforms, or run `VS Code Git: Open Git Log`. Use the bottom tabs to switch repositories in a multi-repository workspace.

| Area        | Interaction                                                                                                                                                                         |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| First pane  | Click to select a branch; double-click to set the Branch filter. Click a stash to locate its commit. Search matches branches, tags, and stash numbers or descriptions.              |
| Second pane | Click to select a commit, `Cmd/Ctrl-click` to select multiple commits, or `Shift-click` to select a range. Right-click for comparison and Git actions.                              |
| Third pane  | Browse changed files and details for the selection. Double-click a file or press Enter to open a diff. Combined changes from a two-parent merge can open the three-pane Merge Diff. |

The first and third panes can collapse completely using their toolbar buttons or by dragging their dividers to a very narrow width. The branch list and the file list in the upper part of the third pane support horizontal scrolling.

Drag commit columns to reorder them. When resizing a column boundary, only the immediately adjacent column on the left changes width; all visible columns on the right share the adjustment according to their remaining capacity toward their minimum or maximum width.

The Date column displays Author Date by default. Enable Commit Timestamp in View Options to display Committer Date. The timestamp display setting and the ordering setting in Graph Options control separate aspects of the log.

## Branch and reference icons

In the first pane, a filled gold tag represents the current reference when favorited; an outlined gold tag represents the current reference when not favorited. Other favorites use a star, ordinary branches use a branch icon, and ordinary tags use a gray tag icon. Stashes use a stash tray icon. Empty groups are hidden.

The second pane uses tag-shaped icons for all references: gold for HEAD, green for local branches, purple for remote-tracking branches, and gray for tags, stashes, and other references. Colors adapt to light and dark themes. Related references on the same commit can appear as `origin & branch-name`. Each reference type contributes at most two stacked layers, so the number of layers is not a reference count. Hover to see every reference.

## Changed files and comparisons

File name colors and A / M / D / R badges indicate change status: added files are green, modified files blue, and deleted files gray. Row backgrounds and action icons follow VS Code styling; file type icons follow the active file icon theme. Open File appears on hover or keyboard focus. It opens the working-tree file when available, or a read-only historical snapshot when the file is absent.

The third pane's left toolbar contains Show File Diffs, History Up To Here, and File View Options, in that order. The right side contains folder expansion and pane collapse controls.

| Entry point                                 | Behavior                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Compare Commit History                      | Shows commits unique to each side in two vertically arranged editor panes.                   |
| Show File Diffs in the third pane           | Opens the selected commits' combined changes in the File Diffs sidebar under Source Control. |
| Show File Diffs for two branches or commits | Compares the complete file snapshots at the two endpoints.                                   |
| Show File Diffs with Working Tree           | Compares a specified commit with the working tree.                                           |
| Button on a Changes to xxx row              | Compares that parent with the selected merge commit without toggling the group.              |
| History Up To Here                          | Shows the selected file's history up to the current commit; a file must be selected first.   |

Comparison semantics:

- Multiple selected commits are combined in log order to determine each file's before and after revisions. Noncontiguous or cross-branch selections may include content introduced by unselected commits; this is not equivalent to replaying only the selected patches.
- An ordinary merge's combined list contains files changed relative to every parent. No merge conflicts means this combined list is empty; it does not reconstruct the original manual conflict-resolution process. Changes relative to each parent can be expanded separately.
- The three-pane Merge Diff inspects a committed merge result. It does not write to the working tree or resolve an ongoing Git conflict. Native Style uses aligned blank blocks and addition/deletion markers; JetBrains Style uses continuous code and connectors between panes.
- File Diffs retains its comparison endpoints. Refresh reads the same comparison again. VS Code Git Graph versions exposing the relevant API provide Show Commit File Diffs and Locate in Git Log entry points.

## Switching branches across repositories

Run `VS Code Git: Switch Branch in All Repositories`, enter a branch name, and select a match. Candidates come from local and remote-tracking branches in the discovered repositories; a branch does not have to exist in every repository.

An existing local branch is checked out directly. A unique remote-tracking match creates a corresponding local tracking branch. If another worktree has the target local branch checked out, the repository switches to that branch's commit in detached HEAD mode. Missing branches, ambiguous remote matches, and local changes blocking checkout are reported per repository through native notifications. Changes are not forcibly overwritten.

Cherry-pick applies selected commits from bottom to top in the log and supports continuing, skipping, or aborting after conflicts. Merge commits requiring a mainline parent are not supported by this action.

## Settings, loading, and refresh

| Setting                           | Default  | Purpose                                                                                  |
| --------------------------------- | -------- | ---------------------------------------------------------------------------------------- |
| `vscode-git.history.initialCount` | `500`    | Commits loaded when opening the log or changing filters. `0` loads all matching commits. |
| `vscode-git.history.pageSize`     | `500`    | Additional commits per page, from `100` to `2000`. Not used when loading all history.    |
| `vscode-git.mergeDiffStyle`       | `native` | Display style for historical three-pane merge comparisons: `native` or `jetbrains`.      |

Settings can be configured per workspace folder. Refresh or reopen the log after changing loading limits. Merge Diff style changes apply to open comparisons.

More history loads automatically near the bottom of the list or when clicking Load more commits. The button disappears when all matching commits are loaded. Loading all history increases loading time and memory use.

The extension subscribes to repository state events from VS Code's Git extension. Refresh rereads history and repository metadata with the current filters; Fetch retrieves remote updates. When a commit-history comparison view is visible, `Cmd+J` on macOS or `Ctrl+J` on other platforms toggles the bottom panel.

## Companion installation

The main extension declares `lvliangxiong.vscode-git-icon-theme` in `extensionPack`. Once both extensions are published to the Marketplace, installing the main extension from the Marketplace also installs the companion. Publish the bridge before the main extension for the initial Marketplace release.

For local VSIX installation, install the bridge package first, then the main package. The main-package command below skips Marketplace resolution of pack members. In Remote-SSH windows, install the bridge on the local client and the main extension on the remote workspace host.

Source and support: [GitHub repository](https://github.com/lvliangxiong/vscode-git) · [Issues](https://github.com/lvliangxiong/vscode-git/issues).

## Building and installing

Development requires Node.js 22+, npm, and Git. The supported VS Code version range is declared in `engines.vscode` in `package.json`.

```sh
npm ci
npm run check
npm test
npm run package
code --install-extension dist/vscode-git-icon-theme.vsix --force
code --install-extension dist/vscode-git.vsix --force --do-not-include-pack-dependencies
```

Packages are written to `dist/vscode-git.vsix` and `dist/vscode-git-icon-theme.vsix`. Both extensions use the same publisher and version. Run `Developer: Reload Window` after installation.

In a Remote-SSH window, the main extension runs in the remote workspace host and the bridge runs in the local UI host. In a local window, both are installed locally.

- [Architecture and data flow](docs/architecture.md)
- [Development, verification, and installation](docs/development.md)
- [UI bridge](icon-theme-bridge/README.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)

## License

Copyright (c) 2026 VS Git contributors.

Original code is licensed under [GNU GPL version 3 only (GPL-3.0-only)](LICENSE). When distributing covered versions, provide the corresponding source and build scripts and retain the required notices as specified by the license. Third-party code, icons, and dependencies retain their own licenses; see [Third-party notices](THIRD_PARTY_NOTICES.md).
