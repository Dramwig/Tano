# 插件开发与工作区管理

同页在浏览器和桌面共用插件 API v1。插件规则是 `.tano/plugins.tano.json`，由工作区存储适配器读取和同步。插件代码按 SHA-256 存在应用缓存，代码不会写入工作区。`.tano/config.json` 仍只保存工作区身份。

## 安装和管理

打开「插件」，使用内置声明式插件，或导入 JSON 插件包。导入窗口提供「文档总览」代码示例。检查、导入以及打开工作区均不会替用户授权代码。

管理员在插件详情中选择必需、推荐、允许自行启用或禁止，并编辑共享 JSON 设置。规则锁定清单、版本和代码摘要；管理员升级或重新导入旧包即可更新或回滚。成员可调整推荐/可选插件的本机启用状态，必需和禁止规则不可由成员覆盖。代码授权绑定账号、工作区和精确摘要，更新脚本后需重新授权。

在线产品通过管理员上传的应用包缓存向工作区成员分发包；独立本地产品也支持可选的 HTTPS 下载地址，或手动导入同摘要插件包。下载不发送宿主凭据，不跟随重定向，浏览器要求下载来源允许 CORS。离线时使用已校验缓存。缺少包或本机能力会显示原因，不影响文档打开。

工作区所有者权限必须由服务端检查；本地目录由当前设备所有者管理。规则文件不能自行赋予管理员身份。停用或卸载插件保留 Markdown、对象、关系和本机插件状态。

## 创建插件

在仓库目录执行（目录名作为插件 ID）：

```powershell
npm run plugin -- create ./artifacts/my-plugin
npm run plugin -- create ./artifacts/my-vue-plugin --template vue
npm run plugin -- create ./artifacts/my-react-plugin --template react
npm run plugin -- pack ./artifacts/my-plugin
npm run plugin -- verify ./artifacts/my-plugin/my-plugin-1.0.0.tano-plugin.json
```

编辑生成的 `manifest.json` 和 `main.ts`。打包器使用 esbuild 编译 TypeScript 及浏览器依赖；入口导出 `async function activate(tano)`。SDK 类型通过 `@tano/workbench/plugin-sdk` 提供。开发循环为修改、打包、重新导入、授权新摘要。可以使用任意浏览器兼容 npm 库，打包后的 JSON 最大为 4 MiB。

## 版本与维护

全部公开方法、模板用法、支持的协议版本及迁移步骤见 [插件 API v1 参考](plugin-api.md)。升级预览同时展示当前与目标的权限、联网地址和本机能力，说明工作区范围及重新授权要求；插件详情显示此设备的实际运行状态和失败原因。

在已安装代码插件的详情中打开「版本与维护」，可重载当前版本、查看本次工作区会话最近 100 条运行日志、检查容量和清理旧包缓存。日志包含启动失败、Worker 和自定义界面的 `console.log/info/warn/error/debug`、未处理 Promise 拒绝和 SDK 调用错误；刷新应用或切换工作区会清空，插件重载会保留。日志作为文本显示，不自动上传。

每次更新将上一版本的清单、摘要和来源加入工作区规则，最多保留 10 个历史版本引用。管理员可选「恢复版本」，沿用当前启用规则与共享设置；恢复代码仍需满足精确摘要授权。在线端允许成员获取当前及历史规则引用的包，移除历史引用后不再提供该版本。代码包始终在应用缓存中，不写入工作区。

浏览器与桌面 WebView 使用 IndexedDB 存储插件包，单包最多 4 MiB，设备代码缓存合计最多 64 MiB；旧 localStorage 包在首次读取校验后迁移。没有 IndexedDB 的嵌入宿主使用原存储接口，其可用容量由宿主决定。超额写入明确失败，已有版本保留；清理历史缓存后，本地离线回滚需要重新导入，在线回滚可重新下载。

插件本机状态仍按账号、工作区和插件隔离，每个空间最多 256 KiB，按 UTF-8 JSON 字节计算。`storage.usage()` 返回 `{ used, limit }`，`storage.remove(key)` 删除不再需要的键；超额或设备存储不足时原数据保留。业务内容应继续存入工作区 Markdown 和对象。

清单版本 1 继续支持无代码的对象和关系声明。清单版本 2 的包结构为：

```json
{
  "packageVersion": 1,
  "manifest": {
    "manifestVersion": 2,
    "apiVersion": 1,
    "id": "hello",
    "name": "你好插件",
    "version": "1.0.0",
    "description": "显示一个命令",
    "objectTypes": [],
    "relationTypes": [],
    "permissions": [],
    "networkOrigins": [],
    "nativeCommands": [],
    "commands": [{ "id": "hello", "label": "打招呼" }],
    "views": []
  },
  "source": "await tano.commands.register('hello', () => tano.notify('你好'));"
}
```

