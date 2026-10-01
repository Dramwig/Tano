// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { CellSelection } from '@milkdown/kit/prose/tables';
import { parseDocumentLayout } from '@tano/protocol';
import type { TableLayout } from '@tano/protocol';
import MarkdownEditor from './MarkdownEditor.vue';
import { moveTableLine, tableLineAction, tableLineSelection } from './table-commands';
import { tablesInDocument } from './table-layout';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
const markdown = '| A | B | C |\n| --- | --- | --- |\n| alpha | beta | gamma |\n| one | two | three |\n';

async function mount(source = markdown, saved: TableLayout[] = [], readonly = false) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const value = ref(source);
  const layouts = ref(saved);
  app = createApp({ render: () => h(MarkdownEditor, {
    ref: editor, documentId: 'a12345', modelValue: value.value, readonly, revealMarkdown: false,
    tableLayouts: layouts.value,
    'onUpdate:modelValue': (next: string) => { value.value = next; },
    onTableLayoutChange: (next: TableLayout[]) => { layouts.value = next; },
  }) });
  app.mount(root);
  await vi.waitFor(() => expect(editor.value!.withContext(ctx => ctx.get(editorViewCtx))).toBeDefined());
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(tablesInDocument(view.state.doc)[0]?.layout.id).toBeTruthy());
  return { view, editor, value, layouts };
}

it('selects exactly the whole row or column without changing Markdown', async () => {
  const { view, value } = await mount();
  for (const axis of ['row', 'column'] as const) {
    const selection = tableLineSelection(view.state.doc, { pos: 0, axis, index: 1 })!;
    view.dispatch(view.state.tr.setSelection(selection).setMeta('tanoBlockContextSelect', true));
    expect(view.state.selection).toBeInstanceOf(CellSelection);
    expect(axis === 'row' ? selection.isRowSelection() : selection.isColSelection()).toBe(true);
    const text: string[] = [];
    selection.forEachCell(cell => text.push(cell.textContent));
    expect(text).toEqual(axis === 'row' ? ['alpha', 'beta', 'gamma'] : ['B', 'beta', 'two']);
    expect(value.value).toBe(markdown);
  }
});

it('inserts above the header, duplicates, and deletes header/body rows with valid GFM and undo', async () => {
  const { view, editor } = await mount();
  const target = { pos: 0, axis: 'row' as const, index: 0 };
  view.dispatch(tableLineAction(view.state, target, 'before')!);
  view.state.doc.check();
  expect(view.state.doc.firstChild!.child(0).textContent).toBe('');
  expect(view.state.doc.firstChild!.child(1).textContent).toBe('ABC');
  expect(editor.value!.undoLastChange()).toBe(true);
  view.dispatch(tableLineAction(view.state, target, 'duplicate')!);
  view.state.doc.check();
  expect(view.state.doc.firstChild!.child(1).textContent).toBe('ABC');
  editor.value!.undoLastChange();
  view.dispatch(tableLineAction(view.state, target, 'delete')!);
  view.state.doc.check();
  expect(view.state.doc.firstChild!.child(0).type.name).toBe('table_header_row');
  expect(view.state.doc.firstChild!.child(0).textContent).toBe('alphabetagamma');
  view.dispatch(tableLineAction(view.state, { ...target, index: 1 }, 'delete')!);
  view.state.doc.check();
  expect(view.state.doc.firstChild!.childCount).toBe(2);
  expect(view.state.doc.firstChild!.child(1).textContent).toBe('');
});

it('clears every selected cell even when content lengths change and removes the final column', async () => {
  const { view, editor } = await mount();
  view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'column', index: 1 }, 'clear')!);
  expect(Array.from({ length: 3 }, (_, row) => view.state.doc.firstChild!.child(row).child(1).textContent)).toEqual(['', '', '']);
  view.state.doc.check();
  editor.value!.undoLastChange();
  for (let i = 0; i < 3; i++) view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'column', index: 0 }, 'delete')!);
  expect(tablesInDocument(view.state.doc)).toHaveLength(0);
  view.state.doc.check();
});

