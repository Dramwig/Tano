// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import MarkdownEditor from './MarkdownEditor.vue';
import { createHeadlessMarkdown } from './headless';
import { unsupportedMarkdown } from './syntax';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
const markdown = '| A | B |\n| :--- | ---: |\n| alpha | beta |\n| one | two |\n';

async function mount(source = markdown, revealMarkdown = false) {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div');
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const value = ref(source);
  const readonly = ref(false);
  app = createApp({ render: () => h(MarkdownEditor, {
    ref: editor, documentId: 'keyboard', modelValue: value.value, revealMarkdown, readonly: readonly.value,
    'onUpdate:modelValue': (next: string) => { value.value = next; },
  }) });
  app.mount(root);
  await vi.waitFor(() => expect(editor.value?.withContext(ctx => ctx.get(editorViewCtx))).toBeDefined());
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  function select(text: string, offset = 0, length = 0) {
    let pos = -1;
    view.state.doc.descendants((node, start) => {
      if (node.isText && node.text === text) pos = start + offset;
    });
    expect(pos).toBeGreaterThan(-1);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos, pos + length)));
  }
  function enter(options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...options });
    view.dom.dispatchEvent(event);
    return event;
  }
  return { editor, view, value, readonly, select, enter };
}

it.each(['A', 'B', 'alpha', 'beta'])('moves from %s to the next row in the same column without editing', async text => {
  const { view, value, select, enter } = await mount();
  select(text, text.length);
  const before = view.state.doc.toJSON();
  expect(enter().defaultPrevented).toBe(true);
  expect(view.state.selection.$from.parent.textContent).toBe(({ A: 'alpha', B: 'beta', alpha: 'one', beta: 'two' })[text]);
  expect(view.state.selection.$from.parentOffset).toBe(0);
  expect(view.state.doc.toJSON()).toEqual(before);
  expect(value.value).toBe(markdown);
});

it('appends a body row at the bottom, keeps the column and alignment, and undoes atomically', async () => {
  const { view, editor, select, enter } = await mount();
  select('two', 1);
  const before = view.state.doc.toJSON();
  enter();
  const table = view.state.doc.firstChild!;
  expect(table.childCount).toBe(4);
  expect(table.lastChild!.child(0).attrs.alignment).toBe('left');
  expect(table.lastChild!.child(1).attrs.alignment).toBe('right');
  expect(table.lastChild!.textContent).toBe('');
  expect(view.state.selection.$from.index(2)).toBe(1);
  expect(view.state.selection.$from.parentOffset).toBe(0);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(before);
  expect(editor.value!.redoLastChange()).toBe(true);
  expect(view.state.doc.firstChild!.childCount).toBe(4);
});

it.each([{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }])('inserts repeatable cell breaks with %j and preserves them on reopen', async options => {
  const { view, editor, value, select, enter } = await mount();
  select('alpha', 2);
  const before = view.state.doc.toJSON();
  enter(options);
  enter(options);
  expect(root.querySelectorAll('td br[data-type="hardbreak"]')).toHaveLength(2);
  expect(view.state.selection.$from.parent.textContent).toBe('al\n\npha');
  expect(view.state.doc.firstChild!.childCount).toBe(3);
  await vi.waitFor(() => expect(value.value).toContain('al<br /><br />pha'));
  expect(unsupportedMarkdown(value.value)).toEqual([]);
  const reopened = editor.value!.withContext(ctx => ctx.get(parserCtx)(value.value));
  expect(reopened!.firstChild!.child(1).firstChild!.firstChild!.childCount).toBe(4);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(view.state.doc.toJSON()).toEqual(before);
});

it('replaces selected text with a cell break without losing neighboring cells', async () => {
  const { view, select, enter } = await mount();
  select('alpha', 1, 3);
  enter({ ctrlKey: true });
  expect(view.state.selection.$from.parent.textContent).toBe('a\na');
  expect(view.state.doc.firstChild!.child(1).child(1).textContent).toBe('beta');
});

it.each([false, true])('handles a link with source reveal=%s without exiting or splitting the table', async reveal => {
  const { view, value, select, enter } = await mount(markdown.replace('alpha', '[alpha](https://example.test)'), reveal);
  if (!reveal) select('alpha', 2);
  else {
    view.focus();
    const range = document.createRange();
    range.setStart(root.querySelector('td a')!.firstChild!, 2);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await nextTick();
    const source = view.state.selection.$from.parent;
    expect(source.type.name).toBe('tano_live_source_inline');
    const pos = view.state.selection.$from.start() + source.textContent.indexOf('alpha') + 2;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
  }
  enter({ ctrlKey: true });
  await vi.waitFor(() => expect(value.value).toContain('<br />'));
  expect(root.querySelectorAll('table')).toHaveLength(1);
  expect(root.querySelector('td')!.textContent).toBe('alpha');
  expect(root.querySelector('td br[data-type="hardbreak"]')).not.toBeNull();
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  enter();
  expect(view.state.selection.$from.parent.textContent).toBe('one');
});

it('leaves composition Enter and readonly content unchanged', async () => {
  const { view, readonly, select, enter } = await mount();
  select('alpha');
  const before = view.state.doc.toJSON();
  enter({ isComposing: true });
  expect(view.state.doc.toJSON()).toEqual(before);
  expect(view.state.selection.$from.parent.textContent).toBe('alpha');
  readonly.value = true;
  await nextTick();
  enter({ ctrlKey: true });
  expect(view.state.doc.toJSON()).toEqual(before);
});

it('round trips table-only HTML breaks through the shared headless codec', async () => {
  const codec = await createHeadlessMarkdown();
  try {
    const source = markdown.replace('A |', 'A<br>B |').replace('alpha', '**al<br />pha**<br/><br />');
    const normalized = codec.normalize(source);
    expect(normalized).toContain('<br />');
    expect(codec.normalize(normalized)).toBe(normalized);
    expect(unsupportedMarkdown('outside<br />table\n')).toContain('内嵌 HTML / MDX');
    expect(unsupportedMarkdown(markdown.replace('alpha', '<br onclick="alert(1)">'))).toContain('内嵌 HTML / MDX');
  } finally { await codec.destroy(); }
});
