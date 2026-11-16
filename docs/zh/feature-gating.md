# 功能开关

注册表初始为空，由负责人判断功能状态。在 `packages/workbench/src/features.ts` 登记字面量键、`status` 和一句话 `note`，从 `@tano/workbench/features` 导入。

状态只有 `dev`（未完成）和 `stable`（已上线）。构建通道只有 dev 和 stable：`import.meta.env.DEV` 为真或 `VITE_TANO_CHANNEL=dev` 时为 dev，其余为 stable。生产构建不设变量必须为 stable。stable 功能始终开启，dev 功能仅在 dev 通道开启。未知 ID 抛错；纯函数可注入注册表测试。无需从产物移除代码。不提供远程开关、按用户或比例放量或实验设置入口。

## 全入口检查清单

- 侧栏切换器和视图注册：`use-workbench.ts` 的 `sidebarNavigationItems`、`store.registerViews`。
- 命令面板命令、快捷键。
- 设置页分区、新建标签选择器 `NewTabPicker.vue`。
- 右键菜单、搜索结果、帮助清单与帮助内容。
- 助手工具、MCP 工具。
- 插件目录内置项。
- 路由与深链，包含直接访问。

关闭时不渲染、不注册命令和工具、不出现在搜索和帮助中；直接访问须在副作用发生前拒绝。仅隐藏按钮不够。

## 数据与流程

关闭的功能写入的数据在 stable 下应被忽略，不能报错或覆盖数据。dev 功能不得向 `.tano/` 写入新的持久化格式；需要时先改为 stable 再发布。

1. 新增未完成功能先登记 dev，使用字面量 `isFeatureEnabled('id')`。
2. 按全入口清单审查，并验证 stable 下既有数据兼容。
3. 运行 `npm run features:check`（已纳入 check）：检查未知 ID、未使用开关和发布配置中的 dev 通道，列出未完成功能。release prepare 将清单写入说明草稿。脚本不能证明所有入口均有保护，仍需审查。
4. 上线改为 stable，稳定一个版本后同时删除开关和登记项。

Vite 在消费方按源码转换 `import.meta.env`，包括排除依赖预构建的 workbench。生产禁止设置 `VITE_TANO_CHANNEL=dev`；服务端显式选择通道，不能根据 Node 默认环境猜测。
