# Tano Local official builds

See the [Code signing policy](code-signing-policy.md),
[Local privacy policy](local-privacy.md) and [SignPath application materials](signpath-application.md).
SignPath signing is planned, not active; the existing PFX path below is not a
SignPath adapter. Current preview signing labels remain unchanged.

Tano Local is the complete MIT local product, built entirely in the public
`Dramwig/Tano` repository. It has no proprietary Cloud Overlay and needs no
account. Tano also supports local use without an account. Core remains the name
of the shared developer packages. Both products use the same workspace contract.

The initial official target is Windows x64 NSIS. Local uses `Tano Local` and
`app.tano.local`, separate from Product's `Tano` / `app.tano.desktop` installation
and application data. Only stable Core releases get Local builds; Product-only
changes do not require them. Download selection belongs on the shared
[download page](https://tano.page/zh-cn/download/#local), below the main Tano
downloads. The website must show preparation status until accepted assets exist.

## Build and publication gates

An explicitly approved unsigned preview is also supported. Dispatch with
`unsigned_preview=true` and pass `--unsigned-preview` to local prepare/publish.
Its metadata must say `preview: true`, `authenticode: "unsigned"` and
`certificateThumbprint: null`. The website displays an unsigned-preview label
and Windows security-warning notice. Public provenance, exact checksums, source
validation and installer acceptance remain mandatory; the preview receipt uses
`windowsInstall` for the actual local Windows environment rather than claiming
a clean-machine test. Signed stable builds still require the publisher
certificate and `cleanWindowsInstall`. Never describe an unsigned preview as
signed or bypass the remaining validation gates.

Follow [local validation](local-validation.md), [release automation](release-automation.md)
and [Core distribution](core-distribution.md) first. A changed Core must be
published as the complete six-package set; adding a desktop installer is not a
replacement for that publication. Update both website changelogs and review
`/zh-cn/changelog/` before release commits or tags. Never rewrite a published tag.

1. Integrate the final source and choose a new stable Core version. Run the full
   local checks and native/MCP acceptance; record the final source SHA and actual
   command results. `core-vX.Y.Z` must contain the Local workflow and scripts.
2. Configure a trusted Authenticode code signing certificate in the public
   repository's `release-automation` environment: secrets
   `LOCAL_WINDOWS_CERTIFICATE_PFX` (base64 PFX),
   `LOCAL_WINDOWS_CERTIFICATE_PASSWORD`, and variable
   `LOCAL_WINDOWS_CERTIFICATE_THUMBPRINT`. Certificate provisioning requires the
   publisher's identity and is not automated by this repository. Never commit
   the certificate or put it in evidence. A hardware/cloud signing service needs
   a separately configured signing adapter; do not export a non-exportable key.
3. Manually dispatch **Build reviewed Tano Local** selecting the **Core tag as
   the workflow ref**, with `local_evidence` JSON below. The workflow runs only
   at public Core tags. It installs dependencies, packages and signs; it never
   runs tests in Actions. It rejects dirty source, tag/version mismatch, a tag
   outside `origin/main`, absent evidence and missing signing credentials. It
   clears inherited updater and development MCP environment settings before
   building and verifies timestamped Authenticode on the app and installer.
   From gh, use `gh workflow run local-desktop.yml --repo Dramwig/Tano --ref core-vX.Y.Z -F local_evidence=@C:/release-evidence/local.json`.
4. Download `tano-local-core-vX.Y.Z-windows-x64` from the public Actions run.
   GitHub provenance attests the installer, source metadata, licenses and hashes.
   Validate provenance before executing the installer. Perform clean Windows
   installation, launch, local editing/conflict preservation, local MCP,
   coexistence with Product, manual update behavior, and uninstall preserving
   workspace data. Use the exact signed downloaded bytes, not a rebuilt local
   installer. Preserve logs/screenshots and receipt privately.
5. From the clean exact tagged checkout, with that Core's six-package Release
   already public, publish the accepted artifacts:

   ```powershell
   node scripts/local-release.mjs publish C:/release-artifacts/core-vX.Y.Z C:/release-evidence/acceptance.json
   ```

   The publisher requires the installer's exact SHA-256, checksums, timestamped
   publisher signature and GitHub attestation bound to the source tag, commit
   and public workflow. It uploads without `--clobber`; identical retries are
   allowed, different existing bytes stop publication. It explicitly keeps the
   Core Release `--latest=false`. The initial Local release has **no `latest.json`
   and no automatic download/install**. Never reuse Product's update endpoint or
   updater keys. A future automatic channel requires its own endpoint and key.
   Local reads only the accepted version announcement at
   `https://tano.page/releases/local.json`. It compares stable versions, shows a
   notification for a newer version, and opens that `core-v` GitHub Release.
   This announcement never stages, downloads or installs an update. Missing or
   invalid announcements show an error and retain the manual download link.
6. In Tano-cloud run `node scripts/record-local-download.mjs core-vX.Y.Z`.
   This fetches published metadata, verifies its attestation/tag/source and checks
   asset availability before recording static metadata. Review Chinese and
   English downloads and changelog, then publish the website through its normal
   immutable release/deployment workflow. Until then the page says preparation
   is in progress and offers source build instructions.

Local source builds remain available with `npm run desktop:build`; they need no
account, publishing credential or signing key. They are not official accepted
release artifacts. To prepare a signed release locally from the clean tag use
`node scripts/local-release.mjs prepare C:/release-evidence/local.json`, with
`TANO_LOCAL_CERTIFICATE_THUMBPRINT` pointing to the publisher certificate in
the current user's certificate store. Public GitHub provenance still requires
the public workflow build; a local build alone cannot pass publication.
`npm run desktop:release -- prepare <evidence-file>` is the same public Local
entry point; it no longer creates a Product-style `latest.json`.

## Evidence format

Build input (replace SHA/results with actual successful local validation):

```json
{
  "sourceCommit": "<full tested Core SHA>",
  "commands": [
    { "command": "npm run check", "exitCode": 0 },
    { "command": "npm run test:native", "exitCode": 0 },
    { "command": "npm run mcp:smoke", "exitCode": 0 }
  ]
}
```

The publication receipt additionally includes `installerSha256` and an
`acceptance` object with each of these keys set to `true` only after testing:
`cleanWindowsInstall`, `launch`, `localWorkspace`, `mcp`, `productCoexistence`,
`uninstallPreservesWorkspace`, `noAutomaticUpdater`. Retain the supporting logs;
these flags record human/local results, not CI certification. Failed validation
blocks publication. Do not copy example successes as evidence.

## Verify a download

The Core Release includes `Tano-Local_X.Y.Z_x64-setup.exe`, `local-release.json`,
`SHA256SUMS.txt`, `local-provenance.jsonl`, `LICENSE` and
`THIRD_PARTY_NOTICES.txt`, alongside `core-registry.json`. Compare SHA-256 and
inspect Windows' publisher signature. For source provenance, with a recent gh:

```powershell
gh attestation verify Tano-Local_X.Y.Z_x64-setup.exe --repo Dramwig/Tano --signer-workflow Dramwig/Tano/.github/workflows/local-desktop.yml --source-ref refs/tags/core-vX.Y.Z --source-digest <full-Core-SHA> --deny-self-hosted-runners --bundle local-provenance.jsonl
```

Provenance establishes where and how a build ran; it is not a promise of
bit-for-bit reproducible builds or a security audit. Windows code signing and
GitHub provenance are separate checks; neither alone replaces desktop acceptance.
See [GitHub artifact attestations](https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations)
and [Tauri Windows signing](https://v2.tauri.app/distribute/sign/windows/).

## Workspace format compatibility

`.tano/config.json` remains portable workspace identity only. `format: 1` is
the supported identity format; missing `format` is accepted as legacy v1 without
rewriting it. Invalid or unknown formats stop opening and native/MCP operations,
including an already connected session whose format changes externally. No
automatic migration or downgrade is attempted, and files are preserved. Future
incompatible workspace changes must bump this format before writing new data;
individual object/identity documents retain their own version validators.

Previously published builds that ignored this field cannot be fixed retroactively.
Do not open a future upgraded workspace with them. Simultaneous Local/Product
editing still uses the existing base-hash conflict checks and portable identity;
different app identities alone do not provide cross-process write serialization.
