# Tano Core 0.14.0

Shared Core update prepared for Cloud Product 0.15.0. The release includes the
editor, workbench, and native storage refactors, with on-demand document covers
and an offline gradient fallback.

The Core distribution consists of five npm packages and the `tano-native` crate.
The native crate uses the independently versioned `tano-page 0.1.0-alpha.2`
protocol library.

## Changes

- chore(release): integrate Core 0.14.0 development (13f2f45)
- Merge branch 'refactor/p3-directory-layout' into dev (dbe9d96)
- docs: align English root and zh/ docs and update moved source links (979aadc)
- chore(tests,scripts): move E2E specs and fixtures to tests/ and organize scripts (9a1dc30)
- refactor(workbench): organize packages/workbench/src into feature directories (45d2bec)
- refactor(workbench): unify en-US locale catalog to JSON format (ac88cab)
- refactor(editor): organize packages/editor/src into views, core, markdown, and plugins (febb381)
- refactor(native): organize crates/tano-native/src into domain directories (cdb5e9c)
- Merge branch 'refactor/p2-rust-native' into dev (48d155e)
- refactor(native): introduce NativeError and decompose storage and IPC router (a5d360f)
- Merge branch 'refactor/p2-frontend-decomposition' into dev (9208bdd)
- refactor(editor): decompose MarkdownEditor, blocks plugin, and split editor tests (aec273e)
- fix(workbench): add offline cover hint translation across locales (57f6b8b)
- refactor(workbench): decompose SettingsPanel, DesktopTabs, DataTablePage, and styles.css (497ab0d)
- refactor(workbench): decompose workspace store into domain modules and assistant bridge (0e4f852)
- refactor(workbench): decompose use-workbench into domain composables and extract App overlays (f81f40e)
- refactor(workbench): hoist async components and stop returning static UI bindings from useWorkbench (0e252aa)
- refactor(workbench): centralize Tauri API calls in platform/native-bridge (afc7199)
- Merge branch 'refactor/p1-public-assets' into dev (9d4c45d)
- refactor(workbench): serve curated document covers over HTTPS with offline gradient fallback (6598b5a)
- Merge branch 'refactor/p1-core-boundaries' into dev (04eef17)
- chore(boundaries): enforce workspace DAG, runtime dependency declarations, and explicit client exports (a8bd98f)
- refactor(native): lift auxiliary_windows into tano-native and trim unused shell Cargo deps (61802f2)
- feat(protocol,native): enforce TS/Rust/Python protocol parity and reuse tano-page in tano-native (0bce7d7)
- refactor(editor,workbench): move editor CSS into @tano/editor/styles.css (9350454)
- refactor(editor): move SourceEditor, highlight worker, and editor-mode from workbench to @tano/editor (1bfea77)
- refactor(editor): share Markdown schema plugin composer and group DOM/motion primitives (aeba7a0)
- refactor(protocol): extract core workspace types and move feature-gate helpers to @tano/protocol (379b736)
- merge: integrate P0 hygiene and packaging cleanup into dev (65ece6f)
- chore(deps): fix direct workspace dependencies and dev-only @types placement (aa6f546)
- chore(repo): remove scratch files and move build/test assets out of Core sources (7435b9c)
- chore(repo): synchronize Core 0.13.0 into development (8043dc4)

## 仍为未完成状态的功能（未随本版本开启）

- assistantClipboardAttachments: Paste local files and images into the assistant composer.
- markdownSpacingAutocomplete: Insert real Markdown spaces at mixed-script boundaries while editing.
