# Tano Local — SignPath application materials

Submitted: October 30, 2026. Decision recorded: October 31, 2026.
**Application not approved; signing is not active.**

The maintainer supplied the Foundation's October 30 response: public trust and
visibility signals were insufficient at this stage. The Foundation cited adoption,
independent references, institutional backing and sustained engagement, and invited
reapplication after broader recognition. It did not identify a build or packaging
failure in that response. Do not continue waiting for activation from this submission.

The official form at `https://signpath.org/apply` displayed **Form submitted** and
**Thank you, we'll be in touch soon.** after submission. No application ID or
account activation was shown. Contact: `dramwig@gmail.com`. The required Foundation
terms and account-data-processing consent were accepted with the maintainer's
authorization; optional marketing communications remained unchecked. This receipt
confirms delivery of the application, not account provisioning or signing approval.

The information below records the submitted [official form](https://signpath.org/apply).
Retain these materials for a future application when new, verifiable public adoption
and recognition evidence is available; do not resubmit the same evidence immediately.
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
- [x] 已准备中英文签名政策及 Local 隐私说明，并按维护者提供的审核结果记录本次未获批状态。
- [x] 政策和 README 入口已发布到公开仓库，英文政策已验证匿名可访问。
- [x] 现有 Local GitHub Release 已加入政策链接；申请使用仓库主页和该 Release 下载页。
- [ ] 发布官网首页页脚及 Local 下载区域的政策入口，检查中英文页面。
- [ ] 确认 GitHub 多因素认证已开启；目前未经确认。
- [ ] 若未来获批或选择其他签名方案，再按实际账号开通流程设置凭据和多因素认证；本次不再等待自动激活。
- [x] 维护者同意以所填姓名及联系邮箱提交申请，并接受必选条款与数据处理授权。
- [x] 收到页面成功回执，确认申请送达。
- [x] 维护者于 2026 年 10 月 31 日提供基金会回复，状态更新为“本次未获批准”。

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
