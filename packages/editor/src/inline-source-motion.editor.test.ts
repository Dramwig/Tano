// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import MarkdownEditor from './MarkdownEditor.vue';
import { defaultCapabilities, defaultEditorPreferences } from './runtime';
import { inlineSourceMotionKey } from './inline-source-motion';

vi.mock('mermaid', () => ({ default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '<svg></svg>' })) } }));

let app: App | undefined;
let root: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value() {
    return { cancel() {}, pause() {}, finish() {}, currentTime: 0, playbackRate: 1 } as unknown as Animation;
  } });
});
afterEach(async () => {
  app?.unmount(); app = undefined; root?.remove();
  vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  await nextTick();
});

async function mount(content: string) {
  root = document.createElement('div');
  document.body.append(root);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(defineComponent(() => () => h(MarkdownEditor, {
    ref: editor, modelValue: content, documentId: 'document', readonly: false, revealMarkdown: true,
    capabilities: structuredClone(defaultCapabilities), preferences: { ...defaultEditorPreferences },
  })));
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return editor.value!.withContext(ctx => ctx.get(editorViewCtx));
}

it('keeps the morph of a wiki link opened by a click', async () => {
  const view = await mount('前 [[nested-folder/target-document]] 后\n');
  view.focus();
  vi.spyOn(view, 'hasFocus').mockReturnValue(true);
  const link = view.dom.querySelector<HTMLElement>('a[data-tano-wiki-target]')!;
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await nextTick();
  expect(view.dom.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('[[nested-folder/target-document]]');
  // The label stays; only the brackets open up.
  expect([...view.dom.querySelectorAll('[data-morph]')].map(node => node.textContent)).toEqual(['[[', ']]']);
});

it.each([
  ['wiki link', '前 [[nested-folder/target-document]] 后\n', '[[nested-folder/target-document]]', ['grow', 'grow'], ['exit', 'lead', 'exit']],
  ['inline math', '前 $x^2$ 后\n', '$x^2$', ['swap'], ['swap']],
])('animates a %s opening and closing in the real editor', async (_label, markdown, source, opening, closing) => {
  const view = await mount(markdown);
  view.focus();
  vi.spyOn(view, 'hasFocus').mockReturnValue(true);
  const morphs = () => inlineSourceMotionKey.getState(view.state)!.decorations.find().map(deco => deco.spec.kind as string);
  // Caret steps onto the atom from the left, as the arrow key does.
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  await nextTick();
  const field = view.dom.querySelector('[data-tano-live-inline-source]');
  expect(field?.textContent).toContain(source.slice(0, 2));
  expect(morphs().sort()).toEqual([...opening].sort());
  expect(view.dom.querySelector('[data-morph]')).not.toBeNull();
  // And leaves it again, once it has opened.
  await new Promise(resolve => setTimeout(resolve, 360));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
  await nextTick();
  expect(view.dom.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(morphs().sort()).toEqual([...closing].sort());
});
