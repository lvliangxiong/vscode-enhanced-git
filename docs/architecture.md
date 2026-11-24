# Architecture and data flow

English | [简体中文](architecture.zh-CN.md)

## Module responsibilities

| Directory                     | Responsibility                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------- |
| `src/extension/extension.ts`  | Extension registration, log sessions, and Webview message routing                 |
| `src/extension/git/`          | Git queries, indexes, topology, stashes, file changes, and write operations       |
| `src/extension/repositories/` | Repository discovery, state events, and persisted recent selections and favorites |
| `src/extension/views/`        | Webview documents, embedded resources, and File Diffs lifecycle                   |
| `src/extension/syntax/`       | Editor theme, TextMate grammar, and syntax-highlighting adaptation                |
| `src/extension/icons/`        | File icon theme resolution and cross-host services                                |
| `src/icon-bridge/`            | Local UI host bridge entry point                                                  |
| `src/shared/`                 | Data models, filters, reference labels, and graph layout algorithms               |
| `src/webview/log/`            | Log composition, messages, selection, layout, and rendering controllers           |
| `src/webview/react/`          | React views, overlays, and component lifecycle                                    |
| `src/webview/state/`          | Zustand session and domain stores                                                 |
| `src/webview/styles/`         | Less styles and shared dimensions                                                 |
| `media/`                      | Static icons and asset source information                                         |
| `scripts/`                    | TypeScript build and packaging scripts                                            |
| `test/`                       | Unit tests, React/jsdom tests, and temporary Git repository integration tests     |

## Hosts and views

The main extension, `lvliangxiong.vscode-git`, runs in the workspace extension host, on the same machine as the repository. The companion, `lvliangxiong.vscode-git-icon-theme`, runs in the local UI host and supplies requested file icons, editor themes, and installed TextMate grammar resources through VS Code commands.

Browser entry points include the standalone log (`main.ts`), multi-repository container (`repository-host.ts`), two-way comparison container (`compare-host.ts`), File Diffs (`branch-changes.ts`), file history (`file-history.ts`), and three-pane merge comparison (`merge-diff.ts`). The multi-repository panel and two-way comparisons use Shadow DOM to isolate each log instance's DOM, styles, messages, and focus.

`log/session.tsx` composes a log through `mountLog()`. `LogContext` supplies environment adapters, a session store, controller interfaces, `Lifetime` resource management, and React UI interfaces. Each log session has one React root; containers and File Diffs have their own roots.

React components subscribe to session and domain stores and invoke controllers through callbacks. Controllers handle Git requests, selection, layout, and host messages. Separate services manage Canvas drawing, DOM measurement, CSSOM, and icon loading. `Lifetime` releases subscriptions, listeners, and animations when a view is disposed.

## State and requests

- `state/log.ts` stores commits, branches, filters, selection, column settings, layout, and loading state.
- `state/branches.ts` merges branch and stash snapshots, host favorite versions, request acknowledgments, and optimistic local updates.
- `state/details.ts` and `state/comparison.ts` manage files and selection in the third pane and standalone comparison sidebar.
- Recent selections and favorites are persisted per repository and synchronized across log sessions for that repository.

Request flow:

1. A Webview requests history, details, a comparison, or a Git operation.
2. The extension host identifies the repository, validates inputs, and calls the Git service.
3. `git/client.ts` launches Git with argument arrays. Results are parsed and graph layouts are calculated.
4. The host returns results to the corresponding session. Request numbers, selection keys, and comparison identities reject stale responses.
5. Store updates trigger React reconciliation and redraw the visible graph region.

`repositories/events.ts` subscribes to VS Code Git API repository events. The frontend's `history-refresh.ts` coalesces refresh requests and schedules them according to visibility and interaction state.

## History queries, caches, and indexes

The log first returns a small commit batch and lightweight references, then fills the configured history count and full-repository layout. Both stages share a request number. Background results retain valid selection and scroll state.

`history-cache.ts` caches repository snapshots, query results, and metadata. Cache identity includes references, HEAD, Git configuration, and special history boundaries. A manual refresh replaces query and metadata caches while compatible search and path indexes remain reusable.

`topology-reader.ts` reads full topology. When references change, it first attempts to join a recent block to the cached tail, falling back to a full read when parent relationships or reachability cannot be established. Layouts are cached per topology snapshot; `topology.ts` projects filtered edges onto visible commits.

`history-index.ts` and `message-index.ts` maintain bounded in-memory indexes for commit messages and authors. Queries fall back to Git when entry or output limits are exceeded, indexes are unavailable, or the query semantics are unsupported. `history-index-store.ts` writes versioned commit data with repository identity and checksums to extension-private storage, using temporary files and atomic replacement. In-memory indexes can be rebuilt after a restart. `history-index-update.ts` fills missing commit details from topology.

`path-index-store.ts` builds Git changed-path Bloom indexes in extension-private storage, accessing repository objects through a process-specific object directory and a read-only alternate. Git evaluates log path filters, including merge, rename, and multiple-path conditions. Standalone file history is handled by `git/file-history.ts`. The acceleration environment is used only for reads.

