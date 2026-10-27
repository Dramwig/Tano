# Tano / 同页

Tano — Humans and agents, on the same page.
同页 — 人与 Agent，在同一页工作。

## Invariants

- Markdown files are the content source of truth. Never move primary content into a database or Yjs binary.
- Cache and application state belong in application data, not in the workspace. `.tano/config.json` contains only portable workspace identity.
- All Tano-owned portable data belongs under `.tano/` (objects, relations, and workspace rules). Never create platform data files or folders at the workspace root. User Markdown and attachments remain ordinary workspace files.
- An external edit must never be overwritten silently. Read/compare/write with a base hash, merge independent edits, and preserve both versions on conflict.
- File identity is independent of its path. Future collaboration rooms use workspace UUID + short file ID.
- Keep the editor, filesystem adapter, and future network sync separate.
- Do not follow symlinks outside the selected workspace.

## Licensing

- The local open-source product and public shared core use the standard MIT License (SPDX: `MIT`). This license choice is settled.
- This repository contains the MIT local product and shared core. Hosted services and deployment code are outside its scope.
- Keep license files, package metadata, and bundled notices aligned with MIT while preserving third-party license obligations. Existing published artifacts retain their accompanying licenses.
- Follow `docs/license.md` for the repository scope and licensing guidance.

## Development

- Before release-related Git commits, pushes, or tag creation for any new Core or Product/cloud version, add the current release's changes to the website changelog in Tano-cloud (`apps/client/src/changelog/zh-cn.md` and `en-us.md`). Review `/zh-cn/changelog/` locally before those Git operations. This also applies to Core-only releases; record the version, date, scope and actual changes, and include the changelog update in the coordinated release commits before tagging. See [docs/release-automation.md](docs/release-automation.md). Ordinary non-release Git work does not require a release entry.

- Ordinary Git commits, pushes and merges do not require tests, builds or dependency installation; do not run them or synchronize Core solely for a Git request. During development, choose targeted local checks based on the change or explicit user instructions. Before publishing a new version, complete the full local checks and applicable platform acceptance on the final release revision, and record the commands, results and tested SHA in release evidence. GitHub Actions is manual-only for packaging, release and synchronization; never add commit/PR-triggered CI or run test suites there. See [docs/local-validation.md](docs/local-validation.md).

- `npm install`, `npm run dev` for the browser demo; `npm run desktop` for the real desktop filesystem.
- `npm run check` for TypeScript, merge/store tests, and production build.
- `npm run docs:check` to verify relative Markdown documentation links independently.
- `npm run test:native` for native storage tests using the release desktop configuration.
- Run `cargo fmt --manifest-path crates/tano-native/Cargo.toml` and `cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml` after Rust changes.
- UI text defaults to Simplified Chinese. Clearly label browser demo storage and unimplemented network capabilities.

## Commits

- After completing a requested Git commit/push/merge workflow, agents must automatically run `npm run cache:clean -- -Apply` on Windows in each affected repository, without asking again. Wait until all validation, packaging, deployment and acceptance work in that workflow has finished. Read-only Git commands do not trigger cleanup. This is an agent workflow rule, not a Git hook; see [docs/local-validation.md](docs/local-validation.md).
- Only clean the script's allowlisted Rust cache subdirectories and Android build intermediates. Preserve source, uncommitted work, `node_modules/`, `vendor/`, installer bundles, exported Core packages, release evidence, backups and local service state. If a build is active or a safety check fails, defer cleanup and report why; never force it. Report recycled bytes separately from reclaimed disk space. On other platforms, report that this Windows cleanup command is unavailable rather than substituting broad deletion commands.

- Follow [docs/branching.md](docs/branching.md): PRs are optional; normal pushes to `main` and `dev` are allowed without a mandatory local-test gate. Integrate ordinary work into `dev` before promoting it to `main`.
- Use `git merge --no-ff` when merging between branches, including task branches and `main`/`dev`, to preserve a merge record. Never squash/rebase long-lived branches or force-push/delete them. Version updates and hotfixes made on `main` must be merged back into `dev` the same way.

- Follow the Conventional Commit format and the examples in [CONTRIBUTING.md](CONTRIBUTING.md) for every new commit.
- Give substantial changes a body that explains the behavior, reason, and important implementation details. Keep follow-up fixes in the same logical commit before merging.
