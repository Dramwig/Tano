# Agent 工作流

[English](../agent-workflow.md) | 中文 | [日本語](../ja/agent-workflow.md) | [Deutsch](../de/agent-workflow.md) | [文档目录](README.md)

先在桌面应用中打开工作区文件夹。Agent 可通过本地 stdio MCP 查询文件、对象和数据表，并提交跨文件提案。完整接口、SDK 与权限说明见 [Agent Gateway v1](agent-gateway.md)。默认修改需要在 Tano 中审阅采纳；旧 Markdown 直接条件写入需显式配置 `--access write`。

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

MCP 服务需要 Node.js 24.12+。工作区与应用数据路径以桌面 MCP 面板显示的值为准。应用数据必须位于工作区外，桌面应用和 MCP 服务应使用同一数据目录。

更新文档时需提供前次读取返回的 SHA-256 hash。文件发生变化后，过期写入会被拒绝。活动记录保存在应用数据中，正文仍保存在 Markdown 文件中。客户端自报名称只是标签，不能证明人员或模型身份。stdio 服务不执行远程命令，也不提供实时网络协作。

也可以提交待审阅提案：用 `tano_read_document_identity` 获取稳定文件 ID 和基线 hash，再调用 `tano_propose_document`；新建建议的 `expectedHash` 为 `null`。Tano 助手的会话记录可导入这些建议，查看差异并采纳，外部客户端用 `tano_get_proposal` 查询结果。提案提交不会写入正文；原直接写入工具仍保留。工作区约定可通过 `tano_read_workspace_rules` 读取。详细步骤见 [Tano 助手](assistant.md)。
