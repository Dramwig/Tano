import type { Ctx } from '@milkdown/kit/ctx';
import type { DOMOutputSpec } from '@milkdown/kit/prose/model';
import { blockquoteSchema, imageSchema } from '@milkdown/kit/preset/commonmark';
import { tableCellSchema, tableHeaderSchema, tableSchema } from '@milkdown/kit/preset/gfm';
import { calloutMarker } from './callout';

/** Shared by the desktop view and server codec to keep their Markdown schema identical. */
export function configureMarkdownSchema(ctx: Ctx) {
  // GFM commonly puts the marker and first body line in one paragraph. Keep
  // the marker separate so body commands can move/convert that line safely.
  ctx.update(blockquoteSchema.key, (previous) => (inner) => {
    const schema = previous(inner);
    return {
      ...schema,
      parseMarkdown: {
        ...schema.parseMarkdown,
        runner(state, node, type) {
          const children = [...(node.children ?? [])];
          const first = children[0];
          const text = first?.type === 'paragraph' ? first.children?.[0] : undefined;
          const marker = text?.type === 'text' ? calloutMarker.exec(String(text.value)) : null;
          if (marker && first && text) {
            const body = [...(first.children ?? [])];
            const rest = String(text.value).slice(marker[0].length).replace(/^[\t ]+/, '');
            if (rest) body[0] = { ...text, value: rest };
            else {
              body.shift();
              if (body[0]?.type === 'break') body.shift();
            }
            children.splice(0, 1,
              { type: 'paragraph', children: [{ type: 'text', value: marker[0] }] },
              ...(body.length ? [{ type: 'paragraph', children: body }] : []),
            );
            if (children.length === 1) children.push({ type: 'paragraph', children: [] });
          }
          state.openNode(type).next(children).closeNode();
        },
      },
    };
  });
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
