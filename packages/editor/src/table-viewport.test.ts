// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import type { CommentAnchor } from '@tano/protocol';
import MarkdownEditor from './MarkdownEditor.vue';
import { makeCommentAnchor } from './comment-anchors';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn() } }));
let app: ReturnType<typeof createApp> | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('keeps a wide nested table within its toggle content width', async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('tano-enhanced-content')) return new DOMRect(100, 100, 400, 200);
    if (this.tagName === 'TABLE') return new DOMRect(100, 100, 1600, 140);
    return new DOMRect(0, 0, 900, 900);
  });
  root = document.createElement('div');
  root.className = 'editor-scroll';
  Object.defineProperty(root, 'clientWidth', { value: 900 });
  document.body.append(root);
  const changes = vi.fn();
  app = createApp({ render: () => h(MarkdownEditor, {
    documentId: 'nested-table',
    modelValue: '<details>\n<summary>Table</summary>\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\n</details>\n',
    'onUpdate:modelValue': changes,
  }) });
  app.mount(root);
  // Wait for asynchronous editor creation and its first layout frame; the
  // default one-second polling deadline can expire on a busy Windows runner.
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.tano-toggle .tano-table-viewport')?.style.width).toBe('400px'), { timeout: 5_000 });
  expect(root.querySelector<HTMLElement>('.tano-table-viewport')!.style.marginLeft).toBe('0px');
  expect(changes).not.toHaveBeenCalled();
}, 10_000);

