# Core package distribution

Tano Core is distributed as five npm packages and one Rust crate. Public import
names remain `@tano/protocol`, `@tano/markdown`, `@tano/editor`, `@tano/workbench`
and `@tano/mcp`. Registry packages use the owned `@tano.page` scope; npm aliases
preserve the import names. `tano-native` is published to crates.io.

All six packages identify the same stable Core version and clean source commit.
The current packages distribute TypeScript/Vue sources for the consumer's
Vue/Vite/esbuild toolchain; the MCP package contains its standalone CJS executable.
This does not change the public/private repository boundary or MIT licensing.

## When publication is required

Core and Product have independent release versions. A production deployment does
not automatically require another Core publication:

| Change being delivered | Core action |
| --- | --- |
| Only the private cloud overlay, website, API or deployment configuration changes | Keep the existing Core version, source pin and package locks; release Product as needed |
| Shipped shared Core code, dependencies or distribution contents change | Create a new Core version and publish all five npm packages plus the Rust crate at that same version, even if only one package changed |
| Product adopts an already published Core version | Sync its existing registry manifest and update consumer locks; do not publish those versions again |
| Retry the same approved release or deploy an unchanged artifact | Reuse the immutable Core packages; identical publication retries may skip existing artifacts |

The six packages currently form one versioned release set. They are not six npm
packages: five use npm and `tano-native` uses crates.io. Do not mix Core versions
or publish directly from the private Product repository. Ordinary Git commits,
documentation edits and development builds do not trigger publication.

## Prepare and verify locally

Configure the publishing scope and registry in `core-distribution.json`. The
original npm workspaces remain private; only staged distribution manifests become
public. Internal Core dependencies are pinned to the same exact version.

```powershell
npm ci
npm run check
npm run test:native
npm run mcp:smoke
npm run core:registry:prepare
npm run core:registry:smoke
npm run core:publish -- --dry-run
```

The preparation command creates `artifacts/core-registry/core-registry.json`,
five `.tgz` archives and one `.crate`. Preparation may preview dirty development
sources, but publication rejects them. The smoke command serves these exact
archives from a temporary local registry, installs the five packages with their
real npm aliases, builds a Vue workbench and exercises the shipped MCP executable.

Follow [release automation](release-automation.md) for changelog review, release
integration, local acceptance and the immutable `core-vX.Y.Z` tag. Publishing an
already validated tag into a new registry does not change that tag or its source.
Record the exact source commit and successful checks in a local evidence JSON:

```json
{
  "sourceCommit": "<full tested commit SHA>",
  "commands": [
    { "command": "npm run check", "exitCode": 0 },
    { "command": "npm run test:native", "exitCode": 0 },
    { "command": "npm run mcp:smoke", "exitCode": 0 },
    { "command": "npm run core:registry:smoke", "exitCode": 0 }
  ]
}
```

Use actual command results. Existing platform evidence can be reused only when
the tested source, dependencies and build configuration are unchanged, as defined
in [local validation](local-validation.md). Keep logs and any reuse explanation
with the evidence. Tests run locally, never in GitHub Actions.

## Reuse local npm authentication

Before asking the publisher to sign in again, check the existing credentials:

```powershell
npm whoami --registry=https://registry.npmjs.org/
```

Reuse a working login. Do not run `npm login` unconditionally for every release.
The Core publisher checks `npm whoami` and calls `npm publish`; it does not force
a new login. A successful identity check confirms authentication, but does not
prove package write permission or remove a publishing 2FA challenge. Reauthenticate
when the registry reports expired or invalid credentials; handle network failures
as network failures rather than assuming the user must log in again.

