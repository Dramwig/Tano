import { $remark } from '@milkdown/kit/utils';
import type { Nodes } from 'mdast';

/** Decode cell breaks before commonmark's empty-paragraph plugin removes HTML br tags. */
export function transformTableBreaks(node: Nodes, inTable = false) {
  if (!('children' in node)) return;
  inTable ||= node.type === 'tableCell';
  if (inTable) node.children = node.children.map(child =>
    child.type === 'html' && /^<br\s*\/?>$/i.test(child.value)
      ? { type: 'break' as const, position: child.position } : child) as typeof node.children;
  for (const child of node.children) transformTableBreaks(child, inTable);
}

export const tableBreaksRemark = $remark('tano-table-breaks', () => () => tree => transformTableBreaks(tree));
