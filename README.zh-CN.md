# VS Git

[English](README.md) | 简体中文

VS Git 是面向 VS Code 的三栏 Git 日志插件，支持本地和 Remote-SSH 工作区。界面使用 VS Code 主题、文件图标主题和原生 Diff 编辑器；分支与引用标签的展示规则、历史浏览交互参考 Rebased / JetBrains，文件变更名称使用 Rebased 状态配色。

主插件 ID 为 `lvliangxiong.vsgit`，本地 UI 桥接插件 ID 为 `lvliangxiong.vsgit-icon-theme`。

## 核心功能

- **三栏日志与多仓库视图**：分支树、提交图、文件变更和提交详情集中展示，各仓库保存独立的筛选与视图状态。
- **历史筛选与定位**：支持分支、作者、日期、路径、提交正文和 Hash 筛选，以及 Recent、正则、大小写匹配和 Hash / 分支 / 标签跳转。
- **提交图与引用标签**：支持日期或拓扑排序、分页加载、图中跳转、列顺序和列宽调整；引用标签按类型着色、分组叠放，悬浮可查看和复制完整名称。
- **Stashes**：第一栏按最新在前展示 stash 编号和说明，支持搜索和定位；主图每份 stash 显示一个节点，文件变更包含已跟踪修改和未跟踪文件。
- **文件比较**：提供独立的 File Diffs 侧栏，支持两个版本的快照比较、所选提交的变更汇总，以及与工作区比较。
- **文件历史**：通过 History Up To Here 或 Show File History 查看文件截至指定提交的历史，支持重命名追踪、原生 Diff、与工作区比较及定位日志。
- **历史合并比较**：只读三栏 Merge Diff 展示两个父版本和合并结果，支持差异导航、同步滚动、栏宽调整及 Native / JetBrains 两种显示样式。
- **多仓库分支切换**：在命令面板搜索同名分支并批量切换，独立仓库并发处理，共享 Git 数据的 worktree 顺序处理，结果通过原生通知展示。
- **分支与提交操作**：支持创建、检出、更新、删除分支，Fetch、Push、收藏、创建标签、导出 Patch、复制 Hash，以及 Cherry-pick 的执行、继续、跳过和中止。
- **主题与远程支持**：本地 UI 桥接为远端工作区提供文件图标、编辑器主题和语法资源；Git 操作在仓库所在的扩展宿主执行。

## 打开与浏览

在 VS Code 中打开 Git 仓库，按 `Option+G`（macOS）或 `Alt+G`，也可执行 `VS Git: Open Git Log`。多仓库工作区通过底部标签切换仓库。

| 区域   | 操作                                                                                                         |
| ------ | ------------------------------------------------------------------------------------------------------------ |
| 第一栏 | 单击选择分支，双击设置 Branch 筛选；点击 Stashes 条目定位对应提交。搜索框匹配分支、标签和 stash 编号或说明。 |
| 第二栏 | 单击选择提交，`Cmd/Ctrl-click` 多选，`Shift-click` 范围选择；右键菜单提供比较和 Git 操作。                   |
| 第三栏 | 浏览所选提交的文件变更和详情；双击文件或按 Enter 打开 Diff。双父合并的汇总文件可进入三栏 Merge Diff。        |

第一栏和第三栏可用顶部按钮完全折叠，拖动分隔线到很窄时也会折叠。分支列表和第三栏上半部分的文件列表支持横向滚动。

提交列可拖动调整顺序。拖动列边界时，左侧仅紧邻边界的列改变宽度，右侧所有可见列按距离最小／最大宽度的可伸缩空间分担变化量。

日期列默认显示 Author Date；View Options 中的 Commit Timestamp 改为显示 Committer Date。日期显示选项与 Graph Options 中的排序方式分别控制显示时间和提交顺序。

## 分支与引用图标

第一栏中的图标由引用状态决定：当前且已收藏使用实心金色吊牌，当前未收藏使用空心金色吊牌，其他收藏项使用星星，普通分支使用分叉图标，普通标签使用灰色吊牌。Stashes 使用暂存盒图标。空分组不显示。

第二栏统一使用吊牌形状表示引用：HEAD 为金色、本地分支为绿色、远端跟踪分支为紫色，标签、stash 和其他引用为灰色，配色随明暗主题切换。同一提交上的关联引用可以组合为 `origin & 分支名`。同类型引用最多绘制两层，图标层数不代表引用总数；悬浮列表展示完整引用。

## 文件变更与比较

文件行以名称颜色及 A / M / D / R 等标记表示状态；新增为绿色、修改为蓝色、删除为灰色。行背景和操作图标使用 VS Code 风格，文件类型图标跟随当前文件图标主题。悬浮或键盘聚焦时显示 Open File，优先打开工作区文件；文件不存在时打开可用的历史只读快照。

第三栏左侧工具栏依次为 Show File Diffs、History Up To Here、File View Options；右侧提供展开／折叠目录和收起面板。

