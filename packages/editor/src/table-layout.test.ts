// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { columnResizingPluginKey } from '@milkdown/kit/prose/tables';
import type { TableLayout } from '@tano/protocol';
import MarkdownEditor from './MarkdownEditor.vue';
import { matchTableLayout, tablesInDocument } from './table-layout';
import { tableLineAction } from './table-commands';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });
const markdown = '前文\n\n| A | B |\n| --- | --- |\n| 甲 | 乙 |\n\n后文\n';

async function mount(source = markdown, saved: TableLayout[] = [], readonly = false) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const value = ref(source);
  const layouts = ref(saved);
  const changes: TableLayout[][] = [];
  const errors: string[] = [];
  app = createApp({ render: () => h(MarkdownEditor, {
    ref: editor, documentId: 'a12345', modelValue: value.value,
    readonly, revealMarkdown: false, tableLayouts: layouts.value,
    'onUpdate:modelValue': (next: string) => { value.value = next; },
    onTableLayoutChange: (next: TableLayout[]) => { changes.push(next); layouts.value = next; },
    onError: (error: string) => { errors.push(error); },
  }) });
  app.mount(root);
  await vi.waitFor(() => {
    expect(errors).toEqual([]);
    expect(editor.value!.withContext(ctx => ctx.get(editorViewCtx))).toBeDefined();
  });
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(tablesInDocument(view.state.doc)[0]?.layout.id).toBeTruthy());
  await nextTick();
  return { view, editor, value, layouts, changes };
}

it('renders fixed pixel widths, commits the drag once, and leaves Markdown byte-identical through undo/redo', async () => {
  const { view, editor, value, changes } = await mount();
  expect(root.querySelector('table')!.style.width).toBe('320px');
  const { node, pos } = tablesInDocument(view.state.doc)[0]!;
  const cell = pos + 2;
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: cell }));
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: { startX: 0, startWidth: 160 } }));
  const tr = view.state.tr;
  node.forEach((row, rowOffset) => {
    const current = row.firstChild!;
    tr.setNodeMarkup(pos + 2 + rowOffset, undefined, { ...current.attrs, colwidth: [900] });
  });
  view.dispatch(tr);
  expect(changes).toHaveLength(0);
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setDragging: null }));
  await nextTick();
  expect(changes.at(-1)![0]!.widths).toEqual([900, 160]);
  expect(root.querySelector('table')!.style.width).toBe('1060px');
  expect(value.value).toBe(markdown);
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(root.querySelector('table')!.style.width).toBe('320px');
  expect(value.value).toBe(markdown);
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(root.querySelector('table')!.style.width).toBe('1060px');
  expect(value.value).toBe(markdown);
});

it('restores widths on reopen in a read-only document and finds the table after an independent external insertion', async () => {
  const first = await mount();
  const table = tablesInDocument(first.view.state.doc)[0]!.layout;
  const saved = [{ ...table, autoWidth: undefined, widths: [80, 210] }];
  app!.unmount(); root.remove();
  const source = '| X | Y |\n| --- | --- |\n| 1 | 2 |\n\n' + markdown;
  const reopened = await mount(source, saved, true);
  const tables = tablesInDocument(reopened.view.state.doc);
  expect(tables[0]!.layout.widths).toEqual([160, 160]);
  expect(tables[1]!.layout.widths).toEqual([80, 210]);
  expect(tables[1]!.layout.id).toBe(table.id);
  expect(reopened.value.value).toBe(source);
  expect(reopened.changes).toEqual([]);
  expect(reopened.editor.value!.canUndo()).toBe(false);
});

it('does not assign a saved layout to indistinguishable duplicate tables', () => {
  const table: TableLayout = { id: '', widths: [160, 160], anchor: { content: 'same', before: '', after: '' } };
  expect(matchTableLayout(table, [table, table], [{ ...table, id: 'table-1234', widths: [100, 300] }])).toBeUndefined();
});

it('persists only customized tables when an untouched table is inserted before them', async () => {
  const first = await mount();
  const table = tablesInDocument(first.view.state.doc)[0]!.layout;
  app!.unmount(); root.remove();
  const source = '| X | Y |\n| --- | --- |\n| 1 | 2 |\n\n' + markdown;
  const restored = await mount(source, [{ ...table, autoWidth: undefined, widths: [80, 210] }]);
  expect(restored.layouts.value).toHaveLength(1);
  expect(restored.layouts.value[0]!.id).toBe(table.id);
  expect(restored.layouts.value[0]!.widths).toEqual([80, 210]);
});

