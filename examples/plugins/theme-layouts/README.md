# 页面风格集

MIT License。纯声明式布局插件，无脚本、配色或图标依赖。

```sh
npm run plugin -- pack examples/plugins/theme-layouts
npm run plugin -- verify examples/plugins/theme-layouts/theme-layouts-1.0.0.tano-plugin.json
```

导入后在「设置 → 外观 → 布局风格」选择宽松卡片岛或窄版纸感。
内置的卡片岛和纸感布局无需导入即可使用；本例展示插件如何指定结构、材质、间距及纸张宽度。
配色与图标单独选择，停用/卸载布局插件只回退布局。参见 [主题契约](../../../docs/theme-plugins.md)。

在「设置 → 外观 → 主题预设」点击「应用预设」即可一键应用。两套布局均提供部分预设，只改变布局，保留当前配色、图标和形态。之后仍可分别调整配色、布局和图标。

配色仅含颜色，字体/圆角/密度/阴影由独立形态槽位控制。预设省略项保持当前，外观默认继承用户设置，可开启工作区覆盖。
