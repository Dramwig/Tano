# ビルドとリリース

[English](../releases.md) | [中文](../zh/releases.md) | 日本語 | [Deutsch](../de/releases.md) | [ドキュメント一覧](README.md)

`npm run desktop:build` でデスクトップパッケージをビルドします。ソースからのビルドにはアカウントや署名鍵は不要で、更新先も既定では設定されません。Windows の NSIS インストーラーは `apps/client/src-tauri/target/release/bundle/nsis/` に出力されます。

公開リポジトリからは MIT ライセンスのローカル製品をビルドできます。公式のオンライン機能を含むインストーラーは、[Cloud Extension API](../cloud-extension.md) を実装する非公開の `Tano-cloud` リポジトリでビルドし、`Dramwig/Tano` の Release アセットとして公開します。GitHub が自動生成するソースアーカイブには公開 Core のみが含まれ、公式バイナリ内の非公開 Cloud Overlay は含まれません。

`npm run version:set -- 0.2.0` は公開 Core リポジトリの npm ワークスペース、内部依存関係、npm/Cargo ロックファイル、Tauri 設定、Rust crate のバージョンをまとめて更新します。`npm run version:check` は整合性を検査し、`npm run check` にも含まれます。公式 Product のバージョンは非公開の `Tano-cloud` で独立して管理します。個別に公開される Python/Rust プロトコル補助パッケージも独自のバージョンを維持します。

`core-vX.Y.Z` を push すると公開 Core の検証が走ります。そのクリーンなコミットから Core をエクスポートし、`Tano-cloud` に固定します。非公開リポジトリのリリースワークフローは独立した Product バージョンを読み取り、選択した Core コミット上に Product タグ `vA.B.C` を作成して、署名済み Windows x64 と Linux x64 のインストーラーをこの公開 Release にアップロードします。macOS の両アーキテクチャも、署名設定後に有効にできます。初回公開には各プラットフォームの認証情報と実機検証が必要です。Cloud のみ変更した場合、複数の Product タグが同じ Core コミットを指せます。Core タグ自体は GitHub Release を作りません。公式アプリは `https://github.com/Dramwig/Tano/releases/latest/download/latest.json` で更新を確認します。

配布物には[サードパーティーの通知](../../THIRD_PARTY_NOTICES.md)を含めてください。依存関係を変更した後は `npm run notices:generate` で通知を再生成します。