| 入口                              | 行为                                                             |
| --------------------------------- | ---------------------------------------------------------------- |
| Compare Commit History            | 在编辑器上下两栏展示双方独有的提交。                             |
| 第三栏 Show File Diffs            | 在 Source Control 的 File Diffs 侧栏展示当前所选提交的变更汇总。 |
| 两个分支或提交的 Show File Diffs  | 比较两个端点的完整文件快照。                                     |
| Show File Diffs with Working Tree | 比较指定提交与工作区。                                           |
| Changes to xxx 行末按钮           | 比较该父提交与当前合并提交，不改变分组展开状态。                 |
| History Up To Here                | 查看所选文件截至当前提交的历史，需要先选择文件。                 |

比较语义：

- 多选提交按日志顺序组合各文件的前后版本。不连续或跨分支选择时，文件差异可能包含未选提交留下的内容，不能等同于独立重放所选补丁。
- 普通合并提交的汇总列表包含相对所有父提交都发生变化的文件。No merge conflicts 表示汇总列表为空，不代表能够还原当时的人工冲突处理过程；各父提交的差异可分别展开查看。
- 三栏 Merge Diff 用于查看已提交的合并结果，不写入工作区或解决当前 Git 冲突。Native 样式使用对齐空白块和增删标记，JetBrains 样式使用连续代码和跨栏连线。
- File Diffs 保存比较端点，Refresh 重新读取同一比较范围。支持相关 API 的 VS Code Git Graph 提供 Show Commit File Diffs 和 Locate in Git Log 入口。

## 多仓库分支切换

执行 `VS Git: Switch Branch in All Repositories`，输入分支名并选择匹配项。候选来自发现的仓库中的本地和远端跟踪分支，不要求每个仓库都存在该分支。

已有本地分支直接切换；仅存在唯一匹配的远端跟踪分支时创建对应本地分支并设置跟踪关系。目标本地分支被其他 worktree 占用时，以 detached HEAD 切换到该分支指向的提交。分支不存在、远端候选不唯一或本地修改阻止切换时，通过原生通知报告对应仓库的结果，不强制覆盖修改。

Cherry-pick 按日志从下到上的顺序应用所选提交，支持冲突后的继续、跳过和中止；需要指定主线父提交的合并提交不适用。

## 设置、加载与刷新

| 设置                         | 默认值   | 含义                                                          |
| ---------------------------- | -------- | ------------------------------------------------------------- |
| `vsgit.history.initialCount` | `500`    | 打开日志或更改筛选时加载的提交数；`0` 表示加载全部匹配提交。  |
| `vsgit.history.pageSize`     | `500`    | 后续每批加载数量，范围为 `100`–`2000`；加载全部时不使用该值。 |
| `vsgit.mergeDiffStyle`       | `native` | 三栏历史合并比较的显示样式，可设为 `native` 或 `jetbrains`。  |

这些设置支持按工作区文件夹配置。修改加载数量后刷新或重新打开日志；修改 Merge Diff 样式会应用到已打开的比较。

接近列表底部时自动加载后续提交，也可点击 Load more commits；全部加载完成后按钮隐藏。加载全部历史会增加等待时间和内存占用。

插件订阅 VS Code Git 扩展的仓库状态事件。Refresh 按当前筛选重新读取日志和仓库信息；Fetch 获取远端更新。在提交历史比较视图可见时，`Cmd+J`（macOS）或 `Ctrl+J` 切换底部面板。

## 安装关联

主插件通过 `extensionPack` 声明桥接插件 `lvliangxiong.vsgit-icon-theme`。两个扩展均在 Marketplace 发布后，从市场安装主插件会一并安装桥接插件。首次市场发布时应先发布桥接插件，再发布主插件。

使用本地 VSIX 时先安装桥接包，再安装主包；主包安装命令跳过从市场解析扩展包成员。Remote-SSH 窗口中需将桥接包安装在本地客户端，主包安装在远端工作区宿主。

源码、使用说明及反馈入口分别为 [GitHub 仓库](https://github.com/lvliangxiong/vsgit)、本 README 和 [Issues](https://github.com/lvliangxiong/vsgit/issues)。

## 构建与安装

开发需要 Node.js 22+、npm 和 Git。VS Code 版本范围由 `package.json` 的 `engines.vscode` 声明。

```sh
npm ci
npm run check
npm test
npm run package
code --install-extension dist/vsgit-icon-theme.vsix --force
code --install-extension dist/vsgit.vsix --force --do-not-include-pack-dependencies
```

安装包为 `dist/vsgit.vsix` 和 `dist/vsgit-icon-theme.vsix`。主插件与桥接插件使用相同 publisher 和版本。安装后执行 `Developer: Reload Window`。

Remote-SSH 窗口中，主插件安装在远端 workspace 宿主，桥接插件安装在本地 UI 宿主；本地窗口中两者都安装在本地。

- [代码结构与数据流](docs/architecture.zh-CN.md)
- [构建、验证与安装](docs/development.zh-CN.md)
- [桥接插件说明](icon-theme-bridge/README.zh-CN.md)
- [第三方代码与图标许可](THIRD_PARTY_NOTICES.zh-CN.md)

## 许可证

Copyright (c) 2026 VS Git contributors.

原创代码采用 [GNU GPL 第 3 版（GPL-3.0-only）](LICENSE)。分发受该许可证覆盖的版本时，应按许可证要求提供对应源码及构建脚本，并保留必要声明。第三方代码、图标及依赖遵循各自许可证，详见 [第三方声明](THIRD_PARTY_NOTICES.zh-CN.md)。
