import { NodeSelection, Selection, SelectionRange, TextSelection } from '@milkdown/kit/prose/state';
import { Fragment, Slice } from '@milkdown/kit/prose/model';
import type { SelectionBookmark } from '@milkdown/kit/prose/state';
import type { Node } from '@milkdown/kit/prose/model';
import type { Mappable } from '@milkdown/kit/prose/transform';
import { blockTree } from './block-tree';
import type { BlockEntry } from './block-tree';

/** Explicit, nonoverlapping block subtrees, independent of native text selection. */
export class BlockRangeSelection extends Selection {
  visible = false;

  private constructor(doc: Node, readonly blocks: BlockEntry[], readonly anchorBlock: number, readonly headBlock: number) {
    const from = blocks[0]!.pos;
    const last = blocks.at(-1)!;
    const to = last.pos + last.node.nodeSize;
    const ranges: SelectionRange[] = [];
    for (const block of blocks) {
      const previous = ranges.at(-1);
      const end = doc.resolve(block.pos + block.node.nodeSize);
      if (previous?.$to.pos === block.pos)
        ranges[ranges.length - 1] = new SelectionRange(previous.$from, end);
      else ranges.push(new SelectionRange(doc.resolve(block.pos), end));
    }
    super(doc.resolve(anchorBlock <= headBlock ? from : to), doc.resolve(anchorBlock <= headBlock ? to : from), ranges);
  }

  static fromBlocks(doc: Node, positions: readonly number[], anchor = positions[0], head = positions.at(-1)): BlockRangeSelection | null {
    const selected = new Set(positions);
    const blocks: BlockEntry[] = [];
    for (const entry of blockTree(doc)) {
      if (!selected.has(entry.pos)) continue;
      const previous = blocks.at(-1);
      if (!previous || entry.pos >= previous.pos + previous.node.nodeSize) blocks.push(entry);
    }
    if (!blocks.length) return null;
    return new BlockRangeSelection(doc, blocks,
      blocks.find(block => block.pos === anchor)?.pos ?? blocks[0]!.pos,
      blocks.find(block => block.pos === head)?.pos ?? blocks.at(-1)!.pos);
  }

  static toggleBlock(doc: Node, current: readonly number[], pos: number, anchor = current[0]): BlockRangeSelection | null {
    if (current.includes(pos)) return this.fromBlocks(doc, current.filter(value => value !== pos), anchor, pos);
    const entry = blockTree(doc).find(block => block.pos === pos);
    if (!entry) return this.fromBlocks(doc, current, anchor);
    // An explicit child replaces its selected ancestor; selecting an ancestor
    // absorbs selected descendants. Never copy or move a subtree twice.
    const positions = current.filter(value => {
      const node = doc.nodeAt(value);
      return node && !(value <= pos && pos < value + node.nodeSize) &&
        !(pos <= value && value < pos + entry.node.nodeSize);
    });
    return this.fromBlocks(doc, [...positions, pos], anchor, pos);
  }

  static betweenBlocks(doc: Node, anchor: number, head: number): BlockRangeSelection | null {
    const tree = blockTree(doc);
    const ancestors = (pos: number) => tree.filter(entry => entry.pos <= pos && pos < entry.pos + entry.node.nodeSize).reverse();
    for (const first of ancestors(anchor)) {
      const last = ancestors(head).find(entry => entry.parentPos === first.parentPos);
      if (!last) continue;
      const blocks = tree.filter(entry => entry.parentPos === first.parentPos &&
        entry.index >= Math.min(first.index, last.index) && entry.index <= Math.max(first.index, last.index));
      return new BlockRangeSelection(doc, blocks, first.pos, last.pos);
    }
    return null;
  }

  eq(other: Selection) {
    return other instanceof BlockRangeSelection && other.anchorBlock === this.anchorBlock && other.headBlock === this.headBlock &&
      other.blocks.length === this.blocks.length && other.blocks.every((block, index) => block.pos === this.blocks[index]!.pos);
  }

