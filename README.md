<div align="center">

<img src="apps/client/brand/green/1024x1024.png" alt="Tano logo" width="88">

# Tano / 同页

### Humans and agents, on the same page.

**A File-Native Workspace for humans and AI agents.**

[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Built with Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Node.js 24.12+](https://img.shields.io/badge/Node.js-24.12%2B-339933.svg)](https://nodejs.org/)

### 🌐 The Official Website: [tano.page](https://tano.page)

English | [中文](README_ZH.md) | [日本語](README_JA.md) | [Deutsch](README_DE.md)

[Downloads](https://github.com/Dramwig/Tano/releases) · [Quick start](#quick-start) · [Features](#features) · [Documentation](docs/README.md) · [Development](#development)

</div>

## Features

- **Files you own:** Markdown, PDF, images, CSV, JSON, code, and attachments remain ordinary workspace files. Portable Tano data, including identities, objects, relations, and views, lives under `.tano/`.
- **One workspace model:** Files are the content source, Objects add stable semantics and relations, and Views project them without copying content.
- **A focused workbench:** Edit and search notes, organize objects and relations, and use the calendar in one desktop app.
- **External-edit protection:** Saves compare against a base hash, merge independent changes, and preserve both versions when edits conflict.
- **Local agent access:** The stdio MCP server lets agents list, read, create, and conditionally update documents. Stale writes are rejected.
- **Backup and recovery:** Back up the workspace together with `.tano/`; recovery tools help restore identity and data when needed.

This open-source Core works locally without an account. The browser demo uses browser storage and **does not read or write a folder on your computer**. Live network collaboration is not included in this source build.

## Official downloads

[GitHub Releases](https://github.com/Dramwig/Tano/releases) provide the complete official Tano installers. They are built from this MIT Core plus a proprietary Cloud Overlay maintained in a private repository. This repository's source and GitHub-generated source archives contain the Core only. Core tags use `core-vX.Y.Z`; Product releases use `vA.B.C` and can share the same Core commit.

[Tano Local · open source local edition](https://tano.page/en-us/download/#local)
is the official build of this public MIT source without the proprietary overlay.
Windows x64 builds are attached to stable Core releases. Unsigned previews are
explicitly labeled on the download page and include public provenance and SHA-256
checksums. See [Local build and verification](docs/local-release.md).

### Code signing policy

The SignPath Foundation application was submitted on October 30, 2026 and awaits review; signing is not active.
Current Local downloads remain explicitly labeled unsigned previews. See the
[Code signing policy](docs/code-signing-policy.md) and
[Tano Local privacy policy](docs/local-privacy.md) for scope, team roles and network behavior.

## Quick start

Install [Node.js 24.12+](https://nodejs.org/) and npm. The desktop app also needs [Rust stable](https://rustup.rs/) and the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/) for your platform.

```sh
npm ci
npm run desktop
```

For a browser-only preview, run `npm run dev` and open `http://127.0.0.1:43841`. Desktop development prefers port 43842 and automatically selects a free port if it is occupied, so both can run at the same time.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Getting started](docs/README.md) | Documentation index and paths through the guides |
| [Local development](docs/local-development.md) | Requirements, commands, and application data |
| [Architecture](docs/architecture.md) | Editor, storage, workspace format, and conflict handling |
| [Agent workflow](docs/agent-workflow.md) | Local MCP setup and conditional writes |
| [Backup and recovery](docs/backup-recovery.md) | Portable data, snapshots, and recovery |
| [Builds and releases](docs/releases.md) | Desktop builds and signed updates |
| [License and scope](docs/license.md) | MIT license and third-party obligations |

## Development

```sh
npm run check
npm run test:native
npm run mcp:smoke
```

`npm run check` runs TypeScript checks, tests, production builds, documentation link checks, and dependency boundary checks. See [local development](docs/local-development.md) for platform setup and Rust formatting commands.

For commit message format and contribution guidance, see [CONTRIBUTING.md](CONTRIBUTING.md).

Tano is released under the [MIT License](LICENSE). Third-party components keep their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md).
