<div align="center">

<img src="apps/client/brand/green/1024x1024.png" alt="Tano ロゴ" width="88">

# Tano / 同页

### 人とエージェントが、同じページで作業する。

**実ファイルを中心に、人と AI エージェントが同じワークスペースで作業する File-Native Workspace。**

[![MIT License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![Tauri 2](https://img.shields.io/badge/built%20with-Tauri%202-orange.svg)](https://tauri.app/)
[![Node.js 24.12+](https://img.shields.io/badge/Node.js-24.12%2B-339933.svg)](https://nodejs.org/)

### 🌐 The Official Website: [tano.page](https://tano.page)

[English](README.md) | [中文](README_ZH.md) | 日本語 | [Deutsch](README_DE.md)

[クイックスタート](#クイックスタート) · [機能](#機能) · [ドキュメント](docs/ja/README.md) · [開発](#開発)

</div>

## 機能

- **自分のファイルをそのまま使用:** Markdown、PDF、画像、CSV、JSON、コード、添付ファイルは通常のワークスペースファイルです。ID、オブジェクト、関係、ビュー、ルールなどの持ち運べるデータは `.tano/` に保存されます。
- **一つの作業画面:** ノートの編集と検索、オブジェクトと関係の整理、カレンダーの利用ができます。
- **外部編集の保護:** 保存時に基準のハッシュと比較して独立した変更をマージし、競合時は両方の内容を残します。
- **ローカルのエージェント接続:** stdio MCP サーバーから文書の一覧、読み取り、作成、条件付き更新ができ、古い内容に基づく書き込みは拒否されます。
- **バックアップと復旧:** ワークスペースと `.tano/` を一緒にバックアップし、必要に応じて ID とデータを復旧できます。

このオープンソース Core はアカウントなしでローカルに利用できます。ブラウザーデモはブラウザーのストレージを使用し、**PC 上のフォルダーを読み書きしません**。このソースビルドにはリアルタイムのネットワーク共同編集は含まれません。

## 公式ダウンロード

[GitHub Releases](https://github.com/Dramwig/Tano/releases) には、MIT Core と非公開の Cloud Overlay から構築した完全な公式インストーラーがあります。このリポジトリのソースと GitHub が自動生成するソースアーカイブには Core のみが含まれます。Core タグは `core-vX.Y.Z`、Product Release は `vA.B.C` を使用し、複数の Product 版が同じ Core コミットを共有できます。

## クイックスタート

[Node.js 24.12+](https://nodejs.org/) と npm をインストールしてください。デスクトップアプリには [Rust stable](https://rustup.rs/) と各 OS の [Tauri 2 の前提条件](https://v2.tauri.app/start/prerequisites/) も必要です。

```sh
npm ci
npm run desktop
```

ブラウザーデモのみを試す場合は `npm run dev` を実行し、`http://127.0.0.1:43841` を開いてください。デスクトップ開発は `43842` を使い、使用中なら空いているポートを選びます。

## ドキュメント

| ガイド | 内容 |
| --- | --- |
| [ドキュメント一覧](docs/ja/README.md) | ガイドへの入口 |
| [ローカル開発](docs/ja/local-development.md) | 要件、コマンド、アプリデータ |
| [アーキテクチャ](docs/ja/architecture.md) | エディター、保存形式、競合処理 |
| [エージェントの利用](docs/ja/agent-workflow.md) | ローカル MCP と条件付き書き込み |
| [バックアップと復旧](docs/ja/backup-recovery.md) | 持ち運べるデータ、スナップショット、復旧 |
| [ビルドとリリース](docs/ja/releases.md) | デスクトップビルドと署名付き更新 |
| [ライセンスと対象範囲](docs/ja/license.md) | MIT とサードパーティーのライセンス |

## 開発

```sh
npm run check
npm run test:native
npm run mcp:smoke
```

`npm run check` は TypeScript の検査、テスト、本番ビルド、ドキュメントのリンク検査、依存関係の境界検査を実行します。OS ごとのセットアップと Rust の整形コマンドは[ローカル開発](docs/ja/local-development.md)を参照してください。

Tano は [MIT License](LICENSE) で公開されています。サードパーティーのライセンスは[通知](THIRD_PARTY_NOTICES.md)を参照してください。
