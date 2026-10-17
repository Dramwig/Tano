import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorState } from '@milkdown/kit/prose/state';
import { sourceStyleRanges } from './source-highlight';
import { isBlockContainer } from './block-tree';
import { blockContentStart } from './callout';

// Preserve the editor API while allowing the workbench to load metadata without ProseMirror.
export * from './selection-context';
import type { BlockType, EditorSelectionContext, InlineType } from './selection-context';

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
      isBlockContainer($from.node(depth)) &&
      to <= $from.end(depth) &&
      $from.index(depth) >= blockContentStart($from.node(depth))
    ) {
      parent = $from.node(depth);
      start = $from.start(depth);
      break;
    }
  }
  parent.forEach((node, offset, index) => {
    if (index < blockContentStart(parent)) return;
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