it('expands only wide tables, reserves the comment gutter, and tracks each scrollable edge without changing Markdown', async () => {
  const source = 'Before\n\n| A | B |\n| --- | --- |\n| alpha | beta |\n\nAfter\n';
  let tableWidth = 1600;
  let paneWidth = 1280;
  let wrapper: HTMLElement | undefined;
  const resizeCallbacks = new Set<() => void>();
  const resize = () => resizeCallbacks.forEach(callback => callback());
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: () => void) { resizeCallbacks.add(callback); }
    observe() {}
    disconnect = disconnect;
  });
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('editor-scroll')) return new DOMRect(0, 0, paneWidth, 900);
    if (this.classList.contains('ProseMirror') || this.classList.contains('milkdown-host') || this.classList.contains('milkdown')) return new DOMRect(250, 0, 780, 900);
    if (this.tagName === 'TABLE') return new DOMRect(250 - (wrapper?.scrollLeft ?? 0), 100, tableWidth, 140);
    return new DOMRect();
  });
  root = document.createElement('div');
  root.className = 'editor-scroll';
  Object.defineProperty(root, 'clientWidth', { get: () => paneWidth });
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const anchors = ref<{ id: string; anchor: CommentAnchor }[]>([]);
  const changes = vi.fn();
  const layouts = vi.fn();
  app = createApp({ render: () => h(MarkdownEditor, {
    ref: editor, documentId: 'a12345', modelValue: source, commentAnchors: anchors.value,
    'onUpdate:modelValue': changes, onTableLayoutChange: layouts,
  }) });
  app.mount(root);
  await vi.waitFor(() => expect(editor.value?.withContext(ctx => ctx.get(editorViewCtx))).toBeDefined());
  const viewport = root.querySelector<HTMLElement>('.tano-table-viewport')!;
  wrapper = viewport.querySelector<HTMLElement>('.tableWrapper')!;
  const scrollbar = viewport.querySelector<HTMLElement>('[role="scrollbar"]')!;
  Object.defineProperty(scrollbar, 'clientWidth', { get: () => Number.parseFloat(scrollbar.style.width) });
  Object.defineProperty(wrapper, 'scrollWidth', { get: () => {
    const table = viewport.querySelector('table')!;
    return tableWidth + Number.parseFloat(table.style.marginLeft || '0') + Number.parseFloat(table.style.marginRight || '0');
  } });
  Object.defineProperty(wrapper, 'clientWidth', { get: () => Number.parseFloat(viewport.style.width) });
  await vi.waitFor(() => expect(viewport.style.width).toBe('1280px'));
  expect(viewport.style.marginLeft).toBe('-250px');
  expect(250 + Number.parseFloat(viewport.style.marginLeft)).toBe(0);
  expect(250 + Number.parseFloat(viewport.style.marginLeft) + Number.parseFloat(viewport.style.width)).toBe(paneWidth);
  expect(scrollbar.style.width).toBe('780px');
  expect(scrollbar.style.marginLeft).toBe('250px');
  expect(viewport.querySelector('table')!.style.marginLeft).toBe('250px');
  expect(viewport.querySelector('table')!.style.marginRight).toBe('250px');
  wrapper.dispatchEvent(new Event('scroll'));
  expect(scrollbar.getAttribute('aria-valuemax')).toBe('820');
  expect(viewport.classList.contains('has-comments')).toBe(false);

  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let position = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'alpha') position = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position, position + 5)));
  const selection = editor.value!.commentSelection()!;
  anchors.value = [{ id: '@draft', anchor: makeCommentAnchor('prose', selection.text, selection.spans, 'base') }];
  await nextTick();
  await vi.waitFor(() => expect(viewport.style.width).toBe('780px'));
  expect(viewport.style.marginLeft).toBe('0px');
  expect(viewport.querySelector('table')!.style.marginLeft).toBe('0px');
  expect(viewport.querySelector('table')!.style.marginRight).toBe('0px');
  expect(viewport.classList.contains('has-comments')).toBe(true);
  expect(viewport.classList.contains('can-scroll-right')).toBe(true);
  expect(viewport.classList.contains('can-scroll-left')).toBe(false);
  wrapper.scrollLeft = 400;
  wrapper.dispatchEvent(new Event('scroll'));
  expect(viewport.classList.contains('can-scroll-left')).toBe(true);
  expect(viewport.classList.contains('can-scroll-right')).toBe(true);
  expect(root.querySelector<HTMLElement>('.tano-block-handle[data-block-index="1"]')!.style.transform).toBe('');
  wrapper.scrollLeft = 820;
  wrapper.dispatchEvent(new Event('scroll'));
  expect(viewport.classList.contains('can-scroll-right')).toBe(false);
  expect(scrollbar.style.width).toBe('780px');
  expect(scrollbar.style.marginLeft).toBe('0px');
  expect(scrollbar.hidden).toBe(false);
  expect(scrollbar.getAttribute('aria-valuemax')).toBe('820');
  scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
  expect(wrapper.scrollLeft).toBe(0);
  wrapper.dispatchEvent(new Event('scroll'));
  expect(root.querySelector<HTMLElement>('.tano-block-handle[data-block-index="1"]')!.style.transform).toBe('');
  scrollbar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  expect(wrapper.scrollLeft).toBe(48);

  anchors.value = [];
  await nextTick();
  await vi.waitFor(() => expect(viewport.style.width).toBe('1280px'));
  wrapper.dispatchEvent(new Event('scroll'));
  await vi.waitFor(() => expect(root.querySelector<HTMLElement>('.tano-block-handle[data-block-index="1"]')!.style.transform).toBe('translateX(-48px)'));
  tableWidth = 320;
  resize();
  await vi.waitFor(() => expect(viewport.style.width).toBe('780px'));
  expect(viewport.style.marginLeft).toBe('0px');
  expect(scrollbar.hidden).toBe(true);
  tableWidth = 1600;
  paneWidth = 1100;
  resize();
  await vi.waitFor(() => expect(viewport.style.width).toBe('1100px'));
  expect(250 + Number.parseFloat(viewport.style.marginLeft)).toBe(0);
  expect(250 + Number.parseFloat(viewport.style.marginLeft) + Number.parseFloat(viewport.style.width)).toBe(paneWidth);
  expect(changes).not.toHaveBeenCalled();
  expect(layouts).not.toHaveBeenCalled();
  app.unmount(); app = undefined;
  await vi.waitFor(() => expect(disconnect).toHaveBeenCalled());
});