it('moves rows and columns with the existing table engine, preserving widths, colors, and header roles', async () => {
  const first = await mount();
  const saved = [{ ...tablesInDocument(first.view.state.doc)[0]!.layout, widths: [80, 210, 320] }];
  app!.unmount(); root.remove();
  const { view } = await mount(markdown, saved);
  view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'column', index: 0 }, 'color', 'blue')!);
  const column = moveTableLine(view.state, { pos: 0, axis: 'column', index: 0 }, 2);
  expect(column).not.toBeNull();
  view.dispatch(column!);
  expect(tablesInDocument(view.state.doc)[0]!.layout.widths).toEqual([210, 320, 80]);
  expect(view.state.doc.firstChild!.firstChild!.child(2).attrs.background).toBe('blue');
  const row = moveTableLine(view.state, { pos: 0, axis: 'row', index: 0 }, 2);
  expect(row).not.toBeNull();
  view.dispatch(row!);
  view.state.doc.check();
  expect(view.state.doc.firstChild!.child(0).type.name).toBe('table_header_row');
  expect(view.state.doc.firstChild!.child(2).textContent).toBe('BCA');
});

it('persists colors outside Markdown, restores them, and undoes them independently', async () => {
  const { view, editor, value, layouts } = await mount();
  view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'row', index: 1 }, 'color', 'yellow')!);
  await nextTick();
  expect(value.value).toBe(markdown);
  expect(layouts.value[0]!.backgrounds?.[1]).toEqual(['yellow', 'yellow', 'yellow']);
  expect(root.querySelector('td')!.getAttribute('data-tano-table-color')).toBe('yellow');
  const saved = JSON.parse(JSON.stringify(layouts.value)) as TableLayout[];
  const parsed = parseDocumentLayout(JSON.stringify({ version: 1, fileId: 'a12345', tables: saved }), 'a12345');
  expect(parsed.tables[0]!.backgrounds).toEqual(saved[0]!.backgrounds);
  editor.value!.undoLastChange();
  expect(tablesInDocument(view.state.doc)[0]!.layout.backgrounds).toBeUndefined();
  expect(value.value).toBe(markdown);
  app!.unmount(); root.remove();
  const reopened = await mount(markdown, saved, true);
  expect(tablesInDocument(reopened.view.state.doc)[0]!.layout.backgrounds?.[1]).toEqual(['yellow', 'yellow', 'yellow']);
  expect(reopened.value.value).toBe(markdown);
  expect(root.querySelector<HTMLButtonElement>('.tano-table-grip')!.hidden).toBe(true);
});

it('rejects invalid color metadata and invalid line targets', async () => {
  const { view } = await mount();
  expect(tableLineAction(view.state, { pos: 0, axis: 'row', index: 10 }, 'delete')).toBeNull();
  expect(moveTableLine(view.state, { pos: 0, axis: 'row', index: 1 }, 10)).toBeNull();
  const layout = tablesInDocument(view.state.doc)[0]!.layout;
  for (const field of ['backgrounds', 'foregrounds']) {
    for (const colors of [[['unknown', null, null]], [[null]]])
      expect(() => parseDocumentLayout(JSON.stringify({ version: 1, fileId: 'a12345', tables: [{ ...layout, [field]: colors }] }), 'a12345')).toThrow('表格颜色格式无效');
  }
});

