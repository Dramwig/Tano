// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { undo, redo } from '@milkdown/kit/prose/history';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { Node, Schema } from '@milkdown/kit/prose/model';
import { $prose } from '@milkdown/kit/utils';
import { enhanced } from './enhanced';
import { mathRemark, inlineMath, blockMath } from './math';
import { deleteEmptyBlock, emptyBlockDeletion } from './empty-block';

let editor: Editor | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await editor?.destroy();
  host?.remove();
});

async function mount(build: (schema: Schema) => Node[]) {
  host = document.createElement('div');
  document.body.append(host);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  let readonly = false;
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host!);
      ctx.set(defaultValueCtx, '');
    })
    .use(commonmark)
    .use(gfm)
    .use(mathRemark)
    .use(inlineMath)
    .use(blockMath)
    .use(enhanced)
    .use(history)
    .use($prose(() => emptyBlockDeletion(() => readonly)))
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.dispatch(
    view.state.tr
      .replaceWith(0, view.state.doc.content.size, build(view.state.schema))
      .setMeta('addToHistory', false),
  );
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  view.focus();
  const key = (key: string, options: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
      ...options,
    });
    view.dom.dispatchEvent(event);
    return event;
  };
  return {
    view,
    key,
    readonly() {
      readonly = true;
      view.setProps({ editable: () => false });
    },
  };
}

function paragraph(schema: Schema, text = '') {
  return schema.nodes.paragraph!.create(null, text ? schema.text(text) : undefined);
}
function empty(schema: Schema, kind: string): Node {
  const p = paragraph(schema);
  const nodes = schema.nodes;
  if (kind === 'heading') return nodes.heading!.create({ level: 1 });
  if (kind === 'paragraph' || kind === 'code_block') return nodes[kind]!.create();
  if (kind === 'blockquote') return nodes.blockquote!.create(null, p);
  if (kind === 'callout') return nodes.blockquote!.create(null, [paragraph(schema, '[!NOTE]'), p]);
  if (kind === 'bullet_list' || kind === 'ordered_list' || kind === 'todo')
    return nodes[kind === 'todo' ? 'bullet_list' : kind]!.create(
      null,
      nodes.list_item!.create(kind === 'todo' ? { checked: false } : null, p),
    );
  if (kind === 'table')
    return nodes.table!.create(
      null,
      nodes.table_row!.create(null, [
        nodes.table_header!.create(null, p),
        nodes.table_header!.create(null, p),
      ]),
    );
  if (kind === 'tano_toggle') return nodes.tano_toggle!.create({ title: '详细内容' }, p);
  return nodes[kind]!.create(null, nodes.tano_panel!.create({ title: '分区一' }, p));
}

