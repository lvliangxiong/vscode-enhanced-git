# 代码结构与数据流

[English](architecture.md) | 简体中文

## 模块职责

| 目录                          | 职责                                              |
| ----------------------------- | ------------------------------------------------- |
| `src/extension/extension.ts`  | 扩展注册、日志会话、Webview 消息路由              |
| `src/extension/git/`          | Git 查询、索引、拓扑、stash、文件变更和写操作     |
| `src/extension/repositories/` | 仓库发现、状态事件、Recent 与收藏持久化           |
| `src/extension/views/`        | Webview 模板、资源嵌入、File Diffs 生命周期       |
| `src/extension/syntax/`       | 编辑器主题、TextMate 语法及高亮适配               |
| `src/extension/icons/`        | 文件图标主题解析与跨宿主服务                      |
| `src/icon-bridge/`            | 本地 UI 宿主中的图标桥接入口                      |
| `src/shared/`                 | 数据模型、筛选、引用标签与图布局算法              |
| `src/webview/log/`            | 日志装配、消息处理、选择、布局及绘图控制器        |
| `src/webview/react/`          | React 视图、浮层和组件生命周期                    |
| `src/webview/state/`          | 基于 Zustand 的会话和领域状态                     |
| `src/webview/styles/`         | Less 样式和共享尺寸                               |
| `media/`                      | 静态图标及来源清单                                |
| `scripts/`                    | TypeScript 构建与打包脚本                         |
| `test/`                       | 单元测试、React/jsdom 测试与临时 Git 仓库集成测试 |

## 宿主与视图

主插件 `lvliangxiong.vsgit` 运行在 workspace 扩展宿主，Git 操作与仓库位于同一台机器。桥接插件 `lvliangxiong.vsgit-icon-theme` 运行在本地 UI 宿主，通过 VS Code 命令提供请求的文件图标、编辑器主题和已安装 TextMate 语法资源。

浏览器入口包括独立日志 `main.ts`、多仓库容器 `repository-host.ts`、双向比较容器 `compare-host.ts` 、File Diffs `branch-changes.ts`、文件历史 `file-history.ts` 和三栏比较 `merge-diff.ts`。底部多仓库视图与双向比较使用 Shadow DOM 隔离各日志实例的 DOM、样式、消息及焦点。

`log/session.tsx` 通过 `mountLog()` 装配日志。`LogContext` 提供环境适配器、会话 Store、控制器接口、`Lifetime` 资源管理器及 React UI 接口。每个日志会话由一个 React root 管理，容器和 File Diffs 拥有各自的 root。

React 组件订阅会话及领域 Store，通过回调触发控制器。控制器处理 Git 请求、选择、布局和宿主消息。Canvas 绘图、DOM 测量、CSSOM 和图标加载由独立服务管理；`Lifetime` 在视图销毁时释放订阅、监听器和动画。

## 状态与请求

- `state/log.ts` 保存提交、分支、筛选、选择、列设置、布局和加载状态。
- `state/branches.ts` 合并分支和 stash 快照、收藏的宿主版本、请求确认和本地乐观更新。
- `state/details.ts` 与 `state/comparison.ts` 管理第三栏及独立比较侧栏的文件和选择状态。
- Recent 与收藏按仓库持久化，并同步到同仓库的其他日志会话。

请求的数据流为：

1. Webview 发送历史、详情、比较或 Git 操作请求。
2. 扩展宿主确定所属仓库，校验输入并调用 Git 服务。
3. `git/client.ts` 使用参数数组启动 Git，查询结果经过解析和图布局计算。
4. 宿主将响应返回对应会话；请求序号、选择键和比较身份用于丢弃过期结果。
5. Store 更新后，React 协调 DOM，图形服务重绘可见区域。

`repositories/events.ts` 订阅 VS Code Git API 的仓库事件；前端 `history-refresh.ts` 合并刷新请求，并结合可见性和交互状态安排刷新。

## 历史查询、缓存与索引

日志先返回小批提交和轻量引用，再补齐配置的加载数量与全仓库布局。两阶段共用请求序号，后台结果保留有效的选择和滚动状态。

`history-cache.ts` 缓存仓库快照、查询结果和元数据。缓存身份包含引用、HEAD、Git 配置和特殊历史边界。手动刷新替换查询与元数据缓存，兼容的搜索和路径索引可继续复用。

`topology-reader.ts` 读取完整拓扑，并在引用变化时优先读取近期块与缓存尾部拼接。无法确认父子关系或可达性时完整重读。图布局按拓扑快照缓存，筛选后的连线由 `topology.ts` 投影到可见提交。

`history-index.ts` 和 `message-index.ts` 为提交正文、作者建立有界内存索引。超过条数或输出大小上限、索引不可用、查询语义不支持时回退到 Git。`history-index-store.ts` 将带版本、仓库身份和校验值的提交数据写入扩展私有存储，以临时文件原子替换；重启后可重建内存索引。`history-index-update.ts` 根据拓扑补充缺少的提交详情。

`path-index-store.ts` 在扩展私有目录构建 Git changed-path Bloom 索引，通过进程级对象目录和只读 alternate 访问仓库对象。日志路径筛选由 Git 判定，支持合并、重命名和多路径条件。独立的文件历史由 `git/file-history.ts` 负责。查询加速环境仅用于读取。

## Stash 与引用标签