it('saves text colors independently of backgrounds and Markdown, restores, moves, and resets them', async () => {
  const { view, value, layouts, editor } = await mount();
  const target = { pos: 0, axis: 'column' as const, index: 1 };
  view.dispatch(tableLineAction(view.state, target, 'color', 'orange')!);
  view.dispatch(tableLineAction(view.state, target, 'textColor', 'pink')!);
  await nextTick();
  expect(value.value).toBe(markdown);
  expect(layouts.value[0]!.foregrounds?.map(row => row[1])).toEqual(['pink', 'pink', 'pink']);
  expect(root.querySelectorAll('[data-tano-table-text-color="pink"]')).toHaveLength(3);
  const saved = JSON.parse(JSON.stringify(layouts.value)) as TableLayout[];
  expect(parseDocumentLayout(JSON.stringify({ version: 1, fileId: 'a12345', tables: saved }), 'a12345').tables[0]!.foregrounds).toEqual(saved[0]!.foregrounds);
  editor.value!.undoLastChange();
  expect(tablesInDocument(view.state.doc)[0]!.layout.foregrounds).toBeUndefined();
  expect(tablesInDocument(view.state.doc)[0]!.layout.backgrounds?.[0]?.[1]).toBe('orange');
  app!.unmount(); root.remove();
  const reopened = await mount(markdown, saved);
  expect(reopened.view.state.doc.firstChild!.firstChild!.child(1).attrs.foreground).toBe('pink');
  reopened.view.dispatch(tableLineAction(reopened.view.state, target, 'textColor')!);
  expect(tablesInDocument(reopened.view.state.doc)[0]!.layout.foregrounds).toBeUndefined();
  expect(tablesInDocument(reopened.view.state.doc)[0]!.layout.backgrounds?.[0]?.[1]).toBe('orange');
  reopened.editor.value!.undoLastChange();
  reopened.view.dispatch(moveTableLine(reopened.view.state, target, 2)!);
  expect(tablesInDocument(reopened.view.state.doc)[0]!.layout.foregrounds?.map(row => row[2])).toEqual(['pink', 'pink', 'pink']);
});

