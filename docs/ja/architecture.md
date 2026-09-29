# アーキテクチャ

[English](../architecture.md) | [中文](../zh/architecture.md) | 日本語 | [Deutsch](../de/architecture.md) | [ドキュメント一覧](README.md)

Vue の作業画面は文書ストアを介して `WorkspaceAdapter` を使用します。デスクトップ用アダプターは `tano-native` が実装する Tauri IPC コマンドを呼び出し、ブラウザーデモは別のブラウザーストレージ用アダプターを使います。`configureWorkbench(pinia, runtime)` は各作業画面のインスタンスに一つの実行環境を結び付けます。

```text
Vue 作業画面 -> 文書ストア -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

内容の正本は Markdown ファイルです。エディターとヘッドレス codec は同じ Markdown schema を共有します。エディターは `EditorExtension` を通じてホスト機能を受け取り、編集処理を保存や通信から分離します。

保存時にはファイルを基準のハッシュと比較します。独立した外部変更はマージでき、変更が重なった場合は確認できるよう両方の内容を残します。Tano と連携しない外部プロセスがある場合、最後のハッシュ確認とアトミックな置換の間には短い競合の可能性があります。

ワークスペースの ID はファイルのパスとは独立しています。UUID、短いファイル ID、ID の予約情報は `.tano/identities.json` とともに移動します。オブジェクト、関係、ルールも `.tano/` に置きます。SQLite の索引、下書き、復旧状態はワークスペース外のアプリデータに保存します。選択したワークスペースの外を指すシンボリックリンクはたどりません。
