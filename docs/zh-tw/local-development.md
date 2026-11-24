# 本機開發

[English](../local-development.md) | [简体中文](../zh/local-development.md) | 繁體中文 | [日本語](../ja/local-development.md) | [Español](../es/local-development.md) | [Deutsch](../de/local-development.md) | [文件目錄](README.md)

第三方帳號匯入所需的 OAuth 應用程式設定，請參閱[第三方帳號匯入](../zh/account-import.md)。行動裝置和平板的建置與驗證方式請參閱[行動裝置開發](../mobile.md)（英文）。

請安裝 Node.js 24.12 以上的版本、npm 和 Rust 穩定版。桌面開發也需要符合目前平台的 [Tauri 2 系統需求](https://v2.tauri.app/start/prerequisites/)。Windows 需要 C++ Build Tools、Windows SDK 和 WebView2，可執行 `powershell -File scripts/check/check-desktop.ps1` 檢查本機環境。

在儲存庫根目錄執行以下命令。

```sh
npm ci
npm run desktop
```

在 Windows 上，也可按兩下 `local-desktop.bat`。它會檢查 Node.js 版本及桌面工具鏈，並在每次啟動前執行 `npm install --no-audit --no-fund`。即使已有 `node_modules`，新增或變更的相依套件也會同步。符合鎖定檔的套件會直接沿用。

命令會啟動 Vite 與 Tauri 開發應用程式。工作台掛載後才會顯示主視窗，Vite 重新載入時亦同。相依套件與編譯進度會顯示在終端機。前端啟動失敗或超過 30 秒時，應用程式會顯示復原畫面並提供重新載入按鈕。逾時後才完成的初始化不會蓋掉該畫面。

兩種 Windows 啟動方式都會在安裝相依套件前檢查 Node.js 版本。儲存庫的 npm 設定也會拒絕不相容的版本。檢查失敗時，請用 `node -v` 和 `where.exe node` 確認目前的版本與執行檔路徑。若使用 nvm-windows，請安裝並切換至 Node.js 24.12 以上的版本，再重新開啟終端機或啟動程式。

要開啟瀏覽器示範，執行 `npm run dev` 並前往 `http://127.0.0.1:43841`。示範只使用瀏覽器儲存空間，無法存取本機工作區資料夾。桌面開發優先使用連接埠 43842。若已被占用，`npm run desktop` 與 `local-desktop.bat` 會自動選擇可用的連接埠並顯示實際網址。兩者可同時執行，瀏覽器示範仍需要可用的連接埠 43841。

桌面應用程式的 ID 是 `app.tano.local`。Windows 的應用程式資料通常位於 `%APPDATA%/app.tano.local`。設定 Agent 時，請使用 Tano 的 MCP 面板顯示的路徑。工作區內的 Markdown 與 `.tano/` 可攜，索引、草稿與工作階段狀態保存在應用程式資料中。

安裝相依套件後，可以離線編輯、搜尋與保留草稿。載入遠端圖片或執行已設定的更新檢查仍需要網路。從原始碼建置的版本預設未設定更新端點。

發行新版本前，請依照[本機驗證](../local-validation.md)（英文）執行 `npm run check`，以及適用的原生和 MCP 檢查（`npm run test:native`、`npm run mcp:smoke`）。一般的提交、推送與合併可依開發內容選用合適的檢查。修改 Rust 程式碼後，請執行以下命令。

```sh
cargo fmt --manifest-path crates/tano-native/Cargo.toml
cargo fmt --manifest-path apps/client/src-tauri/Cargo.toml
```