function containerWidth(initial: number) {
  let width = initial;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return new DOMRect(0, 0, this.tagName === 'TABLE' ? Number.parseFloat(this.style.width) || 0 : width, 200);
  });
  return (next: number) => { width = next; window.dispatchEvent(new Event('resize')); };
}

it('fits default columns to the container without saving layouts, changing Markdown or adding undo entries', async () => {
  const resize = containerWidth(781);
  const { view, editor, value, changes } = await mount();
  const widths = () => tablesInDocument(view.state.doc)[0]!.layout.widths;
  await vi.waitFor(() => expect(widths()).toEqual([391, 390]));
  expect(root.querySelector('table')!.style.width).toBe('781px');
  resize(500);
  await vi.waitFor(() => expect(widths()).toEqual([250, 250]));
  resize(240);
  await vi.waitFor(() => expect(widths()).toEqual([160, 160]));
  expect(changes).toEqual([]);
  expect(value.value).toBe(markdown);
  expect(editor.value!.canUndo()).toBe(false);
});

it('starts a resize at the displayed width, preserves fixed widths across window changes, and restores automatic fitting on undo', async () => {
  const resize = containerWidth(780);
  const { view, editor, changes, value } = await mount();
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('780px'));
  const { node, pos } = tablesInDocument(view.state.doc)[0]!;
  view.dispatch(view.state.tr.setMeta(columnResizingPluginKey, { setHandle: pos + 2 }));
  root.querySelector('th')!.dispatchEvent(new MouseEvent('mousedown', { clientX: 390, bubbles: true, cancelable: true }));
  expect(columnResizingPluginKey.getState(view.state)!.dragging).toEqual({ startX: 390, startWidth: 390 });
  window.dispatchEvent(new MouseEvent('mouseup', { clientX: 490 }));
  await vi.waitFor(() => expect(changes.at(-1)![0]!.widths).toEqual([490, 390]));
  expect(tablesInDocument(view.state.doc)[0]!.node.attrs.autoWidth).toBe(false);
  resize(500);
  await nextTick();
  expect(root.querySelector('table')!.style.width).toBe('880px');
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('500px'));
  expect(tablesInDocument(view.state.doc)[0]!.node.attrs.autoWidth).toBe(true);
  expect(editor.value!.redoLastChange()).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('880px'));
  expect(value.value).toBe(markdown);
  expect(node.attrs.autoWidth).toBe(true);
});

it('retains automatic fitting for color-only layouts and does not save viewport measurements', async () => {
  const resize = containerWidth(780);
  const first = await mount();
  const table = tablesInDocument(first.view.state.doc)[0]!.layout;
  app!.unmount(); root.remove();
  const saved: TableLayout[] = [{ id: table.id, widths: [160, 160], autoWidth: true, backgrounds: [['green', null], [null, null]], anchor: table.anchor }];
  const { view, changes } = await mount(markdown, saved);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('780px'));
  resize(500);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('500px'));
  expect(tablesInDocument(view.state.doc)[0]!.layout.backgrounds).toEqual(saved[0]!.backgrounds);
  expect(changes).toEqual([]);
});

it('restores automatic width after reopening, keeps it on reopen, and undoes to the original fixed widths after resizing', async () => {
  const resize = containerWidth(780);
  const first = await mount();
  const table = tablesInDocument(first.view.state.doc)[0]!.layout;
  app!.unmount(); root.remove();
  const fixed: TableLayout[] = [{ ...table, autoWidth: undefined, widths: [800, 160] }];
  const { view, editor, value, layouts } = await mount(markdown, fixed);
  const pos = tablesInDocument(view.state.doc)[0]!.pos;
  view.dispatch(tableLineAction(view.state, { pos, axis: 'column', index: 0 }, 'restoreAutoWidth')!);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('780px'));
  resize(500);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('500px'));
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(tablesInDocument(view.state.doc)[0]!.layout.widths).toEqual([800, 160]));
  expect(tablesInDocument(view.state.doc)[0]!.node.attrs.autoWidth).toBe(false);
  expect(editor.value!.redoLastChange()).toBe(true);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('500px'));
  expect(value.value).toBe(markdown);
  const saved = JSON.parse(JSON.stringify(layouts.value)) as TableLayout[];
  expect(saved[0]!.autoWidth).toBe(true);
  app!.unmount(); root.remove();
  resize(780);
  const reopened = await mount(markdown, saved);
  await vi.waitFor(() => expect(root.querySelector('table')!.style.width).toBe('780px'));
  expect(reopened.changes).toEqual([]);
  expect(tableLineAction(reopened.view.state, { pos, axis: 'row', index: 0 }, 'restoreAutoWidth')).toBeNull();
});
