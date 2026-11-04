# 潮汐主题

声明式主题验收样例，包含独立的配色与图标主题。MIT License；图标路径为原创。

```sh
npm run plugin -- pack examples/plugins/theme-tide
npm run plugin -- verify examples/plugins/theme-tide/theme-tide-1.0.0.tano-plugin.json
```

从插件中心导入生成文件，再在设置 → 外观中分别选择配色与图标。
安装不会自动改变外观。白天、黑夜与跟随系统独立于主题选择。

契约、生命周期和验收说明见 [主题插件](../../../docs/theme-plugins.md)。

在「设置 → 外观 → 主题预设」点击「应用预设」即可一键应用。整套预设「潮汐卡片岛」同时应用潮汐配色、潮汐图标与卡片岛布局。之后仍可分别调整配色、布局和图标。

配色仅含颜色，字体/圆角/密度/阴影由独立形态槽位控制。预设省略项保持当前，外观默认继承用户设置，可开启工作区覆盖。