摘要是解析规范化后整个包的稳定 JSON 的 SHA-256。清单字段排序不影响摘要；代码、权限、版本、入口和声明均受摘要保护。摘要校验提供完整性，不等同于发布者身份签名或代码审计。

## API 与权限

| API | 权限 | 行为 |
| --- | --- | --- |
| `context()` | 无 | 当前工作区 UUID、插件 ID、共享设置 |
| `commands.register(id, handler)` | 无 | 注册清单声明的命令 |
| `views.render(id, tree)` / `views.onAction(id, handler)` / `views.open(id)` | 无 | 更新、交互和打开清单声明的视图 |
| `views.renderCustom(id, state)` / `views.onMessage(id, handler)` | `ui` | 加载包内自定义界面、推送状态和处理界面消息 |
| `notify(message)` | 无 | 在插件工具区域显示有来源的消息 |
| `documents.list/query/search/read/open` | `documents.read` | 可见 Markdown 的分页、搜索和读取，身份不依赖路径 |
| `documents.write/edit/create` | `documents.write` | 版本比较、编辑事务、独立修改合并、冲突副本；不允许访问 `.tano` |
| `objects.list/query/read` / `objects.create/update` | `objects.read` / `objects.write` | 对象筛选分页、短 ID 和合并机制 |
| `relations.list/query` / `relations.add/remove` | `relations.read` / `relations.write` | 按类型和端点分页，验证端点及现有关系版本 |
| `storage.get/set/remove/usage` | `storage` | 账号、工作区、插件隔离的本机应用状态，最大 256 KiB |
| `connections.request(origin, request)` | `connections` | 使用用户单独授权的服务连接；密钥由宿主保管，来源必须在 `networkOrigins` 中声明 |
| `network.get(url)` | `network` | 仅清单列出的 HTTPS 来源，GET 文本、无凭据、禁止重定向 |
| `native.invoke(command, args)` | `native` | 仅运行环境注册且清单列出的本机命令 |
| `events.subscribe(handler, options?)` | 对应资源的读取权限 | 文档、对象、关系的增删改 ID；兼容无正文的 `workspace.changed` |

`documents.read(id)` 返回 `{ id, path, content, hash }`。写入必须携带同一执行实例最近读取的 `hash`；不能自行构造基线。对象更新同样需要 `objects.read(id)` 或 `objects.list()` 返回的摘要。每个实例最多保留最近 32 个读版本，大量操作时应在写入前重新读取。停用、权限变化或工作区切换会撤销运行实例、待处理请求和事件监听。插件始终受当前成员和文档权限约束。

本地可见编辑器通过真实编辑事务应用正文修改；未打开的本地文档使用 compare/write。在线产品通过 `EditingSession.applyPluginEdit` 把受管理文档的修改送入当前协作会话，即使对应编辑器没有显示。插件操作独立成一个撤销步骤，协作会话保留撤销历史，远端独立修改不随之撤销。接入其他协作宿主时也必须实现此接口，否则明确拒绝写入。非协作富文本事务暂不修改 frontmatter，插件可通过源码编辑器修改，或在关闭文档后按版本写入。

## 分页、搜索、事务与事件

`documents.query({ query, pathPrefix, readOnly, sort, direction, limit, cursor })` 搜索路径和名称，支持按 `path`、`name`、`modified` 排序。`objects.query({ query, type, archived, properties, sort, direction, limit, cursor })` 搜索名称和描述，属性支持最多 10 个标量等值条件，排序字段为 `name`、`type`、`id`。`relations.query({ type, sourceId, targetId, direction, limit, cursor })` 按关系 ID 稳定排序。

每页返回 `{ items, total, nextCursor? }`，默认 50 条、最多 100 条，结果正文最多 256 KB。继续查询需保持所有筛选、排序和数量参数，只增加 `cursor`。游标绑定工作区、执行实例、查询与数据版本，有效期一分钟；数据发生变化、实例重启或游标被回收时，从第一页重新查询。旧 `list()` 保留兼容，新插件优先使用分页接口。

```ts
const options = { type: 'event', archived: false, properties: { checkable: true }, limit: 50 };
let page = await tano.objects.query(options);
processTasks(page.items);
while (page.nextCursor) {
  page = await tano.objects.query({ ...options, cursor: page.nextCursor });
  processTasks(page.items);
}
```

`documents.search('关键词', { pathPrefix, readOnly, direction, limit, cursor })` 执行不区分大小写的字面正文搜索，每个匹配文档返回一条 `{ id, name, path, readOnly, snippet, offset, hash }`。每次最多扫描 25 篇，空页也可能有 `nextCursor`；不返回未经扫描的总匹配数。超过 512 KB 或已有冲突的文档列在 `skipped` 中。打开文档优先搜索当前草稿，内部规则文件不会被搜索。搜索摘要不能作为写入基线，写入前仍须 `read()`。

