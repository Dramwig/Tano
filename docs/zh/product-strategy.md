# Tano 产品方向：File-Native Workspace

本文只说明产品定位、竞争边界和交付顺序。工作区数据规则以 [Workspace Contract v1](workspace-contract.md) 为准，编辑器和存储实现见[架构](architecture.md)，当前数据表能力见[数据表](data-tables.md)。本文中的“规划中”不表示当前版本已经实现。

## 定位

> **Tano — A File-Native Workspace for Humans and AI Agents**
>
> Tano 是一个以真实文件为内容源、以对象关系为语义层、以视图为交互层，让人类和 AI Agent 在同一工作区工作的应用。

Tano 的核心是同一个工作区被不同入口访问：

- 人类通过文件浏览器、编辑器和视图工作；
- Agent 通过受控 API 读取来源、提交提案和条件写入；
- 文件仍可被 VS Code、文件管理器和其他工具直接读取、修改和备份。

File、Object、View 的正式定义、稳定 ID、来源引用、revision 和冲突规则只在 [Workspace Contract v1](workspace-contract.md) 中维护。这里不再复制协议细节。

## 竞争边界

| 产品 | 核心对象 | 主要价值 | Tano 的边界 |
| --- | --- | --- | --- |
| Notion | Page / Database | 团队知识和协作 | Tano 保留真实文件与开放格式 |
| Obsidian | Markdown / Vault | 本地知识管理 | Tano 组织更多文件类型，并提供对象关系和 Agent 入口 |
| AFFiNE | Block / Page / Database | 文档、白板和数据库 | Tano 把文件身份和外部编辑作为基础约束 |
| GitHub Codespaces | Repository / Container | 可重复的开发执行环境 | Tano 管理信息和关系；终端、容器和计算属于独立执行服务 |
| Tano | File / Object / View | 让文件、结构化数据和 Agent 在同一工作区协作 | 文件保持开放，关系和操作可追踪 |

因此，Tano 当前不是 Codespaces 的替代品，也不是支持更多格式的 Notion。Codespaces 解决“代码在哪里运行”，Tano 解决“工作内容是什么、它们如何关联”。未来可以把 Tano 管理的代码、任务和实验结果交给独立执行服务处理，但这不是当前核心范围。

## 差异化原则

1. **File-Native：** 文件是内容事实源。外部工具修改文件后，Tano 重新扫描并通过稳定身份更新引用。
2. **Object-Aware：** Object 为文件和结构化记录提供类型、属性与关系，不复制文件正文，也不把路径当作身份。
3. **Agent-Native：** Agent 使用稳定 ID、来源、revision、权限和提案流程，和人类界面遵守同一套领域规则。
4. **Local + Cloud：** 本地文件夹和云端工作区可以使用不同存储适配器，但遵守同一工作区契约。同步、离线修改和冲突恢复必须先定义清楚，再扩展服务形态。

支持更多扩展名不是目标本身。Tano 应优先把 Markdown、JSON、CSV、PDF、图片和代码文件的浏览、引用、结构化属性和 Agent 协作做好，避免退化成只会打开更多格式的网盘。

## 当前状态

已具备的基础：

- Workspace Contract v1：File、Object、View、稳定身份、来源和基线 hash；
- Markdown、JSON、CSV、PDF、图片、代码等真实文件可以共存于普通工作区；
- `.tano/` 保存可移植的身份、对象、关系、规则和视图数据，缓存与会话状态留在应用数据中；
- 外部编辑使用基线 hash 保护，冲突不会被静默覆盖；
- View MVP 可以从 `.tano/views/*.tano.json` 加载视图，并从来源卡片回到文件或对象；
- 本地助手和 MCP 已支持受控的 Markdown 读取、提案与条件写入；
- `examples/workspaces/ai-research` 提供 File → Object → View → File 的跨格式示例。

当前仍属于后续阶段的能力：

- File Database 的文件筛选、排序、分组和属性编辑；
- 面向对象、数据表和文件查询的统一 Agent API；
- 本地与云端工作区的同步、离线修改和冲突恢复；
- Git 工作区集成以及远程终端、容器和代码执行。

## 交付顺序

### P0：File Database MVP

用一个普通文件夹验证核心闭环：

1. 发现 Markdown、JSON、CSV、PDF、图片和代码等文件；
2. 为文件建立可查询的属性和关系，但不复制文件正文；
3. 提供一个表格或卡片 View，并能通过稳定来源 ID 回到文件；
4. 外部修改、重命名和移动后，刷新仍能解析到同一个文件身份；
5. 用一个 Project 或 Experiment Object 关联文件、任务和结果。

P0 的验收重点是文件可访问、引用稳定、来源可追溯和冲突可核对，而不是支持最多的格式。

### P1：Agent 与检索

先提供文件、对象和视图的只读查询，再提供带差异预览的提案写入。每次写入都必须回到原始文件或结构化记录，并返回新的 revision。具体操作流程见 [Agent 工作流](agent-workflow.md)。

### P2：可靠同步与扩展

在本地契约稳定后，再实现全局搜索、增量同步、离线恢复、云端适配器和 Git 工作区集成。同步协议不能改变 File、Object、View 的语义。

### P3：执行服务

通过隔离的本机 GPU、远程服务器或 Agent 沙箱运行代码，把输出文件和结果对象关联回 Tano。执行环境、终端和网络权限不默认进入工作区主进程。

## 产品取舍

- 保持 Markdown 和其他真实文件可迁移；不要把正文搬进专有数据库或 Yjs 二进制。
- 把对象和视图做成文件之上的可追踪层；不要让 View 变成第二套内容事实源。
- 先完成一个可验证的跨格式工作流，再扩展格式数量、同步能力和执行能力。
- 所有路线图项目都以外部编辑、重命名、冲突和备份场景验收。

> **Keep files open. Make data structured. Connect everything.**
>
> **保持文件开放，让数据结构化，让所有内容彼此关联。**
