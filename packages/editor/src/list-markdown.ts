import { $remark } from '@milkdown/kit/utils';
import { defaultHandlers } from 'mdast-util-to-markdown';
import { markdownPolicy } from './runtime';

/** Read the current workspace policy on each save, including nested lists and task items. */
export const listMarkdown = $remark('tano-list-markdown', (ctx) => function () {
  (this.data().toMarkdownExtensions ??= []).push({
    handlers: {
      list(node, parent, state, info) {
        const options = state.options;
        state.options = {
          ...options,
          bullet: markdownPolicy(ctx).bulletListMarker,
          // Let remark choose a different marker when required to keep adjacent lists separate.
          bulletOther: undefined,
        };
        try {
          return defaultHandlers.list(node, parent, state, info);
        } finally {
          state.options = options;
        }
      },
    },
  });
});
