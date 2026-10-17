import { Fragment } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, Selection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { blockContentStart } from './callout';
import { columnWidths, formatColumnWidths } from './column-widths';

/** Markdown containers own ordered children; paths/positions are scoped to one document revision. */
export function isBlockContainer(node: Node): boolean {
  return ['doc', 'blockquote', 'tano_toggle', 'tano_panel'].includes(node.type.name);
}

export interface BlockEntry {
  node: Node;
  pos: number;
  parent: Node;
  parentPos: number; // -1 denotes the document
  index: number;
  depth: number;
}

/** Panels are structural slots, while their content and owning tabs/columns are blocks. */
export function blockTree(doc: Node): BlockEntry[] {
  const entries: BlockEntry[] = [];
  function visit(parent: Node, parentPos: number, depth: number) {
    parent.forEach((node, offset, index) => {
      const pos = parentPos + 1 + offset;
      if (isBlockContainer(parent) && index >= blockContentStart(parent))
        entries.push({ node, pos, parent, parentPos, index, depth });
      if (isBlockContainer(node) || ['tano_tabs', 'tano_columns'].includes(node.type.name))
        visit(node, pos, depth + 1);
    });
  }
  visit(doc, -1, 0);
  return entries;
}

/** Column slots disappear when their last block leaves; other containers keep an editable line. */
function detachBlock(tr: Transaction, source: BlockEntry, destinationParent: number, columns: Set<number>, count = 1) {
  let size = 0;
  for (let index = source.index; index < source.index + count; index++) size += source.parent.child(index).nodeSize;
  const $panel = source.parentPos >= 0 ? tr.doc.resolve(source.parentPos) : null;
  const column = source.parent.type.name === 'tano_panel' && $panel?.parent.type.name === 'tano_columns';
  const emptyAfter = column && source.parent.content.content.every((node, index) =>
    (index >= source.index && index < source.index + count) || (node.type.name === 'paragraph' && node.content.size === 0));
  if (source.parentPos !== destinationParent && (source.parent.childCount - blockContentStart(source.parent) === count || emptyAfter)) {
    if (column && $panel) {
      const ownerPos = $panel.before();
      const owner = $panel.parent;
      if (owner.childCount === 1) {
        const entry = blockTree(tr.doc).find(entry => entry.pos === ownerPos)!;
        detachBlock(tr, entry, destinationParent, columns);
      } else {
        const widths = columnWidths(owner.attrs.widths, owner.childCount);
        widths.splice($panel.index(), 1);
        tr.delete(source.parentPos, source.parentPos + source.parent.nodeSize);
        if (owner.attrs.widths) tr.setNodeMarkup(ownerPos, undefined, {
          ...owner.attrs, widths: formatColumnWidths(columnWidths(formatColumnWidths(widths), widths.length)),
        });
        columns.add(ownerPos);
      }
      return;
    }
    tr.replaceWith(source.pos, source.pos + size, tr.doc.type.schema.nodes.paragraph!.create());
  } else tr.delete(source.pos, source.pos + size);
}

/** Unwrap a remaining column while tracking the moved block through the removed wrappers. */
function collapseColumns(tr: Transaction, columns: Set<number>, tracked: number): number {
  for (const original of [...columns].sort((a, b) => b - a)) {
    const pos = tr.mapping.map(original, -1);
    const owner = tr.doc.nodeAt(pos);
    if (owner?.type.name !== 'tano_columns' || owner.childCount !== 1) continue;
    const inside = tracked >= pos + 2 && tracked < pos + owner.nodeSize - 2;
    tr.replaceWith(pos, pos + owner.nodeSize, owner.firstChild!.content);
    tracked = inside ? tracked - 2 : tr.mapping.maps.at(-1)!.map(tracked, -1);
  }
  return tracked;
}

