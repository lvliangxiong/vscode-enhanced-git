# Third-party notices

English | [简体中文](THIRD_PARTY_NOTICES.zh-CN.md)

Original VS Code Git code is licensed under GPL-3.0-only; see LICENSE.
The third-party components listed below retain their respective licenses and notices.

The sparse filtered graph algorithm in `src/extension/git/topology.ts` is adapted from
`DottedFilterEdgesGenerator.kt` in JetBrains IntelliJ / Rebased.

Copyright 2000-2014 JetBrains s.r.o.
Licensed under the Apache License, Version 2.0; see LICENSE-APACHE-2.0.txt.
Source: https://github.com/detachhead/rebased/blob/main/platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/DottedFilterEdgesGenerator.kt

Current integration: TypeScript implementation using hash-indexed Git topology;
full graph passes and visible-parent output, without incremental boundary arrows.

## Graph layout and rendering

`src/shared/graph.ts` and the graph renderer in `src/webview/log/graph-render.ts` adapt the following
IntelliJ / Rebased sources (Copyright 2000-2025 JetBrains s.r.o. and contributors):

- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/permanent/GraphLayoutBuilder.kt`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/GraphElementComparatorByLayoutIndex.java`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/PrintElementPresentationManagerImpl.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/graph/DefaultColorGenerator.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/PaintParameters.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCellUtil.kt`
- `plugins/git4idea/backend/src/log/GitRefManager.kt`
- `platform/util/base/src/com/intellij/openapi/util/text/NaturalComparator.java`

Licensed under Apache-2.0; see LICENSE-APACHE-2.0.txt.
Source repository: https://github.com/detachhead/rebased
Current integration: TypeScript full-history layout metadata, cached visible-row Canvas
rendering with SVG arrow hit targets, per-row text insets and viewport clipping,
offset keyboard/clickable arrows, VS Code theme selection, and a shared Canvas/React tile layer for Git Log and file-history sidebars.
Only loaded endpoints are drawn; there are no synthetic unloaded-commit nodes.

## UI icons

The commit context menu follows Rebased's `CopyRevisionNumberAction.java`,
`VcsLogCreatePatchActionProvider.java`, `GoToParentOrChildAction.kt`,
`GitCreateNewBranchFromCommitAction.kt`, and `GitCreateTagAction.java`.
Copyright JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: accessible DOM menus and dialogs, VS Code clipboard/save APIs,
and isolated Git indexes for patch export. Copy and patch SVG assets retain
their upstream paths in `media/icons/SOURCES.txt`.

The collapsible branches stripe follows Rebased's
`plugins/git4idea/backend/src/ui/branch/dashboard/ExpandStripeButton.kt`,
`ExpandablePanelController.kt`, and `BranchesInGitLogUiFactoryProvider.kt`.
Copyright 2000-2021 JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: theme-aware DOM/CSS stripe, accessible toggle, preserved tree,
and VS Code workspace persistence of visibility and pane widths.

The multi-branch menu and comparison layouts follow Rebased's
`plugins/git4idea/backend/src/ui/branch/dashboard/BranchesDashboardActions.kt`,
`plugins/git4idea/backend/src/branch/GitCompareBranchesUi.kt`, and
`plugins/git4idea/backend/src/branch/GitCompareBranchesHelper.java`.
Copyright JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: independent DOM log instances, a branch-tip changes drawer,
VS Code native Diff documents, and preflighted Git CLI batch operations.

The filter menus in `src/webview/filters.ts` follow the Rebased implementations in
`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/`:
`BranchFilterPopupComponent.java`, `BranchPopupBuilder.java`,
`UserFilterPopupComponent.java`, `DateFilterPopupComponent.java`,
`StructureFilterPopupComponent.java`, `MultipleValueFilterPopupComponent.java`,
and `MultilinePopupBuilder.java`. The recent-group limit and ordering follow
`platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogProjectTabsProperties.kt`.
Copyright 2000-2025 JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: DOM menus and dialogs, Git CLI filter resolution, and a directory
chooser reading the filesystem through the VS Code workspace extension host.

The Graph Options status badge follows Rebased's
`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/VcsLogGraphOptionsChooserGroup.java`,
`platform/core-ui/src/ui/BadgeDotProvider.kt`, and
`platform/util/ui/src/com/intellij/util/ui/JBUI.java`.
Its option predicate, badge geometry, and light/dark success colors are adapted
to DOM/CSS rendering. Copyright 2000-2024 JetBrains s.r.o. and contributors;
licensed under Apache-2.0 (see LICENSE-APACHE-2.0.txt).

Except for `sidebar.svg` (see below), the SVGs in `media/icons/` are unmodified JetBrains IntelliJ / Rebased UI icons.
Copyright 2000-2024 JetBrains s.r.o. and contributors.
Licensed under the Apache License, Version 2.0; see LICENSE-APACHE-2.0.txt.
Original copyright notices are retained in each SVG. The exact source paths
are recorded in `media/icons/SOURCES.txt`.
Source repository: https://github.com/detachhead/rebased

This software includes code from IntelliJ IDEA
Copyright (C) JetBrains s.r.o.
https://www.jetbrains.com/idea/

## View container icon

`media/icons/sidebar.svg` is adapted from JetBrains IntelliJ / Rebased's
`platform/icons/src/expui/general/vcs_dark.svg` (also retained as
`media/icons/branch_dark.svg`). Copyright 2000-2023 JetBrains s.r.o. and
contributors; licensed under Apache-2.0 (see LICENSE-APACHE-2.0.txt).
Current integration: 24px intrinsic dimensions and a 16px viewBox for VS Code view
containers. The original geometry and copyright notice are retained.

## jsonc-parser

The icon theme loader includes Microsoft jsonc-parser 3.3.1 (MIT), for VS Code JSON-with-comments theme files. Source: https://github.com/microsoft/node-jsonc-parser. Installed through npm and bundled into both extensions at build time. The upstream LICENSE.md is included at out/jsonc-parser-LICENSE.md in both VSIX packages.

## React UI runtime

The main extension bundles these npm dependencies into its webview entry points
(`out/webview/main.js`, `repository-host.js`, `compare-host.js`,
`branch-changes.js`, `file-history.js`, and `monaco/merge-diff.js`); they do not require a runtime `node_modules` directory:

- React and React DOM, Copyright Meta Platforms, Inc. and affiliates, MIT.
  Source: https://github.com/facebook/react.
  Upstream notices are included as `out/react-LICENSE.txt` and
  `out/react-dom-LICENSE.txt`.
- Scheduler (a React DOM dependency), Copyright Meta Platforms, Inc. and affiliates,
  MIT. Source: https://github.com/facebook/react/tree/main/packages/scheduler.
  Upstream notice: `out/scheduler-LICENSE.txt`.
- Zustand, Copyright (c) 2019 Paul Henschel, MIT. Source: https://github.com/pmndrs/zustand.
  Upstream notice: `out/zustand-LICENSE.txt`.

Exact package versions are recorded in `package-lock.json`. These dependencies are
used by the main extension UI; the local icon bridge does not include them.

## Historical merge editor

The standalone historical three-column viewer bundles Monaco Editor 0.57.0
(Microsoft Corporation, MIT) from https://github.com/microsoft/monaco-editor.
It includes built-in language tokenizers and the bundled Codicons font. Upstream
license and embedded dependency notices are included as
`out/monaco-editor-LICENSE.txt` and `out/monaco-editor-ThirdPartyNotices.txt`.
Monaco's runtime dependencies Marked (MIT, https://github.com/markedjs/marked)
and DOMPurify (Apache-2.0 or MPL-2.0, https://github.com/cure53/DOMPurify) are
bundled where imported. This distribution includes DOMPurify's Apache-2.0
license in `out/dompurify-LICENSE.txt` and Marked's notice in
`out/marked-LICENSE.txt`. Exact resolved versions are in `package-lock.json`.
These assets load only in the historical merge webview; no CDN or installed
VS Code source files are used.

## Historical merge changes

`src/extension/git/merge-changes.ts`, the parent-group presentation, and the
historical diff revision ordering follow these IntelliJ / Rebased sources at
revision `c40cfe677190956dfeb72d9ea822813f35ad38dd`:

- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsStatusMerger.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsChangesLazilyParsedDetails.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/MergedChangeDiffRequestProvider.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/frame/VcsLogAsyncChangesTreeModel.kt`

