# 插件 API v1 参考与迁移

本文覆盖 [SDK 类型定义](../packages/workbench/src/plugin-sdk.ts) 的全部公开方法。清单、运行限制和示例见 [插件开发](plugins.md)。SDK 只导入类型，运行时对象由宿主传给 `activate(tano)`。

## 创建与验证

### 附件只读预览

声明 `attachments.read` 权限后，`tano.attachments.read(fileId, offset?, revision?)`
返回 `{ path, revision, offset, total, chunk }`，其中 `chunk` 为最多 18,000 字节的
Base64 数据。首次使用偏移 0，随后传入已读取的字节数与返回的 `revision`。
宿主仅允许当前工作区内可见的普通附件，禁止 Markdown 和 `.tano` 内部数据，
单文件最大 50 MiB。续读绑定工作区、插件实例及文件版本；切换、撤权或版本变化
后应从头重试。此 API 不写文件，也不授予路径访问或本机命令权限。
浏览器宿主需提供 `AttachmentService.readAttachment`；用户在插件文件选择器中
主动选择的本机文件则由隔离界面直接读取。

在执行过 `npm install` 的 Tano 源码目录中运行：

```sh
npm run plugin -- create ./artifacts/my-vue-plugin --template vue
npm run plugin -- create ./artifacts/my-react-plugin --template react
npm run plugin -- create ./artifacts/my-basic-plugin --template vanilla
npm run plugin -- pack ./artifacts/my-vue-plugin
npm run plugin -- verify ./artifacts/my-vue-plugin/my-vue-plugin-1.0.0.tano-plugin.json
```

模板提供清单、Worker 入口、类型检查配置及依赖版本。Vue 使用渲染函数，React 使用 TSX；框架、CSS 和第三方许可随包分发，不依赖 CDN。已有目标目录不会被覆盖。

在生成目录运行 `npm install` 和 `npm run check` 可独立检查类型。`tsconfig.json` 的两个 SDK 路径指向创建时的 Tano 源码，移动工程后需更新路径。共享类型放在 `ui/` 外，避免被识别成额外视图入口。依赖升级后同步第三方许可文件，重新打包和测试。

## 兼容版本与环境

| 项目 | 当前支持 | 不兼容时 |
| --- | --- | --- |
| 声明式清单 | `manifestVersion: 1` | 未知版本拒绝导入 |
| 可执行清单 | `manifestVersion: 2, apiVersion: 1` | 未知 API 版本拒绝导入 |
| 插件包 | `packageVersion: 1` | 未知版本拒绝导入 |
| 工作区规则 | `version: 1` | 不按未知格式执行代码 |
| 目录 | `catalogVersion: 1` | 未知格式拒绝读取 |
| 目录版本号 | 如 `1.2.0` 的三段数字 | 不接受预发布后缀、范围或覆盖已发布版本 |

当前不解析 `engines`、应用版本范围或任意未知清单字段。插件的 `version` 是自身版本，不是宿主要求。应用与共享核心目前为 0.1.0；验收应同时记录交付核心的 SHA-256，不能仅凭相同应用版本推断开发快照的功能一致。

| 能力 | 浏览器 / 在线桌面 | 本地桌面 | 服务器自动化 |
| --- | --- | --- | --- |
| 文档、对象、关系 | 当前成员权限 | 工作区文件权限 | 任务授权者权限 |
| 命令、视图、通知、事件 | 支持 | 支持 | 不提供 |
| 本机状态 | 当前账号、设备、工作区 | 当前设备、工作区 | 不提供 |
| 网络 | 声明的 HTTPS 来源，受 CORS 约束 | 声明的 HTTPS 来源 | 宿主代理与网络限制 |
| 凭据连接 | 在线加密服务，需部署配置 | 系统用户凭据库 | 授权者的独立连接 |
| 本机命令 | 不提供 | 当前为只读 Git | 不提供 |

演示存储不等同于在线协作服务。缺少所需本机能力会阻止启动并显示原因。后台自动化由在线产品提供，导入包不会自行启动任务。

