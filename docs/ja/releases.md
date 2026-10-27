# ビルドとリリース

[English](../releases.md) | [中文](../zh/releases.md) | 日本語 | [Deutsch](../de/releases.md) | [ドキュメント一覧](README.md)

`npm run desktop:build` でデスクトップパッケージをビルドします。ソースからのビルドにはアカウントや署名鍵は不要で、更新先も既定では設定されません。Windows の NSIS インストーラーは `apps/client/src-tauri/target/release/bundle/nsis/` に出力されます。

公開リポジトリからは MIT ライセンスのローカル製品をビルドできます。公式のオンライン機能を含むインストーラーは、[Cloud Extension API](../cloud-extension.md) を実装する非公開の `Tano-cloud` リポジトリでビルドし、`Dramwig/Tano` の Release アセットとして公開します。GitHub が自動生成するソースアーカイブには公開 Core のみが含まれ、公式バイナリ内の非公開 Cloud Overlay は含まれません。

`npm run version:set -- 0.2.0` は公開 Core リポジトリの npm ワークスペース、内部依存関係、npm/Cargo ロックファイル、Tauri 設定、Rust crate のバージョンをまとめて更新します。`npm run version:check` は整合性を検査し、`npm run check` にも含まれます。公式 Product のバージョンは非公開の `Tano-cloud` で独立して管理します。個別に公開される Python/Rust プロトコル補助パッケージも独自のバージョンを維持します。

配布する共有 Core に変更がある場合だけ、新しい Core バージョンを作成します。最終コミットをローカルで検証し、不変の `core-vX.Y.Z` タグを手動で作成してから、同じバージョンとソース SHA の npm パッケージ五つと Rust crate 一つを公開します。対応する Core GitHub Release に `core-registry.json` を添付し、latest には設定しません。`Tano-cloud` では `npm run core:sync -- --registry <manifest-url>` で依存関係を固定します。タグの push はワークフローを起動しません。Cloud、Web サイト、デプロイ設定のみの変更では既存の Core を再利用し、公開済み Core の導入でも再公開は不要です。詳細は [Core 配布](../core-distribution.md)を参照してください。非公開リポジトリのリリースワークフローは独立した Product バージョンを読み取り、選択した Core コミット上に Product タグ `vA.B.C` を作成して、署名済み Windows x64 と Linux x64 のインストーラーをこの公開 Release にアップロードします。macOS の両アーキテクチャも、署名設定後に有効にできます。初回公開には各プラットフォームの認証情報と実機検証が必要です。複数の Product タグが同じ Core コミットを指せます。公式アプリは `https://github.com/Dramwig/Tano/releases/latest/download/latest.json` で更新を確認します。

配布物には[サードパーティーの通知](../../THIRD_PARTY_NOTICES.md)を含めてください。依存関係を変更した後は `npm run notices:generate` で通知を再生成します。