`git/stashes.ts` 根据 stash reflog 识别每份暂存及其内部快照。历史查询和索引隐藏暂存区、未跟踪文件内部节点，每份 stash 保留一个可见节点，父连线指向创建 stash 时的基础提交。分页按可见提交计数，stash 引用变化参与缓存身份校验。

第一栏 Stashes 分组使用完整 stash 列表，按编号和说明搜索。点击以提交哈希定位主图，避免可变的 `stash@{n}` 编号作为跳转身份。Stash 选择与分支写操作隔离。

stash 文件列表以基础提交和工作区快照比较，并补入未跟踪文件快照；打开 Diff 时使用对应文件实际所在的提交。普通合并提交使用多父交集规则。

`shared/reference-labels.ts` 解析 HEAD、分支、tag 和 stash 装饰，生成紧凑或展开的引用组。`shared/reference-layout.ts` 根据列宽、标题宽度和显示模式分配标签空间，缩短长名称，并将放不下的后续引用合并为图标。`react/reference-labels.tsx` 绘制轮廓图标和名称；`log/hover.ts` 与 `react/session-overlays.tsx` 提供完整名称、复制动作及主题悬浮窗。

`BranchTree` 按当前引用、收藏和引用类型选择图标。detached HEAD 指向确切标签时，标签可使用当前引用图标；图标展示不改变 Git 操作目标。引用标签使用 Rebased New UI 的明暗配色和轮廓，宽度与绘制共用按图标高度缩放的叠放偏移。SVG 遮罩裁掉被遮挡的轮廓，并保留层间留白，避免半透明背景导致底层透出。

## 布局与列宽

`log/layout.ts` 管理侧栏宽度、折叠状态、详情区域和预览位置。第一栏及第三栏文件区域保持独立滚动；横向溢出时可浏览完整名称。`log/columns.ts` 保存列顺序及首选宽度，拖动前测量可见列：边界左侧只调整紧邻列，右侧按各列剩余伸缩能力分配变化，并保持总宽度及最小宽度约束。隐藏列不参与调整。

## 文件比较

第三栏和 File Diffs 复用 `FileList` 与 `file-tree.ts`。目录展开状态、文件选择和比较端点由各自模型保存。File Diffs 保存操作时的仓库与提交集合，刷新沿用该比较范围。

`selection-reader.ts` 分批读取提交元数据、文件变更和统计。普通合并提交保留相对所有父提交都发生变化的文件；多选提交按所选日志顺序组合文件端点，处理重命名和增删抵消。行数统计可在文件列表显示后补齐。

`Changes to xxx` 的比较操作复用 `commitFiles`，端点固定为父提交和所选合并提交。`views/open-working-file.ts` 优先打开工作区文件，路径不存在时读取对应历史版本作为只读文档。

原生 Diff 使用只读 Git 快照或工作区文件。预览与原生 Diff 的加载请求均关联当前选择，避免旧响应覆盖新的选择。

## 文件历史与三栏比较

`git/file-history.ts` 从固定提交读取指定文件的历史，在重命名边界显式追踪路径并保留合并提交，`views/file-history.ts` 管理 File History 侧栏。侧栏复用提交列表和图形组件，筛选条件由宿主提供；选择提交后在 Editor 中打开原生 Diff。

`views/merge-diff.ts` 与 `webview/merge/` 提供基于 Monaco 的只读三栏比较。`merge/three-way.ts` 对两个父版本和合并结果进行片段分类；Native 样式使用对齐空白块，JetBrains 样式使用连续代码和跨栏连线。布局、滚动、差异导航和概览标记由 Webview 管理。

`extension/syntax/` 解析主题和语法配置，通过本地桥接获取远程宿主缺少的 UI 扩展资源；Webview 使用 TextMate 与 Oniguruma 进行语法着色。

## 多仓库分支切换

`commands/switch-repositories.ts` 汇总已发现仓库的本地和远端分支候选。切换以 Git common directory 分组，最多并发处理四组，同组 worktree 按工作区顺序执行；仓库写锁与其他 Git 写操作共用。分支被其他 worktree 占用时使用 detached HEAD，Git 的本地修改检查保持有效，每个仓库的结果通过原生通知展示。

## 渲染、主题与资源

提交列表按固定行高虚拟化，只挂载视口和缓冲区内的行。`shared/graph.ts` 建立图边区间索引，按行生成几何数据；`log/graph-render.ts` 使用 Canvas 绘制节点和连线，少量 SVG 元素承载箭头命中区域。`GraphTile` 管理绘图子树的挂载与销毁。

文件列表和 File Diffs 共用 VS Code 风格的行背景、焦点和操作图标，状态名称及字母使用 Rebased 文件配色。粘性操作区与整行使用相同底色和单层覆盖色，避免重复叠加半透明选中背景。

界面背景、文字和交互状态使用 VS Code CSS 变量，分支／引用图标与文件状态色采用独立的 Rebased 明暗配色；主题和缩放变化会触发可见 Canvas 重绘。字体与图标尺寸按逻辑 CSS 像素定义。加载全量历史仍需要相应的 Git 查询、传输和内存，虚拟化主要限制 DOM 与绘图开销。

React、React DOM、Zustand、Monaco 及运行依赖打包进相应 Webview 入口；宿主图标解析器与桥接插件分别打包 `jsonc-parser`。依赖许可证随构建产物复制，来源和归属见 [第三方声明](../THIRD_PARTY_NOTICES.zh-CN.md)。