## 通用约定

模板兼容性由两层验收保护：`npm run check` 对新建 vanilla/Vue/React 工程进行类型检查、打包和独立校验；`npm run test:plugins:browser -- --grep "newly generated"` 在真实浏览器中导入新建的 Vue/React 包，授权后验证隔离 UI、文档变化事件、手动刷新、打开文档和第三方许可。浏览器插件完整验收已加入 CI；Windows 本机默认使用 Edge，CI 使用 Chromium。首次在其他环境运行前执行 `npx playwright install --with-deps chromium`。

除返回取消函数的回调注册方法外，下表方法都返回 Promise。失败用 `try/catch` 处理，不依赖完整中文消息作为稳定错误码，不自动重试可能已生效的写操作。文件 ID 独立于路径；切换工作区、停用、版本变化或权限撤销会销毁实例和取消待处理调用。每次操作重新核对当前用户权限。

`PluginJson` 只能为普通 JSON 值；不要传 Vue Proxy、函数、循环引用、DOM、Map、BigInt 或凭据。包上限 4 MiB、本机状态 256 KiB、共享设置 32 KiB；日志最多 100 条。启动超时 15 秒，前台交互超时 30 秒，超时实例停止。具体约束见 [宿主](../packages/workbench/src/plugins/host.ts) 和 [格式协议](../packages/protocol/src/extensions.ts)。

## 上下文、命令与通知

| 方法 | 参数与返回 | 约束 |
| --- | --- | --- |
| `context()` | `{ workspaceId, pluginId, settings }` | 返回当前实例的 JSON 副本 |
| `commands.register(id, handler)` | handler 可接收 `{ fileId?, workspaceId }` | id 须在清单声明，允许异步 handler |
| `notify(message)` | `void` | 最长 1000 字符，宿主显示插件来源 |

## 文档

| 方法 | 返回 / 参数 | 权限 |
| --- | --- | --- |
| `documents.list()` | `PluginDocumentEntry[]`，兼容旧插件 | `documents.read` |
| `documents.query(options?)` | `PluginPage<PluginDocumentEntry>` | `documents.read` |
| `documents.search(query, options?)` | `PluginPage<PluginSearchHit>`，字面正文搜索 | `documents.read` |
| `documents.read(fileId)` | `{ id, path, content, hash }` | `documents.read` |
| `documents.write(fileId, content, baseHash)` | `{ id, hash, status: 'applied' \| 'saved' }` | `documents.write`，先读取基线 |
| `documents.edit(fileId, edits, baseHash)` | 同 write，单文档编辑事务 | `documents.write`，先读取基线 |
| `documents.create(path, content)` | `{ id, path }` | `documents.write` |
| `documents.open(fileId)` | `void` | `documents.read`，服务器不提供 |

Entry 为 `{ id,name,path,readOnly }`；SearchHit 另有 `snippet,offset,hash`。搜索 hash 不能作为写入基线。内部 `.tano` 文件不属于文档 API。

query 选项为 `{ query?,pathPrefix?,readOnly?,sort?,direction?,limit?,cursor? }`，sort 为 `path/name/modified`。search 用第一个参数传关键词，options 不带 query/sort。页为 `{ items,total?,nextCursor?,skipped? }`；默认 50、最多 100 条。游标绑定实例、参数及数据版本，1 分钟有效；失效后从第一页重查。搜索空页仍可能有 nextCursor，跳过项列于 skipped。

edits 最多 100 项 `{ from,to,insert }`，是读取原文中的 UTF-16 范围，不能重叠或拆开代理对。实例最多记住最近 32 个读版本，批量写入请逐项重新读取。独立外部修改会合并，冲突保留副本；不提供跨文件原子性。

```ts
const document = await tano.documents.read(fileId);
await tano.documents.edit(fileId, [{ from: document.content.length,
  to: document.content.length, insert: '\n完成复核。\n' }], document.hash);
```

## 对象与关系

