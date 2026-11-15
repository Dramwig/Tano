# 辅助窗口原型：共享 JS 的独立窗口

2026-11-14。目标是验证在当前 Tauri 版本（2.11.6，wry 0.55.1）上，能否像 VS Code 的浮动编辑器窗口那样，用 `window.open` 打开一个与主窗口共享 JavaScript 运行环境的原生窗口，并把编辑器直接渲染进去；同时摸清改造成这种架构要踩哪些坑。

原型只在开发版存在，不影响任何正式窗口。实测结果需要在 Windows 上运行后补充到文末“实测记录”。

## 为什么要验证这条路

标签拖出现在会启动一个全新的应用实例：新建 WebView、加载整个前端、重新打开工作区，然后才显示。即使有预热的隐藏备用窗口（见 `detach-tab.ts`），每个独立窗口仍然是一份独立的 Vue 应用和 store，窗口之间靠事件同步状态。

VS Code 的做法是在已经运行的主界面里调用 `window.open`，新窗口和主窗口共用同一个 JS 环境，编辑器的 DOM 直接渲染到新窗口里。打开几乎没有启动成本，也只有一份状态。

## 原理

1. 主窗口的 JS 调用 `window.open('about:blank', name, features)`。
2. WebView2 触发 NewWindowRequested。Tauri 2 的 `WebviewWindowBuilder::on_new_window` 接管这个请求，由我们自己创建一个 Tauri 窗口作为新窗口，并返回 `NewWindowResponse::Create { window }`。
3. 新窗口必须使用和打开者相同的 WebView2 environment，否则会作为无关页面加载，`window.opener` 为 null。`WebviewWindowBuilder::window_features(features)` 在 Windows 上会自动调用 `with_environment(features.opener().environment)`，同时应用请求里的尺寸和位置（已在 tauri 2.11.6 源码中确认）。
4. `about:blank` 继承打开者的源，所以 `window.open` 返回的对象可以直接读写新窗口的 `document`。
5. 把主窗口 `<head>` 里的样式和 `<html>` 上的主题属性复制到新窗口，然后用 Vue 的 `<Teleport>` 把组件渲染进新窗口的 body。组件仍属于主窗口的 Vue 应用，和主窗口共用 store 与响应式状态。

限制：主窗口目前由 `tauri.conf.json` 静态创建，无法挂 `on_new_window`。正式实现需要改为在 Rust `setup` 里用 builder 创建主窗口；原型为此单独开了一个“实验宿主窗口”。

## 原型组成

| 位置 | 作用 |
| --- | --- |
| `crates/tano-native/src/aux_window_lab.rs` | 命令 `aux_window_lab_open`：创建宿主窗口 `auxlab-host`，并用 `on_new_window` + `window_features` 把它的 `window.open` 请求变成 Tauri 窗口 `auxlab-popup-N`（无系统边框）。只在 debug 构建编译。 |
| `crates/tano-native/src/lib.rs` | 在命令路由里注册上述命令（`cfg(all(desktop, debug_assertions))`）。 |
| `apps/client/src-tauri/capabilities/aux-window-lab.json` | `auxlab-*` 窗口的权限。 |
| `apps/client/src/main.ts` | 开发模式下，`index.html?auxLab=host` 进入原型页面，而不是启动工作台。 |
| `packages/workbench/src/aux-window-lab/aux-window.ts` | 可复用的基础能力 `openAuxWindow`：打开窗口、校验同源、持续同步样式和主题属性、处理关闭。 |
| `packages/workbench/src/aux-window-lab/probes.ts` | 运行时探测：跨窗口 `instanceof`、浮层泄漏、全局事件归属、动画帧、Selection 归属、生成报告。 |
| `packages/workbench/src/aux-window-lab/LabHost.vue` | 宿主页面：打开辅助窗口、展示探测结果、手动检查清单、生成 Markdown 报告。 |
| `packages/workbench/src/aux-window-lab/LabPopup.vue` | 被 Teleport 进辅助窗口的内容：自绘标题栏（两种拖动方式）和真实的 `MarkdownEditor`。 |
| `packages/workbench/src/App.vue` | 命令面板里加入“辅助窗口原型（实验）”，只在开发版显示。 |

