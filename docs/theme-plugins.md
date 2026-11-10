# 主题插件与样式契约 v2

配色、文件图标、布局风格与形态密度使用四个独立槽位，入口为「设置 → 外观」。「显示模式」根据当前配色主题支持的模式提供选项。
安装只增加可选项，不替用户选中主题。每个主题的完整 ID 是 `插件ID:主题ID`。
「设置 → 外观 → 主题预设」提供一键组合，未声明的槽位保持当前，应用后仍可分别调整。

## 声明与打包

纯主题使用声明式 `manifestVersion: 1`，不需要 `main.ts`、运行授权或 `ui` 权限。
可执行 v2 插件也可声明相同的 `appearance`；其主题只在该版本已授权且启用时可用。

```json
{
  "manifestVersion": 1,
  "id": "theme-example",
  "name": "示例主题",
  "version": "1.0.0",
  "description": "浅色与深色配色",
  "objectTypes": [],
  "relationTypes": [],
  "appearance": {
    "version": 2,
    "colors": [{
      "id": "paper",
      "label": "纸页",
      "light": { "paper": "#fff8e8", "text": "#352a20" },
      "dark": { "paper": "#251e16", "text": "#f4ead8" }
    }]
  }
}
```

`colors`、`icons`、`layouts`、`shapes` 和 `presets` 至少提供一个非空列表，每类最多 12 套。每个配色主题至少声明 `light` 或 `dark` 中的一项；
未提供的变量使用内置模式默认值，切换时移除上个主题的覆盖。未知契约版本、字段、重复 ID、
无效图标引用、超限数据都会在导入时拒绝。

| 配色声明 | 显示行为 | 设置中的「显示模式」 |
| --- | --- | --- |
| 同时提供 `light`、`dark` | 按用户偏好或系统外观切换 | 可选「浅色」「深色」「跟随系统」 |
| 只提供 `light` | 固定浅色，不受系统外观变化影响 | 仅显示「浅色」，选择框禁用 |
| 只提供 `dark` | 固定深色，不受系统外观变化影响 | 仅显示「深色」，选择框禁用 |

例如 `{ "id": "night", "label": "夜色", "dark": { "paper": "#17202a", "text": "#f0f4f8" } }` 是只支持深色的配色主题。
省略一个模式表示不支持该模式；显式提供 `light: {}` 或 `dark: {}` 则表示支持该模式、继承对应内置配色。
两项均缺失或声明为 `null` 都会被拒绝，不会自动补齐缺失模式。预设预览优先使用浅色配色，只支持深色时使用深色配色。

```sh
npm run plugin -- pack examples/plugins/theme-paper
npm run plugin -- verify examples/plugins/theme-paper/theme-paper-1.0.0.tano-plugin.json
```

生成的 `.tano-plugin.json` 可从插件中心导入。现有版本的宿主会拒绝未知 `appearance` 字段；
主题包需要支持本契约的 Core，不能假设旧宿主会忽略新字段。

## 形态与密度

配色的 light/dark 仅接受颜色 token。圆角、控件间距与阴影在独立的 shapes 中声明：

```json
"shapes": [{
  "id": "print", "label": "纸页排印",
  "tokens": { "radius-card": "2px", "space-panel": "20px", "overlay-shadow": "none" }
}]
```

内置形态包括同页默认、圆润宽松、柔和圆角、微圆角、直角紧凑。
柔和圆角、微圆角保留原有 `builtin:handwritten`、`builtin:print` ID，以兼容已保存选择和预设引用。
布局负责区域分块、纸张材质与结构间距；组件圆角、控件间距及浮层阴影引用形态 token。
纸感布局的纸纹与居中标题属于布局材质。字体统一在「编辑字体与字号」中选择，系统字体始终使用系统字体栈；手写字体也在此单独选择。
旧版 v2 主题包的 `font-ui`、`font-prose`、`font-mono` 仍通过协议校验，但宿主不再应用这些形态字体 token，切换形态或主题预设不会改变字体。
因此可以同时选择纸页颜色、系统字体和卡片岛布局，也可以让卡片岛使用直角紧凑形态。

## 主题预设

在 appearance 中增加 presets，例如仅改变颜色和结构：

```json
"presets": [{
  "id": "writing", "label": "纸页文稿",
  "color": "paper", "layout": "builtin:paper"
}]
```