| 方法 | 参数 / 返回 | 权限 |
| --- | --- | --- |
| `objects.list()` | `PluginObjectSnapshot[]` | `objects.read` |
| `objects.query(options?)` | `PluginPage<PluginObjectSnapshot>` | `objects.read` |
| `objects.read(objectId)` | `{ id,object,hash }` | `objects.read` |
| `objects.create(object)` | 输入 type/name/description/properties/archived，返回 WorkspaceObject | `objects.write` |
| `objects.update(object, baseHash)` | 完整对象及读版本，返回保存后对象 | `objects.write`，先读基线 |
| `relations.list()` | `WorkspaceRelation[]` | `relations.read` |
| `relations.query(options?)` | `PluginPage<WorkspaceRelation>` | `relations.read` |
| `relations.add(relation)` | 完整关系，返回 void | `relations.write` |
| `relations.remove(relation)` | 完整关系，返回 void | `relations.write` |

对象 query 支持 query/type/archived/properties，最多 10 个标量属性等值条件，按 name/type/id 排序。关系支持 type/sourceId/targetId，按 ID 排序；两者支持 limit/cursor/direction。完整类型见 [对象协议](../packages/protocol/src/objects.ts)，对象内容保持为工作区 Markdown。

## 状态、网络与连接

| 方法 | 返回 / 参数 | 权限与约束 |
| --- | --- | --- |
| `storage.get(key)` | JSON 值，不存在时 null | `storage` |
| `storage.set(key, value)` | void，超限保留原数据 | `storage` |
| `storage.remove(key)` | void | `storage` |
| `storage.usage()` | `{ used,limit }`，字节 | `storage` |
| `network.get(url)` | 文本，最多 256 KiB | `network`、声明的 HTTPS 来源，无凭据或重定向 |
| `connections.request(origin, request)` | `{ status,body,contentType }`，body 为字符串 | `connections`、已声明来源和个人独立授权 |
| `native.invoke('git.status')` | `{ branch,detached,entries }` | `native`、对应命令声明、本地宿主支持 |
| `native.invoke('git.diff', { path,staged? })` | `{ path,staged,patch }` | 同上，只读差异 |
| `native.invoke('git.log', { path?,limit? })` | `{ path,commits }` | 同上，只读历史 |
| `native.invoke('sync.open')` | `{ opened:true }` | `native`、命令声明；仅打开系统同步面板，不执行写入 |

状态键为字母开头、最长 80 字符的小写 ID，可含数字、点和连字符。业务内容存文档或对象；storage 不跨设备同步。连接 request 为 `{ path,method?,body? }`，方法限 GET/POST/PUT/PATCH/DELETE、正文为 JSON，受用户授权的方法及路径前缀限制。插件不能读密钥、列出连接、发起 OAuth 或替用户授权。

`native.invoke(command,args?)` 的通用类型签名供宿主扩展，不表示任意系统命令可用。当前提供上述 Git 读取与系统同步入口；entry 为 `{ path,index,worktree,originalPath }`，不跟随工作区外符号链接。

## 视图与 UI 桥接

| 方法 | 返回 | 行为 |
| --- | --- | --- |
| `views.render(id, tree)` | Promise<void> | 文本树：stack/heading/text/code/table/input/button |
| `views.open(id)` | Promise<void> | 打开声明位置的视图 |
| `views.onAction(id, handler)` | 取消订阅函数 | handler 收到 `{ action,values }` |
| `views.renderCustom(id, state)` | Promise<void> | 需 ui 权限及包内界面，推送 JSON 状态 |
| `views.setHeader(id, header)` | Promise<void> | 需 ui 权限，为声明的视图设置面包屑标题和右侧操作；不占用内容区域 |
| `views.onMessage(id, handler)` | 取消订阅函数 | 接收页面的 JSON，必须验证消息输入 |
| UI 的 `tanoView.postMessage(message)` | Promise<void> | 向自身 Worker 发消息，最多 16 KiB |
| UI 的 `tanoView.onState(handler)` | 取消订阅函数 | 订阅 JSON 状态 |

