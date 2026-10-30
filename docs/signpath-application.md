# Tano Local — SignPath application materials

Prepared: October 30, 2026. **Draft prepared; not submitted; not approved.**

Use this information in the current [official form](https://signpath.org/apply).
Publish the linked materials and complete the account checks before submission.
Never send passwords, private keys, API tokens or backup codes with an application.

## Project fields

| Field | Value |
| --- | --- |
| Project | Tano Local / 同页开源本地版 |
| Maintainer / proposed signing approver | Zixi Wang, GitHub [Dramwig](https://github.com/Dramwig) |
| Public contact | dramwig@gmail.com |
| Source | https://github.com/Dramwig/Tano |
| License | MIT; third-party components retain their own licenses |
| Project homepage | https://github.com/Dramwig/Tano |
| Application download page | https://github.com/Dramwig/Tano/releases/tag/core-v0.9.1 |
| Website download | https://tano.page/en-us/download/#local |
| Chinese download | https://tano.page/zh-cn/download/#local |
| Signing policy (publish before submission) | https://github.com/Dramwig/Tano/blob/main/docs/code-signing-policy.md |
| Privacy policy (publish before submission) | https://github.com/Dramwig/Tano/blob/main/docs/local-privacy.md |
| Workflow | https://github.com/Dramwig/Tano/blob/main/.github/workflows/local-desktop.yml |
| Signing scope | Windows x64; own application executable and NSIS installer |

### Project description

Tano Local is an MIT-licensed, file-native desktop workspace for people and AI
agents. It edits ordinary Markdown files and attachments, maintains portable
identity and object relations, protects independent external edits, and provides
local MCP access. Local file use requires no Tano account. It uses Tauri, Rust
and TypeScript/Vue. Optional model/agent, account import, calendar/task and plugin
connections are documented. The privacy policy discloses startup version requests
and document-linked remote resources; Local is not claimed to be network-isolated.

### Scope and commercial relationship

This application concerns only Tano Local from public Dramwig/Tano source. The
maintainer also develops a separate Tano distribution with a proprietary Cloud
Overlay and hosted services. Those components and installers are excluded and
would not use Foundation signing. Public Local source uses standard MIT, not a
commercial dual-license arrangement. Third-party notices accompany the installer.

### Build and proposed signing process

The public workflow runs manually at immutable `core-vX.Y.Z` tags on GitHub-hosted
Windows runners. Source and dependency locks are public. Full release checks and
native/MCP acceptance run locally against final source; Actions packages and
attests the artifacts. Releases provide checksums and exact source metadata.
GitHub attestations do not replace Authenticode or SignPath origin verification.

The existing signed path expects a separately supplied PFX and is **not yet a
SignPath integration**. After acceptance, we plan to add the trusted GitHub build
connector, sign the own application before bundling, sign the installer, verify
returned artifacts and hash/attest final bytes. Zixi Wang will manually approve
each production signing request. Third-party binaries will not be signed as ours.

### Existing public evidence

This is a released installer example, not the identity of every newer source tag:

- [Core 0.9.1 release](https://github.com/Dramwig/Tano/releases/tag/core-v0.9.1).
- [Public build](https://github.com/Dramwig/Tano/actions/runs/40670535692).
- Source: `9d850ef2b2fc3b85cdef949c2ee80e4f22aab663`.
- [Windows installer](https://github.com/Dramwig/Tano/releases/download/core-v0.9.1/Tano-Local_0.9.1_x64-setup.exe), unsigned preview.
- [Checksums](https://github.com/Dramwig/Tano/releases/download/core-v0.9.1/SHA256SUMS.txt), [provenance](https://github.com/Dramwig/Tano/releases/download/core-v0.9.1/local-provenance.jsonl), [metadata](https://github.com/Dramwig/Tano/releases/download/core-v0.9.1/local-release.json), [notices](https://github.com/Dramwig/Tano/releases/download/core-v0.9.1/THIRD_PARTY_NOTICES.txt).
- Installer SHA-256: `a9c1311474b77609f5940bc88c9ae54275884502cd20189c0f272c17e67b9fe2`.

For a different review candidate, update these facts from its actual Local release
assets and build. A newer Core source tag or proprietary Product installer is not
evidence that a newer Local binary exists.

## 提交前检查 / maintainer checklist

- [x] 维护者确认 Dramwig（Zixi Wang）负责维护、外部贡献审阅和发布签名批准。
- [x] 已有公开 MIT 源码、Local Windows 包、工作流、校验值和来源证明。
- [x] 已准备中英文签名政策及 Local 隐私说明，明确尚未提交及获批。
- [ ] 发布政策和 README 入口到公开仓库，检查匿名可访问。
- [ ] 发布官网首页页脚及 Local 下载区域的政策入口，检查中英文页面。
- [ ] 确认 GitHub 多因素认证已开启；目前未经确认。
- [ ] 按官方申请/注册流程创建 SignPath 账号并开启多因素认证；维护者表示尚无账号。
- [ ] 维护者确认联系邮箱及最新项目资料，提交官方表单。
- [ ] 收到真实回执后才把政策状态改为“已申请，待审核”。

获批后另行配置组织、项目、产物限制、审批策略及可信构建。完成签名与最终
Windows 验收后，才可把新包标为已签名。不修改旧包、不覆盖已有资产，保留
当前未签名预览版提示。

## Future release-page link block

Use in a future Local release description; do not claim historical files are signed:

```markdown
Code signing policy: https://github.com/Dramwig/Tano/blob/main/docs/code-signing-policy.md
Local privacy policy: https://github.com/Dramwig/Tano/blob/main/docs/local-privacy.md
Signing status: use the actual Authenticode result of this release's published files.
```

References: [Foundation conditions](https://signpath.org/terms),
[GitHub integration](https://docs.signpath.io/trusted-build-systems/github).