color、icons、layout、shape 均可选，至少声明一项；省略表示不改动，显式 builtin:tano 表示重置该槽位。
引用本插件的贡献时使用本地 ID，不加插件前缀。不允许跨插件引用。
协议校验 builtin: 后的 ID 格式，不内置名单；宿主在注册目录中解析引用，不支持的内置项会禁用整套预设，不会部分应用。
设置卡片会列出缺少项的类别和完整 ID，并提示安装或更新宿主，例如「缺少形态与密度 builtin:new-shape；请安装或更新宿主」。
当前内置布局为 builtin:islands、builtin:paper，形态为 builtin:rounded、builtin:handwritten、builtin:print、builtin:crisp。
内置 ID 从清单、设置消息到存储保持一致。
除同页默认外，两个内置预设各自搭配宿主自带的配色：卡片岛使用 `builtin:mist`（雾岛，冷灰蓝桌面与白色卡片），
纸感使用 `builtin:ink`（纸墨，暖沙色桌面、米白纸页与墨蓝强调）。另有不绑定预设的 `builtin:sage`（护眼绿，柔和豆沙绿纸面、非纯黑文字与深叶绿强调，减少大面积亮白和蓝色）。它们定义在 `builtin-colors.ts`，同样出现在「配色主题」列表中，可与任何布局混搭；
`AppearanceBuiltins.colors` 可选，注入目录时不提供即无内置配色。
内置布局、形态与预设共同定义在宿主的 `builtinAppearance` 目录中；预设显式声明推荐槽位，不根据 `structure` 推断形态。
构造 `AppearanceController` 时可注入完整目录，主题预设和布局下拉选项均使用该目录。新增布局不会自动生成或绑定预设。

「应用预设」一次合并、保存并应用已声明的槽位，不改写用户保存的显示模式偏好或显式编辑字体。
选中单模式配色时按其支持的模式显示；切回双模式配色后恢复保存的浅色、深色或跟随系统偏好。
卡片展示预览、名称、配色色点和应用状态，不逐项罗列槽位配置；未声明的槽位仍保持当前选择。所有声明项匹配当前选择且可用时显示「已应用」；多个匹配优先显示声明项最多的一套，同数量按列表顺序。
保存具体选择，不保存绑定：更新预设不会改动用户搭配。停用插件时只回退不可用槽位，重新启用恢复保存选择。

## 用户默认与工作区覆盖

四个槽位默认存为当前设备当前用户的默认值，所有工作区继承。
「为此工作区单独设置」开启时只复制当前四个槽位，后续槽位编辑仅影响此工作区；关闭时恢复用户默认，默认槽位不会被覆盖。
显示模式偏好只保存在用户级。开启覆盖后，在双模式主题中切换模式仍会修改用户偏好；工作区覆盖记录不含 `mode`。
实际显示由当前配色主题约束：单模式主题固定浅色或深色，但不改写用户偏好；切换工作区或回退到双模式主题时继续使用该偏好。
用户默认键为 `tano.appearance.v2.<principal>.user`，覆盖键为 `tano.appearance.v2.<principal>.workspace.<workspace>`。
这些数据只在应用存储，不写入工作区 Markdown 或 .tano 配置。其他窗口的 storage 变更会刷新用户模式和继承槽位，保留工作区覆盖槽位。

插件的安装/授权仍按工作区管理：继承到尚未安装或未启用插件的工作区时，该槽位临时回退默认，安装启用后恢复。不会跨工作区自动安装或授权插件。

## 稳定变量

颜色 token 用于 colors.light/dark，形态 token 用于 shapes.tokens。完整白名单与校验为 [协议类型](../packages/protocol/src/appearance.ts)，变量名不带 `--`，
宿主与隔离 UI 均暴露对应的 `--变量名`。声明与隔离 UI 已解析快照统一使用 `version: 2`，不提供旧版外观契约兼容。

