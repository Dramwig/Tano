import {
  chineseInputOptions,
  chineseSyntaxOptions,
  featureDefinitions,
  markdownAutocompleteOptions,
  selectionWrappingOptions,
} from '@tano/editor/runtime';
import { isFeatureEnabled } from '../../features';
import { t, uiSearchText } from '../../i18n/i18n';
import { shortcutDefinitions } from '../../shell/shortcuts';

export type SettingSearchEntry = {
  id: string;
  page: string;
  label: string;
  description?: string;
  terms: string;
};

function settingSearchEntry(
  page: string,
  id: string,
  label: string,
  description = '',
  extra = '',
): SettingSearchEntry {
  return {
    id,
    page,
    label: t(label),
    description: description ? t(description) : undefined,
    terms: `${uiSearchText(label)} ${uiSearchText(description)} ${extra}`,
  };
}

export function buildSettingSearchEntries(options: {
  displayModeDescription: string;
  hasAppearance: boolean;
  frostActive: boolean;
  splitFontsEnabled: boolean;
  showDeveloperMode: boolean;
  developerModeDescription: string;
}): SettingSearchEntry[] {
  const {
    displayModeDescription,
    hasAppearance,
    frostActive,
    splitFontsEnabled,
    showDeveloperMode,
    developerModeDescription,
  } = options;
  const spacingAutocompleteAvailable = isFeatureEnabled('markdownSpacingAutocomplete');
  return [
    settingSearchEntry('appearance', 'appearance-auto-spacing', '正文自动间距', '在中文与英文、数字、行内公式及引用之间自动留白，仅影响显示，不修改原文。', 'spacing typography 中英文 数字 公式 引用 空格 排版'),
    settingSearchEntry('appearance', 'appearance-language', '界面语言', '立即切换界面语言，仅保存在当前设备。', 'language English 中文'),
    settingSearchEntry('appearance', 'appearance-theme', '显示模式', displayModeDescription, 'theme display mode light dark system 主题 模式 白天 黑夜 深色 浅色'),
    ...(hasAppearance
      ? [
          settingSearchEntry('appearance', 'appearance-scope', '为此工作区单独设置', '用户默认与工作区覆盖', 'scope user workspace 用户 默认 覆盖'),
          settingSearchEntry('appearance', 'appearance-shape', '形态与密度', '选择组件圆角、控件间距和阴影；字体在下方单独设置。', 'shape density 圆角 密度 间距 阴影'),
          settingSearchEntry('appearance', 'appearance-presets', '主题预设', '只应用预设声明的配色、图标、布局、材质和形态，未指定的项保持当前。', 'preset theme 一键 整套 预设 风格'),
          settingSearchEntry('appearance', 'appearance-color', '配色主题', '选择工作区主题插件。', 'theme 插件 风格 配色'),
          settingSearchEntry('appearance', 'appearance-icons', '文件与目录图标', '选择工作区图标主题。', 'icon 文件夹 图标 插件'),
          settingSearchEntry('appearance', 'appearance-layout', '布局风格', '选择页面结构，可与任意配色、图标混搭。留边布局的内容区四周留空，侧栏融入背景。', 'layout inset islands paper 贴边 留边 卡片岛 纸感 纸质 布局 结构'),
          settingSearchEntry('appearance', 'appearance-material', '材质', '选择侧栏和页面的质感，可与任意布局、配色混搭。', 'material glass frost frosted liquid translucent 材质 玻璃 磨砂 毛玻璃 液态 液态玻璃 透明 质感'),
          ...(frostActive
            ? [
                settingSearchEntry('appearance', 'appearance-wallpaper', '背景图片', '玻璃材质会透出这张图片，卡片透明度会按图片自动调整以保证文字清晰。图片只保存在这台设备。', 'wallpaper background image glass overlay opacity 壁纸 背景 图片 柔化 蒙版 不透明度'),
              ]
            : []),
        ]
      : []),
    ...(!splitFontsEnabled
      ? [
          settingSearchEntry('appearance', 'appearance-visual-font', '可视化编辑字体', '选择内置字体，或使用本机已安装的字体。', 'font system serif mono Maple custom'),
        ]
      : []),
    settingSearchEntry('appearance', 'appearance-split-fonts', '分别设置中英文字体', '开启后分别选择中文和英文字体；关闭后恢复统一字体设置。', 'font split Chinese English 中英文 中文 英文 字体 拆分'),
    ...(splitFontsEnabled
      ? [
          settingSearchEntry('appearance', 'appearance-chinese-font', '中文字体', '选择内置字体，或使用本机已安装的字体。', 'Chinese CJK 中文 字体'),
          settingSearchEntry('appearance', 'appearance-english-font', '英文字体', '选择内置字体，或使用本机已安装的字体。', 'English Latin 英文 字体'),
        ]
      : []),
    settingSearchEntry('appearance', 'appearance-custom-font', '字体名称', '输入本机字体名称；未安装时会回退到系统字体。', 'custom font'),
    settingSearchEntry('appearance', 'appearance-visual-size', '可视化编辑字号', '调整正文、标题和编辑中的内容大小。', 'font size'),
    settingSearchEntry('appearance', 'appearance-source-size', 'Markdown 源码字号', '调整源码视图中的文字大小。', 'source font size'),
    settingSearchEntry('appearance', 'appearance-page-title', '页面内标题', '在编辑区顶部显示当前文档标题。', 'title'),
    settingSearchEntry('appearance', 'appearance-properties', '文档属性', '在可视化编辑区显示文档属性。', 'properties frontmatter'),
    settingSearchEntry('appearance', 'appearance-discussion', '文档讨论', '有讨论时在文档底部显示，没有讨论时自动隐藏。', 'comments discussion'),
    settingSearchEntry('appearance', 'appearance-outline', '显示目录', '', 'outline table of contents'),
    settingSearchEntry('appearance', 'appearance-outline-position', '目录显示在左侧', '将文档大纲放到编辑区左侧。', 'outline left right'),
    settingSearchEntry('appearance', 'appearance-reduce-motion', '减少动态效果', '关闭按钮回弹、面板弹出和编辑区动画。系统开启“减少动态效果”时始终生效。', 'reduce motion animation accessibility 减少 动态 动画 动效 无障碍'),
    settingSearchEntry('appearance', 'appearance-smooth-caret', '光标平滑移动', '输入、移动光标和换行时，光标平滑滑到新位置。', 'caret cursor smooth animation motion 光标 平滑 动画 动效'),
    settingSearchEntry('appearance', 'appearance-typing-motion', '文字输入与删除动画', '新输入的文字淡入，删除的文字在原位置淡出。', 'typing delete animation motion 打字 输入 删除 退格 动画 动效'),
    settingSearchEntry('appearance', 'appearance-block-motion', '段落增删动画', '新段落浮现，删除的段落淡出，其余段落平滑让位。', 'block paragraph animation motion 段落 块 动画 动效'),
    settingSearchEntry('appearance', 'appearance-block-resize-motion', '段落变高时下方内容平滑移动', '段落内换行或删减使高度变化时，下方内容平滑跟随。', 'block height wrap animation motion 段落 高度 换行 动画 动效'),
    settingSearchEntry('appearance', 'appearance-source-reveal-motion', 'Markdown 源码展开收起动画', '光标进入或离开链接、行内代码、公式和引用时，源码平滑展开，离开后平滑收起。', 'markdown source reveal link code math reference wiki animation motion 源码 展开 收起 链接 公式 引用 动画 动效'),
    settingSearchEntry('appearance', 'appearance-help', '偶尔显示使用提示', '在你停下来时，在帮助按钮上方显示简短的用法提示。关闭后仍可手动查看帮助。', 'help tips hints'),
    settingSearchEntry('editing', 'editing-default-mode', '默认编辑模式', '选择打开文档时使用的视图。', 'editor visual Markdown source'),
    settingSearchEntry('editing', 'editing-reveal-markdown', '光标进入时展开 Markdown 源码', '类似 Typora、Obsidian 的实时预览：光标进入时显示 Markdown 语法，离开后恢复排版。', 'live preview source syntax'),
    settingSearchEntry('editing', 'editing-copy-format', '默认复制格式', '设置可视化编辑区的默认复制与剪切格式，右键菜单仍可单次选择其他格式。仅保存在当前设备。', 'copy clipboard Ctrl+C Command+C Word HTML Markdown 富文本 纯文本 剪贴板 复制'),
    settingSearchEntry('editing', 'editing-toolbar', '编辑工具栏', '随选区显示，或停靠在顶部、底部、左侧、右侧；也可拖动工具栏手柄调整。仅影响当前设备。', 'toolbar selection top bottom left right'),
    settingSearchEntry('editing', 'editing-preview-math', '编辑时预览公式', '展开 Markdown 源码编辑公式时同步显示排版效果。', 'math formula preview'),
    settingSearchEntry('editing', 'editing-preview-mermaid', '编辑时预览 Mermaid', '展开 Markdown 源码编辑 Mermaid 时同步显示图表。', 'mermaid diagram chart preview 图表'),
    settingSearchEntry('editing', 'editing-folding', '标题与列表折叠', '显示折叠按钮，临时收起标题下的内容或列表项。', 'heading list folding collapse'),
    settingSearchEntry('editing', 'editing-ai-shortcut', '空白块按空格启动 AI', '在空白 block 中按空格，直接展开一次性 AI 编辑输入框。', 'AI space block'),
    settingSearchEntry('editing', 'editing-wrapping', '输入符号包裹选区', '选中文字后输入符号，自动补齐两端。可视化与源码模式通用。', 'selection wrapping symbols'),
    ...selectionWrappingOptions.map((option) =>
      settingSearchEntry('editing', `editing-wrapping-${option.key}`, option.label, option.example, 'selection wrapping Markdown'),
    ),
    ...markdownAutocompleteOptions.map((option) =>
      settingSearchEntry('editing', `editing-autocomplete-${option.key}`, option.label, '自动补全 列表 续行 代码块 括号 autocomplete list continuation fence bracket'),
    ),
    ...(spacingAutocompleteAvailable
      ? [
          settingSearchEntry('editing', 'editing-autocomplete-spacing', '输入时自动补空格', '输入时在中文与英文、数字、行内公式及引用之间补空格，写入 Markdown 原文。可视化与源码模式通用。', '正文自动间距 中英文 spacing'),
        ]
      : []),
    ...[...chineseSyntaxOptions, ...chineseInputOptions].map((option) =>
      settingSearchEntry('editing', `editing-chinese-input-${option.key}`, option.label, `${option.input} → ${option.output}`, '中文输入优化 输入法 标点 符号映射 Chinese IME punctuation'),
    ),
    ...shortcutDefinitions.map((item) =>
      settingSearchEntry('shortcuts', `shortcut-${item.id}`, item.label, 'scope' in item ? item.scope : '', 'shortcut keybinding keyboard'),
    ),
    settingSearchEntry('assistant', 'assistant-connections', '模型连接', '管理助手使用的 API 或 CLI 连接。', 'assistant model connection API CLI'),
    ...featureDefinitions.map((feature) =>
      settingSearchEntry('documents', `documents-${feature.key}`, feature.label, '', 'Markdown extension'),
    ),
    settingSearchEntry('documents', 'documents-math-recognition', '识别的公式语法', '未选中的语法按普通文本显示，不修改 Markdown 原文。', '公式 渲染 识别 math LaTeX dollar'),
    settingSearchEntry('documents', 'documents-dialect', '新公式默认格式', '设置新公式的写法，不确定时保留默认即可。', 'Markdown 方言 dialect Obsidian GitHub Pandoc CommonMark'),
    settingSearchEntry('documents', 'documents-math-syntax', '已有公式保存格式', '保留原样：已有公式不转换，新公式使用上面的默认格式。选择统一格式：新旧公式都使用所选写法，在下次编辑保存正文时应用。', '公式输出语法 math formula syntax LaTeX Dollar'),
    settingSearchEntry('documents', 'documents-bullet-marker', '无序列表标记', '选择无序列表与待办列表的 Markdown 标记，在下一次编辑保存正文时应用。', 'bullet list marker'),
    settingSearchEntry('workspace', 'workspace-name', '工作区名称', '最多 65 个字符，显示在侧栏和工作区菜单中。', 'workspace name'),
    settingSearchEntry('workspace', 'workspace-icon', '图标', '选择内置图标、表情符号或上传图片，显示在侧栏和工作区菜单中。', 'workspace icon emoji'),
    settingSearchEntry('workspace', 'workspace-home-page', '默认打开页面', '首次打开时进入此页面；已有会话会恢复上次打开的标签页。', 'home page default'),
    settingSearchEntry('workspace', 'workspace-title-source', '页面标题来源', '适用于当前工作区的所有页面。仅“YAML title 优先”在字段为空或无效时使用文件名。', 'title source filename YAML'),
    settingSearchEntry('workspace', 'workspace-folder-home', '文件夹首页', '点击文件夹名称打开直属首页，点击图标展开。首页文件在文件树中隐藏，不移动或修改文件。', 'README _index index folder home'),
    settingSearchEntry('workspace', 'workspace-show-plan', '显示计划', '在侧栏显示计划与日历入口。', 'sidebar plan calendar'),
    settingSearchEntry('workspace', 'workspace-show-graph', '显示关系图谱', '在侧栏顶部显示关系图谱入口。', 'sidebar graph'),
    settingSearchEntry('workspace', 'workspace-show-plugins', '显示插件', '在侧栏显示已安装插件与插件管理入口。', 'sidebar plugins'),
    settingSearchEntry('workspace', 'workspace-show-collaboration-views', '显示协作应用', '在侧栏显示聊天等协作入口，不影响账户收件箱。', 'sidebar collaboration chat inbox'),
    settingSearchEntry('workspace', 'workspace-export', '工作区内容', '将已保存的 Markdown、附件和工作区设置导出为 ZIP，保留文件夹结构。', 'export ZIP backup'),
    settingSearchEntry('workspace', 'workspace-page-views', '保存并显示页面浏览统计', '页面浏览量统计尚未实现，当前不会收集浏览数据。', 'analytics statistics views'),
    settingSearchEntry('workspace', 'workspace-people', '人物目录', '在工作区对象列表中显示人物；关闭后仍可通过已有引用访问人物。', 'people directory'),
    settingSearchEntry('workspace', 'workspace-id', '工作区 ID', '', 'workspace id identifier'),
    settingSearchEntry('workspace', 'workspace-delete', '删除当前工作区', '移除当前设备上的工作区注册。', 'workspace delete remove'),
    settingSearchEntry('about', 'about-updates', '版本与更新', '检查并安装同页更新。', 'version update'),
    ...(showDeveloperMode
      ? [settingSearchEntry('about', 'about-developer-mode', '开发者模式', developerModeDescription, 'devtools debug inspect 调试')]
      : []),
    settingSearchEntry('about', 'about-links', '资源与支持', '打开官网、使用文档、发行说明，或反馈问题。', 'website docs documentation help release notes changelog feedback issue GitHub tano.page 官网 文档 帮助 更新日志 反馈'),
  ];
}