export function deleteBlock(state: EditorState, pos: number): Transaction | null {
  const source = blockTree(state.doc).find(entry => entry.pos === pos);
  if (!source) return null;
  const columns = new Set<number>();
  const tr = state.tr;
  detachBlock(tr, source, -2, columns);
  const at = collapseColumns(tr, columns, tr.mapping.map(pos, -1));
  tr.setSelection(Selection.near(tr.doc.resolve(Math.min(at, tr.doc.content.size))));
  return tr;
}

/** Move an entire subtree, including across containers, without ProseMirror fitting away content. */
export function moveBlockTo(
  state: EditorState,
  sourcePos: number,
  parentPos: number,
  index: number,
  selectMovedBlock = true,
): Transaction | null {
  return moveBlocksTo(state, [sourcePos], parentPos, index, selectMovedBlock);
}

/** Move explicit block roots atomically in document order, retaining gaps and nested subtrees. */
export function moveBlocksTo(
  state: EditorState, sourcePositions: readonly number[], parentPos: number, index: number, selectMovedBlock = false,
): Transaction | null {
  const tree = blockTree(state.doc);
  const sources = sourcePositions.map(pos => tree.find(entry => entry.pos === pos)).filter((entry): entry is BlockEntry => !!entry)
    .sort((a, b) => a.pos - b.pos);
  const source = sources[0];
  if (!source || sources.length !== sourcePositions.length || sources.some((entry, i) =>
    i > 0 && entry.pos < sources[i - 1]!.pos + sources[i - 1]!.node.nodeSize)) return null;
  const sourcePos = source.pos;
  const content = Fragment.fromArray(sources.map(entry => entry.node));
  const parent = parentPos === -1 ? state.doc : state.doc.nodeAt(parentPos);
  if (
    !source ||
    !parent ||
    !isBlockContainer(parent) ||
    !Number.isInteger(index) ||
    index < blockContentStart(parent) ||
    index > parent.childCount
  )
    return null;
  if (sources.some(entry => parentPos >= entry.pos && parentPos < entry.pos + entry.node.nodeSize)) return null;
  const contiguous = sources.every((entry, i) => entry.parentPos === source.parentPos && entry.index === source.index + i);
  if (contiguous && source.parentPos === parentPos && index >= source.index && index <= source.index + sources.length)
    return null;
  if (!parent.canReplace(index, index, content)) return null;
  let target = parentPos + 1;
  for (let i = 0; i < index; i++) target += parent.child(i).nodeSize;
  const tr = state.tr;
  const columns = new Set<number>();
  if (contiguous) detachBlock(tr, source, parentPos, columns, sources.length);
  else {
    for (const original of [...sources].reverse()) {
      const mapping = tr.mapping.slice();
      const at = mapping.map(original.pos, 1);
      const current = blockTree(tr.doc).find(entry => entry.pos === at);
      if (!current) return null;
      const removedColumns = new Set<number>();
      detachBlock(tr, current, parentPos < 0 ? parentPos : mapping.map(parentPos, 1), removedColumns);
      // detachBlock reports positions in its input document. Cleanup runs after
      // every removal, so retain their coordinates in the original document.
      for (const owner of removedColumns) columns.add(mapping.invert().map(owner, -1));
    }
  }
  target = tr.mapping.map(target, target <= sourcePos ? -1 : 1);
  tr.insert(target, content);
  target = collapseColumns(tr, columns, target);
  if (tr.doc.eq(state.doc)) return null;
  // Pointer drops only reorder content; keyboard/menu moves keep the block selected.
  if (selectMovedBlock) tr.setSelection(NodeSelection.create(tr.doc, target));
  else tr.setSelection(Selection.near(tr.doc.resolve(target)));
  return tr;
}

