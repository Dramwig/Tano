# 架构

[English](../architecture.md) | 中文 | [日本語](../ja/architecture.md) | [Deutsch](../de/architecture.md) | [文档目录](README.md)

Vue 工作台通过文档 store 使用 `WorkspaceAdapter`。桌面适配器调用由 `tano-native` 实现的 Tauri IPC 命令；浏览器演示使用独立的浏览器存储适配器。`configureWorkbench(pinia, runtime)` 将一个运行时绑定到每个工作台实例。

```text
Vue 工作台 -> 文档 store -> WorkspaceAdapter -> Tauri IPC -> tano-native
```

Markdown 文件是内容的事实源。编辑器与无界面 codec 使用相同的 Markdown schema。编辑器通过 `EditorExtension` 接收宿主功能，使编辑与存储、传输保持分离。

每次保存都对比文件与基线 hash。独立的外部修改可合并；重叠修改则保留双方版本供检查。对不与 Tano 协调的外部进程，最后一次 hash 检查与原子替换之间仍有很短的竞争窗口。

工作区身份与文件路径无关。工作区 UUID、文件短 ID 和 ID 占号随 `.tano/identities.json` 携带。对象、关系和规则也保存在 `.tano/`；SQLite 索引、草稿及恢复状态位于工作区外的应用数据中。Tano 不会跟随指向选定工作区外部的符号链接。

## 计划事件

计划侧栏与日历共用选中日期，展示当天的任务与日程，以及未安排的任务。新任务和日历条目统一使用 `.tano/objects/` 中的 `event` 对象，其可选属性为：

- `checkable`：是否需要完成；`completed` 记录完成状态。
- `date`：仅安排日期，使用本地 `YYYY-MM-DD` 格式。
- `start`、`end`：成对的带时区时间戳。具有时间段的事件显示在日历中，也可以同时需要勾选完成。

`date` 与 `start`/`end` 二选一。需要完成、但没有日期或时间段的事件进入「未安排」。勾选完成或安排日期都通过原有基线 hash 合并机制更新同一个对象。截止日期与计划执行日期分别表达。Markdown 待办仍保留在原文档中，不复制为事件记录。

已有 `task` 文件保留原 ID 和引用地址，仍可读取和编辑，并兼容展示在计划侧栏中。工作台新建的任务统一保存为 `event`，创建表单不再提供单独的任务对象类型。
