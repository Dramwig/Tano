# Workspace Contract v1

Tano 的工作区由三层组成：**File、Object、View**。三层共享工作区 UUID 和稳定身份，但只有 File 和用户创建的结构化记录保存内容；View 只保存投影规则。

## File

File 是工作区中的真实文件，也是内容事实源。Markdown、PDF、图片、CSV、JSON、代码和其他附件都保留为普通文件。Tano 可以为它们建立索引、预览和引用，但不会把文件正文复制到数据库或 Yjs 二进制中。

每个文件有以下稳定身份：

- `workspaceId`：工作区 UUID；
- `fileId`：`.tano/identities.json` 中分配的六位短 ID；
- `path`：当前展示路径，可随重命名和移动变化；
- `revision.hash`：本次读取的内容 hash。

引用使用 `workspaceId + fileId`，路径只用于显示和打开文件。文件发生外部修改时，写入方必须带上读取时的 hash；hash 不匹配就重新读取、合并或保留冲突，不得静默覆盖。

## Object

Object 是文件之上的稳定语义层，用来表达类型、属性和关系。Object 自身可以是 `.tano/objects/<id>.tano.json` 中的结构化记录，也可以是由工作区文件派生的资源投影，例如 Markdown 文档和图片资产。

Object 不能复制文件正文，也不能把路径当作身份。一个 Object 的引用至少包含 `workspaceId`、`type` 和稳定 `id`；需要写入时还要带对象文件的当前 revision。文档和资产对象由文件索引派生，保存操作应回到原始文件。

协议中的 `object://<workspaceId>/<type>/<id>` 是 Object 的契约身份，用于 API、关系和 View 来源；它不是现有 Markdown 内容中的 `object://<type>/<id>` 引用语法，也不等同于承载 Object 记录的 `.tano/objects/<file-id>.tano.json` 文件身份。宿主适配器负责把契约身份解析到当前对象记录和来源文件。

关系端点使用 `type + id`。关系可以连接文档、资产、事件、人物和插件对象。删除或移动文件不会改变文件 ID；路径变化后，关系仍能回到原文件。

## View

View 是文件和对象的可重建投影，例如文件浏览器、对象列表、数据表、看板和关系图。View 只保存：

- 视图 ID、名称和类型；
- 文件 ID 或对象 `type/id` 来源；
- 筛选、排序、分组和展示设置；
- 可选的非执行查询提示。

View 不保存正文、对象副本或权限。打开视图中的条目时，宿主必须通过稳定 ID 解析当前路径和 revision，并显示来源。跨文件视图文件位于 `.tano/views/`，可安全重建；数据表自身的表格、卡片和看板设置继续随 `.table.json` 用户文件保存。缺少视图时不能影响原始文件和对象。

## Agent 与权限

人类界面、内置助手和外部 MCP 使用同一套层次：先读取 File 或 Object 的不可变快照，再引用 `fileId` / `objectId` 和 revision 提出修改。Agent 的回答、来源 JSON 和工具结果都是数据，不能扩大读取范围或写入权限。

默认流程是：读取 → 引用来源 → 生成提案 → 显示差异 → 用户采纳 → 条件写入 → 返回新 revision。只有宿主确认写入成功后，界面和 Agent 才能声称已完成。跨文件操作没有事务保证时，必须逐项报告结果。

## 当前示例

可直接打开示例工作区的 [`README.md`](../../examples/workspaces/ai-research/README.md) 查看一份跨格式工作区。它包含 Markdown、PDF、图片、CSV、JSON、Python、数据表、事件对象、关系和一个研究视图。建议按以下顺序体验：

1. 打开 `papers/research-note.md`，通过附件链接回到 PDF、图片和数据文件；
2. 打开工作区对象面板，查看 `AI Research` 事件及其关联文件；
3. 在文件菜单选择「查看文件对象」，确认对象面板中的来源和连接仍使用稳定 ID；
4. 从工作区菜单或命令中心打开 `AI Research 工作台` View，点击来源卡片回到当前文件或对象；
5. 修改 Markdown 或 CSV 后刷新，验证内容仍来自真实文件。

这份示例用于验证 File → Object → View → File 的闭环，不代表 Tano 已经为所有格式提供深度编辑器。当前优先保证真实文件可访问、来源可追溯和冲突可核对。
