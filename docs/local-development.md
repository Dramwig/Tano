# Local development

For third-party account imports, see [OAuth application configuration](account-import.md).

English | [中文](zh/local-development.md) | [日本語](ja/local-development.md) | [Deutsch](de/local-development.md) | [Documentation](README.md)

Install Node.js 24.12+, npm, and Rust stable. Desktop development also needs the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows, these include C++ Build Tools, the Windows SDK, and WebView2; `powershell -File scripts/check-desktop.ps1` checks the local setup.

From the repository root:

```sh
npm ci
npm run desktop
```

On Windows, you can also double-click `local-desktop.bat`. It checks the Node.js version and desktop toolchain and runs `npm install --no-audit --no-fund` before every launch, so added or changed dependencies are synchronized even when `node_modules` already exists. Dependencies that already match the lockfile are reused.

This starts the Vite + Tauri development app. The main window stays hidden until the workbench mounts, including after Vite reloads; dependency and compilation progress remains in the terminal. Frontend startup failures or a 30-second timeout reveal a recovery screen with a reload button. Late initialization results cannot replace that recovery screen.

Both Windows launchers check the Node.js version before installing dependencies, and the repository's npm configuration rejects incompatible versions. If the version check fails, run `node -v` and `where.exe node` to inspect the active version and path. With nvm-windows, install and switch to Node.js 24.12+, then reopen the terminal or launcher.

For the browser demo, use `npm run dev` and open `http://127.0.0.1:43841`. It stores data in the browser and does not access a real workspace folder. Desktop development prefers port 43842. When that port is occupied, `npm run desktop` and `local-desktop.bat` automatically select a free port and print the actual address, so both commands can run together. The browser demo still requires port 43841 to be free.

The desktop application ID is `app.tano.local`. On Windows, application data is normally under `%APPDATA%/app.tano.local`; use the path shown in Tano's MCP panel when configuring an agent. Workspace Markdown and `.tano/` are portable, while indexes, drafts, and session state stay in application data.

After dependencies are installed, local editing, search, and draft persistence can work offline. Remote images and an explicitly configured update check still require a network connection. Source builds do not configure an update endpoint by default.

Before publishing a new version, run `npm run check` and the applicable native and MCP checks (`npm run test:native`, `npm run mcp:smoke`) as described in [local validation](local-validation.md). Ordinary commits, pushes and merges do not require these commands; choose targeted checks during development when useful. After changing Rust code, run:

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