npm saves local authentication in the user configuration, normally
`~/.npmrc` (`$env:USERPROFILE\.npmrc` on Windows). Saving a token on disk does
not extend its server-side lifetime. Since December 2025, `npm login` issues a
two-hour session token, and publishing with that session still enforces 2FA.
This explains why another release can require browser authentication even though
the computer retained the credentials. See the
[npm session authentication announcement](https://github.blog/changelog/2025-12-09-npm-classic-tokens-revoked-session-based-auth-and-cli-token-management-now-available/).

For local publication without repeated browser prompts, the rules as of
2026-10-28 allow a granular access token with these settings:

- Limit package/scope access to the five published `@tano.page` Core packages.
- Select read and write permission that allows direct publication, rather than
  stage-only permission, and enable **Bypass 2FA** when creating the token.
- Choose an appropriate expiry; write tokens have a maximum lifetime of 90 days.
- Store the token in the user-level `.npmrc`, outside the repository. The registry
  entry has the form `//registry.npmjs.org/:_authToken=<token>`; replace the
  placeholder locally and never include the actual value in documentation,
  command output, release evidence or Git.

The package's publishing settings must allow granular tokens. A package configured
to require 2FA and disallow tokens still requires interactive publication. Existing
session credentials do not become a granular token automatically. Token creation
or renewal can itself require interactive authentication. See
[creating access tokens](https://docs.npmjs.com/creating-and-viewing-access-tokens/)
and [package publishing authentication](https://docs.npmjs.com/requiring-2fa-for-package-publishing-and-settings-modification/).

For the longer-term manual release workflow, prefer
[npm trusted publishing with OIDC](https://docs.npmjs.com/trusted-publishers/): a
configured GitHub Actions workflow obtains short-lived publishing credentials
without a stored npm publishing token. npm has announced a target of January 2027
for removing direct publication from bypass-2FA granular tokens; recheck the
[announced transition](https://github.blog/changelog/2026-07-31-restricting-npm-bypass-2fa-granular-access-tokens/)
before relying on them for future releases. The current workflow still uses
`NPM_TOKEN`; OIDC requires configuring the trusted publisher and adapting the
workflow and publisher's token-based `whoami` preflight. Keep Actions manual-only
and retain all local validation and immutable-artifact requirements when migrating.

## Publish immutable packages

Reuse valid npm credentials as described above; use `npm login` only when needed.
Configure crates.io credentials separately with `cargo login` when needed. Do not
put tokens in the repository. The registry scope must belong to the publishing
account. From the clean tagged checkout, publish the prepared, validated artifacts:

```powershell
npm run core:publish -- --apply --evidence artifacts/core-registry/local-evidence.json
```

The publisher preflights every existing version before making remote changes.
Retries skip only identical versions with matching provenance/checksums; an
existing version with different contents stops publication. A partial publication
can be resumed with the same source and artifacts. Changed content needs a new
Core version. Never retarget tags or overwrite registry versions.

After all six packages are available, attach `core-registry.json` to the Core
GitHub Release using `node scripts/publish-core-manifest.mjs core-vX.Y.Z`.
Create that Release from the existing immutable tag first if necessary. The
manifest upload refuses to overwrite an asset with different contents. Registry
packages are the dependency source; the small release manifest is for discovery.
Create a Core discovery Release with `gh release create core-vX.Y.Z --verify-tag
--latest=false --notes-file <release-notes-file>` so it does not replace the
official Product update Release as latest. Pushing a tag alone runs no workflow.

The smoke command records its exact manifest hash in `smoke/summary.json` under
the distribution directory. Publication verifies this receipt against the actual
artifacts, so preparing different bytes requires another local smoke run.

The manual **Publish reviewed Core packages** workflow performs packaging and
publication for an already locally validated tag. Configure `NPM_TOKEN` and
`CARGO_REGISTRY_TOKEN` in the `release-automation` environment and supply the local
evidence JSON and the matching smoke summary JSON. It runs no test suites and has
no push, tag or PR triggers. Different artifacts on another platform require new
local acceptance; the workflow refuses a smoke receipt for different bytes.

## Consume in Tano-cloud

```powershell
npm run core:sync -- --registry https://github.com/Dramwig/Tano/releases/download/core-vX.Y.Z/core-registry.json
```

The consumer verifies all six downloaded artifacts before changing pins, installs
exact npm aliases, changes Cargo to the exact registry crate and verifies both
locks. It then stops tracking old tarballs/native snapshots while preserving local
files, and runs the cloud checks. A configuration backup is kept under the cloud
repository's ignored `artifacts/` directory. Installation failure restores the old
manifests and locks; run `npm ci` to restore node_modules after a failed install.

Git retains dependency manifests, locks, source commit and integrity hashes. A
fresh clone needs neither sibling source nor vendored tarballs for `npm ci`.
Development can still use the sibling Tano source through the existing Vite and
desktop development launchers. Old local Core exports remain development tools;
they must not replace registry pins in a published consumer.

Stopping tracking prevents future archive growth. It does not remove existing
Git history, and this migration does not rewrite that history.
