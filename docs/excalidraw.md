# Excalidraw 插件

同页复用 [Excalidraw 官方 React 组件](https://github.com/excalidraw/excalidraw/tree/master/packages/excalidraw)，当前固定为 `@excalidraw/excalidraw@0.18.1`。矩形、椭圆、箭头、文字、自由绘画、橡皮、撤销、缩放和平移均由官方组件提供；同页负责插件入口与工作区文档读写。

## 使用

1. 在插件中心找到 **Excalidraw** 并安装。
2. 在详情中选择「授权此版本运行」。安装与代码授权仍是两个独立步骤。
3. 在命令中心执行「Excalidraw：新建白板」，或从插件工作台打开「Excalidraw 白板」。
4. 已启用且获授权时，从文件树打开 `.excalidraw.md` 文档会进入官方画布。停用插件后仍可直接读取 Markdown。

绘图更改在停止操作后自动保存，也可点击「保存」。切换白板前会先保存当前更改。菜单、工具和键盘操作沿用官方组件；顶部文件操作用于选择、新建、导入和导出工作区白板。

「导入」接受官网导出的 `.excalidraw`、JSON 文件和带 Drawing 数据段的 `.excalidraw.md`，并创建独立的工作区白板。支持 Obsidian 的普通 `json` 与 LZ-string Base64 `compressed-json`；修改现有压缩文档保留其编码及 Drawing 段之外的文字。可导出标准 `.excalidraw` 文件与 PNG。

新文件是工作区根目录中的普通 Markdown 文档，含 `excalidraw-plugin` frontmatter、`# Excalidraw Data` 与 `## Drawing`。内容以 Markdown 为准，不保存在插件本机状态中。本机状态仅记录最近打开的文档 ID。文档改名依旧使用稳定 ID 打开。

保存使用打开或上次成功保存时的基线摘要。外部修改走宿主已有的比较与合并：重叠修改保留冲突副本并显示路径；保存失败保留当前画布，用户可以先导出再重新打开工作区版本。

## 当前边界

- 为遵守现有插件文档与消息资源限制，单个场景最多 240 KiB、2000 个元素。超限会明确提示，当前画布仍可导出；包含较大图片的场景可能达到上限。
- 插件的官方界面、脚本和常用字体随应用离线提供，中文使用系统字体。没有外部联网权限；官网的在线协作、在线素材库与 Obsidian 专属脚本、Wiki 链接和外部附件解析没有移植。
- Obsidian 场景中内嵌的图片数据随场景保留；通过 Obsidian 专属路径引用的外部图片需要先从原应用导出为标准 Excalidraw 文件。
- 浏览器演示的数据仅保存在本浏览器；桌面工作区通过原有文件系统适配器保存。

## 开发与许可证

```powershell
npm run plugin:excalidraw
npm run typecheck:plugins
npx vitest run scripts/plugin-excalidraw.test.ts scripts/plugin-excalidraw-model.test.ts
```

源码位于 `examples/plugins/excalidraw/`。专用构建脚本将固定版本官方依赖、中文语言包和字体打进隔离界面，并使用 gzip 和浏览器 `DecompressionStream` 在本地加载，使最终 JSON 插件包保持在现有 4 MiB 限额内。生成的 `packages/workbench/src/plugins/excalidraw/bundle.tano-plugin.json` 是应用离线安装源，插件中心只在用户安装时加载它；修改插件源码后需重新生成。共享工作台只携带安装包与清单，不直接依赖 React 或绘图库。

同页适配代码和官方 Excalidraw 使用 MIT。参考 [Obsidian 插件](https://github.com/zsviczian/obsidian-excalidraw-plugin) 的宿主集成方式及文件格式，没有移植其 AGPL 插件代码。上游字体继续遵守各自的 OFL/MIT 等许可；完整通知位于插件的 `UPSTREAM_LICENSES.txt`、生成的 `THIRD_PARTY_NOTICES.txt` 和界面「开源许可」。

自定义界面继续运行在双层不透明来源 iframe 中。为用户主动导出文件，界面 sandbox 允许下载；网络、宿主存储、Tauri IPC 和外部页面导航限制保持有效，固定启动代码及桌面 CSP 摘要同步更新。
