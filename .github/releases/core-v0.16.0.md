# Tano Core 0.16.0

2026-11-26 · 仅共享 Core / Shared Core only

- 插件中心新增开发者区。非移动平台均可启用开发者模式，宿主可通过 `plugin-customize`、`plugin-forge` 和 `plugin-publishing` 插槽扩展开发者工具。
- 拆分日历、工作台窗格、应用外壳和快捷键调度，使用 5 个窄作用域的注入上下文。工作区 Store 依赖保持无环，插件 RPC 按域路由。
- 移除 `@tano/workbench` 的 `"./*"` 通配导出。宿主须改用显式声明的子路径，边界守卫会检查子路径导出和 Store 依赖图。
- 统一各语言实现对工作区便携数据路径的识别。MCP 加载插件对象的 schema，插件清单和对象协议增加了兼容性校验。

## English

- The Plugin Center includes a developer area. Developer mode is available on non-mobile platforms, and hosts can extend its tools through the `plugin-customize`, `plugin-forge`, and `plugin-publishing` slots.
- Calendar, workbench panes, app shell, and shortcut dispatch are split into smaller modules with five narrow injection contexts. Workspace store dependencies are acyclic, and plugin RPC is routed by domain.
- `@tano/workbench` removes its `"./*"` wildcard export. Hosts must use explicitly exported subpaths. Boundary checks enforce the declared exports and acyclic store dependencies.
- Workspace data path classification is aligned across protocol implementations. MCP loads plugin object schemas, and plugin manifests and objects receive stricter protocol validation.