/** A side drop creates columns, or inserts a slot beside an existing column. */
export function moveBlockBeside(
  state: EditorState, sourcePos: number, targetPos: number, side: 'left' | 'right', selectMovedBlock = false,
): Transaction | null {
  const entries = blockTree(state.doc);
  const source = entries.find(entry => entry.pos === sourcePos);
  const target = entries.find(entry => entry.pos === targetPos);
  if (!source || !target ||
    (target.pos >= source.pos && target.pos < source.pos + source.node.nodeSize) ||
    (source.pos >= target.pos && source.pos < target.pos + target.node.nodeSize)) return null;
  const $panel = target.parentPos >= 0 ? state.doc.resolve(target.parentPos) : null;
  const existing = target.parent.type.name === 'tano_panel' && $panel?.parent.type.name === 'tano_columns';
  const tr = state.tr;
  const collapsed = new Set<number>();
  // This always leaves the old slot, even when the new slot belongs to the same row.
  detachBlock(tr, source, -2, collapsed);
  const panel = state.schema.nodes.tano_panel!.create({ title: '' }, source.node);
  let moved: number;
  if (existing) {
    const at = tr.mapping.map(target.parentPos, -1);
    const $at = tr.doc.resolve(at);
    const owner = $at.parent;
    const ownerPos = $at.before();
    const widths = columnWidths(owner.attrs.widths, owner.childCount);
    const index = $at.index();
    const half = widths[index]! / 2;
    widths.splice(index, 1, half, half);
    const insertion = side === 'left' ? at : at + tr.doc.nodeAt(at)!.nodeSize;
    tr.insert(insertion, panel).setNodeMarkup(ownerPos, undefined, { ...owner.attrs, widths: formatColumnWidths(widths) });
    moved = insertion + 1;
  } else {
    const at = tr.mapping.map(target.pos, -1);
    const targetPanel = state.schema.nodes.tano_panel!.create({ title: '' }, target.node);
    const children = side === 'left' ? [panel, targetPanel] : [targetPanel, panel];
    const owner = state.schema.nodes.tano_columns!.create(null, children);
    tr.replaceWith(at, at + target.node.nodeSize, owner);
    moved = at + 2 + (side === 'left' ? 0 : targetPanel.nodeSize);
  }
  moved = collapseColumns(tr, collapsed, moved);
  tr.setSelection(selectMovedBlock ? NodeSelection.create(tr.doc, moved) : Selection.near(tr.doc.resolve(moved)));
  return tr;
}

export function moveBlockSibling(state: EditorState, pos: number, direction: -1 | 1) {
  const source = blockTree(state.doc).find((entry) => entry.pos === pos);
  return source
    ? moveBlockTo(state, pos, source.parentPos, source.index + (direction < 0 ? -1 : 2))
    : null;
}

export function wrapBlockInToggle(state: EditorState, pos: number): Transaction | null {
  const source = blockTree(state.doc).find((entry) => entry.pos === pos);
  if (!source) return null;
  const toggle = state.schema.nodes.tano_toggle!.create({ title: '详细内容' }, source.node);
  const tr = state.tr.replaceWith(pos, pos + source.node.nodeSize, toggle);
  return tr.setSelection(NodeSelection.create(tr.doc, pos));
}

export function indentBlock(state: EditorState, pos: number) {
  const source = blockTree(state.doc).find((entry) => entry.pos === pos);
  if (!source || source.index === blockContentStart(source.parent)) return null;
  const previous = source.parent.child(source.index - 1);
  if (!isBlockContainer(previous)) return null;
  return moveBlockTo(state, pos, pos - previous.nodeSize, previous.childCount);
}

export function outdentBlock(state: EditorState, pos: number) {
  const source = blockTree(state.doc).find((entry) => entry.pos === pos);
  if (!source || source.parentPos === -1) return null;
  // Panels belong to tabs/columns: lift after the owning block, never between panel slots.
  const owner = blockTree(state.doc).find(
    (entry) =>
      entry.pos <= source.parentPos &&
      source.parentPos < entry.pos + entry.node.nodeSize &&
      (entry.pos === source.parentPos ||
        ['tano_tabs', 'tano_columns'].includes(entry.node.type.name)) &&
      entry.depth === source.depth - (source.parent.type.name === 'tano_panel' ? 2 : 1),
  );
  return owner ? moveBlockTo(state, pos, owner.parentPos, owner.index + 1) : null;
}
