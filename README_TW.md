<div align="center">

<img src="apps/client/brand/green/1024x1024.png" alt="同頁圖示" width="88">

# Tano / 同页

### 人與 Agent，在同一頁工作。

**讓人與 AI Agent 使用相同真實檔案的工作區。**

[English](README.md) | [简体中文](README_ZH.md) | 繁體中文 | [日本語](README_JA.md) | [Español](README_ES.md) | [Deutsch](README_DE.md)

[官方網站](https://tano.page) · [下載](https://github.com/Dramwig/Tano/releases) · [文件](docs/zh/README.md)

</div>

## 功能

- **檔案由你掌握：** Markdown、PDF、圖片、CSV、JSON、程式碼和附件仍是一般工作區檔案。身分、物件、關係、檢視和規則等可攜資料保存在 `.tano/`。
- **統一的工作區模型：** File 是內容的事實來源，Object 提供穩定的語意與關係，View 只做投影，不複製正文。
- **集中的工作介面：** 在一個桌面應用程式中編輯與搜尋筆記、管理物件與關係，並使用行事曆。
- **保護外部修改：** 儲存時比較基準雜湊值，合併獨立修改；發生衝突時保留雙方內容。
- **本機 Agent 存取：** stdio MCP 服務支援列出、讀取、建立和條件更新文件，並拒絕過期寫入。
- **備份與復原：** 將工作區與 `.tano/` 一起備份；需要時使用復原工具找回身分與資料。

開源 Core 不需帳號即可在本機使用。瀏覽器示範使用瀏覽器儲存空間，**不會讀寫電腦上的資料夾**。此原始碼建置不包含即時網路協作。

## 官方下載

[GitHub Releases](https://github.com/Dramwig/Tano/releases) 提供完整官方安裝包，由本儲存庫的 MIT Core 與私有 Cloud Overlay 建置。本儲存庫及自動產生的原始碼壓縮檔只包含 Core。Core 標籤使用 `core-vX.Y.Z`，Product Release 使用 `vA.B.C`；多個 Product 版本可以使用同一個 Core 提交。

[Tano Local 開源本機版](https://tano.page/zh-cn/download/#local) 是不含私有 Cloud Overlay 的獨立安裝包；Windows x64 包附於對應的 Core Release。

目前 Local 包仍為未簽署的預覽版。2026 年 10 月 30 日的 SignPath Foundation 申請未獲批准，簽署尚未啟用。請參閱[程式碼簽署政策](docs/zh/code-signing-policy.md)及 [Local 隱私說明](docs/zh/local-privacy.md)。

## 快速開始

安裝 [Node.js 24.12+](https://nodejs.org/) 和 npm。桌面開發另需 [Rust stable](https://rustup.rs/) 與 [Tauri 2 系統相依套件](https://v2.tauri.app/start/prerequisites/)。

```sh
npm ci
npm run desktop
```

瀏覽器示範：執行 `npm run dev`，開啟 `http://127.0.0.1:43841`。桌面開發使用 `43842`；連接埠被佔用時會自動選擇其他可用連接埠。

## 文件與開發

開發與架構文件目前提供[簡體中文](docs/zh/README.md)及 [English](docs/README.md) 等版本。另見[本機開發](docs/zh/local-development.md)、[Agent 工作流程](docs/zh/agent-workflow.md)、[備份與復原](docs/zh/backup-recovery.md)和[建置與發行](docs/zh/releases.md)。

```sh
npm run check
npm run test:native
npm run mcp:smoke
```

`npm run check` 包含型別檢查、測試、正式版建置、文件連結與相依邊界檢查。

Tano 採用 [MIT License](LICENSE)。第三方元件保留各自授權，詳見[第三方聲明](THIRD_PARTY_NOTICES.md)。