`documents.edit(id, edits, baseHash)` 接收最多 100 项 `{ from, to, insert }`，偏移是 `read()` 返回原文中的 UTF-16 索引。宿主拒绝重叠范围、拆开 Unicode 代理对、越界及伪造基线；所有范围一起生成一个新版本，再走同一套外部修改合并和编辑事务。它是单篇文档的事务，不承诺跨文件原子写入。

```ts
const document = await tano.documents.read(id);
await tano.documents.edit(id, [{ from: document.content.length, to: document.content.length, insert: '\n新段落\n' }], document.hash);
const unsubscribe = tano.events.subscribe(event => {
  if (event.type === 'objects.changed') refreshVisibleTasks(event);
}, { types: ['objects.changed'], ids: watchedIds });
```

细粒度事件为 `documents.changed`、`objects.changed`、`relations.changed`，内容只有 `changes: [{ id, kind: 'created' | 'updated' | 'deleted' }]`。宿主合并 150 ms 内的变化；超过 100 项时发 `reset: true`，插件应重新查询。对象只修改属性也会触发事件。没有对应读取权限的插件收不到资源 ID；关闭工作区会取消待发送事件。事件用于刷新缓存，读取和写入时仍重新校验权限。

声明式视图支持 `stack`、`heading`、`text`、`code`、`table`、`input` 和 `button`。按钮回调收到 `{ action, values }`。所有文字由宿主作为文本渲染。自定义 HTML/CSS/JS 则使用下文的隔离界面；直接操作宿主 DOM 和动态修改编辑器 schema 仍不开放。

## 工作台入口

清单可以声明视图位置和命令入口：

```json
{
  "commands": [
    { "id": "open-board", "label": "打开看板", "shortcut": "Alt+Shift+J", "menus": ["workspace", "document", "file"] }
  ],
  "views": [
    { "id": "board", "label": "项目看板", "location": "tab" },
    { "id": "summary", "label": "项目摘要", "location": "sidebar" },
    { "id": "preferences", "label": "看板设置", "location": "settings" }
  ]
}
```

未指定 `location` 的视图仍显示在插件中心。插件工作台侧栏和命令中心可打开所有已启用插件的声明视图；标签页支持分栏、会话恢复和前后导航。标签页暂不支持移到独立窗口。设置页在浏览器内显示，在桌面设置窗口中通过原工作台实例处理操作。

开发者通过 `tano.commands.register('open-board', () => tano.views.open('board'))` 绑定命令。菜单和命令中心传入 `{ workspaceId, fileId? }`，文件菜单提供选中文件的 ID，文档菜单提供当前文档的 ID。插件必须注册命令后才会出现在可执行入口中。

默认使用 `Ctrl+Shift+P`（macOS 为 `⌘+Shift+P`）打开命令中心，也可从界面按钮打开并在个人快捷键设置中调整。插件快捷键使用 `Mod` 表示 Ctrl/⌘，修饰符依次为 `Mod`、`Alt`、`Shift`；不接受 Mod+Alt，避免干扰 AltGr。宿主快捷键和保留的编辑/浏览器快捷键优先，同一个快捷键被多个插件占用时均不触发，命令仍可通过菜单或命令中心执行。输入框、编辑器、对话框、输入法组合和长按不会触发插件快捷键。

工作区切换、停用或卸载会撤销实例；插件标签页、侧栏和设置入口随声明移除。设置表单的操作绑定工作区和执行实例，旧窗口不能把待处理操作发给新的插件版本。

开发模式、自动重载、运行日志、版本回滚、设备容量配额和在线产品的工作区包配额及回收已提供。[插件目录与发布流程](plugin-catalog.md) 支持产品配置的 HTTPS 目录、发布者归属、不可覆盖版本、撤回与精确下载安装，并提供提交材料和目录构建命令。官方在线产品另有默认目录、账号投稿和管理员审核入口；其服务端实现位于独立产品仓库。在线工作区已接入下文的 API Key 凭据代理和可配置 OAuth；桌面本地工作区已提供系统凭据库、公共客户端 OAuth 和受控 Git 查询。云端自动化已提供独立入口、所有者授权、隔离执行、定时任务和 Webhook，部署后仍需验收实际调度与唤醒；更多本机能力仍待扩展。

## 桌面 Git 能力

独立桌面产品及官方桌面的本地工作区注册 `git.status` 和 `git.diff`。网页、移动端和在线工作区不提供本机 Git，即使在线工作区运行在桌面应用中也不继承已打开本地目录的权限。

```ts
// manifest: permissions: ['native'], nativeCommands: ['git.status', 'git.diff']
const status = await tano.native.invoke('git.status');
// { branch, detached, entries: [{ path, index, worktree, originalPath }] }
const diff = await tano.native.invoke('git.diff', { path: '笔记.md', staged: false });
// { path, staged, patch }; staged: true 查询暂存区相对 HEAD 的差异
```

