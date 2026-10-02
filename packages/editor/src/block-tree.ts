import { Fragment } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';

/** Markdown containers own ordered children; paths/positions are scoped to one document revision. */
export function isBlockContainer(node: Node): boolean {
  return ['doc', 'tano_toggle', 'tano_panel'].includes(node.type.name);
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
      if (isBlockContainer(parent)) entries.push({ node, pos, parent, parentPos, index, depth });
      if (isBlockContainer(node) || ['tano_tabs', 'tano_columns'].includes(node.type.name))
        visit(node, pos, depth + 1);
    });
  }
  visit(doc, -1, 0);
  return entries;
}

/** Move an entire subtree, including across containers, without ProseMirror fitting away content. */
export function moveBlockTo(
  state: EditorState,
  sourcePos: number,
  parentPos: number,
  index: number,
): Transaction | null {
  const source = blockTree(state.doc).find((entry) => entry.pos === sourcePos);
  const parent = parentPos === -1 ? state.doc : state.doc.nodeAt(parentPos);
  if (
    !source ||
    !parent ||
    !isBlockContainer(parent) ||
    !Number.isInteger(index) ||
    index < 0 ||
    index > parent.childCount
  )
    return null;
  if (parentPos >= sourcePos && parentPos < sourcePos + source.node.nodeSize) return null;
  if (source.parentPos === parentPos && (index === source.index || index === source.index + 1))
    return null;
  if (!parent.canReplace(index, index, Fragment.from(source.node))) return null;
  let target = parentPos + 1;
  for (let i = 0; i < index; i++) target += parent.child(i).nodeSize;
  const tr = state.tr;
  // Keep an editable empty line when moving the last child out of a required block+ container.
  if (source.parent.childCount === 1 && source.parentPos !== parentPos)
    tr.replaceWith(
      sourcePos,
      sourcePos + source.node.nodeSize,
      state.schema.nodes.paragraph!.create(),
    );
  else tr.delete(sourcePos, sourcePos + source.node.nodeSize);
  target = tr.mapping.map(target, target <= sourcePos ? -1 : 1);
  tr.insert(target, source.node);
  tr.setSelection(NodeSelection.create(tr.doc, target));
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
  if (!source || source.index === 0) return null;
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
