import type { Ctx } from '@milkdown/kit/ctx';
import type { DOMOutputSpec } from '@milkdown/kit/prose/model';
import { imageSchema } from '@milkdown/kit/preset/commonmark';
import { tableCellSchema, tableHeaderSchema, tableSchema } from '@milkdown/kit/preset/gfm';

/** Shared by the desktop view and server codec to keep their Markdown schema identical. */
export function configureMarkdownSchema(ctx: Ctx) {
  ctx.update(tableSchema.key, (previous) => (inner) => {
    const schema = previous(inner);
    return { ...schema, attrs: { ...schema.attrs, layoutId: { default: null } } };
  });
  // Yjs omits null attributes. A Markdown column with unspecified alignment must
  // remain unspecified when it is rehydrated from its XML fragment.
  for (const cell of [tableCellSchema, tableHeaderSchema]) {
    ctx.update(cell.key, (previous) => (inner) => {
      const schema = previous(inner);
      return {
        ...schema,
        attrs: { ...schema.attrs, alignment: { ...schema.attrs?.alignment, default: null }, background: { default: null }, foreground: { default: null } },
        toDOM(node) {
          const output = schema.toDOM!(node) as [string, Record<string, unknown>, ...DOMOutputSpec[]];
          return [output[0], { ...output[1], 'data-tano-table-color': node.attrs.background, 'data-tano-table-text-color': node.attrs.foreground }, ...output.slice(2)] as DOMOutputSpec;
        },
      };
    });
  }
  // remark uses null for omitted image fields; Milkdown validates string attrs.
  ctx.update(imageSchema.key, (previous) => (inner) => {
    const schema = previous(inner);
    return {
      ...schema,
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner(state, node, type) {
          state.addNode(type, {
            src: node.url ?? '',
            alt: node.alt ?? '',
            title: node.title ?? '',
          });
        },
      },
    };
  });
}
