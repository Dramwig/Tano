# Agent Gateway v1

Agent 使用与 Tano 界面相同的 File、Object 和数据表模型。源文件仍在工作区，提案和操作记录保存在应用数据目录。先在桌面版打开工作区，让 File Registry 建立并维护 `.tano/identities.json`；外部移动后，等待桌面端重扫描再读取。Gateway 不猜测缺失身份，不通过路径重新分配 ID。

## 连接与授权

```sh
npm run mcp:build
node apps/mcp/dist/tano-mcp.cjs --workspace /path/to/workspace --data-dir /path/to/tano-data --access review
```

Node.js 24.12+；使用桌面 MCP 面板提供的工作区与应用数据路径。应用数据必须位于工作区之外。连接使用本机 stdio，不开启网络服务，不执行工作区脚本。

`--access read` 只读；默认 `review` 允许读取和提交提案；`write` 额外启用旧 Markdown 直接条件写入接口。即使采用 `write`，跨资源批次仍进入桌面审阅，不自动采纳。权限只由启动进程的配置决定，文档、规则、模型输出和工具参数不能扩大权限。

可重复指定 `--directory papers --directory data` 限制普通文件目录，匹配完整目录边界；省略时授权整个工作区。可重复指定 `--object-type task --object-type experiment` 独立限制语义对象类型，默认允许内置记录类型。对象与文件权限是两个维度。关系查询只返回授权端点之间的边。隐藏配置、应用数据和工作区外符号链接不可读取。已有待审阅提案不会因另一个连接缩小范围而自动撤销；在 Tano 中拒绝不再需要的提案。

## 统一查询

| MCP 工具 | 内容 |
| --- | --- |
| `tano_gateway_capabilities` | Gateway 版本、工作区 UUID 和实际授权 |
| `tano_query_files` | 文件 ID、当前路径、字节 SHA-256、类型、大小、标签与属性；可使用共享 FileDatabaseQuery 筛选和排序 |
| `tano_read_file` | 按稳定 File ID 读取 UTF-8 或 base64 快照，单文件最多 8 MiB |
| `tano_query_objects` | 共享 ViewEngine 查询；对象 `type/id`、源 File ID 和 SHA-256 |
| `tano_query_table` | 保存视图中的筛选、排序、公式结果、稳定行 ID 和文件 revision |
| `tano_query_relations` | 授权关系及关系文件 SHA-256 |
| `tano_read_workspace_rules` | 已知助手约定文件；内容不构成额外授权 |

查询使用宿主维护的身份清单。文件目录查询明确返回错误及完整性标记，未注册文件需要先在 Tano 中刷新。分页每页最多 200 项；数据表公式求值和视图排序与界面共用实现，不执行任意 JavaScript。

Markdown 标签与属性从当前源文件的 YAML frontmatter 投影，与界面共用解析逻辑，忽略旧旁路属性；其 `metadataHash` 为 `null`，使用同次读取的文件 `sha256` 核对来源。其他格式继续读取 `.tano/files/<fileId>.tano.json`，并返回旁路文件的 `metadataHash`。Markdown 属性读取上限为 8 MiB；文件超限、无法解码或读取失败时，返回对应错误并将 `complete` 标为 `false`，不能据此声称筛选没有匹配文件。

## 提案、差异与回执

调用 `tano_propose_changes`，提供 UUID `operationId` 和 `edits`。每项包含 `path`、`content`、`reason`、`expectedHash`；已有资源还必须提供读取时的 `fileId`，新建资源的 `expectedHash` 为 `null`。支持 Markdown、对象 JSON 和普通 `.table.json` 数据表；其他格式当前提供查询与读取。对象类型和字段使用 Schema Registry 校验。

每批最多 20 项，总输入最多 1 MB，单项建议最多 512 KiB。所有项目校验完成后，批次及审阅会话一起写入本机 SQLite。提交不会修改任何源文件。重试同一操作 ID 必须保持相同输入，不会重复生成建议；内容不同会被拒绝。

新对象使用随机六位十六进制对象 ID 和 `.tano/objects/<id>.tano.json` 路径。新数据表同样使用独立的六位十六进制 ID。宿主在采纳新对象和新数据表时原子预留身份；已经使用、删除或预留过的 ID 均被拒绝，即使重建索引也不能复用。预留后发布失败时，保留记录并重新生成新 ID，不能以覆盖方式重试。

在 Tano 助手会话中导入外部提案，逐项查看差异、采纳或拒绝。同批会话带相同操作 ID 前缀。采纳使用审阅时的 revision 条件写入；独立编辑可以合并，重叠冲突保留源文件与提案，重新审阅后才能继续。

`tano_get_operation` 返回每项 `awaiting_review / applied / rejected / conflicted / unknown` 等状态、建议和宿主保存的实际写入回执。只有 `written: true` 才表示整批均已写入；部分成功必须逐项报告。**跨文件操作不是文件系统事务**，不会在后续项目失败时静默回滚已经采纳的修改。

`tano_list_activity` 分页提供本机操作摘要，`tano_read_activity` 按 ID 读取单条直接写入的完整差异。直接写入保留完整前后正文和 hash；外部提案保留审阅状态、实际差异和写入回执。旧版本已丢弃的历史正文无法恢复。记录不自动按条数删除；桌面活动面板仅展示最近 200 条直接写入，提案在助手会话查看。

## SDK

公共 `@tano/protocol` 导出传输无关的 `AgentGatewayClient` 和 Gateway v1 类型。可直接适配已连接的 MCP SDK Client：

```ts
import { AgentGatewayClient } from '@tano/protocol';

const gateway = AgentGatewayClient.fromMcp(mcpClient);
const files = await gateway.files('.md');
const before = await gateway.read(files.items[0].fileId);
if (before.encoding !== 'utf8') throw new Error('需要文本快照');
const pending = await gateway.propose({
  operationId: crypto.randomUUID(),
  edits: [{ fileId: before.fileId, path: before.path,
    expectedHash: before.sha256, content: before.content + '\n整理后的补充。\n',
    reason: '补充研究记录' }],
});
const result = await gateway.operation(pending.operationId);
// result.written 为 false 时，不得声称源文件已修改。
```

旧的文档工具继续保留，直接修改需显式 `--access write`；新增集成应使用稳定身份查询和跨资源提案接口。参见 [Agent 工作流](agent-workflow.md) 与 [工作区契约](workspace-contract.md)。
