# Agent 工作流

[English](../agent-workflow.md) | 中文 | [日本語](../ja/agent-workflow.md) | [Deutsch](../de/agent-workflow.md) | [文档目录](README.md)

先在桌面应用中打开工作区文件夹。Agent 可以直接编辑其中的 Markdown 文件，也可以通过 Tano 的本地 stdio MCP 服务列举、读取、创建和条件写入文档。

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

MCP 服务需要 Node.js 24.12+。工作区与应用数据路径以桌面 MCP 面板显示的值为准。应用数据必须位于工作区外，桌面应用和 MCP 服务应使用同一数据目录。

更新文档时需提供前次读取返回的 SHA-256 hash。文件发生变化后，过期写入会被拒绝。活动记录保存在应用数据中，正文仍保存在 Markdown 文件中。客户端自报名称只是标签，不能证明人员或模型身份。stdio 服务不执行远程命令，也不提供实时网络协作。
