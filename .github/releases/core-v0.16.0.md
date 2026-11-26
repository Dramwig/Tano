# Tano Core 0.16.0

- chore(release): integrate Core 0.16.0 development (37e64e4)
- chore(workbench): remove wildcard export and enforce explicit exports and store acyclicity (2507da9)
- feat(workbench): add Plugin Center Developer Area and decompose shell, panes, and shortcuts (33b95f3)
- refactor(workbench): decompose CalendarView and workspace store god modules (3cf7251)
- fix(workbench,client): polish remaining dialogs, lazy-load mail CSS, and dedupe plugin styles (24af685)
- refactor(editor,workbench): remove dead enabledLevels chain and fix multi-window ownerDocument leaks (c042001)
- fix(protocol,mcp): sync workspace data paths, tighten manifest/object contracts, and load plugin schemas in MCP (d1d6393)
- feat(workbench): allow hiding built-in icons tab in WorkspaceIconPicker (5002f84)
- refactor(workbench): split assistant store into connection, bridge, and proposal modules (4f54eca)
- refactor(workbench): add extensionless explicit subpath exports (6540f8f)
- refactor(protocol,editor,workbench): extract pure assistant and plugin domain modules (974a59d)
- chore(release): sync Core 0.15.0 back to development (d36ce96)

## 仍为未完成状态的功能（未随本版本开启）

- assistantClipboardAttachments: Paste local files and images into the assistant composer.
- desktopMailClient: Desktop native IMAP/SMTP mail client with calendar and document integration.
- markdownSpacingAutocomplete: Insert real Markdown spaces at mixed-script boundaries while editing.
