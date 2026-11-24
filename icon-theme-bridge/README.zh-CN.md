# VS Code Git File Icon Theme Bridge

[English](README.md) | 简体中文

VS Code Git 的本地 UI 配套扩展，扩展 ID 为 `lvliangxiong.vscode-git-icon-theme`，主插件 ID 为 `lvliangxiong.vscode-git`。

## 职责

- 根据当前 VS Code 文件图标主题和文件关联，解析请求的文件图标。
- 为历史 Merge Diff 视图提供编辑器主题设置和已安装的 TextMate 语法资源。
- 从本地 UI 扩展读取资源，并通过 VS Code 命令返回结果。

桥接插件使用 `ui` 扩展宿主。Git 命令在主插件的 `workspace` 宿主执行，与仓库位于同一台机器。Remote-SSH 窗口中桥接插件运行在本地，主插件运行在远端；桥接插件不需要单独配置。

## 安装关联

主插件在 `extensionPack` 中声明此桥接插件。两个包均发布到 Marketplace 后，从市场安装主插件可以一并安装桥接插件。首次发布市场时先发布桥接插件。本地 VSIX 安装显式使用两个安装包；下面的主包安装命令跳过从市场解析扩展包成员。

[源码仓库](https://github.com/lvliangxiong/vsgit/tree/main/icon-theme-bridge) · [反馈问题](https://github.com/lvliangxiong/vsgit/issues)

## 构建与安装

在仓库根目录执行：

```sh
npm ci
npm run package
code --install-extension dist/vsgit-icon-theme.vsix --force
code --install-extension dist/vsgit.vsix --force --do-not-include-pack-dependencies
```

打包脚本将桥接插件的 publisher 和版本同步为主插件的值。在本地 VS Code 客户端安装桥接插件，在仓库所在宿主安装主插件，然后执行 `Developer: Reload Window`。

使用方式和验证说明见[主 README](https://github.com/lvliangxiong/vsgit/blob/main/README.zh-CN.md) 和[开发指南](https://github.com/lvliangxiong/vsgit/blob/main/docs/development.zh-CN.md)。

## 许可证

Copyright (c) 2026 VS Git contributors.

桥接插件原创代码采用 GNU GPL 第 3 版（SPDX: GPL-3.0-only），详见 [LICENSE](LICENSE)。分发者应按许可证要求提供对应源码及构建说明。

随包分发的 jsonc-parser 和 vscode-textmate 保留各自的 MIT 许可证，分别位于 `out/jsonc-parser-LICENSE.md` 和 `out/vscode-textmate-LICENSE.txt`。用户安装的第三方主题和语言语法在运行时读取，不随本插件的 VSIX 重新分发。

市场图标沿用 VS Git 的 V 形提交图标识，并添加连接的链路徽标以标明配套扩展身份。SVG 和 PNG 是 VS Git 原创图形，采用 GPL-3.0-only；源图位于主仓库的 `media/marketplace-bridge-icon.svg`。