宿主绑定工作区 UUID、插件 ID、精确摘要与命令声明，Rust 再核对当前工作区和磁盘规则。取消请求、窗口关闭、规则变化或工作区切换会中断查询并丢弃旧结果。全应用最多 4 个并发查询，每次最多 15 秒，状态最多 1000 项，Git 原始输出最多 256 KiB。查询只读取已保存文件，未保存草稿不参与。

Git 可执行文件必须来自工作区外的系统 PATH，不能由插件指定。宿主复制最多 32 MiB Git 元数据到应用缓存，使用隔离的 Git 配置，不改写原索引；不运行配置中的辅助程序、过滤器、外部 diff、textconv 或 fsmonitor，不读取系统、全局及 include 配置。使用这些配置的仓库可能与普通 Git 显示不同。这里使用的禁用选项参考 [Git diff 官方说明](https://git-scm.com/docs/git-diff)。

当前只支持根目录含普通 `.git` 目录的仓库，不支持链接工作树、共享对象库、稀疏检出、嵌套仓库、符号链接或额外 Git 存储扩展。路径检查最多 200000 个目录项、64 层；隐藏文件不开放正文差异读取，不提供任意命令、暂存、提交或网络操作。[Git 变更示例](../examples/plugins/git-inspector/README.md) 可直接打包安装，包含状态列表和差异预览。

## 服务连接与凭据

插件使用 `connections` 权限与 `networkOrigins` 声明要调用的来源。`network` 的无凭据 GET 与服务连接是两个独立能力，不因声明其中一个而获得另一个。SDK 不提供读取密钥或枚举其他插件连接的接口。

```ts
// manifest: permissions: ['connections'], networkOrigins: ['https://api.example.com']
const response = await tano.connections.request('https://api.example.com', {
  path: '/v1/items',
  method: 'POST',
  body: { title: '新的事项' }
});
if (response.status >= 400) throw new Error(`服务返回 HTTP ${response.status}`);
const item = JSON.parse(response.body);
```

用户先启用并授权插件，在插件中心的「服务连接与凭据」中选择该插件和声明来源，配置允许的路径前缀、方法和 API 密钥。支持 `Authorization: Bearer`、`X-API-Key`、`API-Key`、`Private-Token`。密钥输入不会写入共享规则或插件的 localStorage，保存后清空输入框；网络操作由宿主 `PluginConnectionProvider` 处理。

连接绑定当前用户、工作区、插件 ID、服务来源和精确代码摘要。升级插件后，原连接保留但不能由新版本调用；用户核对新版本后可以沿用密钥重新授权。管理员安装必需插件不开放管理员或其他成员的凭据，成员使用自己的连接。修改设置或撤销连接使用版本比较，避免覆盖另一窗口的更新。卸载后仍可在连接列表显式撤销。

请求只接受相对服务来源的绝对路径（以 `/` 开头）、`GET/POST/PUT/PATCH/DELETE` 和可选 JSON 正文。正文最多 64 KiB，GET 不携带正文；返回 `{ status, body, contentType }`，响应正文最多 256 KiB，不转发 Cookie、认证头或其他上游头部。不自动重试：写入超时或取消时，第三方服务可能已经执行，插件必须使用服务支持的幂等机制或查询结果后再决定重试。

当前官方在线产品在服务端加密保管 API Key，网页和桌面的在线工作区共用该代理。服务端再次核对成员身份、当前插件规则和连接授权，拦截非公共网络地址、越界路径与方法、重定向、超大响应及常见凭据回显。密钥只应交给用户信任的目标服务；通用 HTTP 代理无法证明第三方服务不会以任意编码返回凭据。它不是对目标服务行为的审计或担保。

独立桌面产品和官方桌面的本地工作区使用操作系统凭据库，通过同一界面保存和撤销 API Key。连接属于当前系统用户，绑定工作区 UUID、目录身份、插件、来源和精确摘要，不跟随工作区复制或在线账号同步。应用数据目录的 `plugin-connections/` 只保存连接范围、版本与凭据清理记录；密钥分块存入系统凭据库。保存失败保留旧连接，撤销先移除调用权限，再清理凭据；如果凭据库锁定，界面提示解锁后刷新重试，不降级到明文存储。每个工作区最多 20 个本地连接。

本地代理重新验证工作区和磁盘插件规则，只连接经 DNS 校验并固定地址的公共 HTTPS 服务，不使用系统代理、Cookie、重定向或自动重试。全应用网络与 Git 查询共用最多 4 个并发槽，凭据管理保留独立余量；网络调用最多 15 秒。修改或撤销连接、改变插件规则、取消调用或切换工作区后，宿主停止等待并拒绝旧结果；远端已经执行的写入无法撤回。响应上限、方法、路径和凭据回显限制与在线代理一致。

可安装的[GitHub 议题导入示例](../examples/plugins/github-importer/README.md)演示配置连接、读取预览、明确确认后创建 Markdown，保留同名已有文档。浏览器演示和移动端尚未接入本地持久凭据提供方；自有宿主可通过 `WorkbenchRuntime.plugins.connections` 接入。

在线宿主可提供 `PluginConnectionProvider.oauth`，在相同连接界面显示「使用账号登录」。管理员在部署环境配置服务来源、登录地址、客户端、固定回调地址及权限范围；插件和共享工作区规则不能指定这些内容。用户确认后点击「前往服务登录」，在外部浏览器中完成授权，再返回同页等待结果。在线工作区要求系统浏览器登录发起授权的同一同页账号。未配置服务的来源仍使用 API Key。

宿主使用授权码与 PKCE S256，保存一次性、十分钟有效的授权状态，并把授权绑定到当前用户、工作区、插件摘要和连接版本。令牌及刷新令牌在服务器加密保存，SDK 仍只使用 `connections.request`。临近过期时由宿主刷新，多个服务实例通过持久记录互斥；刷新失败、进程崩溃或结果不明时需要重新登录，不重复消耗可能已轮换的令牌，也不自动重试第三方业务写入。换工作区、修改授权范围或关闭界面会取消等待并请求取消未完成授权；已完成的连接需从列表明确撤销。

OAuth 连接的版本变化需要重新登录授权；不能把内部令牌作为普通 API Key 沿用。撤销移除同页的连接与令牌，不代表撤销第三方账号端的应用授权；后者由用户在服务的账号设置中管理。当前验证使用模拟 OAuth 服务，真实服务注册、回调配置与上线验收由部署方完成。实现参考 [OAuth 安全最佳实践](https://www.rfc-editor.org/rfc/rfc9700.html)。

### 桌面本地账号连接

本地桌面通过相同界面使用授权码与 PKCE S256，账号令牌和刷新令牌保存在当前系统用户的凭据库中。产品管理员或设备所有者在应用数据目录配置 `plugin-oauth-clients.tano.json`；不能把此文件放进工作区。Windows 独立产品的目录是 `%APPDATA%/app.tano.local/`，官方桌面是 `%APPDATA%/app.tano.desktop/`。其他平台使用 Tauri 的应用数据目录。示例配置如下，地址和客户端 ID 必须替换为服务实际注册值：

```json
{
  "version": 1,
  "providers": [{
    "id": "example",
    "label": "示例服务",
    "origin": "https://api.example.com",
    "scopes": ["read"],
    "authorizationEndpoint": "https://accounts.example.com/authorize",
    "tokenEndpoint": "https://accounts.example.com/token",
    "clientId": "registered-native-public-client"
  }]
}
```

目前仅支持不含客户端秘密的公共客户端、JSON Bearer 令牌响应和 IPv4 loopback 回调。服务须支持动态端口的 `http://127.0.0.1:{port}/tano/plugins/oauth/{providerId}/callback`。配置最多 20 个服务、64 KiB；登录及令牌端点必须是无查询、片段或用户凭据的 HTTPS 地址。不支持设备码流程、私有网络令牌服务、嵌入网页登录或桌面内保存客户端秘密。配置改变后重新打开连接面板；已有连接的注册信息指纹改变时必须重新登录。

每次登录创建独立的临时回调端口与随机状态，绑定发起窗口、工作区目录身份、插件规则、代码摘要和连接版本，最长十分钟。错误状态不消耗授权；取消、窗口关闭或切换工作区会结束等待并关闭端口。每个工作区最多三个待完成登录，不占用业务网络请求的四个并发槽。登录不会替换旧连接，直到完整授权并成功保存。流程状态仅驻留进程内，重启后需要重新开始。

临近过期时宿主刷新，发送刷新请求前持久记录占用；刷新失败、保存失败或进程退出后不能再次使用结果不确定的旋转令牌，需重新连接账号。令牌仍不可由插件读取。第一次保存 OAuth 连接后，本地连接元数据升级为版本 2；旧版程序不能读取此格式，避免把账号令牌记录当作 API Key。当前 Windows 验收覆盖实际本机回调、取消和切换清理，模拟 HTTPS 测试覆盖换取及刷新，尚未对真实第三方 OAuth 账号完成上线验收。协议依据 [原生应用 OAuth](https://www.rfc-editor.org/rfc/rfc8252.html)。

## 开发模式与自动重载

云端任务的独立入口、打包和接入状态见[云端自动化入口](#云端自动化入口)。开发重载仍只影响前台授权，不会自动批准服务端执行。

先通过 `npm run plugin -- pack ./my-plugin` 构建初始包，在测试工作区导入、启用并授权。打开插件详情的「版本与维护 → 开发模式」，复制界面给出的命令，例如：

```sh
npm run plugin -- watch ./my-plugin --origin http://127.0.0.1:5173
```

`--origin` 必须与实际 Tano 窗口的来源一致；也支持桌面使用的 `tauri://localhost`。命令监听源文件及本地界面资源，忽略 `node_modules`、`.git` 和导出的 `.tano-plugin.json` 包。它只在 `127.0.0.1` 上提供当前内存中的构建，端口默认自动分配，也可传 `--port 4173`。服务不暴露目录；每次启动生成独立随机地址，并验证请求来源和 Host。

将命令输出的完整地址粘贴到「本机开发地址」，勾选信任此开发会话后点击「开始自动重载」。只有已授权、已启用插件的工作区管理员可以启动。网页和桌面通过相同的包格式接入；开发服务运行在当前设备，浏览器如要求本机网络访问许可，需允许该连接。

保存源码后，工具重新打包，界面约每 1.5 秒检查一次摘要。新构建沿用当前规则和共享设置，安装并为当前账号、设备授权精确的新摘要，然后重启隔离实例。**这会修改工作区共享的版本锁定与版本历史**，所以应使用专门的测试工作区；其他成员仍需在各自设备授权新版本。开发地址和信任会话不写入便携规则或用户数据，刷新应用后需要重新开启。

编译失败或服务临时断开时保留上一版并重试。插件 ID、权限、网络来源、本机命令声明变化时停止自动应用，必须手动导入核对。停止会话、切换工作区、停用插件、撤销授权、失去管理权限或其他操作替换版本，也会使待处理构建失效；授权前会再次检查当前会话与新版本。关闭详情面板不会结束开发会话，使用「停止自动重载」结束它。若停止时共享规则已经写入，新版本可能显示待授权，系统不会自动信任它；可以手动恢复历史版本。

维护面板还提供当前版本重新加载、最近 100 条会话日志、最近 10 个历史版本引用和显式缓存清理。单包最多 4 MiB，设备代码缓存合计 64 MiB，每个插件的本机状态最多 256 KiB；工作区 Markdown 和对象内容不计入插件本机状态。工作区历史仅保存引用，清理对应代码缓存后回滚可能需要重新下载或导入包。

在线工作区管理员可从插件中心或插件详情打开「工作区云端包存储」，查看所有已发布版本（包括已卸载插件）并回收未被规则引用的包。官方在线产品默认为每工作区 64 MiB、最多 1024 个包版本；上传前原子预留容量，相同内容只计一次，未完成上传也计入。失败后可重新导入相同版本重试，或在两分钟后刷新并回收预留。回收失败会保留占用和记录，支持重试。

当前版本和历史版本默认受保护。需要释放历史包时，先在历史列表移除对应引用，再回收云端包；此后恢复需重新导入。服务端将包可用性检查与规则写入放在同一事务中，回收也比较当前规则版本，避免并发安装丢失代码。仅回收代码包，不删除 Markdown、对象或插件用户数据。离线宿主没有此云端入口，可通过 `PluginPackageRepository.usage/remove` 接入自己的包存储管理。

## 自定义 HTML / CSS / JavaScript 界面

清单需声明 `ui` 权限。插件包可带有 `ui: { "board": { "html": "...", "css": "...", "source": "..." } }`；每个键都必须对应清单中的视图 ID，所有界面字节纳入版本摘要。旧包没有此字段时规范化结果保持不变。

Worker 处理数据，自定义界面处理 DOM。界面只拿到 `TanoPluginViewApi`，通过受控消息触发 Worker 中的 SDK 操作：

```ts
// main.ts — Worker
export default async function activate(tano: TanoPluginApi) {
  tano.views.onMessage('board', async (message) => {
    if (message === 'refresh') {
      const documents = await tano.documents.list();
      await tano.views.renderCustom('board', { documents });
    }
  });
  await tano.views.renderCustom('board', { documents: [] });
}

// ui/board.ts — 自定义界面
export default function mount(view: TanoPluginViewApi) {
  view.onState(state => { /* 使用 Vue / React / Canvas 等更新界面 */ });
  // Promise 在 Worker 处理完成时返回；状态由 onState 接收。
  void view.postMessage('refresh');
}
```

在插件目录的 `ui/` 下创建与视图同名的 `.ts`、`.tsx`、`.js` 或 `.jsx` 入口，导出默认挂载函数。`npm run plugin -- pack` 自动打包依赖、导入的 CSS、图片和字体。可选的同名 `.html` 和 `.css` 文件也会加入包中；HTML 放入隔离页面的 `#app` 容器。辅助模块放入子目录，避免被当作独立入口。依赖应安装在插件项目中；Vue 使用 render 函数或预编译组件，React 可使用 JSX。依赖应支持浏览器、CSP 和无网络运行；动态从 CDN 加载库、运行时 `eval` 和 Node.js 模块不支持。

状态为最大 128 KB 的 JSON，界面向 Worker 发送的单条消息最大 16 KB，每个界面最多 16 个并发请求，每秒最多 100 条消息。界面加载超过 15 秒会关闭；工作区、版本或实例变化会销毁旧页面与消息通道。普通状态更新保留当前 DOM 和输入，不重新加载界面。

界面采用两层不透明来源的 sandbox iframe：外层只有固定启动代码并禁止子页面加载外部地址，内层运行包内代码。CSP 阻止直接网络请求、外部图片/CSS、表单提交、嵌套网络页面和 Worker；窗口、宿主存储、凭据及 Tauri IPC 不提供给界面。固定启动代码也禁用 WebRTC 构造器，避免其独立网络通道。正常表单事件可用于交互，实际联网必须交给 Worker 的已授权 SDK。[iframe sandbox](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe#sandbox) 和 [CSP frame-src](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/frame-src) 提供浏览器边界；跨浏览器行为仍需实际验收。

完整 Vue 示例见 [任务看板](../examples/plugins/kanban/README.md)，包含拖拽、键盘移动、错误反馈、工作区对象持久化和重启恢复。React 与 Chart.js 示例见 [任务统计](../examples/plugins/task-insights/README.md)，包含分页汇总、交互图表、筛选、实时刷新与资源清理。两个示例都使用工作区事件任务，内容没有移到插件缓存或数据库。

宿主可通过 `WorkbenchRuntime.plugins.native` 注册受信任系统集成，并接收工作区 ID 与取消信号。核心没有默认开放任意 shell/文件系统。浏览器缺少本机集成时会阻止依赖这些命令的插件。云端上传与后台授权分开：上传包不会执行服务端脚本。后台任务由在线宿主的持久队列统一调度。

## 云端自动化入口

清单可以声明 `automations: [{ "id": "daily", "label": "生成日报" }]`，同目录提供 `automation.ts`，默认导出异步函数 `(tano: TanoAutomationApi, execution: PluginAutomationExecution)`。现有 `main.ts` 继续用于浏览器和桌面的前台插件。两个入口可导入相同的纯逻辑模块；打包器分别构建，服务端脚本写入 `automationSource`，参与整个包的摘要和容量计算。未声明入口不能附带服务端脚本。旧包没有新增字段时规范化内容不变。

```ts
import type { TanoAutomationApi, PluginAutomationExecution } from '@tano/workbench/plugin-sdk';

export default async function run(tano: TanoAutomationApi, execution: PluginAutomationExecution) {
  if (execution.automationId !== 'daily') throw new Error('未知自动化入口');
  const page = await tano.documents.query({ limit: 100, sort: 'path' });
  return { runId: execution.runId, documentsOnPage: page.items.length };
}
```

服务端 API 保留 `context`、文档读写查询、对象、关系、网络和服务连接的类型；不包含打开编辑器、视图、快捷键、本机命令、设备存储和前台事件订阅。`execution` 包含运行 ID、入口 ID、触发类型、计划时间和 JSON 输入；它来自宿主，不能用插件参数替换执行身份。异步操作必须 `await`，不能在返回后继续修改内容。服务端入口必须是可独立打包的 ECMAScript，不能依赖 Node.js、DOM、浏览器 Web API 或外部动态模块。

在线宿主已接通隔离执行器、持久任务、owner 独立授权、手动触发和服务运行期间的间隔调度，并提供文档、对象、关系、分页查询、网络与服务连接的数据适配。任务授权绑定工作区、授权者、入口、精确包摘要和共享规则版本；安装、复制工作区和前台授权不会创建后台任务。规则改变后需要重新授权，失去权限或取消后拒绝旧实例提交。后台对象类型注册表按工作区隔离。

后台文档写入复用版本比较与协作协调流程：独立修改合并，重叠修改或合并计算超过限额时保留插件冲突副本。宿主每次运行最多读取 64 MiB 数据，保存最近 32 个读基线；解释器还有独立的 CPU、内存和消息限额。服务连接使用授权者此前为该精确插件版本配置的凭据；密钥仍不进入脚本。第三方写入发生异常或执行结果不明时记录为结果不确定，不自动重试；取消不能撤销已经完成的操作。

可打包的[工作区日报示例](../examples/plugins/daily-report/README.md)会分页读取任务和文档并创建独立 Markdown。在线工作区所有者可在「插件 → 后台自动化」新建任务，核对当前版本、权限及共享设置后单独授权，选择手动或按间隔执行。界面提供任务编辑、停用、运行记录、停止执行和删除；停用需取消「启用此后台任务」后保存。插件在此设备上是否运行不影响后台任务授权。宿主通过 `WorkbenchRuntime.plugins.automations` 接入任务服务，SDK 无权自行创建或授权任务。

任务保存同时比较任务版本和用户核对的规则摘要；刷新发现其他管理员的更改时重新核对，避免把旧表单覆盖到新配置。切换工作区、共享规则变化或失去管理权限会取消界面请求。手动提交中断后，设备应用状态保留提交标识，可「确认上次提交」而不重复入队；查看记录并主动结束本次确认后，下一次运行才使用新标识。这里只保存标识，不保存参数和凭据。本地桌面和浏览器演示没有后台任务服务。

部署管理员可配置外部调度，在有到期或待执行任务时唤醒在线 API；云端 Worker 每五分钟检查一次，自托管服务可使用独立计划任务。此配置属于部署环境，不由插件或工作区设置决定，也不会因安装插件自动开启。执行可能延迟一个检查间隔及服务启动时间；服务恢复后仅补入最近一次到期，不逐次补跑停机期间的任务。唤醒失败保留队列，运行结果不确定时仍需人工核对，不自动重复执行。具体配置见在线宿主的部署文档。

在线任务支持 Webhook。所有者在任务的「Webhook」区域确认允许外部触发后生成凭据，复制触发地址及凭据到调用方；服务端只保存凭据摘要，关闭区域后不能重新查看。调用方发送 JSON `POST`，凭据置于 `Authorization: Bearer ...`，事件唯一标识置于 `Idempotency-Key`；不能把凭据放进 URL。每个事件的重复投递沿用相同标识和正文；同一标识改换正文或任务版本返回冲突，去重收据保留 30 天。凭据只能触发绑定任务，不能读取文档或运行结果。

脚本中的 `execution.payload` 始终是所有者配置的任务参数，外部 JSON 单独放在 `execution.webhook`（最多 16 KiB）。`execution.trigger`、工作区、入口、执行身份和插件包均由服务端绑定，不能由事件正文覆盖。插件需要自行验证外部事件的业务格式。凭据轮换或撤销会改变任务版本、停止旧版本所有待执行和运行中调用；任务保存时清除原凭据。原有文档与第三方副作用保留。若宿主提供 `PluginAutomationProvider.webhook`，共享管理界面即显示此入口。

桌面配置保留显式的 `style-src 'unsafe-inline'`，仅关闭 Tauri 对 `style-src` 的自动 nonce 注入，避免父页面继承策略阻止隔离界面的包内 CSS。脚本指令的自动保护、固定 bootstrap 哈希、iframe 隔离与网络限制仍启用。

## 执行边界与验证

每个代码插件运行在独立 Worker 中。Worker 从不透明来源的沙箱 iframe 创建，继承禁止联网的 CSP；iframe 只有固定、带 CSP 哈希的消息转发代码。插件无法读取宿主 DOM、cookie、应用存储或 Tauri IPC。网络、文档、本机能力全部通过绑定实例的消息通道校验。视图数量、内容、请求速率和并发受限，启动和交互超时会停止插件。浏览器进程总体内存仍受浏览器自身资源管理限制，不能承诺恶意代码无法造成资源消耗。

`npm run check` 检查协议、授权、持久化、并发和构建。`npm run test:plugins:browser` 在真实浏览器检查沙箱及插件中心安装流程；Windows 本地默认使用 Edge，CI 使用已安装的 Playwright Chromium。更改沙箱 bootstrap 时必须同步桌面 CSP 哈希并运行浏览器测试。

Windows 上可运行 `npm run test:plugins:native`，使用真实 WebView2、生产 CSP、Rust 提供方和系统 Git 验收安装、授权、状态、差异、停用及工作区切换；用真实任务对象验收 React/Chart.js 的分页统计、图表交互、刷新及清理；使用合成密钥验收系统凭据保存、刷新后沿用与撤销；使用测试注册验证 OAuth 的 PKCE、本机回调错误状态、拒绝、取消和切换清理，不打开真实登录服务。测试构建独立身份的隐藏窗口，使用临时仓库和独立浏览器配置，结束后清理本次测试凭据、恢复测试应用的原有 OAuth 配置，并恢复普通发布构建配置。截图、结果和临时仓库保留在 `artifacts/`，测试应用状态位于 `app.tano.plugin-smoke` 的系统应用目录。此命令需要已安装 Rust、Git 和 WebView2，不属于普通网页检查。原生单元测试的 HTTPS 测试服务由 Node.js 启动，只信任专用测试 CA，不修改系统信任库；固定测试证书到期前需重新生成。

公共 MIT 核心包含 SDK、格式、管理界面、运行时和开发工具。账户、在线包分发、云端权限与部署位于独立私有产品仓库。插件作者仍需遵循各自依赖的许可义务。
