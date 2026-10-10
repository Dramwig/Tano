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

- Run all tests and checks locally before committing or merging, and record the commands, results and tested revision in the commit body or an optional PR. GitHub Actions is manual-only for packaging, release and synchronization; never add commit/PR-triggered CI or run test suites there. See [docs/local-validation.md](docs/local-validation.md).

- `npm install`, `npm run dev` for the browser demo; `npm run desktop` for the real desktop filesystem.
- `npm run check` for TypeScript, merge/store tests, and production build.
- `npm run docs:check` to verify relative Markdown documentation links independently.
- `npm run test:native` for native storage tests using the release desktop configuration.
- Run `cargo fmt --manifest-path crates/tano-native/Cargo.toml` and `cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml` after Rust changes.
- UI text defaults to Simplified Chinese. Clearly label browser demo storage and unimplemented network capabilities.

## Commits

- Follow [docs/branching.md](docs/branching.md): PRs are optional; normal pushes to `main` and `dev` are allowed after local validation. Integrate ordinary work into `dev` before promoting it to `main`.
- Use `git merge --no-ff` when merging between branches, including task branches and `main`/`dev`, to preserve a merge record. Never squash/rebase long-lived branches or force-push/delete them. Version updates and hotfixes made on `main` must be merged back into `dev` the same way.

- Follow the Conventional Commit format and the examples in [CONTRIBUTING.md](CONTRIBUTING.md) for every new commit.
- Give substantial changes a body that explains the behavior, reason, and important implementation details. Keep follow-up fixes in the same logical commit before merging.