## 如何运行

1. 在 Windows 上运行 `npm run desktop`（开发版）。
2. 在主窗口打开命令面板，搜索“辅助窗口原型”并执行，会弹出原型宿主窗口。
3. 点击“打开辅助窗口”。新窗口出现后，按页面上的手动检查清单逐项操作，并给每项选“正常”或“异常”。
4. 点击“测试主窗口最小化时的帧率”。宿主窗口会最小化 2 秒再恢复。
5. 点击“生成报告并复制”，把报告粘贴到本文末尾的“实测记录”。

## 检查项和预期

自动探测：

| 项目 | 预期 | 依据 |
| --- | --- | --- |
| `window.open` 返回可用窗口 | 通过，记录打开耗时和到编辑器首帧的耗时 | `on_new_window` 文档 |
| 与主窗口同源、`popup.opener === window` | 通过 | `window_features` 在 Windows 上共享 environment |
| 新窗口是 Tauri 管理的原生窗口（`auxlab-popup-N`） | 通过 | `NewWindowResponse::Create` |
| 弹窗有自己的 Tauri IPC 桥接 | 不确定，要实测 | 新窗口由 Tauri builder 创建，可能注入了初始化脚本 |
| 共享 JS 中 `getCurrentWindow()` 的指向 | 指向宿主而不是弹窗（已知坑） | `getCurrentWindow()` 读的是当前 JS 环境的元数据 |
| 样式和主题变量同步 | 通过 | `openAuxWindow` 的镜像逻辑，已有单元测试 |
| Vue 创建的节点能被主窗口 `instanceof` 识别 | 大概率通过 | Vue 用主窗口的 `document` 创建节点 |
| 弹窗自己创建的节点（输入、粘贴）能被主窗口 `instanceof` 识别 | 大概率失败 | 每个窗口有自己的一套 DOM 类 |
| 浮层没有被插入到主窗口 body | 失败（已知坑） | 编辑器里有 `<Teleport to="body">` |
| 弹窗里的键盘、指针事件到达哪个窗口的全局监听 | 只到弹窗（已知坑） | 事件不跨窗口冒泡 |
| 主窗口最小化时的动画帧 | 主窗口的 `requestAnimationFrame` 停止或降频 | 浏览器会节流隐藏页面 |

手动检查（实测填写）：英文和中文输入法输入、斜杠菜单与浮动工具栏的位置、快捷键、复制粘贴、两种标题栏拖动、窗口按钮、跨显示器缩放、主窗口最小化时的流畅度、关闭主窗口时弹窗是否一起关闭、开发者工具、Alt+Tab 与任务栏表现。

## 已知的坑（静态分析）

下面的数量是 2026-11-14 在 `packages/workbench/src` 和 `packages/editor/src` 中（不含测试）用 grep 粗略统计的，用来估算改造量，不是精确清单。

