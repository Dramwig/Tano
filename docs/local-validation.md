# Local validation and manual Actions

All tests, static checks and smoke tests run on developer machines. Ordinary
commits, pushes (including tags), PR updates and merges start **no GitHub Actions**.
No Git hook is installed and no background test runner is started automatically.

## Before submitting or merging

1. Update the target branch and validate the proposed integration locally. After
   resolving a merge conflict, rerun the affected checks on the resolved result.
2. Run `npm ci` when dependencies change, then `npm run check`. This covers
   TypeScript, unit/integration tests, production builds and documentation links.
3. Run the additional commands below for affected areas. Tests requiring a native
   platform run locally on that platform; record unavailable checks honestly.
4. Record the tested revision, commands, results and any platform limitations in
   the commit body or an optional PR. For checks before a commit, record the base
   SHA and that the staged working tree was tested. Ordinary pushes to main/dev
   are allowed; force pushes and branch deletion remain blocked. If using a PR,
   resolve its review conversations. There are no remote required checks.
   A successful manual package build is not a test result.

| Area | Additional local validation |
| --- | --- |
| Native/desktop | `npm run test:native`; Rust formatting checks; `npm run desktop:build` and a local launch |
| MCP | `npm run mcp:smoke` |
| Android | `npm run test:android` with a local SDK, emulator/device and required Rust targets; `npm run android:build -- --debug --apk --target aarch64 --ci` |
| Apple | Build and exercise macOS/iOS on a local Mac with Xcode |
| Workflow edits | Run `actionlint` locally |
| Browser plugins | `npm run test:plugins:browser` (install Playwright Chromium locally first) |
| Native plugins | `npm run test:plugins:native` |

## GitHub Actions

The former `check.yml` has been removed. Remaining workflows are manual
`workflow_dispatch` entries.
They package, release or create synchronization PRs, and do not execute test suites.
Release-time source identity, tag/version matching, package hashes, signing and
clean Core export guards remain part of the requested operation.

Normally merge main into dev locally with `git merge --no-ff main` and push dev.
**Sync main into dev** is an optional manual PR helper; it never merges the PR itself.
Run **Export reviewed Core** manually for an immutable Core tag; then request the consumer sync manually.
Creating a version PR or tag no longer starts the next workflow. Follow the manual
sequence in [release automation](release-automation.md). Manually running a build
still uses Actions minutes; ordinary development does not.
