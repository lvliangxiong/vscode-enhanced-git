# 构建、验证与安装

## 环境与命令

需要 Node.js 22+、npm 和 Git。VS Code 版本范围见主插件 manifest 的 `engines.vscode`，依赖版本由 `package-lock.json` 固定。

```sh
npm ci
npm run check
npm test
```

| 命令                   | 用途                                                                      |
| ---------------------- | ------------------------------------------------------------------------- |
| `npm run build`        | 重建 `out/`，编译 TypeScript、React 入口和 Less，复制静态资源及依赖许可证 |
| `npm run typecheck`    | 检查应用、脚本和测试的 TypeScript 类型                                    |
| `npm run check`        | 执行类型检查和构建                                                        |
| `npm test`             | 构建后运行 `test/*.test.ts`                                               |
| `npm run format`       | 格式化源码、脚本、测试及文档                                              |
| `npm run format:check` | 检查格式                                                                  |
| `npm run package`      | 检查构建并生成主插件和图标桥接插件的 VSIX                                 |

`scripts/` 和 `test/` 使用 TypeScript，通过项目内的 `tsx` 执行。`tsconfig.tools.json` 配置脚本与测试环境；组件测试通过 jsdom 提供 DOM。

## 调试与测试

构建后启动扩展开发窗口，仓库路径替换为测试仓库。需要独立用户配置时使用 `--user-data-dir` 指定临时目录：

```sh
code --extensionDevelopmentPath=. /path/to/test-repository
```

单独运行测试：

```sh
npm run build
npx tsx --test test/graph.test.ts
npx tsx --test test/stash-history.test.ts test/reference-labels.test.ts
npx tsx --test test/merge-three-way.test.ts test/file-history.test.ts
npx tsx --test test/branch-selection.test.ts test/reference-layout.test.ts test/column-resize.test.ts
npx tsx --test test/switch-repositories.test.ts test/open-working-file.test.ts
```

Git 写操作测试使用临时仓库和本地 bare remote。测试覆盖历史筛选、拓扑、stash、比较端点、重命名、分支操作、Cherry-pick、缓存和多仓库状态隔离。

React/jsdom 测试覆盖选择、键盘操作、菜单、悬浮提示、文件树和视图生命周期。jsdom 不执行真实布局，尺寸和 Canvas 由测试替身提供。焦点、缩放、主题、文件图标及 Remote-SSH 行为需要在 VS Code 中验证。

## 打包与安装

```sh
npm run package
code --install-extension dist/vsgit-icon-theme.vsix --force
code --install-extension dist/vsgit.vsix --force
```

产物分别为 `dist/vsgit.vsix` 和 `dist/vsgit-icon-theme.vsix`。`scripts/package-icon-bridge.ts` 将桥接插件的 publisher 和版本同步为主插件的值。安装后运行 `Developer: Reload Window` 激活更新。

扩展身份如下：

| 扩展                          | ID                              | 宿主        |
| ----------------------------- | ------------------------------- | ----------- |
| VS Git                        | `lvliangxiong.vsgit`            | `workspace` |
| VS Git File Icon Theme Bridge | `lvliangxiong.vsgit-icon-theme` | `ui`        |

可通过 `code --list-extensions --show-versions` 检查本地安装，通过 `code --locate-extension lvliangxiong.vsgit` 定位本地主插件安装目录。远端安装应在对应 Remote-SSH 窗口的 Extensions 视图中核对 publisher 和版本。

Remote-SSH 中主插件运行在远端 workspace 宿主，图标、编辑器主题和语法资源由本地 UI 桥接提供。主插件的 `extensionKind` 为 `workspace`，桥接插件为 `ui`。

VSIX 包含编译产物、使用文档和许可证。React 等浏览器依赖以及宿主侧的 `jsonc-parser` 在构建时打包，运行不依赖开发目录中的 `node_modules`。运行依赖的许可证由构建脚本复制。

分发 GPL-3.0 覆盖的安装包时，应按许可证要求提供与发布版本匹配的对应源码及构建脚本。源码范围包括主插件、图标桥接插件、共享模块和构建配置；第三方声明见 [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md)。

文档变更使用 Markdown 格式和链接检查，无须增加插件版本或重新部署：

```sh
npx prettier --check README.md docs/*.md icon-theme-bridge/README.md THIRD_PARTY_NOTICES.md
git diff --check
```

功能或界面变更应完成相关测试，并在 VS Code 中检查真实布局、主题、焦点和操作结果。打包与安装校验不能替代界面验证。

## 本地配置与产物

构建输出、VSIX、测试日志、编辑器配置、环境变量文件和个人辅助工具配置通过 `.gitignore` 排除。文档中的路径使用通用占位形式，本机配置保存在被忽略的位置。

`VS Git Performance` 输出通道记录查询、索引和文件比较耗时。诊断输出可能包含运行时仓库路径或 Git 错误，在分享日志前检查其中的环境信息。