Copyright 2000-2025 JetBrains s.r.o. and contributors, Apache-2.0;
see LICENSE-APACHE-2.0.txt. Source: https://github.com/detachhead/rebased.
Current integration: TypeScript status merging with real per-parent rename paths,
cached parent comparisons, and a read-only React shell containing three virtualized Monaco editors.
Git computes line edit ranges; the viewer aligns them on the committed merge result.

The Go to Hash / Branch / Tag interaction follows Rebased's
`platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/GoToHashOrRefAction.java`,
`GoToHashOrRefPopup.java`, and `impl/VcsLogNavigationUtil.kt` at
commit `c40cfe677190956dfeb72d9ea822813f35ad38dd`.
Copyright JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: VS Code native QuickPick completion, Git CLI revision resolution,
and request-scoped navigation in the webview instead of changing branch filters.

The branch rail follows Rebased's `BranchesDashboardTreeComponent.createActionGroup`
and `BranchesDashboardActions` (NewBranch, UpdateSelectedBranch, DeleteBranch,
ShowBranchDiff, ToggleFavorite) under
`plugins/git4idea/backend/src/ui/branch/dashboard/`, at commit
`c40cfe677190956dfeb72d9ea822813f35ad38dd`.
Copyright JetBrains s.r.o. and contributors, Apache-2.0.
Current integration: VS Code prompts, repository-scoped commands, existing fast-forward
and merged-branch checks, and DOM tree expansion.

## Search indexing design references

