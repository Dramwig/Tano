# Word 文档预览

默认安装并启用的系统插件，仅申请 `attachments.read` 与 `ui` 权限。
从文件树打开 DOC/DOCX，或使用面包屑右侧“…”菜单选择本机文件。
离线解析、渲染，不调用本机 Word，不上传文件，不改写原件。

DOCX 由 Apache-2.0 的 `@file-viewer/docx@0.3.39` 直接渲染，保留纸张、
分节、页边距、页眉页脚、段落/字符样式、编号、表格、图片和受支持的浮动对象。
连续页面支持滚动、翻页、Home/End、缩放与适应宽度。
缺失字体和复杂兼容模式可能使布局与 Microsoft Word 不同。

DOC 由 MIT 的 `@file-viewer/doc@3.3.3` 解析二进制格式，保留文字、段落、
表格与内嵌图片的受支持样式。插件从 MS-DOC 的 PlcfSed/SEPX 读取首节纸张
和页边距。当前旧格式引擎不还原完整分页、多节布局及页眉页脚；这些限制在
“预览说明与许可”中可见，不能把此兼容路径描述为 Word 完全一致的打印预览。

插件运行在不透明 iframe 中，无网络和宿主 DOM 权限。DOCX 禁用外部资源、
外链和 HTML altChunk。文件上限 50 MiB；ZIP 展开限制为 2000 项、单项 20 MiB、
总计 100 MiB，拒绝不安全路径和 XML DTD。渲染页面上限 1000。
换文件时撤销旧渲染结果，移除对应 DOM 与布局观察器。

构建：`npm run plugin:word`。第三方完整许可随插件打包，可在弹层中查看。
浏览器验收：`npx playwright test word-browser.spec.mjs`。

引擎来源：
- [DOCX](https://github.com/flyfish-dev/docxjs)
- [MS-DOC](https://github.com/flyfish-dev/file-viewer/tree/main/packages/renderers/doc)
- [MS-DOC 分节规范](https://learn.microsoft.com/en-us/openspecs/office_file_formats/ms-doc/6777a859-d537-486b-96c7-fb0c959a5bf9)
