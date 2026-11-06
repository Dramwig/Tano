import { t } from './i18n';

/** App-owned illustrations; hovering never invokes a setting or editor command. */
export const settingExamples = {
  'editing-default-mode': { scene: 'mode', label: '默认编辑模式', description: '打开文档时，选择直接编辑排版内容或 Markdown 源码。' },
  'editing-reveal-markdown': { scene: 'reveal', label: '光标进入时展开 Markdown 源码', description: '光标进入时显示语法，离开后恢复排版。' },
  'editing-copy-format': { scene: 'copy', label: '默认复制格式', description: '同一段内容可复制为 Markdown 源码或带排版的富文本。' },
  'editing-toolbar': { scene: 'toolbar', label: '编辑工具栏', description: '工具栏可跟随选区，也可停靠在页面边缘。' },
  'editing-preview-math': { scene: 'math', label: '编辑时预览公式', description: '编辑公式源码时，在旁边同步查看公式排版。' },
  'editing-preview-mermaid': { scene: 'mermaid', label: '编辑时预览 Mermaid', description: '编辑 Mermaid 源码时，同步查看生成的图表。' },
  'editing-folding': { scene: 'folding', label: '标题与列表折叠', description: '点击折叠箭头，临时收起或展开下面的内容。' },
  'editing-ai-shortcut': { scene: 'ai', label: '空白块按空格启动 AI', description: '在空段落按空格，展开一次性 AI 编辑输入框。' },
  'editing-wrapping': { scene: 'wrapping', label: '输入符号包裹选区', description: '选中文字再输入符号，自动在两端补齐对应标记。' },
  'appearance-auto-spacing': { scene: 'spacing', label: '正文自动间距', description: '在中文和英文、数字之间增加视觉留白，Markdown 原文保持不变。' },
  'appearance-page-title': { scene: 'title', label: '页面内标题', description: '在正文上方显示当前文档的标题。' },
  'appearance-properties': { scene: 'properties', label: '文档属性', description: '在正文上方查看和编辑 Markdown 文档中的属性。' },
  'appearance-discussion': { scene: 'discussion', label: '文档讨论', description: '在文档底部查看和参与整篇文档的讨论。' },
  'appearance-outline': { scene: 'outline', label: '显示目录', description: '将正文中的标题汇成目录，点击可跳转到对应位置。' },
  'appearance-outline-position': { scene: 'outline-position', label: '目录显示在左侧', description: '选择将文档目录放在编辑区左侧或右侧。' },
  'documents-math-recognition': { scene: 'recognition', label: '识别的公式语法', description: '识别的写法显示为公式，未识别的写法保留为普通文本。' },
  'documents-dialect': { scene: 'math-syntax', label: '新公式默认格式', description: '选择新公式的 Markdown 写法，两种写法可显示相同的公式。' },
  'documents-math-syntax': { scene: 'math-syntax', label: '已有公式保存格式', description: '已有公式可保留原写法，或在下一次编辑保存时统一格式。' },
  'documents-bullet-marker': { scene: 'bullet', label: '无序列表标记', description: '选择列表保存时使用的标记，渲染后的列表外观相同。' },
} as const;

export type SettingExampleKey = keyof typeof settingExamples;
export function isSettingExample(key: string): key is SettingExampleKey {
  return Object.hasOwn(settingExamples, key);
}
export function settingHint(key: string) {
  return isSettingExample(key) ? {
    'data-tooltip': t(settingExamples[key].label),
    'data-tooltip-setting': key,
  } : {};
}
