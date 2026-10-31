# Tano Local 代码签名政策 / Code signing policy

更新日期：2026 年 10 月 31 日。[English](../code-signing-policy.md) · [Local 隐私说明](local-privacy.md)

## 当前状态

2026 年 10 月 30 日提交的 SignPath Foundation 开源签名申请**本次未获批准，签名尚未启用**。基金会反馈项目目前尚缺足够的公众信任及知名度证据，并欢迎获得更广泛认可后重新申请；本次申请已不处于待审核状态。当前 Windows 包仍为明确标注的未签名预览版。SHA-256 和公开构建来源证明不能代替 Windows Authenticode 签名。

英文政策保留获批并启用后的服务署名，目前不表示已经获得赞助或签名。基金会方案的证书主体为 SignPath Foundation，Windows 发布者身份将体现该主体。

## 范围

仅适用于 [Dramwig/Tano](https://github.com/Dramwig/Tano) 公开 MIT 源码构建的 Tano Local 自有程序及 Windows x64 NSIS 安装包 `Tano-Local_<version>_x64-setup.exe`。

私有 Cloud Overlay、托管服务及含私有代码的 Tano Product 安装包不在范围内，不能使用该基金会订阅签名。第三方组件保留原许可和签名，不以 Tano 自有程序身份重新签名。参见 [MIT](../../LICENSE)、[许可范围](../license.md)及[第三方声明](../../THIRD_PARTY_NOTICES.md)。

## 团队与审批

| 职责 | 负责人 |
| --- | --- |
| 代码维护与提交 | [Dramwig（Zixi Wang）](https://github.com/Dramwig) |
| 外部贡献与发布变更审阅 | [Dramwig（Zixi Wang）](https://github.com/Dramwig) |
| 发布签名批准 | [Dramwig（Zixi Wang）](https://github.com/Dramwig) |

维护者于 2026 年 10 月 30 日确认上述职责。其他贡献者的变更须审阅后纳入，审阅包括构建脚本、工作流、依赖和随包资源。每次正式发布签名需要批准人明确人工批准。启用前，所有承担上述职责的成员必须在 GitHub 和 SignPath 开启多因素认证；这是启用要求，不声称账号设置及验证已经完成。

## 构建与发布控制

- 使用公开不可变的 `core-vX.Y.Z` 标签，构建脚本和依赖锁文件都属于公开源码。
- [Local 工作流](../../.github/workflows/local-desktop.yml)在 GitHub 托管 Windows runner 上手动运行；完整检查及原生/MCP 验收在本地对发布源码执行，Actions 负责打包与来源证明。
- SignPath 接入尚待实现。启用前须上传产物，通过 GitHub 可信构建集成提交产物身份，并取得人工批准，不能换入本机或其他仓库来源的二进制。
- 配置产品名及匹配版本限制，先签自有程序，再打包并签安装包；保留第三方签名。
- 验证最终文件可信且带时间戳的 Authenticode 签名，完成安装、启动、卸载验收，再对最终字节生成校验值及来源证明。不得签后修改或以不同字节覆盖发布资产。
- Local 不占用 Product 的 GitHub latest，不复用其自动安装更新渠道，详见[发布控制](../local-release.md)。

## 隐私与联系

[Local 隐私说明](local-privacy.md)披露启动版本查询、文档远程资源、可选模型与 Agent、账号导入、计划连接及插件联网行为。本地工作区不会自动上传 Tano 云端；Local 不表示所有功能永远不联网。

联系 [dramwig@gmail.com](mailto:dramwig@gmail.com)咨询政策或发布完整性问题，不要发送凭据及无关私人文档。

依据：[基金会条件](https://signpath.org/terms)、[GitHub 可信构建文档](https://docs.signpath.io/trusted-build-systems/github)。
