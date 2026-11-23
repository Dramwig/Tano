# Agent 工作流程

[English](../agent-workflow.md) | [简体中文](../zh/agent-workflow.md) | 繁體中文 | [日本語](../ja/agent-workflow.md) | [Español](../es/agent-workflow.md) | [Deutsch](../de/agent-workflow.md) | [文件目錄](README.md)

請先在桌面應用程式開啟工作區資料夾。本機 Agent Gateway 透過穩定的識別碼與修訂版本查詢檔案、物件和資料表。預設允許讀取與提出變更，提案在 Tano 中審閱後才會套用。若要使用舊有的 Markdown 直接寫入機制，必須明確指定 `--access write`。權限範圍、SDK、跨檔案審閱與操作回執請參閱 [Agent Gateway v1](../zh/agent-gateway.md)（簡體中文）。

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

MCP 伺服器需要 Node.js 24.12 以上的版本。請使用桌面應用程式 MCP 面板顯示的工作區與應用程式資料路徑。應用程式資料必須位於工作區外，桌面應用程式與 MCP 伺服器應共用同一個資料目錄。

更新時須提供上一次讀取傳回的 SHA-256 雜湊值。若檔案已變更，伺服器會拒絕這次寫入。活動紀錄位於應用程式資料中，正文保留在 Markdown 檔案內。用戶端提供的名稱只供辨識，無法驗證人員或模型的身分。stdio 伺服器僅提供本機 MCP 存取，無遠端命令執行或即時網路協作功能。
