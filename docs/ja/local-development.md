# ローカル開発

[English](../local-development.md) | [中文](../zh/local-development.md) | 日本語 | [Deutsch](../de/local-development.md) | [ドキュメント一覧](README.md)

Node.js 24.12+、npm、Rust stable をインストールしてください。デスクトップ開発には各 OS の [Tauri 2 の前提条件](https://v2.tauri.app/start/prerequisites/) も必要です。Windows では C++ Build Tools、Windows SDK、WebView2 が必要です。`powershell -File scripts/check-desktop.ps1` で環境を確認できます。

リポジトリのルートで実行します。

```sh
npm ci
npm run desktop
```

ブラウザーデモは `npm run dev` で起動し、`http://127.0.0.1:43841` を開きます。データはブラウザーに保存され、実際のワークスペースフォルダーにはアクセスしません。デスクトップ開発版はポート 43842 を使うため、同時に実行できます。起動時にはそれぞれのポートが空いている必要があります。

デスクトップアプリの ID は `app.tano.local` です。Windows ではアプリデータは通常 `%APPDATA%/app.tano.local` にあります。エージェントの設定には Tano の MCP パネルに表示されるパスを使用してください。Markdown と `.tano/` は持ち運べますが、索引と復旧状態はアプリデータに置かれます。

依存関係をインストールした後は、ローカルの編集、検索、復旧をオフラインで利用できます。外部画像と、明示的に設定された更新確認にはネットワークが必要です。ソースからのビルドでは更新先は既定で設定されません。

変更を提出する前に `npm run check`、`npm run test:native`、`npm run mcp:smoke` を実行します。Rust コードを変更した後は次も実行してください。

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
