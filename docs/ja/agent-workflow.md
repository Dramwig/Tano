# エージェントの利用

[English](../agent-workflow.md) | [中文](../zh/agent-workflow.md) | 日本語 | [Deutsch](../de/agent-workflow.md) | [ドキュメント一覧](README.md)

まずデスクトップアプリでワークスペースフォルダーを開きます。エージェントは Markdown ファイルを直接編集できるほか、Tano のローカル stdio MCP サーバーで文書の一覧、読み取り、作成、条件付き書き込みを行えます。

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

MCP サーバーには Node.js 24.12+ が必要です。デスクトップの MCP パネルに表示されるワークスペースとアプリデータのパスを使用してください。アプリデータはワークスペースの外に置き、デスクトップアプリと MCP サーバーで同じディレクトリを使用します。

更新には、前回の読み取りで返された SHA-256 ハッシュが必要です。ファイルが変更されている場合、古い内容に基づく書き込みは拒否されます。活動記録はアプリデータに、本文は Markdown ファイルに残ります。クライアントが名乗る名前はラベルであり、人やモデルの身元を証明しません。stdio サーバーは遠隔コマンドの実行やリアルタイムのネットワーク共同編集を提供しません。
