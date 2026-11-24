# Marketplace 与 GitHub 发布

[English](releasing.md) | 简体中文

推送 `v主版本.次版本.修订版本` 格式的稳定版本标签时，`.github/workflows/publish-release.yml` 按顺序执行：

1. 校验两个扩展 manifest 的版本与标签一致，安装锁定依赖，进行类型检查、构建、测试，并打包两个 VSIX。
2. 通过 OIDC 向 Visual Studio Marketplace 发布桥接插件，再发布主插件。
3. 为已有标签创建 GitHub Release，生成发布说明，并附上两个 VSIX。

发布任务和 Release 任务下载同一份构建产物，不重新构建。产物清单记录提交、扩展 ID、版本和 SHA-256；每个后续任务都校验该清单。版本校验、测试、打包或 Marketplace 发布失败时，不执行 GitHub Release 任务。

## 首次配置

Marketplace publisher 必须已经创建，并由你控制的账号管理。本仓库使用 `lvliangxiong`。

1. 在 GitHub 仓库 **Settings → Environments** 中创建 `marketplace` 环境，允许部署的标签应包含 `v*`。可以设置 required reviewers；设置后，市场发布会等待审批。
2. 打开 [Marketplace 发布者管理页面](https://marketplace.visualstudio.com/manage)，选择 `lvliangxiong` publisher，在 **Trusted Publishing** 中创建策略：

   | 字段             | 值                    |
   | ---------------- | --------------------- |
   | Repository owner | `lvliangxiong`        |
   | Repository       | `vscode-git`          |
   | Workflow         | `publish-release.yml` |
   | Environment      | `marketplace`         |

3. 确认仓库 Actions 策略允许工作流中固定版本的官方 checkout、Node setup、artifact upload/download actions，以及创建 Release 所需的 `contents: write` 权限。

两个扩展使用同一 publisher，因此共用该信任策略。不需要配置 Marketplace PAT 或 GitHub PAT：市场发布使用短期 OIDC 凭据，GitHub Release 使用工作流的 `GITHUB_TOKEN`。

项目锁文件中的 `vsce 4.0.0` 用于打包。发布任务在 runner 临时目录单独安装支持 `--oidc` 的 `@vscode/vsce@4.1.1`，不修改项目依赖。每次扩展发布单独申请凭据。

参考 [官方 Trusted Publishing 文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing)。

## 发布版本

选择未使用的稳定版本，更新 `package.json` 和 `icon-theme-bridge/package.json` 的 `version`，同步 `package-lock.json`。先提交并推送包含工作流、辅助脚本和版本修改的代码，再在该提交上打标签。

例如两个 manifest 和锁文件均为 `0.1.285` 后：

```sh
git push origin main
git tag -a v0.1.285 -m "VS Code Git 0.1.285"
git push origin v0.1.285
```

工作流不会自动递增版本或创建版本提交。标签必须与两个已提交的 manifest 一致；此稳定版本流程不接受 `v0.1.285-beta.1` 等预发布标签。不要移动已发布的版本标签，也不要用同一版本发布不同内容。

## 手动检查与重试

工作流进入默认分支后，打开 **Actions → Publish extensions and GitHub Release → Run workflow**，输入包含工作流及辅助脚本的已有标签。

- 手动执行默认 `dry_run: true`：只校验、测试、打包并上传 Actions artifact，不发布市场、不创建 GitHub Release。
- `dry_run: false`：执行完整发布流程，**Use workflow from** 也必须选择同一个标签。分支触发后 checkout 标签不会改变 GitHub 环境和 OIDC 使用的 ref；触发 ref 与标签不一致时工作流会拒绝正式发布。
- 推送标签：自动执行完整发布流程。

部分任务失败后优先使用 **Re-run failed jobs**，复用原始构建产物。市场发布会跳过已发布版本，因此桥接成功、主插件失败时可以重试主插件。已发布版本不能替换；内容变化应使用新版本。首次桥接发布仍在 Marketplace 处理中时，等待可用后再重试主插件。

GitHub Release 重试只上传缺少的同名附件，并发布已有草稿，不覆盖已有附件。同一标签的运行不会并发发布。Actions artifact 保留 30 天；GitHub Release 附件不受该 artifact 保留期限控制。

首次正式发布前应使用 `dry_run` 检查。工作流包含真实发布操作；本地语法和产物校验不会验证外部 Trusted Publishing 策略，也不会执行市场发布。