## Stashes and reference labels

`git/stashes.ts` identifies stash entries and their internal snapshots from the stash reflog. History queries and indexes hide internal index and untracked-file commits, retaining one visible node per stash connected to its base commit. Pagination counts visible commits, and stash reference changes contribute to cache identity.

The first pane's Stashes group uses the complete stash list and searches numbers and descriptions. Clicking navigates by commit hash rather than the mutable `stash@{n}` identifier. Stash selection is separate from branch write operations.

Stash file lists compare the base commit with the working-tree snapshot and include the untracked-file snapshot. Diffs read each file from its actual revision. Ordinary merge commits use the intersection of changes relative to all parents.

`shared/reference-labels.ts` parses HEAD, branch, tag, and stash decorations into compact or expanded groups. `shared/reference-layout.ts` allocates space according to column width, subject width, and display mode, shortens long names, and combines overflowing groups into an icon. `react/reference-labels.tsx` renders outline icons and names; `log/hover.ts` and `react/session-overlays.tsx` provide full names, copy actions, and themed popups.

`BranchTree` chooses icons based on the current reference, favorite state, and reference type. A tag at a detached HEAD can use the current-reference icon; presentation does not change Git operation targets. Reference labels use Rebased New UI light/dark colors and outlines. Width calculation and rendering share the same icon-height-scaled stacking offset. SVG masks remove occluded outlines and retain separation between layers, preventing rear icons from showing through translucent backgrounds.

## Layout and column widths

`log/layout.ts` manages sidebar widths, collapse state, details areas, and preview placement. The branch pane and file area scroll independently and support horizontal overflow. `log/columns.ts` stores column order and preferred widths and measures visible columns before a resize. Only the adjacent column on the left changes; all columns on the right share the adjustment according to their remaining resize capacity, preserving total width and minimum-width constraints. Hidden columns do not participate.

## File comparisons

The third pane and File Diffs share `FileList` and `file-tree.ts`. Their models retain folder expansion, file selection, and comparison endpoints. File Diffs captures the repository and commit selection at invocation and retains that scope on refresh.

`selection-reader.ts` batches commit metadata, file changes, and statistics. Ordinary merge commits retain files changed relative to every parent. Multiple selected commits are combined in log order, accounting for renames and additions/deletions that cancel out. Line statistics can arrive after the file list.

The Changes to xxx action reuses `commitFiles`, with endpoints fixed to the parent and selected merge commit. `views/open-working-file.ts` opens the working-tree file when present and otherwise reads an available historical revision into a read-only document.

Native diffs use read-only Git snapshots or working-tree files. Preview and native Diff requests are associated with the current selection so stale responses cannot replace a newer selection.

## File history and three-pane comparisons

`git/file-history.ts` reads a file's history from a fixed commit, follows paths explicitly across rename boundaries, and retains merge commits. `views/file-history.ts` manages the File History sidebar, which reuses commit list and graph components. Filters come from the host, and selecting a commit opens a native Diff in the editor.

`views/merge-diff.ts` and `webview/merge/` provide read-only three-pane comparisons using Monaco. `merge/three-way.ts` classifies fragments between the two parents and the merge result. Native Style uses aligned blank blocks; JetBrains Style uses continuous code and connectors. The Webview manages layout, scrolling, difference navigation, and overview markers.

`extension/syntax/` resolves theme and grammar configuration. The local bridge supplies UI extension resources unavailable on the remote host. TextMate and Oniguruma provide syntax highlighting in the Webview.

## Branch switching across repositories

`commands/switch-repositories.ts` collects local and remote branch candidates from discovered repositories. It groups operations by Git common directory, runs at most four groups concurrently, and processes worktrees within each group in workspace order. Write locks are shared with other Git write operations. A branch occupied by another worktree is opened in detached HEAD mode. Git's local-change checks remain in effect, and native notifications report results per repository.

## Rendering, themes, and resources

Commit lists use fixed-height virtualization, mounting only the viewport and buffer rows. `shared/graph.ts` indexes graph-edge intervals and generates geometry per row. `log/graph-render.ts` draws nodes and edges with Canvas, using a small number of SVG elements for arrow hit targets. `GraphTile` manages the drawing subtree's lifetime.

File lists and File Diffs share VS Code-style row backgrounds, focus behavior, and action icons. File names and status badges use Rebased colors. Sticky actions and the surrounding row use the same base color and a single overlay to avoid applying translucent selection backgrounds repeatedly.

Surfaces, text, and interaction states use VS Code CSS variables; branch/reference icons and file status colors use separate Rebased light/dark palettes. Theme and zoom changes repaint visible canvases. Fonts and icons use logical CSS pixels. Loading all history still requires the corresponding Git queries, transfers, and memory; virtualization primarily limits DOM and drawing costs.

React, React DOM, Zustand, Monaco, and their runtime dependencies are bundled into the corresponding Webview entry points. The host icon resolver and bridge bundle `jsonc-parser` separately. Dependency licenses are copied with build outputs; see [Third-party notices](../THIRD_PARTY_NOTICES.md).
