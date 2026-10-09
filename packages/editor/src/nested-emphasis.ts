import { $remark } from '@milkdown/kit/utils';
import type { Literal, Nodes, Root } from 'mdast';
import type { Plugin } from 'unified';

interface NestedEmphasisSource extends Literal {
  type: 'tanoNestedEmphasisSource';
  value: string;
}

declare module 'mdast' {
  interface RootContentMap {
    tanoNestedEmphasisSource: NestedEmphasisSource;
  }
  interface PhrasingContentMap {
    tanoNestedEmphasisSource: NestedEmphasisSource;
  }
}

const emphasisTypes = new Set(['strong', 'emphasis']);

/** ProseMirror cannot represent two marks of the same type on one text span. */
const remarkNestedEmphasis: Plugin<[], Root> = () => (tree, file) => {
  const source = String(file.value);
  const repeatsMark = (node: Nodes, ancestors = new Set<string>()): boolean => {
    if (emphasisTypes.has(node.type)) {
      if (ancestors.has(node.type)) return true;
      ancestors = new Set([...ancestors, node.type]);
    }
    return 'children' in node && node.children.some(child => repeatsMark(child, ancestors));
  };
  const visit = (node: Nodes) => {
    if (!('children' in node)) return;
    for (let index = 0; index < node.children.length; index++) {
      const child = node.children[index]!;
      const position = 'position' in child ? child.position : undefined;
      const from = position?.start.offset;
      const to = position?.end.offset;
      if (emphasisTypes.has(child.type) && repeatsMark(child) && from !== undefined && to !== undefined) {
        // Keep the whole outer mark, including mixed markers and interior text,
        // so saving or reopening never silently flattens nested emphasis.
        node.children[index] = { type: 'tanoNestedEmphasisSource', value: source.slice(from, to), position };
      } else visit(child);
    }
  };
  visit(tree);
};

export const nestedEmphasisRemark = $remark('tano-nested-emphasis', () => remarkNestedEmphasis);