| 分类 | 变量 | 允许值 |
| --- | --- | --- |
| 背景与文字 | paper、sidebar、surface、surface-raised、hover、text、text-secondary、muted | 十六进制颜色，3/4/6/8 位 |
| 边框与选中 | line、line-strong、control-border、selected、selected-text、selection、accent、block-selection | 同上 |
| 操作 | green、green-hover、green-fill、green-fill-hover、on-accent | 同上；green 是历史名称，语义为品牌/操作强调色；on-accent 为填充操作上的文字 |
| 状态 | danger、danger-bg、warning、warning-bg、warning-border、switch-off | 同上 |
| 编辑器 | syntax-purple/red/blue/orange/teal/green、highlight-bg、suggestion-color、diff-add-bg、diff-remove-bg、quote-border | 同上 |
| 浮层与滚动 | scrollbar-thumb、scrollbar-thumb-hover、backdrop | 同上 |
| 旧版字体（兼容校验，宿主忽略） | font-ui、font-prose、font-mono | 本机字体列表与 generic family；无 URL、CSS 函数或远程字体 |
| 圆角 | radius-control、radius-card、radius-dialog | 0–24px |
| 间距 | space-control-x、space-control-y、space-panel、space-row-gap | 2–24px |
| 阴影 | overlay-shadow、dialog-shadow | none 或最多 3 层 px 偏移/模糊/扩展与十六进制颜色；各长度绝对值 ≤100 |

间距用于控件、目录行、设置行与面板，不暴露任意定位或隐藏界面的 CSS。
移动端目录行和输入控件保留至少 44px 高的触控区域。圆角不改变开关、圆形图标等语义形状。
编辑字体由用户独立选择系统、衬线、手写、等宽或自定义字体，不继承形态设置。
可在「编辑字体与字号」顶部开启「分别设置中英文字体」，独立选择中文和英文字体。英文字体仅应用于拉丁字符，中文及全角标点使用中文字体；关闭后恢复原有统一字体，单独设置仍保留。设置保存在当前设备，并应用于正文、页面内标题、源码和字体预览。
主题作者须自行验证颜色对比；语法颜色名称是语义槽位，不要求实际颜色必须与名称相同。

图标格式见 [文件图标主题](file-icon-themes.md)。`appearance.icons` 使用相同的 `FileIconTheme`，
最多 2048 个图标、每个最多 32 条路径、单路径最多 4096 字符、每张匹配表最多 8192 项。
矢量图标使用 20×20 坐标、单色描边，允许 `currentColor`。
彩色图标可在原定义上增加 `image`（`data:image/png;base64,...`），并按需提供 `lightImage`；
存在 `image` 时用图片替代路径、轮廓与文字。`lightImage` 随宿主实际浅色模式显示，深色模式使用 `image`，
并非跟随操作系统模式。每张编码图片最多 44 KiB，必须包含 PNG 签名、IHDR、IDAT 与 IEND，尺寸限制为 1–128px；不接受远程资源、HTML、SVG 或脚本。
图标主题可提供最多 4096 字符的 `notice`，保留第三方许可全文。原有单色主题无须修改。
插件清单和完整包分别最多 4 MiB，工作区插件规则最多 16 MiB（包含当前及历史清单），所有限制均按 UTF-8 字节计算。
例如 [Material 文件图标](../examples/plugins/material-icon-theme/README.md) 使用嵌入式彩色资源，作为按需导入的独立插件提供。
用户显式指定的文档 emoji/图标仍优先。

## 生命周期与保存

- 模式只保存为当前用户默认，四个槽位另支持工作区覆盖；不写入工作区配置。
- 主题清单随现有 `.tano/plugins.tano.json` 插件规则保存。没有新增根目录平台文件。
- 停用、卸载、管理员禁用、可执行插件撤权、更新移除主题时，受影响的选择回退到同页默认。
- 保留原选择并在设置中解释回退。原主题重新可用时自动恢复；主动选择“同页默认”则取消恢复。
- 切换工作区先清理旧主题，再应用用户默认或该工作区覆盖；主题加载失败时保留选择并显示错误。
- 配色、图标与布局互不绑定。只停用布局包不会影响配色和图标。未选中的主题安装不会改变外观。
- 存储不可写时本次会话仍可切换；损坏的保存记录不会在读取时被覆盖。

## 隔离页面与设置窗口

宿主在隔离 UI 首次执行前提供已解析的模式与契约变量；后续切换通过既有 MessageChannel 推送，
无需重载插件，不改变它的业务状态。UI 可直接使用 `var(--paper)`、`var(--text)` 等。