it('opens all line actions with keyboard navigation and cancels a pending gesture after a document edit', async () => {
  const { view } = await mount();
  for (const element of root.querySelectorAll<HTMLElement>('*'))
    element.getBoundingClientRect = () => new DOMRect(100, 100, 480, 200);
  const cell = root.querySelectorAll('tr')[1]!.children[1]!;
  const pointer = (type: string, element: Element, x = 180, y = 150) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    element.dispatchEvent(event);
  };
  pointer('pointermove', cell);
  const grip = root.querySelector<HTMLButtonElement>('.tano-table-grip.is-column')!;
  expect(grip.hidden).toBe(false);
  pointer('pointerdown', grip);
  pointer('pointerup', grip);
  const menu = root.querySelector<HTMLElement>('.tano-table-menu')!;
  expect(menu.hidden).toBe(false);
  expect((view.state.selection as CellSelection).isColSelection()).toBe(true);
  expect(menu.querySelector('input')).toBeNull();
  expect(menu.querySelectorAll('[role=menuitem]')).toHaveLength(6);
  expect(document.activeElement).toBe(menu.querySelector('[role=menuitem]'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  const palette = menu.querySelector<HTMLElement>('.tano-table-color-menu')!;
  expect(palette.hidden).toBe(false);
  expect(palette.querySelectorAll('[role=group]')).toHaveLength(2);
  expect(palette.querySelectorAll('[role=menuitemradio]')).toHaveLength(20);
  expect(document.activeElement!.textContent).toBe('A默认文字');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(palette.hidden).toBe(true);
  expect(menu.hidden).toBe(false);
  expect(document.activeElement).toBe(menu.querySelector('[role=menuitem]'));
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
  expect(document.activeElement!.textContent).toBe('删除列');
  document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(menu.hidden).toBe(true);
  pointer('pointermove', cell);
  pointer('pointerdown', grip);
  const tr = tableLineAction(view.state, { pos: 0, axis: 'row', index: 1 }, 'clear')!;
  view.dispatch(tr);
  pointer('pointerup', grip);
  expect(menu.hidden).toBe(true);
  expect(root.querySelector<HTMLElement>('.tano-table-line-drop')!.hidden).toBe(true);
  app!.unmount(); app = undefined;
  expect(root.querySelector('.tano-table-controls')).toBeNull();
  pointer('pointermove', root);
});

it('previews the selected row only after drag intent, follows its axis, and cleans up on cancellation, edits, and teardown', async () => {
  const source = markdown.replace('alpha', '**alpha**');
  const { view, value, layouts } = await mount(source);
  view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'row', index: 1 }, 'color', 'brown')!);
  const original = view.state.doc;
  const layout = JSON.stringify(layouts.value);
  const measure = () => {
    for (const element of root.querySelectorAll<HTMLElement>('*'))
      element.getBoundingClientRect = () => new DOMRect(80, 80, 600, 300);
    root.querySelector<HTMLTableElement>('table')!.getBoundingClientRect = () => new DOMRect(100, 100, 480, 120);
    root.querySelectorAll<HTMLTableRowElement>('tr').forEach((row, r) => {
      row.getBoundingClientRect = () => new DOMRect(100, 100 + r * 40, 480, 40);
      [...row.children].forEach((cell, c) => {
        cell.getBoundingClientRect = () => new DOMRect(100 + c * 160, 100 + r * 40, 160, 40);
      });
    });
  };
  const pointer = (type: string, target: Element, x = 100, y = 160) => {
    const event = new MouseEvent(type, { bubbles: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    target.dispatchEvent(event);
  };
  const start = () => {
    measure();
    pointer('pointermove', root.querySelectorAll('tr')[1]!.children[0]!);
    pointer('pointerdown', root.querySelector('.tano-table-grip.is-row')!);
  };
  start();
  pointer('pointermove', root, 102, 162);
  expect(root.querySelector('.tano-table-drag-preview')).toBeNull();
  pointer('pointermove', root, 125, 190);
  const preview = root.querySelector<HTMLElement>('.tano-table-drag-preview')!;
  expect(preview).not.toBeNull();
  expect(view.dom.contains(preview)).toBe(false);
  expect(preview.getAttribute('aria-hidden')).toBe('true');
  expect(preview.inert).toBe(true);
  expect(preview.querySelectorAll('tr')).toHaveLength(1);
  expect(preview.querySelectorAll('td[data-tano-table-color="brown"]')).toHaveLength(3);
  expect(preview.querySelector('strong')!.textContent).toBe('alpha');
  expect(preview.querySelectorAll('.selectedCell, [id], [contenteditable]')).toHaveLength(0);
  expect(preview.style.width).toBe('480px');
  expect(preview.style.height).toBe('40px');
  await vi.waitFor(() => expect(preview.style.transform).toBe('translate3d(100px, 170px, 0)'));
  expect(root.querySelector<HTMLElement>('.tano-table-grip.is-row')!.style.transform).toBe('translate3d(0px, 30px, 0)');
  expect(view.state.doc).toBe(original);
  expect(value.value).toBe(source);
  expect(JSON.stringify(layouts.value)).toBe(layout);
  pointer('pointercancel', root);
  expect(root.querySelector('.tano-table-drag-preview')).toBeNull();
  expect(root.querySelector('.tano-table-dragging')).toBeNull();
  expect(root.querySelector<HTMLElement>('.tano-table-grip.is-row')!.style.transform).toBe('');
  start(); pointer('pointermove', root, 100, 185);
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(root.querySelector('.tano-table-drag-preview')).toBeNull();
  start(); pointer('pointermove', root, 100, 185);
  view.dispatch(tableLineAction(view.state, { pos: 0, axis: 'row', index: 1 }, 'clear')!);
  expect(root.querySelector('.tano-table-drag-preview')).toBeNull();
  start(); pointer('pointermove', root, 100, 185);
  expect(root.querySelector('.tano-table-drag-preview')).not.toBeNull();
  app!.unmount(); app = undefined;
  expect(root.querySelector('.tano-table-drag-preview')).toBeNull();
});
