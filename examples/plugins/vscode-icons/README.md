# vscode-icons 文件图标

将 [vscode-icons 13.0.0](https://github.com/vscode-icons/vscode-icons/tree/866d4f48701ba71e39d309e9e519bcf2eaf1c3e2) 的经典图标适配为同页独立插件，非上游官方发布。

## 安装

1. 在支持嵌入式彩色图标的 Tano 中打开「插件 → 导入插件」。
2. 选择本目录的 `vscode-icons-1.0.0.tano-plugin.json`，检查后安装。
3. 打开「设置 → 外观 → 文件与目录图标」，选择 **vscode-icons**。

安装只增加选项，不会自动切换。插件可与 [Material 文件图标](../material-icon-theme/README.md) 同时安装，通过外观设置切换。
不需要脚本授权、网络权限或文件正文权限，安装后可离线使用。
停用或卸载后回退默认图标；重新启用恢复原选择。用户自己设置的文档 emoji、上传图标继续优先。
需要包含嵌入式彩色图标 Core 改动的宿主，旧版不能直接导入，也不能使用 VS Code 的 VSIX 安装文件。

## 匹配与资源

包含默认启用的文件、文件夹图标与浅色变体，支持文件名优先、最长复合扩展名、命名文件夹和展开/收起。
额外使用上游语言目录的 `knownExtensions`、`knownFilenames`，使 JavaScript、TypeScript、Python、Markdown 等文件在没有 VS Code 语言服务的同页中也能正确识别；显式文件关联优先。
配置文件的名称与后缀组合沿用上游规则。所有匹配均不区分大小写，不检查文档内容。

图标转换为透明 32×32 PNG（32 色调色板、无抖色），适用于常规 14–16px 图标及其两倍像素密度显示，大幅放大时不具备 SVG 的无限缩放能力。
不包含上游的项目自动检测、可选图标预设、自定义关联、语言服务、路径级匹配或隐藏展开箭头行为。
同页文件夹主页沿用对应文件夹的图标。

上游 `file_type_xposed.svg` 单独声明 GPL-3.0-or-later；本适配未收录该图标，其专用关联回退为通用文件图标。
具体提交、归档摘要、图标数量、匹配数量与包摘要见 [upstream.json](upstream.json)。

## 重建

在仓库根目录执行：

```powershell
npm run plugin:vscode-icons
# 离线使用同一源码归档，仍校验固定 SHA-256：
npm run plugin:vscode-icons -- C:/downloads/vscode-icons-source.tgz
npm run plugin -- verify examples/plugins/vscode-icons/vscode-icons-1.0.0.tano-plugin.json
```

脚本下载并校验固定提交的源码归档，用现有 esbuild 读取关联目录与语言元数据，
使用现有 sharp 转换图片并生成清单、安装包和来源记录。
不安装上游依赖，不加载 VS Code API，不在插件包中携带可执行代码。
构建依赖版本由仓库锁文件固定。更新上游时须重新核对资源许可、归档摘要、默认关联及单独标注许可的图标。

## 许可与署名

Copyright The vscode-icons Contributors。原作者 Roberto Huertas 与 vscode-icons 贡献者。

- 上游源码与 Tano 适配代码：MIT，见 [LICENSE](LICENSE) 及仓库许可。
- 上游图标及本适配中的 PNG 转换作品：**CC BY-SA 4.0**，见 [许可全文](CC-BY-SA-4.0.txt)。
- 品牌图标保留各自版权许可及商标权，遵循上游声明；不表示官方关联或背书。

修改内容：将 SVG 转换为透明 32×32、32 色 PNG（无抖色），并适配同页的关联规则。
图标转换作品继续使用 CC BY-SA 4.0，不改为 MIT；同页代码的 MIT 许可保持不变。
完整来源、修改说明、许可链接与上游 MIT 全文保存在 [NOTICE.txt](NOTICE.txt)，也嵌入安装包的 `appearance.icons[0].notice`。