UI 没有文档、网络、本机存储或 Tauri API；Worker 读取后推送。React useEffect 返回 onState 的取消函数。视图 id 必须在清单中声明，位置为 panel/tab/sidebar/settings。宿主 DOM、编辑器 schema 和任意原生命令不属于此 SDK。

自定义标签页可调用 `views.setHeader(id, { title, status?, statusAfter?, previewInfo?, actions })`，由宿主在面包屑左侧显示标题、右侧显示操作。标题最多 200 字符，状态最多 80 字符，操作最多 10 项；`statusAfter` 是放置状态的操作 ID。每项为 `{ id, label, icon?, disabled?, accept?, group? }`，图标限 `open/previous/next/minus/plus/fit/info`。`group`（最多 40 字符）将低频操作按组收进右侧“…”弹层；未指定分组的操作保留在面包屑行。`previewInfo: { label, detail }` 在面包屑标题后显示预览状态图标，悬浮、聚焦或点击展开详情；标签最多 80 字符，详情最多 2000 字符，均为纯文本。页眉状态独立于 `renderCustom` 内容状态。点击操作通过 `onMessage` 收到 `{ type:'header-action', action:id }`。

设置 `accept:'.ppt,.pptx'` 之类的扩展名列表后，宿主提供本机文件选择器，仅把用户选中的文件传给当前工作区的当前插件实例；上限 50 MiB。消息为 `{ type:'header-file', action, name, total, offset, chunk, transferId }`，`chunk` 是最多 9000 字节的 base64 编码。插件须在处理完分块后结束消息回调，宿主才发送下一块；若转发给异步界面，应等待界面确认以免覆盖尚未消费的状态。切换工作区、插件实例或关闭页面会停止后续传输。

读取所选文件前，宿主先发送 `{ type:'header-file-start', action, name, transferId }`，插件可立即展示加载骨架。读取或传输失败时发送 `{ type:'header-file-error', transferId, error }`；插件应按 `transferId` 结束对应加载状态，忽略过期传输的错误。

## 事件和自动化

`events.subscribe(handler, { types?,ids? }?)` 返回取消函数。事件为 workspace.changed（可带 fileId）或 documents.changed/objects.changed/relations.changed（`changes:[{id,kind}]`，kind 为 created/updated/deleted）。变化合并 150 ms，超过 100 项发送 reset:true，应重新查询。资源事件需要对应读权限；收到事件不代表永久获得该 ID 的访问权限。

后台入口是 `automation.ts` 的默认异步函数 `(tano: TanoAutomationApi, execution)`。仅提供 context、除 open 外的文档方法、对象、关系、网络和连接；没有 UI、命令、通知、storage、native 或 events。execution 含 runId/automationId/trigger/scheduledAt/payload/webhook?；trigger 为 manual/schedule/webhook。webhook 是不可信外部 JSON；任务参数和权限由宿主管理，导入不自动启用。未知执行结果不得自动重复副作用。

## 迁移和发布

1. 声明式 v1 可继续使用；增加代码时升级清单为 v2，填写 apiVersion:1 和最小权限，经打包器生成 package v1，不把脚本放入共享规则。
2. list 循环改为分页 query；路径身份改为短 ID；直接写文件改为 read 后携带 hash 的 write/edit/update。
3. Vue/React 留在 ui/，文档及凭据操作移到 Worker，经消息桥沟通，不复制宿主 store、组件或令牌。
4. 插件状态用自己的数据版本迁移并保留回退副本；用户文档变更需显式预览并按 hash 保存。回滚代码不会自动回滚内容。
5. 新版本、新权限、新来源在更新说明中解释；代码摘要变化后，成员、服务连接和后台任务按各自范围重新授权。
6. 在独立工作区验收新安装、读者权限、已有数据、外部修改、工作区切换、离线和回滚。目录已发布版本不可覆盖；修复提交新版本，撤回保留历史包和用户数据。
7. 在线产品在「插件 → 我的投稿」提交包、版本源码地址、许可证及说明，也可从社区目录点击「发布插件」进入，经维护者审核发布。自托管静态目录使用插件开发文档中的 release/catalog 命令。
