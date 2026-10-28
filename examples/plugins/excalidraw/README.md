# Excalidraw

使用官方 `@excalidraw/excalidraw@0.18.1` React 组件的同页插件。绘图工具由上游提供，`main.ts` 与 `model.ts` 只负责工作区文档、保存基线和消息传输。

在仓库根目录执行：

```powershell
npm run plugin:excalidraw
npm run typecheck:plugins
npx vitest run scripts/plugin-excalidraw.test.ts scripts/plugin-excalidraw-model.test.ts
```

此插件需要专用构建命令提供离线字体、中文语言包和压缩的官方组件，不使用通用 `plugin pack`。构建结果位于 `packages/workbench/src/plugins/excalidraw/bundle.tano-plugin.json`，通过插件中心按需加载，也可手动导入。源码更改后需重新生成安装包，并按新摘要重新授权。

使用、文件格式、资源限制和许可证说明见 [Excalidraw 插件文档](../../../docs/excalidraw.md)。
