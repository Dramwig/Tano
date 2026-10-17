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
| Mobile/tablet UI | `npm run test:mobile:browser`; native keyboard, rotation, split view and back/lifecycle checks in [mobile development](mobile.md) |
| Apple | Build and exercise macOS/iOS on a local Mac with Xcode |
| Workflow edits | Run `actionlint` locally |
| Browser plugins | `npm run test:plugins:browser` (install Playwright Chromium locally first) |
| Native plugins | `npm run test:plugins:native` |

For desktop startup changes, inspect the **first visible frame** of a fresh process
in both `npm run desktop` (with a fresh Vite server) and the built release. It must
show the startup UI or workbench, including when workbench imports are slow or
fail. A screenshot taken after initialization does not verify this. Navigation
completion is not evidence of a painted frame. Check that prewarmed settings stay
hidden, the main window stays hidden until the workbench mounts, and a Vite or
manual reload follows the same boundary. Check that startup errors and a stalled
frontend offer recovery, and late imports cannot overwrite it. Report time to first content
separately from time to an interactive workbench.

## After completing Git work

Agents automatically clean build caches once at the end of a requested
commit/push/merge workflow in every affected repository. Finish all validation,
packaging, deployment and acceptance first; do not clear caches between those
steps. Read-only commands such as `git status`, `git diff` and `git log` do not
trigger cleanup. This is an agent workflow requirement, not an installed Git
hook, so manually running Git outside an agent does not invoke it.

On Windows with PowerShell 7, preview with `npm run cache:clean`, then apply with
`npm run cache:clean -- -Apply`. The [cleanup script](../scripts/clean-build-cache.ps1)
moves only allowlisted Rust `incremental`, `deps`, `build` and `.fingerprint`
directories and Android `app/build/intermediates` to the Recycle Bin. It checks
the repository boundary, tracked files, directory links and active build
processes before changing anything. If blocked, defer cleanup and report the
reason. If Windows prevents moving a cache container, recycle its children and
leave the empty container; report any files that remain. Do not change access
permissions or stop unrelated processes. Other platforms require a separately
reviewed cleanup implementation.

Keep dependencies, vendor snapshots, installers, Core exports, release evidence,
backups and local service state. Never use `git clean -fdx` or remove entire
`target/` or `artifacts/` trees for this step. The next native build will be slower.
Report the amount recycled; it is not reclaimed disk space until those items
are permanently removed from the Recycle Bin. Do not empty unrelated recycled
files automatically.

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
