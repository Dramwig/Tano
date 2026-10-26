import { Fragment } from '@milkdown/kit/prose/model';
import type { Node } from '@milkdown/kit/prose/model';
import { NodeSelection, Selection } from '@milkdown/kit/prose/state';
import type { EditorState, Transaction } from '@milkdown/kit/prose/state';
import { BlockRangeSelection } from './block-selection';
import { blockTree } from './block-tree';
import { blockCommand } from './block-commands';
import { blockContentStart } from './callout';

export const blockContainerOptions = [
  { type: 'quote', label: '引用块' },
  { type: 'callout', label: '提示块' },
  { type: 'toggle', label: '折叠块' },
  { type: 'tabs', label: '标签页' },
  { type: 'columns', label: '分栏' },
] as const;

function children(node: Node): Node[] | null {
  if (['blockquote', 'tano_toggle'].includes(node.type.name))
    return node.content.content.slice(blockContentStart(node));
  if (['tano_tabs', 'tano_columns', 'bullet_list', 'ordered_list'].includes(node.type.name))
    return node.content.content.flatMap(child => [...child.content.content]);
  return null;
}

/** Menu conversions keep each root and its descendant tree in place. */
export function blockMenuStructure(state: EditorState, action: string) {
  const selected = state.selection;
  const positions = selected instanceof BlockRangeSelection ? selected.blocks.map(block => block.pos)
    : selected instanceof NodeSelection ? [selected.from] : [];
  if (!positions.length) return null;
  const tr = state.tr;
  if (action.startsWith('wrap-')) {
    const entries = positions.map(pos => blockTree(state.doc).find(entry => entry.pos === pos)!);
    const first = entries[0]!, last = entries.at(-1)!;
    if (!entries.every((entry, i) => entry.parentPos === first.parentPos && entry.index === first.index + i)) return null;
    const content = Fragment.fromArray(entries.map(entry => entry.node));
    const type = action.slice(5), nodes = state.schema.nodes;
    let node: Node;
    if (type === 'quote') node = nodes.blockquote!.create(null, content);
    else if (type === 'callout') node = nodes.blockquote!.create(null,
      Fragment.from(nodes.paragraph!.create(null, state.schema.text('[!NOTE]'))).append(content));
    else if (type === 'toggle') node = nodes.tano_toggle!.create({ title: '详细内容' }, content);
    else if (type === 'tabs' || type === 'columns') node = nodes[`tano_${type}`]!.create(null,
      nodes.tano_panel!.create({ title: '分区一' }, content));
    else return null;
    if (!first.parent.canReplace(first.index, last.index + 1, Fragment.from(node))) return null;
    tr.replaceWith(first.pos, last.pos + last.node.nodeSize, node);
    return tr.setSelection(NodeSelection.create(tr.doc, first.pos));
  }
  for (const pos of [...positions].reverse()) {
    const node = tr.doc.nodeAt(pos)!;
    if (action === 'unwrap') {
      const content = children(node);
      if (!content?.length) return null;
      const $pos = tr.doc.resolve(pos);
      if (!$pos.parent.canReplace($pos.index(), $pos.index() + 1, Fragment.fromArray(content))) return null;
      tr.replaceWith(pos, pos + node.nodeSize, content);
    } else {
      const current = state.apply(tr);
      const single = current.apply(current.tr.setSelection(NodeSelection.create(current.doc, pos)));
      let converted: Transaction | null = null;
      if (!blockCommand(action)(single, result => { converted = result; }) || !converted) return null;
      const result = converted as Transaction;
      const before = blockTree(single.doc), after = blockTree(result.doc);
      if (before.length !== after.length || before.some((entry, i) => entry.depth !== after[i]!.depth)) return null;
      for (const step of result.steps) tr.step(step);
    }
  }
  if (action === 'unwrap') return tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(positions[0]!, -1))));
  const mapped = positions.map(pos => tr.mapping.map(pos, -1));
  return tr.setSelection(BlockRangeSelection.fromBlocks(tr.doc, mapped)!);
}