```ts
const current = tanoView.theme();
const unsubscribe = tanoView.onTheme(theme => {
  // 适用于 Canvas、图表等需要重新绘制的视图。
  console.log(theme.version, theme.mode, theme.shape.id, theme.tokens.paper);
});
```

主题对象及 tokens 为只读快照。`onTheme` 首次异步通知、返回取消订阅函数。
快照始终包含只读 `shape: { id, label, tokens }`，其 tokens 同样只读，ID 使用当前生效形态的完整 ID。
默认或回退形态为 `{ id: 'builtin:tano', label: '同页默认', tokens: {} }`；完整计算后的变量仍从顶层 `tokens` 读取。
隔离页面同步 `data-shape-theme`，可直接识别形态，无需根据圆角或字体猜测。
选中布局时，快照还包含只读 `layout` 定义，隔离页同步 `data-layout`、`data-surface`、
`--layout-gap`、`--layout-page-width`；回退默认时清除选中定义。插件可依此调整自身布局与材质。
iframe 仍为 opaque origin，不能访问宿主 DOM；主题不授予网络、文件或 Tauri 权限。
插件自己写死的 CSS 颜色不会被强制改写，作者须使用契约变量才能完整跟随主题。
独立原生设置窗口接收主工作台的主题快照，工作区回退也会清除其旧覆盖。

## 页面结构与材质

「布局风格」内置卡片岛、纸感，无需安装插件；也可以安装只提供布局的主题包。
布局选择与配色、图标独立，切换时保留编辑器实例、选区及 Markdown 内容。

```json
{
  "version": 2,
  "layouts": [{
    "id": "reading-desk",
    "label": "阅读工作台",
    "structure": "document",
    "surface": "paper",
    "gap": 24,
    "pageWidth": 880
  }]
}
```

以上是 manifest 的 `appearance` 字段。结构与材质只允许下列三组已实现组合，其他组合在导入时明确拒绝：

| structure | surface |
| --- | --- |
| continuous | flat |
| islands | flat |
| document | paper |

早期的 `notebook × skeuomorphic`（复古拟物笔记本）已移除；仍声明它的布局会以「笔记本布局已停止支持」拒绝导入，已保存的相关选择回退到默认外观。

字段说明：

| 字段 | 取值与行为 |
| --- | --- |
| structure | continuous：连续界面；islands：导航与工作区分别是浮于桌面的两张圆角卡片，文档在卡片内保持连续；document：暖色桌面上的单张纸页，带安静的文件名页眉、居中标题与短线，正文行距略宽 |
| surface | flat：平面；paper：极淡纸纹与柔和投影，不再绘制纸叠 |
| gap | 可选整数 8–32，单位 px，默认 16；控制卡片间隙或纸张外边距 |
| pageWidth | 可选整数 640–1200，单位 px，默认 880；控制文档卡片/纸张最大宽度 |

手机保留窄边距和触控区域，分屏使用每个窗格自身的几何尺寸。用户关闭页面宽度限制后，
文档可以展开到窗格宽度。打印不应用工作台结构 CSS。材质颜色来自当前配色，可与深浅色组合。
新增结构应由宿主实现并加入契约；插件不注入任意 CSS 或替换编辑器 DOM。
默认布局保持同页原样；停用布局插件时使用连续平面布局。
完整布局插件示例见 [页面风格集](../examples/plugins/theme-layouts/README.md)。

## 验收样例

- [纸页](../examples/plugins/theme-paper/manifest.json)：暖纸色、衬线正文、小圆角。
- [潮汐](../examples/plugins/theme-tide/manifest.json)：蓝色、圆润控件、柔和阴影。
- [明晰](../examples/plugins/theme-contrast/manifest.json)：黑白高对比、直角、无阴影。

每套均包含深浅两种配色、独立形态和一套原创 MIT 图标。验收应覆盖安装后手动选择、独立混搭、
编辑器、目录展开、菜单弹窗、设置、系统模式变化、iframe 已打开时切换、停用/卸载/恢复、
工作区切换、重载恢复及手机宽度。原生多窗口与设备平台验收仍遵循
[本地验证](local-validation.md)，浏览器视口测试不能替代原生平台发布验收。

文件图标 color 支持颜色 token 名（如 accent、syntax-blue）、十六进制颜色和 currentColor。语义引用渲染为宿主 CSS 变量，自动跟随配色与深浅模式；不允许任意 CSS 变量或 url()。
