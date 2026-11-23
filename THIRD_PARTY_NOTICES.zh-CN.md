# 第三方声明

[English](THIRD_PARTY_NOTICES.md) | 简体中文

VS Git 原创代码采用 GPL-3.0-only，详见 LICENSE。以下第三方组件保留各自的许可证和版权声明。本文提供中文归属及集成说明；随附许可证条款保留原文。

`src/extension/git/topology.ts` 中的稀疏筛选图算法改编自 JetBrains IntelliJ / Rebased 的 `DottedFilterEdgesGenerator.kt`。

Copyright 2000-2014 JetBrains s.r.o.
采用 Apache License, Version 2.0，详见 LICENSE-APACHE-2.0.txt。
来源：<https://github.com/detachhead/rebased/blob/main/platform/vcs-log/graph/src/com/intellij/vcs/log/graph/collapsing/DottedFilterEdgesGenerator.kt>

当前集成：使用按哈希索引的 Git 拓扑实现 TypeScript 算法，执行全图遍历并输出可见父节点，不采用增量边界箭头。

## 图布局与渲染

`src/shared/graph.ts` 以及 `src/webview/log/graph-render.ts` 中的渲染器改编自以下 IntelliJ / Rebased 源码（Copyright 2000-2025 JetBrains s.r.o. and contributors）：

- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/permanent/GraphLayoutBuilder.kt`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/GraphElementComparatorByLayoutIndex.java`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/print/PrintElementGeneratorImpl.kt`
- `platform/vcs-log/graph/src/com/intellij/vcs/log/graph/impl/facade/PrintElementPresentationManagerImpl.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/graph/DefaultColorGenerator.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/SimpleGraphCellPainter.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/paint/PaintParameters.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/render/GraphCommitCellUtil.kt`
- `plugins/git4idea/backend/src/log/GitRefManager.kt`
- `platform/util/base/src/com/intellij/util/text/NaturalComparator.java`

采用 Apache-2.0，详见 LICENSE-APACHE-2.0.txt。来源仓库：<https://github.com/detachhead/rebased>

当前集成：TypeScript 全历史布局元数据、带缓存的可见行 Canvas 渲染、SVG 箭头命中区域、按行文字偏移、视口裁剪、支持偏移和键盘／点击操作的箭头、VS Code 主题选择，以及 Git Log 和文件历史侧栏共用的 Canvas/React 图块层。只绘制已加载端点，不生成虚拟的未加载提交节点。

## 界面图标

提交上下文菜单参考 Rebased 的 `CopyRevisionNumberAction.java`、`VcsLogCreatePatchActionProvider.java`、`GoToParentOrChildAction.kt`、`GitCreateNewBranchFromCommitAction.kt` 和 `GitCreateTagAction.java`。
Copyright JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：可访问的 DOM 菜单与对话框、VS Code 剪贴板／保存 API，以及导出 Patch 使用的隔离 Git index。复制和 Patch 的 SVG 来源记录于 `media/icons/SOURCES.txt`。

分支折叠条参考 Rebased 的 `plugins/git4idea/backend/src/ui/branch/dashboard/ExpandStripeButton.kt`、`ExpandablePanelController.kt` 和 `BranchesInGitLogUiFactoryProvider.kt`。
Copyright 2000-2021 JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：适配主题的 DOM/CSS 折叠条、可访问的切换按钮、保留树内容，以及通过 VS Code 工作区状态保存可见性和栏宽。

多分支菜单与比较布局参考 Rebased 的 `plugins/git4idea/backend/src/ui/branch/dashboard/BranchesDashboardActions.kt`、`plugins/git4idea/backend/src/branch/GitCompareBranchesUi.kt` 和 `plugins/git4idea/backend/src/branch/GitCompareBranchesHelper.java`。
Copyright JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：独立 DOM 日志实例、分支端点文件变更侧栏、VS Code 原生 Diff 文档，以及带预检的 Git CLI 批量操作。

`src/webview/filters.ts` 中的筛选菜单参考 Rebased 的 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/`：`BranchFilterPopupComponent.java`、`BranchPopupBuilder.java`、`UserFilterPopupComponent.java`、`DateFilterPopupComponent.java`、`StructureFilterPopupComponent.java`、`MultipleValueFilterPopupComponent.java` 和 `MultilinePopupBuilder.java`。Recent 分组的数量和排序参考 `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsLogProjectTabsProperties.kt`。
Copyright 2000-2025 JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：DOM 菜单与对话框、Git CLI 筛选解析，以及通过 VS Code workspace 宿主读取文件系统的目录选择器。

