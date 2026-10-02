# Local development

English | [中文](zh/local-development.md) | [日本語](ja/local-development.md) | [Deutsch](de/local-development.md) | [Documentation](README.md)

Install Node.js 24.12+, npm, and Rust stable. Desktop development also needs the [Tauri 2 system prerequisites](https://v2.tauri.app/start/prerequisites/). On Windows, these include C++ Build Tools, the Windows SDK, and WebView2; `powershell -File scripts/check-desktop.ps1` checks the local setup.

From the repository root:

```sh
npm ci
npm run desktop
```

For the browser demo, use `npm run dev` and open `http://127.0.0.1:43841`. It stores data in the browser and does not access a real workspace folder. Desktop development uses port 43842, so both commands can run together. Both ports must be free when starting their respective services.

The desktop application ID is `app.tano.local`. On Windows, application data is normally under `%APPDATA%/app.tano.local`; use the path shown in Tano's MCP panel when configuring an agent. Workspace Markdown and `.tano/` are portable, while indexes, drafts, and session state stay in application data.

After dependencies are installed, local editing, search, and draft persistence can work offline. Remote images and an explicitly configured update check still require a network connection. Source builds do not configure an update endpoint by default.

Run `npm run check`, `npm run test:native`, and `npm run mcp:smoke` before submitting changes. After changing Rust code, run:

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
