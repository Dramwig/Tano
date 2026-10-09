# 插件目录与发布

Tano 支持由产品维护者配置的 HTTPS 插件目录。目录由 JSON 索引和按 SHA-256 寻址的包组成，可以放在自己的静态站点或对象存储。浏览器与桌面使用相同格式；工作区不会自行指定或替换整个目录来源。

公共核心提供目录协议、安装界面、自托管构建命令和基于代码仓库审核的发布流程。官方在线产品另外提供账号投稿、管理员审核和默认公共目录；账户、服务端与部署实现位于独立产品仓库。本地产品无需在线账号即可使用内置插件、文件导入和自托管目录。

目录尚不提供发布者数字签名。发布者身份由所选目录的运营方核验，JSON 中的名字本身不是身份认证。摘要校验保证收到的包与审核目录一致，不能代替代码审核。

## 官方在线目录

官方在线工作区的「插件 → 社区目录」读取所连接服务的目录；官方桌面默认使用官方目录。作者可从社区目录点击「发布插件」，或进入「插件 → 我的投稿」，使用已验证邮箱的账号创建发布者，上传插件包并填写该版本的源码地址、许可证和更新说明。发布者 ID 不可更换，`tano` 和 `tano-` 前缀由产品保留。待审稿件仅作者和审核人员可见。

