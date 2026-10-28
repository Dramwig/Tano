# 构建与发布

[English](../releases.md) | 中文 | [日本語](../ja/releases.md) | [Deutsch](../de/releases.md) | [文档目录](README.md)

本地发布验收、手动创建不可变标签和注册表发包流程见 [Core 发布自动化](../release-automation.md) 与 [Core 注册表分发](../core-distribution.md)。生产部署与官方多平台签名流程由私有仓库维护。

运行 `npm run desktop:build` 构建桌面安装包。源码构建无需账号或签名私钥，默认不配置更新地址。在 Windows 上，NSIS 安装包位于 `apps/client/src-tauri/target/release/bundle/nsis/`。

公开仓库可以构建完整的 MIT 本地产品。[Cloud Extension API](../cloud-extension.md) 让私有 `Tano-cloud` 仓库加入官方联网功能。官方安装包由私有仓库构建，统一作为 `Dramwig/Tano` 的 Release 附件发布。GitHub 自动生成的源码压缩包只包含公开 MIT Core，不包含官方二进制中的私有 Cloud Overlay。

运行 `npm run version:set -- 0.2.0` 可统一修改公开 Core 仓库的 npm 工作区、内部依赖版本、npm/Cargo 锁文件、Tauri 配置和 Rust crate 版本。`npm run version:check` 校验这些版本是否一致，并已纳入 `npm run check`。官方 Product 版本独立由私有 `Tano-cloud` 管理；独立发布的 Python/Rust 协议辅助包也保留各自的版本号。

只有本次交付的共享 Core 内容变化时，才创建新 Core 版本：对最终源码 SHA 完成本地验收，手动创建不可变的 `core-vX.Y.Z` 标签，再发布同版的五个 npm 包和一个 Rust crate。在对应 Core GitHub Release 上传 `core-registry.json`，且不将其设为 latest；消费方通过 `npm run core:sync -- --registry <分发清单地址>` 固定依赖。推送标签不会自动执行工作流。仅 Cloud、官网或部署配置变化时，保留原 Core 版本；接收已发布的 Core 也无需重新发包。私有仓库独立设置 Product 版本，发布工作流核对 Core 标签与提交、构建并验签官方安装包，然后在本仓库的 Core 提交上创建 Product 标签 `vA.B.C`，将安装包、签名、校验值及 `latest.json` 发布到对应 Release。多个 Product 标签可以指向同一个 Core 提交。官方客户端使用 `https://github.com/Dramwig/Tano/releases/latest/download/latest.json` 检查更新；私有工作流需要仅授权访问本仓库的跨仓库发布令牌。私有工作流支持 Windows x64、Linux x64，以及可选的 macOS 双架构签名构建。首次正式运行仍需配置平台凭据并完成原生验收。

分发制品须包含[第三方说明](../../THIRD_PARTY_NOTICES.md)。依赖变更后使用 `npm run notices:generate` 重新生成随包声明。
