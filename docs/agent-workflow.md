# Agent workflow

English | [中文](zh/agent-workflow.md) | [日本語](ja/agent-workflow.md) | [Deutsch](de/agent-workflow.md) | [Documentation](README.md)

Open a workspace folder in the desktop app first. Agents can edit its Markdown files directly, or use Tano's local stdio MCP server to list, read, create, and conditionally write documents.

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/notes --data-dir /path/to/tano-app-data
```

The MCP server requires Node.js 24.12+. Use the workspace and application-data paths shown in the desktop MCP panel. Application data must be outside the workspace, and the same data directory should be used by the desktop app and MCP server.

An update supplies the SHA-256 hash returned by a previous read. If the file has changed, the stale write is rejected. Activity records live in application data, while content remains in Markdown files. A client-provided name is a label, not proof of a person or model's identity. The stdio server does not run remote commands or provide live network collaboration.