  content() { return new Slice(Fragment.fromArray(this.blocks.map(block => block.node)), 0, 0); }
  map(doc: Node, mapping: Mappable): Selection { return this.getBookmark().map(mapping).resolve(doc); }
  toJSON() { return { type: 'tano-block-range', anchor: this.anchorBlock, head: this.headBlock, blocks: this.blocks.map(block => block.pos) }; }
  static fromJSON(doc: Node, json: { anchor: number; head: number; blocks?: number[] }): Selection {
    // Continue reading bookmarks saved before individual block toggling existed.
    const positions = json.blocks ?? BlockRangeSelection.betweenBlocks(doc, json.anchor, json.head)?.blocks.map(block => block.pos) ?? [];
    return new BlockRangeBookmark(json.anchor, json.head, positions).resolve(doc);
  }
  getBookmark(): SelectionBookmark { return new BlockRangeBookmark(this.anchorBlock, this.headBlock, this.blocks.map(block => block.pos)); }
}

class BlockRangeBookmark implements SelectionBookmark {
  constructor(readonly anchor: number, readonly head: number, readonly positions: readonly number[]) {}
  map(mapping: Mappable) {
    const anchor = mapping.mapResult(this.anchor, 1), head = mapping.mapResult(this.head, 1);
    const positions = this.positions.map(pos => mapping.mapResult(pos, 1)).filter(result => !result.deleted).map(result => result.pos);
    return new BlockRangeBookmark(anchor.pos, head.pos, positions);
  }
  resolve(doc: Node): Selection {
    const selection = BlockRangeSelection.fromBlocks(doc, this.positions, this.anchor, this.head);
    if (selection) return selection;
    return Selection.near(doc.resolve(Math.max(0, Math.min(doc.content.size, this.anchor || 0))));
  }
}

Selection.jsonID('tano-block-range', BlockRangeSelection);

/** Expand through the portable block tree, not schema-only list/cell/panel wrappers. */
export function expandBlockSelection(doc: Node, selection: Selection): Selection | null {
  const tree = blockTree(doc);
  if (!tree.length) return null;
  const deepestFirst = [...tree].reverse();
  const siblings = (parentPos: number) => tree.filter(block => block.parentPos === parentPos);
  const contains = (block: BlockEntry, from: number, to: number) =>
    block.pos <= from && to <= block.pos + block.node.nodeSize;
  let scope: BlockEntry | undefined;

  if (selection instanceof BlockRangeSelection) {
    const first = selection.blocks[0]!;
    const group = siblings(first.parentPos);
    if (selection.blocks.every(block => block.parentPos === first.parentPos)) {
      if (group.length !== selection.blocks.length)
        return BlockRangeSelection.fromBlocks(doc, group.map(block => block.pos));
      // A complete sibling group grows to its owning block's sibling group.
      scope = deepestFirst.find(block => block.pos < first.pos && contains(block, selection.from, selection.to));
      if (!scope) return BlockRangeSelection.fromBlocks(doc, siblings(-1).map(block => block.pos));
    }
  } else {
    scope = deepestFirst.find(block => contains(block, selection.from, selection.to));
    if (scope) {
      if (scope.node.isTextblock) {
        if (!scope.node.content.size) return BlockRangeSelection.fromBlocks(doc, [scope.pos]);
        const content = TextSelection.create(doc, scope.pos + 1, scope.pos + scope.node.nodeSize - 1);
        if (selection.empty || selection.from !== content.from || selection.to !== content.to) return content;
      } else if (!(selection instanceof NodeSelection && selection.from === scope.pos)) {
        return BlockRangeSelection.fromBlocks(doc, [scope.pos]);
      }
    }
  }

  // A selection spanning several branches expands to their common container's children.
  if (!scope) {
    const container = deepestFirst.find(block => contains(block, selection.from, selection.to));
    const children = container && siblings(container.pos);
    if (children?.length) return BlockRangeSelection.fromBlocks(doc, children.map(block => block.pos));
  }
  return BlockRangeSelection.fromBlocks(doc, siblings(scope?.parentPos ?? -1).map(block => block.pos));
}