describe('delete empty blocks', () => {
  it.each(['Backspace', 'Delete'])(
    '%s deletes an empty heading without downgrading and restores it on undo',
    async (keyName) => {
      const { view, key } = await mount((s) => [paragraph(s, 'previous'), empty(s, 'heading')]);
      expect(key(keyName).defaultPrevented).toBe(true);
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.textContent).toBe('previous');
      expect(view.state.selection.from).toBe(view.state.doc.firstChild!.nodeSize - 1);
      undo(view.state, view.dispatch);
      expect(view.state.doc.lastChild!.type.name).toBe('heading');
      expect(view.state.doc.lastChild!.attrs.level).toBe(1);
      expect(view.state.selection.$from.parent.type.name).toBe('heading');
      redo(view.state, view.dispatch);
      expect(view.state.doc.childCount).toBe(1);
    },
  );

  it.each([
    'paragraph',
    'heading',
    'code_block',
    'blockquote',
    'callout',
    'bullet_list',
    'ordered_list',
    'todo',
    'table',
    'tano_toggle',
    'tano_tabs',
    'tano_columns',
  ])('deletes the empty %s block and places the caret after the previous text', async (kind) => {
    const { view, key } = await mount((s) => [paragraph(s, 'before'), empty(s, kind)]);
    key('Backspace');
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.textContent).toBe('before');
    expect(view.state.selection.$from.parentOffset).toBe(6);
    view.state.doc.check();
  });

  it('preserves the following block when Delete removes an empty heading in the middle', async () => {
    const { view, key } = await mount((s) => [
      paragraph(s, 'before'),
      empty(s, 'heading'),
      paragraph(s, 'after'),
    ]);
    view.dispatch(
      view.state.tr.setSelection(
        TextSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize + 1),
      ),
    );
    key('Delete');
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild!.textContent).toBe('after');
    expect(view.state.selection.$from.parent.textContent).toBe('before');
    expect(view.state.selection.$from.parentOffset).toBe(6);
  });

  it('removes only an empty list item when earlier items contain text', async () => {
    const { view, key } = await mount((s) => [
      s.nodes.bullet_list!.create(null, [
        s.nodes.list_item!.create(null, paragraph(s, 'keep')),
        s.nodes.list_item!.create(null, paragraph(s)),
      ]),
    ]);
    key('Backspace');
    expect(view.state.doc.firstChild!.type.name).toBe('bullet_list');
    expect(view.state.doc.firstChild!.childCount).toBe(1);
    expect(view.state.selection.$from.parent.textContent).toBe('keep');
    expect(view.state.selection.$from.parentOffset).toBe(4);
  });

  it('does not remove an empty cell from a populated table', async () => {
    const { view, key } = await mount((s) => [
      paragraph(s, 'before'),
      s.nodes.table!.create(
        null,
        s.nodes.table_row!.create(null, [
          s.nodes.table_header!.create(null, paragraph(s, 'keep')),
          s.nodes.table_header!.create(null, paragraph(s)),
        ]),
      ),
    ]);
    expect(deleteEmptyBlock(view.state)).toBeNull();
    key('Backspace');
    expect(view.state.doc.lastChild!.firstChild!.childCount).toBe(2);
    expect(view.state.doc.lastChild!.textContent).toBe('keep');
  });

  it('does not treat media with no textContent as empty content', async () => {
    const { view } = await mount((s) => [
      paragraph(s, 'before'),
      s.nodes.blockquote!.create(null, [
        s.nodes.paragraph!.create(null, s.nodes.image!.create({ src: 'assets/photo.png' })),
        paragraph(s),
      ]),
    ]);
    const tr = deleteEmptyBlock(view.state)!;
    view.dispatch(tr);
    expect(view.state.doc.lastChild!.type.name).toBe('blockquote');
    expect(view.state.doc.lastChild!.firstChild!.firstChild!.type.name).toBe('image');
  });

  it('supports selecting the empty block itself and preserves populated or partial selections', async () => {
    const { view, key } = await mount((s) => [paragraph(s, 'before'), empty(s, 'heading')]);
    view.dispatch(
      view.state.tr.setSelection(
        NodeSelection.create(view.state.doc, view.state.doc.firstChild!.nodeSize),
      ),
    );
    key('Delete');
    expect(view.state.doc.childCount).toBe(1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(deleteEmptyBlock(view.state)).toBeNull();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(deleteEmptyBlock(view.state)).toBeNull();
  });

  it.each(['heading', 'table', 'tano_toggle', 'bullet_list'])(
    'keeps an editable paragraph after deleting the only empty %s',
    async (kind) => {
      const { view, key } = await mount((s) => [empty(s, kind)]);
      key('Backspace');
      expect(view.state.doc.childCount).toBe(1);
      expect(view.state.doc.firstChild!.type.name).toBe('paragraph');
      view.state.doc.check();
    },
  );

  it('does not override IME composition or readonly mode', async () => {
    const { view, key, readonly } = await mount((s) => [
      paragraph(s, 'before'),
      empty(s, 'heading'),
    ]);
    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    key('Backspace', { isComposing: true });
    expect(view.state.doc.childCount).toBe(2);
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    readonly();
    key('Delete');
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.lastChild!.type.name).toBe('heading');
  });
});
