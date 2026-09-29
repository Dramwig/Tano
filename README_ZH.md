<div align="center">

<img src="apps/client/brand/green/1024x1024.png" alt="同页图标" width="88">

# Tano / 同页

### 人与 Agent，在同一页工作。

**在本地 Markdown 工作区中写作、整理知识，并与 Agent 协作。**

[![MIT 许可证](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![基于 Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Node.js 24.12+](https://img.shields.io/badge/Node.js-24.12%2B-339933.svg)](https://nodejs.org/)

[English](README.md) | 中文 | [日本語](README_JA.md) | [Deutsch](README_DE.md)

[快速开始](#快速开始) · [功能](#功能) · [文档](docs/zh/README.md) · [开发](#开发)

</div>

## 功能

- **文件由你掌握：** Markdown 和附件仍是普通工作区文件。身份、对象、关系和规则等可移植数据保存在 `.tano/`。
- **集中工作的界面：** 在一个桌面应用中编辑和搜索笔记，管理对象与关系，并使用日历。
- **保护外部修改：** 保存时对比基线 hash，合并独立修改；发生冲突时保留双方内容以供检查。
- **本地 Agent 接入：** stdio MCP 服务支持列举、读取、创建和条件更新文档，并拒绝过期写入。
- **备份与恢复：** 将工作区与 `.tano/` 一起备份；需要时使用恢复工具找回身份及数据。

此开源 Core 无需账号即可在本地使用。浏览器演示使用浏览器存储，**不会读写电脑上的文件夹**。此源码构建不包含实时网络协作。

## 官方下载

[GitHub Releases](https://github.com/Dramwig/Tano/releases) 提供完整的 Tano 官方安装包，由本仓库的 MIT Core 与私有 Cloud Overlay 构建。本仓库源码及 GitHub 自动生成的源码压缩包只包含 Core。Core 标签使用 `core-vX.Y.Z`，Product Release 使用 `vA.B.C`；多个 Product 版本可以复用同一 Core 提交。

## 快速开始

安装 [Node.js 24.12+](https://nodejs.org/) 和 npm。运行桌面应用还需要 [Rust stable](https://rustup.rs/) 及当前平台的 [Tauri 2 系统依赖](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run desktop
```

只想预览浏览器演示，可运行 `npm run dev` 并打开 `http://127.0.0.1:1420`。桌面与浏览器开发服务器使用同一端口，请分别运行。

## 文档

| 指南 | 内容 |
| --- | --- |
| [文档首页](docs/zh/README.md) | 指南目录与阅读入口 |
| [本地开发](docs/zh/local-development.md) | 环境、命令与应用数据 |
| [架构](docs/zh/architecture.md) | 编辑器、存储、工作区格式及冲突处理 |
| [Agent 工作流](docs/zh/agent-workflow.md) | 本地 MCP 配置与条件写入 |
| [备份与恢复](docs/zh/backup-recovery.md) | 可移植数据、快照与恢复 |
| [构建与发布](docs/zh/releases.md) | 桌面构建与签名更新 |
| [许可与范围](docs/zh/license.md) | MIT 许可与第三方义务 |

## 开发

```sh
npm run check
npm run test:native
npm run mcp:smoke
```

`npm run check` 包含 TypeScript 检查、测试、生产构建、文档链接检查及依赖边界检查。平台环境与 Rust 格式化命令见[本地开发](docs/zh/local-development.md)。

Tano 使用 [MIT License](LICENSE)。第三方组件保留各自许可，详见[第三方说明](THIRD_PARTY_NOTICES.md)。
