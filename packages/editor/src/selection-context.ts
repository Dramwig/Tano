import { featureEnabled } from './runtime';
import type { DocumentFeatures } from './runtime';

/** Semantic presentation types, independent of Milkdown's Markdown storage schema. */
export const blockTypes = [
  { type: 'ObjectReference', label: '对象引用卡片', command: 'object-reference', level: 2 },
  { type: 'Heading', label: '标题', command: 'heading', level: 0 },
  { type: 'Paragraph', label: '正文', command: 'paragraph', level: 0 },
  { type: 'Quote', label: '引用', command: 'quote', level: 0 },
  { type: 'BulletList', label: '无序列表', command: 'list', level: 0 },
  { type: 'OrderedList', label: '有序列表', command: 'ordered-list', level: 0 },
  { type: 'TodoList', label: '待办列表', command: 'todo-list', level: 0 },
  { type: 'CodeBlock', label: '代码块', command: 'code-block', level: 0 },
  { type: 'ImageBlock', label: '图片', command: 'image', level: 0 },
  { type: 'Table', label: '表格', command: 'table', level: 0 },
  { type: 'MermaidBlock', label: 'Mermaid 图表', command: 'mermaid', level: 0 },
  { type: 'Callout', label: '提示块', command: 'callout', level: 1 },
  { type: 'Toggle', label: '折叠块', command: 'toggle', level: 1 },
  { type: 'FileBlock', label: '附件', command: 'file', level: 1 },
  { type: 'Embed', label: '嵌入预览', command: 'embed', level: 1 },
  { type: 'Tabs', label: '标签页', command: 'tabs', level: 1 },
  { type: 'Columns', label: '分栏', command: 'columns', level: 1 },
  { type: 'HorizontalRule', label: '分隔线', command: 'horizontal-rule', level: 0 },
  { type: 'MathBlock', label: '公式块', command: 'math-block', level: 0 },
] as const;
export const inlineTypes = [
  { type: 'Reference', label: '引用对象或文档', command: 'reference', level: 2 },
  { type: 'Bold', label: '粗体', command: 'bold', level: 0 },
  { type: 'Italic', label: '斜体', command: 'italic', level: 0 },
  { type: 'CodeSpan', label: '行内代码', command: 'code', level: 0 },
  { type: 'Link', label: '链接', command: 'link', level: 0 },
  { type: 'InlineMath', label: '行内公式', command: 'math', level: 0 },
  { type: 'FootnoteReference', label: '脚注引用', command: 'footnote', level: 0 },
  { type: 'Mention', label: '提及文档', command: 'mention', level: 1 },
] as const;
export type BlockType =
  | (typeof blockTypes)[number]['type']
  | 'Document'
  | 'UnsupportedBlock'
  | 'FootnoteDefinition'
  | 'Panel'
  | 'LocalSource';
export type InlineType = (typeof inlineTypes)[number]['type'];
export type FeatureLevel = 0 | 1 | 2;
export const defaultEnabledLevels: readonly FeatureLevel[] = [0, 1, 2];
export const insertionCommands = new Set([
  'object-reference',
  'image',
  'table',
  'horizontal-rule',
  'math-block',
  'toggle',
  'file',
  'embed',
  'tabs',
  'columns',
]);
/** Lossless containers can wrap blocks that cannot be flattened into text. */
export const wrappingCommands = new Set(['quote', 'callout']);
/** Feature level is separate from selection granularity (block/inline) and heading depth. */
export function featureLevel(type: string): FeatureLevel {
  return (
    [...blockTypes, ...inlineTypes].find((item) => item.type === type)?.level ??
    (type === 'Panel' ? 1 : 0)
  );
}
export function commandEnabled(
  command: string,
  levels: readonly number[] = defaultEnabledLevels,
  features?: DocumentFeatures,
) {
  const definition = [...blockTypes, ...inlineTypes].find((item) => item.command === command);
  return levels.includes(definition?.level ?? 0) && featureEnabled(command, features);
}
export interface EditorSelectionContext {
  level: 'block' | 'inline';
  block: BlockType;
  headingLevel?: number;
  multiple: boolean;
  activeInline: InlineType[];
  canTransform: boolean;
  canStyleText: boolean;
  inlineSource?: boolean;
  /** A non-empty text range, rather than a caret or an explicit block selection. */
  textSelected?: boolean;
}
export const defaultSelectionContext: EditorSelectionContext = {
  level: 'block',
  block: 'Paragraph',
  multiple: false,
  activeInline: [],
  canTransform: true,
  canStyleText: false,
};
