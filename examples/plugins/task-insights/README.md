# 任务统计：React 与 Chart.js 插件

这是可安装的只读任务统计插件。独立 Worker 通过 SDK 分页读取工作区对象，隔离界面用 React 渲染筛选表单和任务预览，用 Chart.js 绘制可点击的柱形图。React、React DOM、Chart.js、CSS 和许可声明全部随包提供，无需 CDN 或网络权限。

在 Tano 公共核心仓库运行：

```sh
npm install
npm run typecheck:plugins
npm run plugin -- pack examples/plugins/task-insights artifacts/task-insights.tano-plugin.json
```

在网页演示或桌面本地工作区的「插件」中导入生成的 JSON 包，检查并授权当前版本，再从「插件工作台」打开「任务统计」。在线产品也使用同一 SDK 和包格式，需由工作区管理员导入并启用。任务内容保留在 `.tano/objects/` 中，插件只申请 `objects.read` 和 `ui`。

## 使用与统计口径

- 搜索匹配任务名称或描述，默认排除已归档任务，可勾选「包含归档任务」。修改条件后点击「应用筛选」。
- 只统计 `event` 类型且 `checkable: true` 的对象；已完成为 `completed: true`，进行中为未完成且 `kanbanLane: doing`，其余为待办，与任务看板示例一致。
- 每页读取 50 项，每次最多读取 1,000 项或 40 页。达到上限时明确显示「部分统计」；匹配总数与已统计数量分别展示，未读取的任务不计入图表。分页失效时显示错误，可刷新重试。
- 每种状态预览按名称排序的前 20 项。点击柱形或上方状态按钮筛选预览；状态按钮支持键盘。图表同时提供无障碍文字，预览使用普通表格。
- 工作区任务变更后自动刷新；短时间内多个变更会合并。正在进行的旧筛选不会覆盖新筛选结果。筛选条件驻留当前插件实例，关闭并重开标签页保留，重载插件或切换工作区后重置。

## 开发与验收

`main.ts` 负责 SDK 和事件，`model.ts` 负责分页汇总，`ui/dashboard.tsx` 只接收 JSON 并发送筛选请求。只有 Worker 能调用工作区 SDK；界面不能直接读取宿主状态或凭据。导入 `.txt` 会将文本纳入 UI 包，示例借此展示完整的第三方许可。

图表组件卸载时调用 [Chart.js `destroy`](https://www.chartjs.org/docs/latest/developers/api.html#destroy)，页面退出时调用 [React `root.unmount`](https://react.dev/reference/react-dom/client/createRoot#root-unmount)，同时释放状态订阅。宿主在停用插件、关闭视图或切换工作区时销毁对应隔离页面；停用或切换也终止 Worker。

本仓库把 React、Chart.js 和类型包作为开发依赖，锁定在根 `package-lock.json`，不向宿主工作台注入 React。独立开发时在自己的项目安装这些依赖及 SDK 类型，并保留 [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt)；升级依赖时同步其中版本和许可。插件 SDK 与打包方式见[插件开发文档](../../../docs/plugins.md)。

```sh
npx vitest run scripts/plugin-task-insights.test.ts scripts/plugin-task-insights-package.test.mjs
npm run test:plugins:browser -- --grep "packaged React chart"
npm run test:plugins:native
```

浏览器与原生验收复用同一套步骤：安装真实包，分页统计 108 项任务，检查 Canvas 绘制、鼠标和键盘筛选、任务修改后的刷新、归档筛选、空结果、关闭重开及停用清理。原生验收使用临时工作区和实际文件适配器；截图保存在 `artifacts/plugin-react-browser.png` 与 `artifacts/plugin-react-native.png`。