审核人员在[管理站点的插件审核页](https://admin.tano.page/#plugins)检查清单、源文、权限与版本说明。普通管理员可查阅，root 管理员核对材料并记录理由后才能批准、退回或撤回。审阅页面不会运行投稿中的代码；只有批准后的版本进入公共目录。

作者可以取消待审稿件或申请撤回已发布版本；撤回申请须由 root 管理员处理。已发布的版本、包摘要和源码地址不可覆盖，修复应提交新版本。撤回停止新安装并保留历史，不会删除已有工作区数据。在线目录发布与工作区私有包分发独立，安装后仍遵循工作区规则和设备授权。

下面的命令用于自托管目录和提交材料准备，不会代替在线投稿，也不会自动公开插件。

## 作者提交版本

在 Tano 源码仓库运行开发命令。先构建、验证插件，再生成独立提交目录：

```sh
npm run plugin -- pack ./my-plugin ./my-plugin.tano-plugin.json
npm run plugin -- verify ./my-plugin.tano-plugin.json
npm run plugin -- release ./my-plugin.tano-plugin.json ./submission-1.0.0 --publisher my-team --source https://git.example.org/my-team/my-plugin/commit/REVISION --license MIT --notes ./release-notes.txt
```

`--notes` 可省略；`--source` 应指向该次构建的不可变源码修订，包括依赖锁文件和可复现构建步骤。`--license` 必须如实反映插件许可证。插件打包不免除第三方依赖的许可义务，作者应在源码与插件中保留所需声明。

提交目录必须尚不存在，生成内容包括：

- `release.json`：插件清单、发布者 ID、版本、SHA-256、规范化包字节数、时间、源码链接、许可证与更新说明。
- `packages/<SHA-256>.json`：已验证的规范化代码包，不包含作者机器上的路径或凭据。

将这两个文件提交给目录维护者审核。命令不联网发布，不改写已有目录。`release.json` 中的 `published` 表示候选条目格式，只有被维护者加入正式索引并发布后才会被客户端发现。

## 维护者审核与构建

维护者在专用目录仓库管理 `reviewed-index.json` 与 `packages/`。初始索引形状如下；把经过核验的 `release.json` 对象放进 `releases`，把包放进 `packages/`：

```json
{
  "catalogVersion": 1,
  "name": "团队插件目录",
  "updatedAt": "2026-10-09T00:00:00.000Z",
  "publishers": [
    {
      "id": "my-team",
      "name": "我的团队",
      "homepage": "https://git.example.org/my-team",
      "pluginIds": ["my-plugin"]
    }
  ],
  "releases": []
}
```

每个插件 ID 只能归属一个发布者。维护者首次分配 ID 时，应在源码托管服务核验申请者身份；后续提交核对原有发布者、源码、构建产物与新增权限。保护目录主分支和发布凭据，要求维护者审核后才能合并；作者提交不能修改审核规则、上次正式索引或发布任务。

首次建库显式使用 `--initial`：

```sh
npm run plugin -- catalog ./reviewed-index.json ./dist-first --packages ./packages --initial
```

之后每次更新都传入**上次实际发布的索引**，由维护者或可信发布任务取得，不能用本次投稿自行提供的文件代替：

```sh
npm run plugin -- catalog ./reviewed-index.json ./dist-next --packages ./packages --previous ./last-published-index.json
```

构建会重新解析全部清单，核对包摘要、清单和字节数；拒绝重复版本、发布者抢占、已发布版本覆盖、历史删除或撤回版本重新上架。包文件不能通过符号链接指向选定包目录之外。每个包上限 4 MiB，索引上限 4 MiB / 1000 个版本，单次输出代码包总量上限 256 MiB。

输出目录必须不存在。工具完成所有包验证后才创建输出，并在复制、再次验证全部包后最后写入 `index.json`；失败时可能留下未完成的输出目录，**只有命令成功且索引存在的目录才可部署**。不要在已发布目录上直接运行构建，也不要删除旧包来模拟版本更新。

## 托管与产品配置

将构建结果整体发布到你控制的 HTTPS 地址，例如 `https://plugins.example.org/tano/index.json`。静态服务器需满足：

- 索引和 `packages/` 保持同一来源、同一目录布局；先上传包，最后原子替换索引，或使用支持整站原子切换的托管方式。
- 索引返回 JSON，建议 `Cache-Control: no-store`；包地址不可变，原内容须保留，以支持工作区重开和回滚。
- 浏览器跨来源加载需允许应用来源的 CORS。公开的无凭据目录可使用 `Access-Control-Allow-Origin: *`，桌面 WebView 同样需要可读取。
- 下载不发送应用 cookie，不跟随重定向。索引地址必须以 `/index.json` 结尾，不得包含用户名、密码、查询参数或片段；包 URL 由目录地址和摘要生成。

构建本地产品、网页产品或官方桌面时配置：

```dotenv
VITE_TANO_PLUGIN_CATALOG_URL=https://plugins.example.org/tano/index.json
```

这是产品构建配置，变更后需重新启动开发服务器或重新构建。公共本地产品和浏览器演示未配置时显示“社区目录尚未配置”，内置插件与文件导入仍然可用。官方在线工作区默认读取所连接服务的 `/api/plugins/catalog/index.json`；官方桌面默认读取 `https://api.tano.page/api/plugins/catalog/index.json`，可由该构建变量覆盖。自有宿主也可以实现 `PluginCatalogProvider`，通过 `WorkbenchRuntime.plugins.catalog` 注入；公共 HTTP 实现在 `@tano/workbench/plugins/catalog`。

社区目录页提供按名称、插件 ID、发布者搜索，以及版本、源码、许可证、更新说明和权限预览。管理员选择精确版本后，宿主校验完整包，再走原有工作区安装通路；在线工作区会先上传至工作区包存储，再写入共享规则。安装不会自动授予代码执行权限；新摘要需要每个成员在各自设备确认。更新保留已有共享设置、必需/推荐等规则和历史版本，不自动追踪“最新版”。

## 撤回版本

将原条目的 `status` 改为 `withdrawn`，添加 `reason`，更新时间并重新构建发布。其余版本字段保持原样。修复必须增加版本号，不能覆盖原包或将撤回版本重新上架。

客户端在下载前后重新读取目录，拒绝已撤回或已变化的条目；详情中仍保留该版本和撤回原因。撤回阻止通过最新目录安装，不远程删除已安装插件或用户内容，也不是对已授权代码的即时停机机制。原包保留供既有工作区按摘要恢复；工作区管理员可通过共享规则停用插件。

在线工作区的 API Key 代理、OAuth 和本地桌面的系统凭据库见[插件服务连接](plugins.md#服务连接与凭据)，本地桌面另有[公共客户端 OAuth](plugins.md#桌面本地账号连接)和[受控 Git 查询](plugins.md#桌面-git-能力)。在线宿主另提供[后台自动化](plugins.md#云端自动化入口)的隔离执行器、所有者管理入口、Webhook 和可由部署管理员配置的外部唤醒；更多本机能力仍待扩展。目录与包托管本身不运行社区代码。