| 问题 | workbench | editor | 说明 |
| --- | --- | --- | --- |
| `getCurrentWindow()` | 36 处，9 个文件 | 0 | 共享 JS 后永远返回主窗口。最小化/最大化/关闭、标题栏拖动、原生标签拖拽、跨窗口事件都要改成“按界面所在的窗口找原生窗口”。 |
| `window` / `document` 全局监听 | 230 | 47 | 快捷键、点外部关闭菜单、滚动、resize 等都挂在主窗口上，收不到弹窗里的事件。需要按窗口注册，或提供“当前元素所在窗口”的工具函数。 |
| `<Teleport to="body">` | 41 | 2 | 菜单、提示、对话框会出现在主窗口里。需要一个按窗口提供的浮层容器（provide/inject），替换固定的 `body`。 |
| `document.body` 直接引用 | 11 | 3 | 同上。 |
| `instanceof HTMLElement / Node / MouseEvent …` | 72 | 63 | 弹窗原生产生的节点和事件来自另一套 DOM 类，判断会失败。改成 `nodeType` 判断，或用 `node.ownerDocument.defaultView.HTMLElement`。 |
| `requestAnimationFrame` | 29 | 13 | 用的是主窗口的帧循环。主窗口最小化或被遮挡时，弹窗里的动画、光标动效可能卡住。要改成按元素所在窗口取 `requestAnimationFrame`。 |
| `document.activeElement` / `getSelection` / `elementFromPoint` | 115 | 14 | 查询的是主窗口文档。ProseMirror 自身用 `view.root`，问题主要在工作台代码里。 |

平台层面的已知问题（来自 Tauri 仓库的 issue，未在本项目中复现）：

- macOS 上 `window.open('')` 会被拒绝，必须传 `'about:blank'`（[tauri#16425](https://github.com/tauri-apps/tauri/issues/16425)）。原型已经使用 `about:blank`。
- Windows 上点击 `target="_blank"` 链接不会触发 `on_new_window`（[tauri#15872](https://github.com/tauri-apps/tauri/issues/15872)）。对我们的用法影响不大，因为我们主动调用 `window.open`。
- 子 WebView 不能作为 `Create` 的返回值（[tauri#16426](https://github.com/tauri-apps/tauri/issues/16426)）。我们用的是 `WebviewWindow`，不受影响。

生命周期上的差异：辅助窗口依附于主窗口，主窗口关闭时一起关闭（`openAuxWindow` 在主窗口 `pagehide` 时会关闭所有弹窗，VS Code 也是这样）。现在的独立窗口可以在主窗口关闭后单独存在，改造后这个行为会变化。

## 如果实测可行：迁移步骤

1. 主窗口改为在 Rust `setup` 里用 `WebviewWindowBuilder` 创建，挂上 `on_new_window`，按请求创建无边框的 Tauri 窗口。
2. 提供“窗口上下文”：每个辅助窗口通过 provide/inject 提供自己的 `window`、`document`、浮层容器和原生窗口 label。把 `getCurrentWindow()`、`document.body`、全局监听、`requestAnimationFrame` 改为从这个上下文取值，先改标签栏、窗口控制和编辑器周边。
3. 编辑器和工作台里的 `instanceof DOM 类` 改为不依赖 realm 的判断。
4. 标签拖出改为：在主应用里创建一个“窗口分组”（窗格布局的一部分），用 `openAuxWindow` 打开窗口并 Teleport 进去。标签仍在同一个 store 里，不再需要跨窗口迁移和预热窗口。
5. 原生标签拖拽（OLE 拖放、拖拽预览）要按窗口分别处理，这部分需要单独验证。

在这些完成之前，现有的“预热隐藏窗口”方案继续使用。

## 本次已完成的验证

- `openAuxWindow` 的单元测试（`aux-window.test.ts`，jsdom）：样式与主题同步、动态新增/删除/热更新样式、关闭回调、`window.open` 返回 null、不同源时报错、读取弹窗的 Tauri label。在 Linux 虚拟机中单独安装 vitest 4.1.11 + jsdom 29.1.1 运行通过。
- 新增前端代码通过 `vue-tsc` 类型检查。
- Rust 代码没有编译：虚拟机里没有 Rust 工具链。相关 API 已对照 tauri 2.11.6 源码确认（`on_new_window` 无 feature 限制；`window_features` 在 Windows 上设置 environment）。首次 `npm run desktop` 时请留意编译错误。
- 没有在 Windows 上实际运行。

## 实测记录

（在 Windows 上运行原型后，把“生成报告并复制”的内容粘贴到这里。）
