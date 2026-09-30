# 日历与 Todo 同步

[文档目录](README.md) | [架构](architecture.md)

在计划侧栏的范围菜单中打开「日历同步与导入」或「Todo 同步与导入」。两个类别分别管理连接、目标空间、自动同步开关、同步时间与冲突，不增加第二个计划范围选择器。

## 接入方式

| 类别 | 来源 | 认证方式 |
| --- | --- | --- |
| 日历 | Google 日历 | 系统浏览器 OAuth，授权 Calendar API |
| 日历 | iCloud | Apple 账号 + App 专用密码，通过 CalDAV |
| 日历 | 飞书 | 飞书日历设置生成的 CalDAV 服务器、用户名和密码 |
| 日历 / Todo | CalDAV | HTTPS 服务器与应用密码；Todo 要求服务器明确支持 VTODO |
| Todo | Todoist | API Token，使用统一 API v1 |
| Todo | Microsoft To Do | 系统浏览器 OAuth，授权 Microsoft Graph Tasks.ReadWrite |
| 日历 / Todo | `.ics` 文件 | 无需账号，分别读取 VEVENT / VTODO |

账号同步使用桌面原生网络层，浏览器演示和移动端当前仅开放文件导入。浏览器演示的导入内容只保存在本浏览器。

### OAuth 应用配置

当前仓库没有预置生产 OAuth 应用。发布者需要注册自己的应用，也可以在连接表单中填写开发用应用配置：

- Google：启用 Calendar API，创建 **Desktop app** OAuth 客户端，填写 Client ID 和提供的 Client Secret。开发阶段将测试账号加入授权测试用户。回调监听临时端口的 `http://127.0.0.1:<port>/`。
- Microsoft：注册支持所需组织账号 / 个人 Microsoft 账号的公共客户端，添加 **Mobile and desktop applications** 回调 `http://localhost`，授予委派权限 `Tasks.ReadWrite`。不需要客户端密钥。
- 构建时可用 `VITE_GOOGLE_CALENDAR_CLIENT_ID` 和 `VITE_MICROSOFT_TODO_CLIENT_ID` 预填公开 Client ID。访问令牌、刷新令牌和密码不放在 Vite 环境变量或工作区文件中。

授权使用系统浏览器、随机 state、PKCE S256 和本机回调，等待超时为三分钟。令牌刷新在原生层进行。iCloud 需要开启双重认证并生成 App 专用密码；飞书可能需要组织管理员先启用第三方日历同步。

## 同步行为

连接后先选择远端日历或任务清单，再选择保存到「个人」或「当前工作区」。默认双向同步已连接的事项；可改为只接收更新。只读日历自动使用接收模式。

「同时上传此范围内尚未连接的事项」默认关闭。打开后，首次同步也会上传该范围内符合类别的已有事项；后续新事项在同步时上传。日历连接处理不需勾选完成的事件，Todo 连接处理需要完成的事件和兼容任务，避免同一条任务被两个类别重复发布。

Todo 交换标题、说明、截止日期和完成状态。远端截止日期保存在 `properties.due`，与 Tano 的 `date` / `start` / `end` 计划安排分开，更新任务不会清掉本地安排的时间段。

Todoist 当前映射 `due.date` 的日期部分，不改写独立的 `deadline` 字段。首次连接拉取未完成任务；已连接任务后续的完成 / 重新打开状态继续同步，不回溯导入历史已完成清单。更新只发送变化字段；只改标题或完成状态时，保留远端日期的原有时间和时区。

自动同步在应用打开、窗口可见时检查，以五分钟间隔逐个运行；也可点击「立即同步」。关闭应用后没有后台常驻同步或 webhook。工作区连接只在对应工作区打开且可写时运行，切换工作区不会把内容写到另一个空间。

当前使用完整分页拉取，不依赖本地增量令牌。Google 日历的读取窗口为过去一年至未来两年；CalDAV 读取资源后，在同一窗口内展开重复日程。重复系列及实例只读，应在来源应用编辑。文件导入也会提示展开窗口。

## 文件导入

导入前显示事项预览，可选择条目和保存空间。支持中文、折行文本、带 VTIMEZONE 的时区、UTC / 浮动时间、全天日程及重复规则展开。未知时区、缺少 UID、无效日期等项目列入提示，不能静默按另一个时区导入。

同一类别的 UID（重复实例包含 occurrence ID）用于去重，重新导入会跳过已有条目，不覆盖本地修改。一次最多 5 MB、5000 条。导入是本地快照，不保存账号，也不建立持续同步。

## 冲突、删除与重试

- 同步基线对比本地和远端字段，合并互不重叠的修改。日期、开始和结束视为同一安排，不能拼出无效时间段。
- 双方修改同一内容时，连接列表显示双方内容。选择接收远端前，会把当前本地版本保存为独立冲突副本；这些副本不自动再次上传。
- Google 和 CalDAV 使用 ETag / If-Match；CalDAV 新建使用 If-None-Match。Todoist、Microsoft To Do 写前重新检查远端版本，仅使用服务支持的条件写入。对不提供原子条件写入的服务，最后一次检查到更新之间仍存在服务端竞争窗口。
- Google 和 CalDAV 使用稳定创建 ID，Todoist 使用 X-Request-Id；上传意图先落盘。Microsoft 创建请求结果未知时暂停自动重试，避免盲目重复创建。此情况需到来源应用确认；当前没有自动匹配未知创建结果的恢复向导。
- 远端列表缺少某条记录可能是日期范围或权限变化，不推断为删除。本地归档不自动永久删除另一端内容；Todo 归档不会向服务发送删除请求。远端明确返回取消状态的日历事件会在本地归档。
- 暂停不会删除内容。断开连接保留本地事项；工作区连接需打开目标工作区后断开。移除账号前先断开其连接，移除设备凭据不等于在服务端撤销 OAuth 授权。

## 存储与验证边界

事项仍然使用个人 / 工作区的 `.tano/objects/` 文件。账号配置、远端版本、同步基线和待确认上传位于应用数据目录的 `planning-connections.json`、`planning-sync.json`。系统凭据库保存密码与令牌；Windows 长令牌拆为多段，并通过一个 generation manifest 提交，绕开单条凭据大小上限。任何凭据都不写入工作区。

自动化测试覆盖格式解析、去重、分页、条件更新、双向编辑、完成状态、读写隔离、同步开关独立性、冲突和不确定创建重试。界面端到端测试使用模拟原生 IPC / 服务响应；没有连接真实账号。正式发布前仍需分别用真实 Google、Apple、飞书、CalDAV、Todoist、Microsoft 账号检查授权、服务权限、配额与服务端差异。

官方资料：[Google 桌面 OAuth](https://developers.google.com/identity/protocols/oauth2/native-app)、[Google 日历 API](https://developers.google.com/workspace/calendar/api/guides/overview)、[Apple App 专用密码](https://support.apple.com/102654)、[飞书第三方日历](https://www.feishu.cn/hc/zh-CN/articles/079695875192-%E7%AC%AC%E4%B8%89%E6%96%B9%E6%97%A5%E5%8E%86%E5%90%8C%E6%AD%A5-%E7%AE%A1%E7%90%86%E5%91%98%E6%89%8B%E5%86%8C)、[CalDAV RFC 4791](https://www.rfc-editor.org/rfc/rfc4791)、[Todoist API](https://developer.todoist.com/api/v1/)、[Microsoft To Do API](https://learn.microsoft.com/en-us/graph/api/resources/todo-overview?view=graph-rest-1.0)。
