import { $remark } from '@milkdown/kit/utils';
import type { Code, Root, RootContent } from 'mdast';
import { defaultHandlers } from 'mdast-util-to-markdown';
import type { Plugin } from 'unified';

/** Keep a blank body line distinct from a fenced block with no body lines. */
export const remarkCodeBlankLines: Plugin<[], Root> = function () {
  const data = this.data();
  (data.toMarkdownExtensions ?? (data.toMarkdownExtensions = [])).push({
    handlers: {
      code(node, parent, state, info) {
        const output = defaultHandlers.code(node, parent, state, info);
        const value = (node as Code).value;
        if (!/^\n+$/.test(value) || !/(?:`{3,}|~{3,})$/.test(output)) return output;
        const beforeFence = output.lastIndexOf('\n');
        return output.slice(0, beforeFence) + output.slice(beforeFence + 1);
      },
    },
  });
  return (tree) => {
    const visit = (node: Root | RootContent) => {
      if (node.type === 'code' && (!node.value || /^\n+$/.test(node.value))) {
        const bodyLines = node.position
          ? Math.max(0, node.position.end.line - node.position.start.line - 1)
          : 0;
        if (bodyLines) node.value = '\n'.repeat(bodyLines);
      }
      if ('children' in node)
        for (const child of node.children) visit(child);
    };
    visit(tree);
  };
};

export const codeBlankLinesRemark = $remark('tano-code-blank-lines', () => remarkCodeBlankLines);
