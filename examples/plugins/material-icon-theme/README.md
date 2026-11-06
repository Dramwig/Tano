# Material 文件图标

将 [Material Icon Theme 5.40.0](https://github.com/material-extensions/vscode-material-icon-theme/tree/v5.40.0) 的默认文件与文件夹图标适配为同页独立插件，非上游官方发布。

## 安装

1. 在支持嵌入式彩色图标的 Tano 中打开「插件 → 导入插件」。
2. 导入本目录的 `material-icon-theme-1.0.0.tano-plugin.json`。
3. 打开「设置 → 外观 → 文件与目录图标」，选择 **Material Icon Theme**。

安装不会自动切换图标。不需要脚本授权、网络权限或文件正文权限；图标随包提供，安装后可离线使用。
停用或卸载后回退到同页默认；用户自行设置的文档 emoji、上传图标继续优先。
需要包含此适配所需 Core 改动的宿主，旧版本会拒绝新增字段，不能直接安装 VS Code 的 VSIX。

## 范围

包含默认匹配规则引用的全部图标：文件名优先、最长复合扩展名、命名文件夹、展开/收起与上游浅色变体。
图标转换为透明 64×64 PNG（64 色调色板），用于常规 14–24px 图标显示。颜色保留，放大到很大尺寸时不具备 SVG 的无限缩放能力。
未移植 VS Code 的语言 ID 检测、路径级匹配、扩展设置、自定义关联、可选图标包或隐藏展开箭头行为。
同页的文件夹主页是普通文件夹，继续使用同一套文件夹图标。

具体上游版本、归档 SHA-512、图标与匹配数量、包大小和摘要记录在 [upstream.json](upstream.json)。

## 重建

在仓库根目录执行（使用现有 `sharp` 与打包工具，不安装 VS Code 扩展依赖）：

```powershell
npm run plugin:material-icons
# 离线时使用相同归档；仍校验固定 SHA-512：
npm run plugin:material-icons -- C:/downloads/material-icon-theme-5.40.0.tgz
npm run plugin -- verify examples/plugins/material-icon-theme/material-icon-theme-1.0.0.tano-plugin.json
```

脚本下载固定 npm 归档、验证摘要、转换默认图标及深浅色变体，生成清单、安装包与来源记录。
不打包任何上游可执行代码。依赖版本由仓库锁文件固定；更新上游时应同时审核版本、摘要、许可和匹配变化。

## 许可

上游 Material Icon Theme：Copyright (c) 2025 Material Extensions，MIT。
完整许可见 [LICENSE](LICENSE)，也包含在安装包 `appearance.icons[0].notice` 中。
同页适配代码使用仓库 MIT 许可。品牌图标的商标权归其所有者，不代表官方关联或背书。
