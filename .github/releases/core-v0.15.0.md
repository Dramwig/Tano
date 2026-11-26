# Tano Core 0.15.0

- chore(release): integrate Core 0.15.0 development (0cc05ca)
- fix(i18n): complete missing workbench and mail locale translations (1bb80cb)
- fix(workbench): calibrate light-mode raised card borders and focus edges (dd490c8)
- refactor(workbench)!: replace ObjectPanel, remove Git/sync and legacy views, and restore table creation (2e13aee)
- refactor(protocol,mcp)!: remove built-in project/experiment types and legacy relations (f11c348)
- fix(editor,workbench): fix slash gating, plugin permissions, import dialog, and dead UI (d7d0fc9)
- feat(workbench): add extra tab and upload action slots to WorkspaceIconPicker (c0b83f5)
- feat(workbench): add raised card material and polish calendar controls (02b38ec)
- refactor(protocol,workbench): extract pure domain modules and declare explicit exports (20bcffb)
- feat(protocol,workbench): decouple extension hooks and add extension proposals (fd89d8a)
- fix(workbench): render theme tokens in a stylesheet ordered before overlay styles (98fe4bd)
- chore(repo): ignore generated promo screenshots (5219e73)
- feat(assistant): add neutral extension hooks, plugin log inspection, and @ mention autocomplete (0adbd4a)
- feat(plugins): upgrade open plugin ecosystem runtime, v2 ZIP, and CloudExtension hooks (3896b0c)
- feat(workbench): bundle interface fonts and add an interface font setting (024d38f)
- feat(protocol,workbench): unify task and event models and expand calendar scheduling (69e659e)
- feat(mail): add desktop native IMAP/SMTP mail client (da9c736)
- style(workbench): round continuous layout page corners (05a0f92)
- ci: remove optional PR helper workflows (dc92256)
- chore(assets): integrate document cover cleanup (09894b7)
- chore(assets): retire mirrored document cover files (42fdff0)
- chore(repo): synchronize main into development (14e6b7e)
- fix(release): install dependencies before tag preflight (9ae20b3)

## 仍为未完成状态的功能（未随本版本开启）

- assistantClipboardAttachments: Paste local files and images into the assistant composer.
- desktopMailClient: Desktop native IMAP/SMTP mail client with calendar and document integration.
- markdownSpacingAutocomplete: Insert real Markdown spaces at mixed-script boundaries while editing.
