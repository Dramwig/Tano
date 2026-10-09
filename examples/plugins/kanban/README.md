# Vue 任务看板插件

此示例使用 Vue 的预编译运行时、HTML 拖拽和可用键盘操作的状态菜单。Worker 通过 Tano SDK 读写工作区 `event` 对象；卡片不是本机缓存中的另一份任务数据。

在 Tano 仓库安装依赖后，从仓库根目录执行：

```powershell
npm run plugin -- pack examples/plugins/kanban artifacts/kanban.tano-plugin.json
npm run plugin -- verify artifacts/kanban.tano-plugin.json
```

在插件中心导入生成的 JSON，查看权限并授权，随后通过「插件工作台 → 任务看板」打开。创建任务、拖拽换列或用状态下拉框移动，再刷新页面，状态仍从工作区对象读取。

- `manifest.json` 声明 `objects.read`、`objects.write` 和 `ui` 权限。
- `main.ts` 是 Worker 入口，读取基线摘要后再更新对象，冲突处理由宿主负责。
- `ui/board.ts` 是 Vue 界面入口，只能通过消息请求 Worker 操作。
- `ui/style.css` 随脚本打包，样式不影响宿主页面。

示例显示最多 100 项未归档事件任务，不直接支持旧版 `task` 类型。已完成状态使用 `completed` 属性，中间列保存在 `kanbanLane` 属性。关闭插件不会删除任务；存在交付审阅要求的任务仍遵守宿主的完成校验。

独立开发插件时，应在自己的项目中安装 Vue 和 SDK 类型依赖。也可以将界面改成 React、其他浏览器组件库或原生 DOM；所有运行代码须随包提供。完整协议见[插件开发文档](../../../docs/plugins.md)。
