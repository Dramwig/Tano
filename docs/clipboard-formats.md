# 平台复制格式

可视化编辑器在“复制为”菜单中提供通用富文本、微信公众号和知乎三个目标。目标偏好也用于 Ctrl+C 和剪切；转换只处理选区的静态副本，不修改 Markdown。

## 公式

- 富文本（Word / WPS）：Presentation MathML。
- 微信公众号：MathJax 在本地生成独立 SVG 路径，不依赖编辑器 CSS、字体文件、外部字形引用或图片服务。行内公式使用 span 保留基线，独占公式使用居中的 section。
- 知乎：`img.Formula-image[data-eeimg="true"]`，LaTeX 放在 `alt`。未带 `\tag` 的独占公式以 `\\` 标记结束。没有 `src`，由目标编辑器解析；空 `src` 会被浏览器的 Clipboard API 改写成当前页面地址。

公众号公式转换失败时报告错误，不静默降级，也不执行剪切删除。每个公式使用独立的 TeX 上下文，宏定义和编号不会跨复制操作传播。

## 兼容性依据与验证

研究参考：[mdnice 平台转换入口](https://github.com/mdnice/markdown-nice/blob/master/src/utils/converter.js)。仅参考平台识别标记和输出结构，转换代码在 Tano 中独立实现；不引入 mdnice 的 GPL 代码。SVG 渲染使用 Apache-2.0 的 MathJax，许可证随第三方声明提供。

回归测试覆盖美元和 LaTeX 定界符、行内与独占公式、编号公式、分数、矩阵、无效公式剪切保护，以及既有 Word / WPS 和 TSV 行为。真实 Chromium 剪贴板回读另确认 SVG 路径、知乎类名、公式数据和独占标记未被过滤。

平台编辑器可能改变粘贴规则。浏览器剪贴板验证不能替代微信公众号、知乎在线编辑器中的实际粘贴验收；目前未自动操作用户账号中的草稿。
