# Tano Local — Code signing policy

Updated: October 30, 2026. [中文](zh/code-signing-policy.md) · [Local privacy policy](local-privacy.md)

## Current status

SignPath Foundation signing is **not active**. The project application was submitted
on October 30, 2026 and is awaiting review; approval is not claimed. Current Local
Windows downloads remain explicitly labeled **unsigned previews**. SHA-256 checksums
and public build provenance do not replace Windows Authenticode signatures.

The intended attribution, applicable only after acceptance and activation, is:
“Free code signing provided by [SignPath.io](https://signpath.io), certificate by
[SignPath Foundation](https://signpath.org).” The Foundation certificate's publisher
identity is SignPath Foundation, not the individual maintainer.

## Scope

[Tano Local](https://tano.page/en-us/download/#local) is the MIT local desktop product
maintained in [Dramwig/Tano](https://github.com/Dramwig/Tano). Local file use requires
no Tano account. The proposed Windows signing scope is the project's own application
executable and Windows x64 NSIS installer, `Tano-Local_<version>_x64-setup.exe`.

The proprietary Cloud Overlay, hosted services and Tano Product installers containing
private code are excluded and must never use this Foundation signing subscription.
Third-party components retain their licenses and existing signatures; their binaries
are not signed as Tano-owned software. See [MIT](../LICENSE), [license scope](license.md)
and [third-party notices](../THIRD_PARTY_NOTICES.md).

## Team and approval

| Role | Responsible maintainer |
| --- | --- |
| Authors / committers | [Dramwig — Zixi Wang](https://github.com/Dramwig) |
| Reviewers | [Dramwig — Zixi Wang](https://github.com/Dramwig) |
| Release signing approver | [Dramwig — Zixi Wang](https://github.com/Dramwig) |

The maintainer confirmed these responsibilities on October 30, 2026. Contributions
from others must be reviewed before inclusion, including changes to workflows,
build scripts, dependencies and bundled resources. Each release-signing request
requires the designated approver's explicit manual approval.

All members in these roles must enable multi-factor authentication on GitHub and
SignPath before signing is activated. This is an activation requirement, not a
claim that account setup or verification is already complete.

## Build and release controls

- Use immutable public `core-vX.Y.Z` tags in `Dramwig/Tano`; scripts and dependency
  lockfiles are public source.
- The [Local workflow](../.github/workflows/local-desktop.yml) runs manually on
  GitHub-hosted Windows runners. Full checks and native/MCP acceptance run locally
  against the release source; Actions packages artifacts and records provenance.
- SignPath integration is not yet implemented. Before activation, upload the
  unsigned build artifacts and submit their GitHub artifact identity using the
  trusted-build connector, followed by manual release approval. Substituted local
  binaries and unrelated repository builds are outside this policy.
- Configure enforced product-name and matching-version restrictions. Sign the
  project's application executable before bundling and signing the installer;
  preserve third-party signatures.
- Verify trusted, timestamped Authenticode signatures and complete final Windows
  installation, launch and uninstall acceptance. Hash and attest the final
  distributed bytes. Do not modify signed files or overwrite a published asset
  with different bytes.
- Keep Local separate from Product's GitHub `latest` release and automatic installer
  channel. See [Local release controls](local-release.md).

## Privacy and contact

The [Local privacy policy](local-privacy.md) discloses startup version requests,
document-linked remote resources, optional models/agents, account imports,
planning connections and plugins. Local workspaces are not automatically uploaded
to Tano cloud. “Local” does not mean enabled network features never contact services.

Contact [dramwig@gmail.com](mailto:dramwig@gmail.com) for policy or release-integrity
questions. Do not include credentials or unrelated private documents.

References: [Foundation conditions](https://signpath.org/terms) and
[GitHub integration](https://docs.signpath.io/trusted-build-systems/github).
