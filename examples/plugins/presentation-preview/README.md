# 演示文稿预览

这是随 Tano 默认安装并启用的系统插件。PPT/PPTX 在浏览器内直接解析并渲染为 SVG，
无需 Office、转换服务或上传文件。依赖的渲染引擎为 MIT 许可的 `@web-ppt/core`。

- 无需安装或单独授权；在文件树打开 PPT/PPTX 即进入预览。
- 可在插件中心停用，设备偏好会保留；不能卸载或导入替换，版本随应用更新。
- 插件的“打开 PPT/PPTX”按钮也可读取本机文件，不写入工作区。
- 权限仅为 `attachments.read`、`ui`；没有联网或本机命令权限。
- 预览保留源坐标和页面比例；提供分页、缩放和适应宽度。
- 静态预览不播放动画/视频。字体缺失、复杂对象或引擎未覆盖的格式仍可能产生差异。

构建：`npm run plugin:presentation`。生成的插件包在
`packages/workbench/src/plugins/presentation-preview/bundle.tano-plugin.json`，
由应用作为系统插件加载，不通过导入更新。文件名显示在面包屑中，翻页和页码位于同一行右侧；打开文件、缩放、适应宽度和第三方许可收进右侧“…”菜单。
