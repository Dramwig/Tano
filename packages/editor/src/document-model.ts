import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { sourceStyleRanges } from './source-highlight';
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

export function blockType(node: Node): BlockType {
  switch (node.type.name) {
    case 'tano_reference_block': return 'ObjectReference';
    case 'tano_live_source':
      return 'LocalSource';
    case 'tano_toggle':
      return 'Toggle';
    case 'tano_tabs':
      return 'Tabs';
    case 'tano_columns':
      return 'Columns';
    case 'tano_panel':
      return 'Panel';
    case 'tano_file':
      return 'FileBlock';
    case 'tano_embed':
      return 'Embed';
    case 'doc':
      return 'Document';
    case 'heading':
      return 'Heading';
    case 'paragraph':
      return node.childCount === 1 && node.firstChild?.type.name === 'image'
        ? 'ImageBlock'
        : 'Paragraph';
    case 'image':
      return 'ImageBlock';
    case 'blockquote':
      return /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s|$)/i.test(
        node.firstChild?.textContent ?? '',
      )
        ? 'Callout'
        : 'Quote';
    case 'bullet_list': {
      let todo = false;
      node.forEach((item) => {
        if (item.attrs.checked != null) todo = true;
      });
      return todo ? 'TodoList' : 'BulletList';
    }
    case 'ordered_list':
      return 'OrderedList';
    case 'code_block':
      return String(node.attrs.language).toLowerCase() === 'mermaid' ? 'MermaidBlock' : 'CodeBlock';
    case 'table':
      return 'Table';
    case 'hr':
      return 'HorizontalRule';
    case 'math_block':
      return 'MathBlock';
    case 'footnote_definition':
      return 'FootnoteDefinition';
    default:
      return 'UnsupportedBlock';
  }
}

/** Blocks are selected explicitly by handles, or implicitly by a caret / a cross-block range. */
export function selectedBlocks(state: EditorState) {
  const { from, to, empty } = state.selection;
  const blocks: { node: Node; pos: number }[] = [];
  let parent = state.doc,
    start = 0;
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if (
      ['tano_toggle', 'tano_panel'].includes($from.node(depth).type.name) &&
      to <= $from.end(depth)
    ) {
      parent = $from.node(depth);
      start = $from.start(depth);
      break;
    }
  }
  parent.forEach((node, offset) => {
    const pos = start + offset;
    if (empty ? pos <= from && from < pos + node.nodeSize : pos < to && pos + node.nodeSize > from)
      blocks.push({ node, pos });
  });
  return blocks;
}

export function canTransformBlock(node: Node): boolean {
  if (['paragraph', 'heading', 'code_block'].includes(node.type.name)) return true;
  if (!['blockquote', 'bullet_list', 'ordered_list', 'list_item'].includes(node.type.name))
    return false;
  let valid = true;
  node.forEach((child) => {
    if (!canTransformBlock(child)) valid = false;
  });
  return valid;
}

export function selectionContext(state: EditorState): EditorSelectionContext {
  const selection = state.selection;
  const blocks = selectedBlocks(state);
  const selectedNode = selection instanceof NodeSelection ? selection.node : null;
  const inlineSource =
    selection instanceof TextSelection &&
    !selection.empty &&
    selection.$from.sameParent(selection.$to) &&
    selection.$from.parent.type.name === 'tano_live_source_inline';
  const inline = selectedNode
    ? selectedNode.isInline && selectedNode.type.name !== 'image'
    : selection instanceof TextSelection &&
      !selection.empty &&
      selection.$from.sameParent(selection.$to) &&
      (!selection.$from.parent.type.spec.code || inlineSource);
  const markTypes: Record<string, InlineType> = {
    strong: 'Bold',
    emphasis: 'Italic',
    inlineCode: 'CodeSpan',
    link: 'Link',
  };
  const atomTypes: Record<string, InlineType> = {
    tano_reference: 'Reference',
    math_inline: 'InlineMath',
    footnote_reference: 'FootnoteReference',
    tano_wiki_link: 'Mention',
  };
  const active = new Set<InlineType>();
  let commonMarks: Set<InlineType> | undefined;
  let canStyleText = false;
  if (inline)
    state.doc.nodesBetween(selection.from, selection.to, (node) => {
      if (node.isText) {
        canStyleText = true;
        const marks = new Set(
          node.marks.flatMap((mark) =>
            markTypes[mark.type.name] ? [markTypes[mark.type.name]!] : [],
          ),
        );
        commonMarks = commonMarks
          ? new Set([...commonMarks].filter((mark) => marks.has(mark)))
          : marks;
      }
    });
  commonMarks?.forEach((mark) => active.add(mark));
  if (inlineSource) {
    const start = selection.$from.start();
    const from = selection.from - start;
    const to = selection.to - start;
    const styles: Partial<Record<string, InlineType>> = {
      strong: 'Bold',
      emphasis: 'Italic',
      code: 'CodeSpan',
      link: 'Link',
    };
    for (const range of sourceStyleRanges(selection.$from.parent.textContent))
      if (range.from <= from && to <= range.to && styles[range.style])
        active.add(styles[range.style]!);
  }
  if (selectedNode && atomTypes[selectedNode.type.name])
    active.add(atomTypes[selectedNode.type.name]!);
  const node = selectedNode?.type.name === 'image' ? selectedNode : blocks[0]?.node;
  return {
    level: inline ? 'inline' : 'block',
    textSelected: selection instanceof TextSelection && !selection.empty,
    block: blocks.length > 1 ? 'Document' : node ? blockType(node) : 'Document',
    headingLevel: node?.type.name === 'heading' ? Number(node.attrs.level) : undefined,
    multiple: blocks.length > 1,
    activeInline: [...active],
    canTransform:
      !inlineSource && blocks.length > 0 && blocks.every(({ node }) => canTransformBlock(node)),
    canStyleText,
    ...(inlineSource ? { inlineSource: true } : {}),
  };
}
