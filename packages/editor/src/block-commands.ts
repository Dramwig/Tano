import { Fragment } from '@milkdown/kit/prose/model';
import type { Node, Schema } from '@milkdown/kit/prose/model';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { Command } from '@milkdown/kit/prose/state';
import { canTransformBlock, selectedBlocks } from './document-model';
import { safeResourceUrl } from './enhanced-markdown';
import { BlockRangeSelection } from './block-selection';

export const blockCommandNames = new Set([
  'paragraph',
  'heading',
  'quote',
  'list',
  'ordered-list',
  'todo-list',
  'code-block',
  'mermaid',
  'callout',
  'table',
  'image',
  'horizontal-rule',
  'math-block',
  'toggle',
  'tabs',
  'columns',
  'file',
  'embed',
]);

function paragraphs(node: Node, schema: Schema): Node[] {
  if (node.isTextblock) return [schema.nodes.paragraph!.create(null, node.content)];
  const result: Node[] = [];
  node.forEach((child) => result.push(...paragraphs(child, schema)));
  return result;
}

/** Keep block conversions and insertions atomic, undoable, and independent of Vue. */
export function blockCommand(name: string, value?: string, currentTextblock = false): Command {
  return (state, dispatch) => {
    const selection = state.selection;
    if (selection instanceof BlockRangeSelection && selection.ranges.length > 1 &&
      !['toggle', 'tabs', 'columns', 'file', 'embed', 'image', 'horizontal-rule', 'math-block', 'table'].includes(name)) {
      const tr = state.tr;
      // Run each contiguous group independently so conversions cannot replace
      // unselected gaps. Accumulate every step in the same undo transaction.
      for (const range of [...selection.ranges].reverse()) {
        const positions = selection.blocks.filter(block => block.pos >= range.$from.pos && block.pos < range.$to.pos)
          .map(block => tr.mapping.map(block.pos, 1));
        let current = state.apply(tr);
        current = current.apply(current.tr.setSelection(BlockRangeSelection.fromBlocks(current.doc, positions)!));
        if (!blockCommand(name, value)(current, result => {
          for (const step of result.steps) tr.step(step);
          tr.setSelection(result.selection.getBookmark().resolve(tr.doc));
        })) return false;
      }
      dispatch?.(tr.scrollIntoView());
      return true;
    }
    const blocks =
      currentTextblock && state.selection instanceof TextSelection && state.selection.$from.depth
        ? [{ node: state.selection.$from.parent, pos: state.selection.$from.before() }]
        : selectedBlocks(state);
    if (!blocks.length) return false;
    const { schema } = state;
    const paragraph = schema.nodes.paragraph!;
    const first = blocks[0]!;
    const last = blocks[blocks.length - 1]!;
    let replacement: Node[];
    let insert = false;
    const text = (content: string) => (content ? schema.text(content) : undefined);
    if (['toggle', 'tabs', 'columns', 'file', 'embed'].includes(name)) {
      if ((name === 'file' || name === 'embed') && (!value || !safeResourceUrl(value)))
        return false;
      const panel = (title: string) =>
        schema.nodes.tano_panel!.create({ title }, paragraph.create());
      replacement = [
        schema.nodes[`tano_${name}`]!.create(
          {
            title: name === 'toggle' ? '详细内容' : (value?.split('/').pop() ?? ''),
            url: value ?? '',
          },
          name === 'toggle'
            ? paragraph.create()
            : name === 'tabs' || name === 'columns'
              ? [panel('分区一'), panel('分区二')]
              : undefined,
        ),
      ];
      insert = true;
    } else if (name === 'image') {
      if (!value?.trim()) return false;
      replacement = [
        paragraph.create(null, schema.nodes.image!.create({ src: value.trim(), alt: '图片' })),
      ];
      insert = true;
    } else if (name === 'horizontal-rule') {
      replacement = [schema.nodes.hr!.create()];
      insert = true;
    } else if (name === 'math-block') {
      replacement = [schema.nodes.math_block!.create({ value: 'E = mc^2' })];
      insert = true;
    } else if (name === 'table') {
      const row = (header: boolean) =>
        schema.nodes[header ? 'table_header_row' : 'table_row']!.create(
          null,
          Array.from({ length: 3 }, () =>
            schema.nodes[header ? 'table_header' : 'table_cell']!.create(null, paragraph.create()),
          ),
        );
      replacement = [schema.nodes.table!.create(null, [row(true), row(false), row(false)])];
      insert = true;
    } else {
      if (!['quote', 'callout'].includes(name) && !blocks.every(({ node }) => canTransformBlock(node))) return false;
      const content = blocks.flatMap(({ node }) => paragraphs(node, schema));
      if (name === 'paragraph') replacement = content;
      else if (name === 'heading') {
        const level = Number(value ?? 2);
        if (!Number.isInteger(level) || level < 1 || level > 6) return false;
        replacement = content.map((node) => schema.nodes.heading!.create({ level }, node.content));
      } else if (name === 'quote' || name === 'callout') {
        // Preserve nested content when adding a container, and avoid nesting it on repeat clicks.
        const children = blocks.flatMap(({ node }) =>
          node.type.name === 'blockquote'
            ? Array.from({ length: node.childCount }, (_, i) => node.child(i))
            : [node],
        );
        if (name === 'callout' && value) {
          if (!/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION)$/i.test(value)) return false;
          const marker = /^\[!(?:NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.exec(
            children[0]?.textContent ?? '',
          );
          if (marker && children[0]?.type.name === 'paragraph') {
            const firstChild = children[0];
            children[0] = paragraph.create(
              null,
              Fragment.from(schema.text(`[!${value.toUpperCase()}]`)).append(
                firstChild.content.cut(marker[0].length),
              ),
            );
          } else children.unshift(paragraph.create(null, schema.text(`[!${value.toUpperCase()}]`)));
        }
        if (
          name === 'callout' &&
          !/^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i.test(children[0]?.textContent ?? '')
        )
          children.unshift(paragraph.create(null, schema.text('[!NOTE]')));
        if (
          name === 'quote' &&
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i.test(children[0]?.textContent ?? '')
        )
          children.shift();
        replacement = [
          schema.nodes.blockquote!.create(null, children.length ? children : paragraph.create()),
        ];
      } else if (['list', 'ordered-list', 'todo-list'].includes(name)) {
        const ordered = name === 'ordered-list';
        const items: Node[] = [];
        for (const { node } of blocks) {
          if (['bullet_list', 'ordered_list'].includes(node.type.name)) {
            node.forEach((item) =>
              items.push(
                schema.nodes.list_item!.create(
                  {
                    ...item.attrs,
                    listType: ordered ? 'ordered' : 'bullet',
                    label: ordered ? `${items.length + 1}.` : '•',
                    checked: name === 'todo-list' ? (item.attrs.checked ?? false) : null,
                  },
                  item.content,
                ),
              ),
            );
          } else {
            const children = node.type.name === 'paragraph' ? [node] : paragraphs(node, schema);
            for (const child of children)
              items.push(
                schema.nodes.list_item!.create(
                  {
                    listType: ordered ? 'ordered' : 'bullet',
                    label: ordered ? `${items.length + 1}.` : '•',
                    checked: name === 'todo-list' ? false : null,
                  },
                  child,
                ),
              );
          }
        }
        replacement = [schema.nodes[ordered ? 'ordered_list' : 'bullet_list']!.create(null, items)];
      } else if (name === 'code-block' || name === 'mermaid') {
        // Inline atoms (images, math, mentions) cannot be represented by plain code text.
        if (
          content.some((node) => {
            let atom = false;
            node.forEach((child) => {
              if (!child.isText && child.type.name !== 'hardbreak') atom = true;
            });
            return atom;
          })
        )
          return false;
        const code = content
          .map((node) => node.textBetween(0, node.content.size, '\n', '\n'))
          .join('\n');
        replacement = [
          schema.nodes.code_block!.create(
            { language: name === 'mermaid' ? 'mermaid' : '' },
            text(code || (name === 'mermaid' ? 'graph TD\n  A[开始] --> B[结束]' : '')),
          ),
        ];
      } else return false;
    }
    if (!dispatch) return true;
    // Insertion tools append after a nonempty block, preserving its existing content.
    const replaceEmpty =
      blocks.length === 1 &&
      (first.node.type.name === 'paragraph' || (currentTextblock && first.node.isTextblock)) &&
      first.node.content.size === 0;
    const from = insert && !replaceEmpty ? last.pos + last.node.nodeSize : first.pos;
    const to = insert && !replaceEmpty ? from : last.pos + last.node.nodeSize;
    const $from = state.doc.resolve(from);
    const $to = state.doc.resolve(to);
    if (
      !$from.sameParent($to) ||
      !$from.parent.canReplace($from.index(), $to.index(), Fragment.fromArray(replacement))
    )
      return false;
    const tr = state.tr.replaceWith(from, to, Fragment.fromArray(replacement));
    if (
      state.selection instanceof TextSelection &&
      state.selection.empty &&
      replacement[0]?.isTextblock
    )
      tr.setSelection(
        TextSelection.create(
          tr.doc,
          from + 1 + Math.min(state.selection.$from.parentOffset, replacement[0].content.size),
        ),
      );
    else if (name === 'toggle') tr.setSelection(TextSelection.create(tr.doc, from + 2));
    else tr.setSelection(NodeSelection.create(tr.doc, from));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
