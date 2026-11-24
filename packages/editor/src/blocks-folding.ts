import type { EditorState, PluginKey, Transaction } from '@milkdown/kit/prose/state';
import type { Node as ProseMirrorNode } from '@milkdown/kit/prose/model';
import { Decoration } from '@milkdown/kit/prose/view';
import { blockTree } from './block-tree';

export type FoldEntry = Pick<ReturnType<typeof blockTree>[number], 'node' | 'pos' | 'parent' | 'index'>;

/** List items fold their own continuation; list containers never fold sibling items. */
export function foldingTree(doc: ProseMirrorNode, tree = blockTree(doc)): FoldEntry[] {
  const entries: FoldEntry[] = tree.filter(({ node }) => node.type.name === 'heading');
  doc.descendants((node, pos, parent, index) => {
    if (node.type.name === 'list_item' && node.childCount > 1 && parent) {
      entries.push({ node, pos, parent, index });
    }
  });
  return entries.sort((a, b) => a.pos - b.pos);
}

export function foldEntryKey(entry: Pick<FoldEntry, 'node' | 'pos'>): string {
  return `${entry.pos}:${entry.node.type.name}:${entry.node.textContent.slice(0, 80)}`;
}

export function applyFoldingState(
  transaction: Transaction,
  current: Set<string>,
  foldingKey: PluginKey<Set<string>>,
): Set<string> {
  const reveal = transaction.getMeta('tanoRevealPosition') as number | undefined;
  if (reveal !== undefined && current.size) {
    const next = new Set(current);
    foldingTree(transaction.doc).forEach(({ node, pos, parent, index }) => {
      const key = foldEntryKey({ node, pos });
      if (!next.has(key)) return;
      if (node.type.name === 'heading') {
        let end = pos + node.nodeSize;
        for (let i = index + 1; i < parent.childCount; i++) {
          const sibling = parent.child(i);
          if (
            sibling.type.name === 'heading' &&
            Number(sibling.attrs.level) <= Number(node.attrs.level)
          ) {
            break;
          }
          end += sibling.nodeSize;
        }
        if (reveal >= pos + node.nodeSize && reveal < end) next.delete(key);
      } else if (reveal > pos && reveal < pos + node.nodeSize) {
        next.delete(key);
      }
    });
    return next;
  }
  const toggle = transaction.getMeta(foldingKey) as string | undefined;
  if (!toggle) return current;
  const next = new Set(current);
  if (next.has(toggle)) next.delete(toggle);
  else next.add(toggle);
  return next;
}

export function buildFoldingDecorations(
  state: EditorState,
  foldingKey: PluginKey<Set<string>>,
  foldingEnabled: boolean,
): Decoration[] {
  if (!foldingEnabled) return [];
  const folded = foldingKey.getState(state) ?? new Set<string>();
  if (!folded.size) return [];
  const decorations: Decoration[] = [];
  const hidden = new Set<number>();
  const tree = blockTree(state.doc);
  const foldTargets = foldingTree(state.doc, tree);
  foldTargets.forEach(({ node, pos, parent, index }) => {
    if (!folded.has(foldEntryKey({ node, pos }))) return;
    if (node.type.name === 'heading') {
      const level = Number(node.attrs.level ?? 1);
      let nextPos = pos + node.nodeSize;
      for (let next = index + 1; next < parent.childCount; next++) {
        const nextNode = parent.child(next);
        if (nextNode.type.name === 'heading' && Number(nextNode.attrs.level ?? 1) <= level) {
          break;
        }
        hidden.add(nextPos);
        nextPos += nextNode.nodeSize;
      }
    }
  });
  tree.forEach(({ node, pos: offset }) => {
    if (hidden.has(offset)) {
      decorations.push(
        Decoration.node(offset, offset + node.nodeSize, { class: 'tano-folded-heading-content' }),
      );
    }
  });
  foldTargets.forEach(({ node, pos }) => {
    if (node.type.name !== 'list_item' || !folded.has(foldEntryKey({ node, pos }))) return;
    node.forEach((child, offset, index) => {
      if (index > 0) {
        decorations.push(
          Decoration.node(pos + 1 + offset, pos + 1 + offset + child.nodeSize, {
            class: 'tano-folded-list-content',
          }),
        );
      }
    });
  });
  return decorations;
}

export function foldButtonLeft(entry: FoldEntry, element: Element, rect: DOMRect): number {
  const left =
    entry.node.type.name === 'list_item'
      ? element.parentElement!.getBoundingClientRect().left
      : rect.left;
  // The text inset leaves room for the fold button beside the drag icon.
  return left + 8;
}
