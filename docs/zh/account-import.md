# 第三方账号导入配置

[English](../account-import.md) | [文档目录](README.md)

桌面端支持“连接账号 → 选择内容 → 预览 → 保存为 Markdown”。每个平台都保留文件导入入口。连接本身不会写入工作区；确认预览后才会通过已有的导入与同名文件处理流程保存。

## 平台与连接方式

| 平台 | 连接方式 | 导入范围 |
| --- | --- | --- |
| Notion | OAuth 2.0 或集成令牌 | 已授权页面与正文块 |
| Confluence Cloud | Atlassian OAuth 2.0 | 站点、空间和页面 |
| Evernote 国际版 | OAuth 1.0a 或开发者令牌 | 笔记本与笔记正文 |
| Trello | OAuth 1.0a 或 API Key + 用户令牌 | 看板、列表、卡片和检查项 |
| Roam Research | Graph API 令牌 + Graph 名称 | 页面与子块 |
| Asana | OAuth 2.0 或个人访问令牌 | 工作区项目与直接列出的任务 |
| Workflowy | 官方 API 令牌 | 根节点与子大纲 |
| Jira Cloud | Atlassian OAuth 2.0 | 站点、项目与问题 |
| Monday.com | OAuth 2.0 或 API 令牌 | 看板、分组与条目字段 |
| Quip | OAuth 2.0 或个人访问令牌 | 桌面文件夹及子文件夹文档 |
| Google Docs | OAuth 2.0 或短期访问令牌 | Drive 中的文档，通过 HTML 导出 |
| Obsidian | 本地 Markdown / Vault ZIP | 没有公开的账号内容读取 API |

浏览器演示和手机端目前使用文件导入；宿主可通过 `WorkbenchRuntime.accountImports` 接入自己的账号服务。本仓库不包含托管 OAuth 中转服务。桌面端的本地与在线工作区均使用原生连接实现。

## 创建 OAuth 应用

先在目标平台的开发者控制台创建应用，启用对应 API 与权限，注册回调地址，按平台要求完成生产审核。项目没有内置可用的 Client ID 或密钥。平台入口与权限明细见[英文配置表](../account-import.md#application-configuration)。

原生进程优先读取环境变量 `TANO_IMPORT_OAUTH` 中的 JSON；未设置时读取当前产品**应用数据目录**中的 `import-oauth.json`。Windows 本地版通常是 `%APPDATA%/app.tano.local`，官方桌面版是 `%APPDATA%/app.tano.desktop`。配置后重启桌面应用。

```json
{
  "google-docs": {
    "clientId": "YOUR_DESKTOP_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET_IF_REQUIRED",
    "redirectUri": "http://127.0.0.1:43843/callback"
  },
  "notion": {
    "clientId": "YOUR_CLIENT_ID",
    "clientSecret": "YOUR_CLIENT_SECRET",
    "redirectUri": "http://localhost:43843/callback"
  }
}
```

仅添加需要启用的平台。平台 ID 为 `notion`、`google-docs`、`asana`、`confluence`、`jira`、`monday`、`quip`、`trello`、`evernote`。Trello 的 `clientId` 是 API Key，Evernote 的是 Consumer Key。Workflowy 和 Roam 直接使用 API 令牌，不填 OAuth 配置。

默认回调为 `http://127.0.0.1:43843/callback`。仅接受带明确端口、没有用户名/密码/查询参数/片段的 HTTP `127.0.0.1` 或 `localhost` 回调；实际监听固定为 `127.0.0.1`。Notion 控制台拒绝 IP 回调，应注册并配置 `http://localhost:43843/callback`。若平台拒绝此类回调，需要选择其支持的桌面应用类型、使用可用的 API 令牌，或另行实现产品 HTTPS 中转服务并接入宿主接口；当前代码没有该中转服务。

Notion 本机测试：在[开发者连接控制台](https://app.notion.com/developers/connections)选择“新连接”，名称填 `Tano 本机导入测试`，验证方式选 OAuth，添加上面的 localhost 回调。创建会要求同意平台开发者条款。创建后仅启用读取内容权限，记录 OAuth Client ID 与 Client Secret，写入当前产品的原生配置文件；账号连接时只授权用于测试的页面。不要把 Client Secret 粘贴到聊天或文档中。

密钥只能放在原生进程配置中，不能放入 `VITE_*`、前端包、版本库、工作区、Markdown 或 `.tano/`。Evernote 仅支持国际生产环境，不支持印象笔记中国版和沙箱。

## 会话与验收

OAuth 返回的令牌仅保留在原生进程内存。手动输入的 API 令牌提交后会清空表单，不保存到浏览器存储或工作区。关闭导入面板后连接仍可在本次进程中复用；断开连接或退出应用后清除。没有后台同步或自动刷新令牌，过期后需重新连接。

授权等待最多三分钟，可取消；关闭面板会取消当前尝试。请求限定官方 HTTPS 域名和读取操作，不跟随重定向，单次超时 30 秒、响应上限 16 MiB。分页重复或超过限制会报错，不静默截断。导入批次最多 2,000 个文件、单文件 50 MiB、总计 100 MiB。

导入范围是当前有权读取的正文与列表。评论、历史版本、附件原文件不迁移，外链可能过期；部分平台排版、宏和富文本会简化。Asana 不递归读取子任务；Quip 不覆盖仅通过聊天分享的文档；Notion 子页面可单独选择。

本地模拟接口测试覆盖各平台转换、分页、错误、取消及原生读取限制。OAuth 应用尚未创建时，不能验证真实账号授权、生产审核和实际数据保真度；需配置应用后用测试账号完成这些验收。