Graph Options 状态标记参考 Rebased 的 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/filter/VcsLogGraphOptionsChooserGroup.java`、`platform/core-ui/src/ui/BadgeDotProvider.kt` 和 `platform/util/ui/src/com/intellij/util/ui/JBUI.java`。选项判断、标记几何和明暗主题成功状态颜色适配为 DOM/CSS 渲染。
Copyright 2000-2024 JetBrains s.r.o. and contributors，Apache-2.0，详见 LICENSE-APACHE-2.0.txt。

除下文说明的 `sidebar.svg` 外，`media/icons/` 中的 SVG 均为未修改的 JetBrains IntelliJ / Rebased 界面图标。
Copyright 2000-2024 JetBrains s.r.o. and contributors。
采用 Apache License, Version 2.0，详见 LICENSE-APACHE-2.0.txt。各 SVG 保留原版权注释，具体来源路径记录于 `media/icons/SOURCES.txt`。来源仓库：<https://github.com/detachhead/rebased>

This software includes code from IntelliJ IDEA
Copyright (C) JetBrains s.r.o.
<https://www.jetbrains.com/idea/>

## 视图容器图标

`media/icons/sidebar.svg` 改编自 JetBrains IntelliJ / Rebased 的 `platform/icons/src/expui/general/vcs_dark.svg`（同时保留为 `media/icons/branch_dark.svg`）。
Copyright 2000-2023 JetBrains s.r.o. and contributors，Apache-2.0，详见 LICENSE-APACHE-2.0.txt。
当前集成：为 VS Code 视图容器设置 24px 固有尺寸和 16px viewBox，保留原几何和版权注释。

## jsonc-parser

图标主题加载器包含 Microsoft jsonc-parser 3.3.1（MIT），用于解析 VS Code JSON-with-comments 主题文件。来源：<https://github.com/microsoft/node-jsonc-parser> 。通过 npm 安装，并在构建时分别打包到两个扩展。两个 VSIX 均包含上游 LICENSE.md，路径为 `out/jsonc-parser-LICENSE.md`。

## React 界面运行时

主插件将以下 npm 依赖打包进 Webview 入口（`out/webview/main.js`、`repository-host.js`、`compare-host.js`、`branch-changes.js`、`file-history.js` 和 `monaco/merge-diff.js`），运行时不需要独立的 `node_modules` 目录：

- React 和 React DOM，Copyright Meta Platforms, Inc. and affiliates，MIT。来源：<https://github.com/facebook/react> 。随附声明为 `out/react-LICENSE.txt` 和 `out/react-dom-LICENSE.txt`。
- Scheduler（React DOM 的依赖），Copyright Meta Platforms, Inc. and affiliates，MIT。来源：<https://github.com/facebook/react/tree/main/packages/scheduler> 。随附声明为 `out/scheduler-LICENSE.txt`。
- Zustand，Copyright (c) 2019 Paul Henschel，MIT。来源：<https://github.com/pmndrs/zustand> 。随附声明为 `out/zustand-LICENSE.txt`。

精确依赖版本记录于 `package-lock.json`。这些依赖用于主插件界面，本地桥接插件不包含它们。

## 历史合并编辑器

独立的历史三栏比较视图包含 Monaco Editor 0.57.0（Microsoft Corporation，MIT），来源：<https://github.com/microsoft/monaco-editor> 。其中包含内置语言 tokenizer 和 Codicons 字体，上游许可证及依赖声明位于 `out/monaco-editor-LICENSE.txt` 和 `out/monaco-editor-ThirdPartyNotices.txt`。

Monaco 的运行依赖 Marked（MIT，<https://github.com/markedjs/marked>）和 DOMPurify（Apache-2.0 或 MPL-2.0，<https://github.com/cure53/DOMPurify>）在导入处随构建打包。本发行版包含 DOMPurify 的 Apache-2.0 许可证 `out/dompurify-LICENSE.txt`，以及 Marked 的 `out/marked-LICENSE.txt`。精确版本记录于 `package-lock.json`。

这些资源只在历史合并 Webview 中加载，不使用 CDN 或本机 VS Code 的源码文件。

## 历史合并变更

`src/extension/git/merge-changes.ts`、父提交分组展示和历史 Diff 版本顺序参考以下 IntelliJ / Rebased 源码，来源版本为 `c40cfe677190956dfeb72d9ea822813f35ad38dd`：

- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsStatusMerger.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/VcsChangesLazilyParsedDetails.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/impl/MergedChangeDiffRequestProvider.java`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/frame/VcsLogAsyncChangesTreeModel.kt`

Copyright 2000-2025 JetBrains s.r.o. and contributors，Apache-2.0，详见 LICENSE-APACHE-2.0.txt。来源：<https://github.com/detachhead/rebased> 。
当前集成：TypeScript 状态合并、各父版本的真实重命名路径、缓存的父提交比较，以及包含三个虚拟化 Monaco 编辑器的只读 React 界面。Git 计算行编辑范围，视图以已提交的合并结果对齐。

Go to Hash / Branch / Tag 交互参考 Rebased 的 `platform/vcs-log/impl/src/com/intellij/vcs/log/ui/actions/GoToHashOrRefAction.java`、`GoToHashOrRefPopup.java` 和 `impl/VcsLogNavigationUtil.kt`，来源提交为 `c40cfe677190956dfeb72d9ea822813f35ad38dd`。
Copyright JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：VS Code 原生 QuickPick 补全、Git CLI 版本解析，以及按请求定位 Webview 中的提交，不改变分支筛选。

分支操作栏参考 Rebased 中 `plugins/git4idea/backend/src/ui/branch/dashboard/` 下的 `BranchesDashboardTreeComponent.createActionGroup` 和 `BranchesDashboardActions`（NewBranch、UpdateSelectedBranch、DeleteBranch、ShowBranchDiff、ToggleFavorite），来源提交为 `c40cfe677190956dfeb72d9ea822813f35ad38dd`。
Copyright JetBrains s.r.o. and contributors，Apache-2.0。
当前集成：VS Code 提示、仓库范围命令、快进和已合并分支检查，以及 DOM 树展开。

## 搜索索引设计参考

索引设计参考 Rebased 版本 `c40cfe677190956dfeb72d9ea822813f35ad38dd` 的 `VcsLogPersistentIndex.java`、`VcsLogPathsIndex.java`、`IndexDataGetter.java`、`GitLogIndexer.kt` 和 `GitCompressedDetailsCollector.kt`。
这些上游源码为 Copyright 2000-2025 JetBrains s.r.o. and contributors，Apache-2.0。
TypeScript 索引服务实现对应流程；路径后端调用用户已安装的 Git commit-graph/Bloom 索引，不嵌入 Rebased 的 Java 存储，也不分发 Git 二进制。当前索引架构见 [架构说明](docs/architecture.zh-CN.md)。

## 增量日志刷新设计参考

`src/extension/git/topology-reader.ts` 的近期块拼接、扩大范围重试和全量读取回退参考 Rebased 版本 `c40cfe677190956dfeb72d9ea822813f35ad38dd`：

- `platform/vcs-log/impl/src/com/intellij/vcs/log/data/VcsLogRefresherImpl.kt`
- `platform/vcs-log/impl/src/com/intellij/vcs/log/data/VcsLogJoiner.java`

来源源码为 Copyright 2000-2025 JetBrains s.r.o. and contributors，Apache-2.0（详见 LICENSE-APACHE-2.0.txt），<https://github.com/detachhead/rebased> 。
TypeScript 实现使用基于哈希的可达性和 HEAD 未变化时的快速路径，保留 Git 返回的近期前缀及仍然有效的缓存尾部，不嵌入 Java 实现或其存储格式。

## 引用标签展示

轮廓引用标签、HEAD 分组、本地／跟踪分支命名和引用悬浮提示参考 Rebased 版本 `c40cfe677190956dfeb72d9ea822813f35ad38dd` 中的 `GitRefManager.kt`、`SimpleRefGroup.kt`、`LabelIcon.java`、`TagPainter.kt`、`LabelPainter.java`、`GraphCommitCellRenderer.kt`、`VcsLogUiUtil.java` 和 `TooltipReferencesPanel.java`。
JetBrains s.r.o. and contributors，Apache-2.0。
React 组件使用 TagPainter 轮廓的 SVG 适配，配合重叠遮罩和 New UI 明暗引用配色。分支树图标优先级参考 `GitBranchesTreeIconProvider.kt`；当前引用和当前收藏引用的 SVG 来源记录于 `media/icons/SOURCES.txt`。
来源：<https://github.com/DetachHead/rebased>

## Monaco 主题与 TextMate 适配

历史比较视图包含 Microsoft `vscode-textmate` 9.3.2 和 `vscode-oniguruma` 2.0.1（MIT），包括本地打包的 Oniguruma WASM。
来源：<https://github.com/microsoft/vscode-textmate> 和 <https://github.com/microsoft/vscode-oniguruma> 。
声明随包分发于 `out/vscode-textmate-LICENSE.txt`、`out/vscode-oniguruma-LICENSE.txt` 和 `out/vscode-oniguruma-NOTICES.txt`；UI 桥接也包含 TextMate 的声明。
用户安装的主题和语言语法从已安装扩展中按需读取，不随 VSIX 重新分发。

## 三方合并结果片段

`src/webview/merge/three-way.ts` 使用 TypeScript 实现 Rebased 版本 `c40cfe677190956dfeb72d9ea822813f35ad38dd` 中定义的共享片段分类：

- `platform/util/diff/src/com/intellij/diff/comparison/ComparisonMergeUtil.kt`
- `platform/util/diff/src/com/intellij/diff/util/MergeRangeUtil.kt`
- `platform/diff-impl/src/com/intellij/diff/tools/util/text/SimpleThreesideTextDiffProvider.java`

Copyright 2000-2024 JetBrains s.r.o. and contributors，Apache-2.0（详见 LICENSE-APACHE-2.0.txt），<https://github.com/detachhead/rebased> 。
视图使用 MERGE_RESULT 的增删反转规则，每个共享片段只分类一次，父版本未变化的片段不添加装饰。两两行匹配使用 Git histogram，不嵌入 Rebased 的 JVM ByLine 引擎，因此重复模板代码的匹配结果仍可能不同。冲突颜色描述当前展示的三个文本，不代表提交原始合并／冲突状态。

## VS Code 文件与树操作图标

`src/webview/react/log-chrome.tsx` 中的内联 `fileDiff` SVG 使用 Microsoft Codicons 的 `diff-multiple`，不修改路径几何。
来源：<https://github.com/microsoft/vscode-codicons/blob/main/src/icons/diff-multiple.svg>
Copyright (c) Microsoft Corporation and contributors。
仓库内容采用 Creative Commons Attribution 4.0 International（<https://creativecommons.org/licenses/by/4.0/>），仓库代码采用 MIT。SVG 继承当前 VS Code 前景色。

`src/webview/react/native-file-icon.tsx` 使用同一项目的 `go-to-file` 和 `chevron-right` SVG 路径，不修改几何，继承当前 VS Code 图标前景色。这些图标采用相同版权和 CC-BY-4.0 许可证。
来源：<https://github.com/microsoft/vscode-codicons/tree/main/src/icons>

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