The indexing design references Rebased revision
`c40cfe677190956dfeb72d9ea822813f35ad38dd`:
`VcsLogPersistentIndex.java`, `VcsLogPathsIndex.java`, `IndexDataGetter.java`,
`GitLogIndexer.kt`, and `GitCompressedDetailsCollector.kt`.
These upstream sources are Copyright JetBrains s.r.o. and contributors, Apache-2.0.
The TypeScript index services implement the workflow;
the path backend invokes the user's installed Git commit-graph/Bloom index,
rather than embedding Rebased's Java storage or distributing a Git binary.
See `docs/architecture.md` for the current index architecture.

## Incremental log refresh design references

`src/extension/git/topology-reader.ts` follows the recent-block join, expanded retry,
and full-read fallback workflow from Rebased revision
`c40cfe677190956dfeb72d9ea822813f35ad38dd`:

- `platform/vcs-log/impl/src/com/intellij/vcs/log/data/VcsLogRefresherImpl.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/data/VcsLogJoiner.java`

The reference sources are Copyright 2000-2025 JetBrains s.r.o. and contributors,
Apache-2.0 (see LICENSE-APACHE-2.0.txt), https://github.com/detachhead/rebased.
The TypeScript implementation uses hash-based reachability and an unchanged-head
fast path, retaining Git's recent prefix and the surviving cached tail. It does
not embed the Java implementation or its storage format.

## Reference label presentation

The outline reference labels, HEAD grouping, local/tracking branch names and reference tooltips
follow the presentation rules from Rebased revision
`c40cfe677190956dfeb72d9ea822813f35ad38dd`, in `GitRefManager.kt`, `SimpleRefGroup.kt`,
`LabelIcon.java`, `TagPainter.kt`, `LabelPainter.java`, `GraphCommitCellRenderer.kt`, `VcsLogUiUtil.java`
and `TooltipReferencesPanel.java` (JetBrains s.r.o. and contributors,
Apache-2.0). The React components use an SVG adaptation of the TagPainter outline,
with masks for overlap and the New UI light/dark reference palette.
Branch-tree icon precedence follows `GitBranchesTreeIconProvider.kt`; the current
and current-favorite SVG assets are recorded in `media/icons/SOURCES.txt`.
Source: https://github.com/DetachHead/rebased

## Monaco theme and TextMate adapter

The historical viewer bundles Microsoft `vscode-textmate` 9.3.2 and
`vscode-oniguruma` 2.0.1 (MIT), including the locally packaged Oniguruma WASM.
Sources: https://github.com/microsoft/vscode-textmate and
https://github.com/microsoft/vscode-oniguruma. Notices are shipped as
`out/vscode-textmate-LICENSE.txt`, `out/vscode-oniguruma-LICENSE.txt`, and
`out/vscode-oniguruma-NOTICES.txt`; the UI bridge includes TextMate's notice.
User-installed themes and language grammars are read from their installed
extensions at runtime and are not redistributed in the VSIX.

## Three-way merge-result fragments

`src/webview/merge/three-way.ts` is a TypeScript implementation of the shared
fragment classification defined in Rebased revision
`c40cfe677190956dfeb72d9ea822813f35ad38dd`:

- `platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt`
- `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt`
- `platform/diff-impl/src/com/intellij/diff/tools/util/text/SimpleThreesideTextDiffProvider.java`

Copyright 2000-2024 JetBrains s.r.o. and contributors, Apache-2.0
(see LICENSE-APACHE-2.0.txt), https://github.com/detachhead/rebased.
The viewer uses MERGE_RESULT insertion/deletion inversion, one classification
per shared fragment, and no decorations for unchanged parent fragments.
Pairwise line matching uses Git histogram rather than embedding Rebased's
JVM ByLine engine; repeated boilerplate can therefore still match differently.
Conflict coloring describes the three displayed texts, not a claim about a
commit's original merge/conflict state.

## VS Code file and tree action icons

The inline `fileDiff` SVG in `src/webview/react/log-chrome.tsx` reproduces
Microsoft Codicons `diff-multiple` without changing its path geometry.
Source: https://github.com/microsoft/vscode-codicons/blob/main/src/icons/diff-multiple.svg
Copyright (c) Microsoft Corporation and contributors.
Repository content is licensed under Creative Commons Attribution 4.0 International
(https://creativecommons.org/licenses/by/4.0/); repository code uses MIT.
The SVG inherits the active VS Code foreground color.

`src/webview/react/native-file-icon.tsx` uses the same project's `go-to-file`
and `chevron-right` SVG paths without geometry changes, inheriting the active
VS Code icon foreground. These icons have the same copyright and CC-BY-4.0 license:
https://github.com/microsoft/vscode-codicons/tree/main/src/icons

MIT License

    Copyright (c) Microsoft Corporation.

    Permission is hereby granted, free of charge, to any person obtaining a copy
    of this software and associated documentation files (the "Software"), to deal
    in the Software without restriction, including without limitation the rights
    to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
    copies of the Software, and to permit persons to whom the Software is
    furnished to do so, subject to the following conditions:

    The above copyright notice and this permission notice shall be included in all
    copies or substantial portions of the Software.

    THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
    IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
    FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
    AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
    LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
    OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
    SOFTWARE
