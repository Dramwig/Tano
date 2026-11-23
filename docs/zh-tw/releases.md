# 建置與發行

[English](../releases.md) | [简体中文](../zh/releases.md) | 繁體中文 | [日本語](../ja/releases.md) | [Español](../es/releases.md) | [Deutsch](../de/releases.md) | [文件目錄](README.md)

本機發行驗證、手動建立不可變標籤及在套件登錄平台發佈的流程，請參閱 [Core 發行自動化](../release-automation.md)與 [Core 套件散佈](../core-distribution.md)（英文）。

執行 `npm run desktop:build` 來建置桌面安裝套件。從原始碼建置無需帳號或簽署金鑰，預設也未設定更新端點。Windows 的 NSIS 安裝程式位於 `apps/client/src-tauri/target/release/bundle/nsis/`。

**Tano Local** 是開放原始碼的本機版本。官方 Windows x64 套件由公開的 Core 標籤手動觸發建置，並附 GitHub 建置來源證明。正式簽署流程使用 Authenticode，核准的未簽署預覽則有專屬標示。套件發佈到對應的 Core Release。Product 的最新版本標記與自動更新資訊由 Product 發行流程管理。詳見 [Local 發行與下載驗證](../local-release.md)（英文）。

公開儲存庫可建置完整的 MIT 本機產品。私有的 `Tano-cloud` 儲存庫透過 [Cloud Extension API](../cloud-extension.md) 加入官方線上功能後建置安裝程式，再將安裝程式發佈為 `Dramwig/Tano` 的 Release 附件。GitHub 自動產生的原始碼壓縮檔只包含這個公開的 MIT 儲存庫。含雲端功能的執行檔是在私有儲存庫建置的。

執行 `npm run version:set -- 0.2.0` 可同時更新 Core 儲存庫的 npm 工作區、內部相依套件版本範圍、npm/Cargo 鎖定檔、Tauri 設定及 Rust crate 版本。`npm run version:check` 會驗證這些版本是否一致，也是 `npm run check` 的一部分。獨立發行的 Python 與 Rust 通訊協定輔助套件各有自己的版本。官方 Product 版本由私有的 `Tano-cloud` 獨立管理。

- **Core 發行**。交付的 Core 內容有變更時，先在本機驗證最終版本，再手動建立不可變的 `core-vX.Y.Z` 標籤。五個 npm 套件及一個 Rust crate 須使用相同的版本與乾淨的原始碼提交 SHA。將 `core-registry.json` 上傳至對應的 Core GitHub Release，取消選取「設為最新版本」，並在 `Tano-cloud` 固定使用該資訊清單。推送標籤本身不會觸發工作流程。
- **Product 發行**。僅有 Product 變更時，可沿用既有 Core。採用已發佈的 Core 時，可直接固定該版本。私有發行流程設定自己的 Product 版本，驗證固定的 Core 標籤與提交，並建置已簽署的官方安裝程式。流程會在這個儲存庫選定的 Core 提交上建立 Product 標籤 `vA.B.C`，並將安裝程式、簽章、校驗值與 `latest.json` 發佈到對應的 Product Release。只有私有部分有變更時，多個 Product 標籤可指向同一個 Core 提交。
- **更新與平台**。官方應用程式透過 `https://github.com/Dramwig/Tano/releases/latest/download/latest.json` 檢查更新。Product Release 必須公開，更新檢查才能匿名存取。私有發行流程需要限定於 `Dramwig/Tano` 的跨儲存庫發行權杖，支援 Windows x64、Linux x64，以及選配的 macOS 簽署建置。首次正式發行前，須設定平台憑證並通過適用的原生驗證。

發行套件須包含[第三方聲明](../THIRD_PARTY_NOTICES.md)。變更相依套件後，請執行 `npm run notices:generate` 重新產生隨附的聲明。
