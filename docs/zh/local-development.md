# 本地开发

[English](../local-development.md) | 中文 | [日本語](../ja/local-development.md) | [Deutsch](../de/local-development.md) | [文档目录](README.md)

安装 Node.js 24.12+、npm 和 Rust stable。桌面开发还需要当前平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。Windows 需要 C++ Build Tools、Windows SDK 和 WebView2；可用 `powershell -File scripts/check-desktop.ps1` 检查本机环境。

在仓库根目录运行：

```sh
npm ci
npm run desktop
```

浏览器演示可运行 `npm run dev`，然后打开 `http://127.0.0.1:43841`。演示将数据保存在浏览器中，不访问真实工作区文件夹。桌面开发版使用 43842 端口，两者可同时运行。启动前对应端口需空闲。

桌面应用标识为 `app.tano.local`。在 Windows 上，应用数据通常位于 `%APPDATA%/app.tano.local`；配置 Agent 时请使用 Tano 的 MCP 面板显示的路径。工作区 Markdown 和 `.tano/` 可移植，索引与恢复状态位于应用数据中。

依赖安装后，本地编辑、搜索和恢复可离线使用。远程图片及显式配置的更新检查仍需网络。源码构建默认不配置更新地址。

提交修改前运行 `npm run check`、`npm run test:native` 和 `npm run mcp:smoke`。修改 Rust 代码后运行：

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
