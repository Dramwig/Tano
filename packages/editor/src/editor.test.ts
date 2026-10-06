// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx, parserCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import MarkdownEditor from './MarkdownEditor.vue';
import { splitFrontmatter, unsupportedMarkdown } from './syntax';
import { defaultCapabilities, defaultEditorPreferences } from './runtime';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })),
  },
}));

let app: App | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  app?.unmount();
  app = undefined;
  root?.remove();
  await nextTick();
});

it('searches across formatting in readonly prose without editing or moving the caret', async () => {
  const { value, editor, readonly, errors } = await mount('同**页** 同页\n\n其他正文\n');
  readonly.value = true;
  await nextTick();
  const original = value.value;
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const selection = view.state.selection;
  expect(editor.value!.search('同页', 1, false)).toBe(2);
  expect(root.querySelector('.tano-search-current')?.textContent).toBe('同页');
  expect(view.state.selection.eq(selection)).toBe(true);
  expect(value.value).toBe(original);
  expect(editor.value!.canUndo()).toBe(false);
  value.value += '\n同页\n';
  await nextTick();
  expect(editor.value!.search('同页', 2, false)).toBe(3);
  editor.value!.search('', 0, false);
  expect(root.querySelector('.tano-search-match')).toBeNull();
  expect(errors).toEqual([]);
});

it('reveals a search match inside folded heading and list content without editing Markdown', async () => {
  const source = '# Project\n\nDetails\n\n- One\n  - Two\n';
  const { value, editor } = await mount(source);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-fold-toggle')];
  buttons()[0]!.click();
  expect(prose.children[1]?.classList.contains('tano-folded-heading-content')).toBe(true);
  editor.value!.search('Details');
  expect(prose.children[1]?.classList.contains('tano-folded-heading-content')).toBe(false);
  buttons()[1]!.click();
  expect(prose.querySelector('li > ul')?.classList.contains('tano-folded-list-content')).toBe(true);
  editor.value!.search('Two');
  expect(prose.querySelector('li > ul')?.classList.contains('tano-folded-list-content')).toBe(false);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
});

it('replaces prose matches across formatting and undoes all replacements as one step', async () => {
  const source = '同**页** 同页 同页\n\n独立正文\n';
  const { value, editor, readonly, errors } = await mount(source);
  const replaced = editor.value!.replaceSearch('同页', '一起', 0);
  expect(replaced).toEqual({ replaced: 1, index: 0 });
  await nextTick();
  expect(editor.value!.search('同页', 0, false)).toBe(2);
  expect(value.value).toContain('一起');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(source);
  editor.value!.withContext(ctx => ctx.get(editorViewCtx).dom.blur());
  expect(editor.value!.replaceSearch('同页', '一起', 'all').replaced).toBe(3);
  await nextTick();
  expect(editor.value!.search('同页', 0, false)).toBe(0);
  expect(editor.value!.search('一起', 0, false)).toBe(3);
  value.value = value.value.replace('独立正文', '外部修改');
  await nextTick();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(source.replace('独立正文', '外部修改'));
  readonly.value = true;
  await nextTick();
  expect(editor.value!.replaceSearch('同页', '禁止修改', 'all').replaced).toBe(0);
  expect(value.value).toBe(source.replace('独立正文', '外部修改'));
  expect(errors).toEqual([]);
});

it('supports deleting matches and skips newly inserted matches after single replacement', async () => {
  const { value, editor } = await mount('find find\n');
  expect(editor.value!.replaceSearch('find', 'find find', 0)).toEqual({ replaced: 1, index: 2 });
  await nextTick();
  expect(editor.value!.replaceSearch('find', '', 'all').replaced).toBe(3);
  await nextTick();
  expect(value.value).not.toContain('find');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('find find find\n');
});
async function mount(
  content: string,
  importer?: (
    file: File,
    requireImage: boolean,
  ) => Promise<{ url: string; name: string; image: boolean }>,
  initialCapabilities = defaultCapabilities,
  initialPreferences = defaultEditorPreferences,
) {
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content),
    editor = ref<InstanceType<typeof MarkdownEditor>>();
  const readonly = ref(false);
  const revealMarkdown = ref(true);
  const capabilities = ref(structuredClone(initialCapabilities));
  const preferences = ref({ ...initialPreferences });
  const errors: string[] = [];
  const openedWikiLinks: string[] = [];
  const openedLinks: string[] = [];
  const openedNewTabLinks: string[] = [];
  let selectionChanges = 0;
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(
    defineComponent(
      () => () =>
        h(MarkdownEditor, {
          ref: editor,
          modelValue: value.value,
          documentId: 'document',
          readonly: readonly.value,
          revealMarkdown: revealMarkdown.value,
          capabilities: capabilities.value,
          preferences: preferences.value,
          resolveImage: (reference) =>
            reference.startsWith('assets/') ? `https://example.test/${reference}` : null,
          importFile: importer,
          'onUpdate:modelValue': (next: string) => {
            value.value = next;
          },
          onError: (error: string) => errors.push(error),
          onOpenWikiLink: (target: string) => openedWikiLinks.push(target),
          onOpenLink: (href: string, newTab?: boolean) => {
            openedLinks.push(href);
            if (newTab) openedNewTabLinks.push(href);
          },
          onSelectionChange: () => { selectionChanges++; },
        }),
    ),
  );
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return {
    value,
    editor,
    errors,
    openedWikiLinks,
    openedLinks,
    openedNewTabLinks,
    readonly,
    revealMarkdown,
    capabilities,
    preferences,
    selectionChangeCount: () => selectionChanges,
  };
}

async function mountPanel(content: string) {
  const result = await mount(content);
  result.revealMarkdown.value = false;
  await nextTick();
  return result;
}

it.each(['正文\n', '- 第一个项目\n', '```ts\nconst value = 1;\n```\n'])(
  'keeps unhandled Tab and Shift-Tab inside prose: %s', async (source) => {
    const { value, editor } = await mount(source);
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
      view.dom.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(view.dom);
      if (!shiftKey) expect(value.value).toBe(source);
    }
  },
);

it('preserves list indentation and outdentation with Tab', async () => {
  const source = '* First\n* Second\n';
  const { value, editor } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let second = 0;
  view.state.doc.descendants((node, pos) => { if (node.isText && node.text === 'Second') second = pos; });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, second)));
  view.focus();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toMatch(/\n +[-*] Second/);
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toBe(source);
});

it('keeps embedded form controls available to keyboard focus navigation', async () => {
  await mount('正文\n');
  const input = document.createElement('input');
  root.querySelector('.ProseMirror')!.append(input);
  const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(false);
});

it('reports and applies undo history through the public editor API', async () => {
  const source = '# 标题\n\n正文\n';
  const { value, editor } = await mount(source);
  expect(editor.value!.canUndo()).toBe(false);
  editor.value!.insertBlockAtStart();
  await vi.waitFor(() => expect(value.value).not.toBe(source));
  expect(editor.value!.canUndo()).toBe(true);
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).toBe(source));
  expect(editor.value!.canRedo()).toBe(true);
  expect(editor.value!.redoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).not.toBe(source));
  expect(editor.value!.undoLastChange()).toBe(true);
  await vi.waitFor(() => expect(value.value).toBe(source));
});

it('maps a backward selection through external edits without adding undo history', async () => {
  const { value, editor, errors } = await mount('前文\n\n选中文字\n');
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 9, 5)));
  value.value = '新前文\n\n选中文字\n';
  await nextTick();
  expect(view.state.selection.anchor).toBe(10);
  expect(view.state.selection.head).toBe(6);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each(['', '# 标题\n\n'])('keeps independent external edits when undoing and redoing local typing with prefix %j', async (prefix) => {
  const { value, editor, errors } = await mount(`${prefix}第一段\n\n第二段\n`);
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const start = prefix ? view.state.doc.firstChild!.nodeSize : 0;
  view.dispatch(view.state.tr.insertText('本地', start + 4));
  await nextTick();
  value.value = value.value.replace('第二段', '第二段外部');
  await nextTick();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(`${prefix}第一段\n\n第二段外部\n`);
  expect(editor.value!.canUndo()).toBe(false);
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(`${prefix}第一段本地\n\n第二段外部\n`);
  expect(errors).toEqual([]);
});

it('keeps active Markdown source and selection when only external metadata changes', async () => {
  const { value, editor, errors } = await mount('---\ntitle: old\n---\n\n# 标题\n\n正文\n');
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  const source = root.querySelector('[data-tano-live-source]');
  expect(source).not.toBeNull();
  const selection = view.state.selection;
  value.value = value.value.replace('title: old', 'title: new');
  await nextTick();
  expect(root.querySelector('[data-tano-live-source]')).toBe(source);
  expect(view.state.selection.eq(selection)).toBe(true);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each(['属性名', '属性值'])('keeps the %s field open while Enter confirms an IME candidate', async (label) => {
  const { value, errors } = await mount('---\ntitle: original\n---\n\n正文\n');
  root.querySelector<HTMLButtonElement>('.frontmatter-property-value')!.click();
  await nextTick();
  const input = root.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
  input.focus();
  input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  input.value = '中文';
  input.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true }));
  const enter = new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true });
  input.dispatchEvent(enter);
  await nextTick();
  expect(enter.defaultPrevented).toBe(false);
  expect(root.contains(input)).toBe(true);
  input.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  await nextTick();
  expect(value.value).toContain(label === '属性名' ? '"中文": original' : 'title: 中文');
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  expect(root.querySelector('.frontmatter-row-editor')).toBeNull();
  expect(errors).toEqual([]);
});

it.each([
  ['aa\n', 'aaa\n'],
  ['aaa\n', 'aa\n'],
  ['', '# 新标题\n\n正文\n'],
  ['# 标题\n\n正文\n', ''],
  ['一段\n\n二段\n', '前言\n\n一段\n\n二段\n'],
  ['一段\n\n二段\n', '二段\n'],
  ['正文\n', '**正文**\n'],
  ['| A | B |\n| - | - |\n| 1 | 2 |\n', '| A | B |\n| - | - |\n| 3 | 2 |\n'],
])('applies external structural and repeated-text changes from %j to %j', async (before, after) => {
  const { value, editor, errors } = await mount(before);
  value.value = after;
  await nextTick();
  editor.value!.withContext((ctx) => {
    const withoutGeneratedIds = (key: string, value: unknown) => ['id', 'layoutId', 'colwidth'].includes(key) ? undefined : value;
    expect(JSON.stringify(ctx.get(editorViewCtx).state.doc.toJSON(), withoutGeneratedIds))
      .toBe(JSON.stringify(ctx.get(parserCtx)(after)!.toJSON(), withoutGeneratedIds));
  });
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each(['Enter', 'Escape'])('ignores IME %s with the legacy key code', async (key) => {
  await mount('---\ntitle: original\n---\n\n正文\n');
  root.querySelector<HTMLButtonElement>('.frontmatter-property-value')!.click();
  await nextTick();
  const input = root.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
  const event = new KeyboardEvent('keydown', { key, keyCode: 229, bubbles: true, cancelable: true });
  input.dispatchEvent(event);
  await nextTick();
  expect(event.defaultPrevented).toBe(false);
  expect(root.contains(input)).toBe(true);
});

it('switches workspace capabilities without mutating content, and restores rendering', async () => {
  const source =
    '公式 \\(x^2\\)，[[笔记|标题]]。\n\n> [!NOTE]\n> 提示内容\n\n脚注[^a]\n\n[^a]: 定义\n';
  const { value, capabilities, errors, revealMarkdown, editor } = await mount(source);
  revealMarkdown.value = false;
  for (const key of ['math', 'wikiLink', 'callout', 'footnotes'] as const)
    capabilities.value.features[key] = false;
  await nextTick();
  expect(root.querySelector('.katex')).toBeNull();
  expect(root.querySelector('a[data-tano-wiki-target]')).toBeNull();
  expect(root.querySelector('.tano-callout-title')).toBeNull();
  expect(root.querySelectorAll('.tano-feature-source').length).toBe(4);
  expect(root.textContent).toContain('\\(x^2\\)');
  expect(root.textContent).toContain('[[笔记|标题]]');
  expect(value.value).toBe(source);
  editor.value!.command('math');
  expect(value.value).toBe(source);
  capabilities.value = structuredClone(defaultCapabilities);
  await nextTick();
  expect(root.querySelector('.katex')).not.toBeNull();
  expect(root.querySelector('.tano-feature-source')).toBeNull();
  expect(value.value).toBe(source);
  expect(errors).toEqual([]);
});

it('opens a document with disabled capabilities while keeping its table visual', async () => {
  const source = '\\(x\\) [[note]]\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
  const { value, errors } = await mount(
    source,
    undefined,
    {
      ...defaultCapabilities,
      features: { ...defaultCapabilities.features, math: false, wikiLink: false },
    },
  );
  expect(errors).toEqual([]);
  expect(root.querySelectorAll('.tano-feature-source')).toHaveLength(2);
  expect(root.querySelector('table')).not.toBeNull();
  expect(value.value).toBe(source);
});

it('edits a formula in a panel while keeping its rendering visible', async () => {
  const source = '公式 $x$。\n\n| A | B |\n| - | - |\n| 1 | 2 |\n';
  const { value, errors } = await mountPanel(source);
  const input = root.querySelector<HTMLTextAreaElement>('.tano-math textarea')!;
  const preview = root.querySelector<HTMLElement>('.tano-math .math-preview')!;
  expect(input.wrap).toBe('off');
  expect(input.hidden).toBe(true);
  expect(preview.hidden).toBe(false);
  root.querySelector<HTMLButtonElement>('.math-preview')!.click();
  expect(input.hidden).toBe(false);
  expect(root.querySelector('.tano-math')?.classList.contains('tano-editor-active')).toBe(true);
  expect(preview.hidden).toBe(false);
  expect(root.querySelector<HTMLElement>('.math-editor-panel')?.hidden).toBe(false);
  expect(root.querySelector('.math-editor-panel button')).toBeNull();
  input.value = 'x^2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(root.querySelector('.math-editor-highlight')?.textContent).toBe('x^2');
  expect(root.querySelector('.math-editor-highlight .tano-math-token-number')?.textContent).toBe('2');
  expect(input.hidden).toBe(false);
  expect(preview.hidden).toBe(false);
  expect(preview.querySelector('.katex')).not.toBeNull();
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(input.hidden).toBe(true);
  expect(root.querySelector('.tano-math')?.classList.contains('tano-editor-active')).toBe(false);
  expect(root.querySelector<HTMLElement>('.math-editor-panel')?.hidden).toBe(true);
  expect(preview.hidden).toBe(false);
  expect(root.querySelector('table')).not.toBeNull();
  expect(value.value).toContain('$x^2$');
  expect(errors).toEqual([]);
});

it('keeps long formula source visible through synchronized horizontal scrolling', async () => {
  await mountPanel('$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n');
  root.querySelector<HTMLButtonElement>('.math-block .math-preview')!.click();
  const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
  const highlight = root.querySelector<HTMLElement>('.math-block .math-editor-highlight')!;
  const source = '\\int_0^1 x^2\\,dx = \\frac{1}31232143412422';
  input.value = source;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(input.wrap).toBe('off');
  expect(highlight.textContent).toBe(source);
  input.scrollLeft = 96;
  input.dispatchEvent(new Event('scroll'));
  expect(highlight.scrollLeft).toBe(96);
});

it('opens the formula panel by clicking the formula when Markdown reveal is off', async () => {
  const source = '行内 $x$。\n\n$$\ny^2\n$$\n';
  const { value, revealMarkdown, preferences, errors } = await mount(source);
  const inline = root.querySelector<HTMLElement>('.math-inline')!;
  const preview = inline.querySelector<HTMLElement>('.math-preview')!;
  expect(inline.querySelector("button")).toBeNull();
  revealMarkdown.value = false;
  preferences.value = { ...preferences.value, previewMathWhileEditing: false };
  await nextTick();
  expect(preview.getAttribute('role')).toBe('button');
  preview.click();
  const panel = inline.querySelector<HTMLElement>('.math-editor-panel')!;
  const input = panel.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(panel.classList.contains('tano-editor-panel')).toBe(true);
  expect(panel.hidden).toBe(false);
  expect(document.activeElement).toBe(input);
  expect(preview.style.visibility).not.toBe('hidden');
  input.value = 'z^2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(preview.style.visibility).not.toBe('hidden');
  expect(preview.querySelector('.katex')?.textContent).toContain('z');
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  expect(panel.hidden).toBe(true);
  expect(value.value).toContain('$z^2$');

  const block = root.querySelector<HTMLElement>('.math-block')!;
  const blockPreview = block.querySelector<HTMLElement>('.math-preview')!;
  blockPreview.click();
  expect(block.querySelector<HTMLElement>('.math-editor-panel')!.hidden).toBe(false);
  expect(blockPreview.style.visibility).not.toBe('hidden');
  expect(errors).toEqual([]);
});

it('opens the inline formula panel by clicking it with reveal disabled without expanding Markdown source', async () => {
  const { value, errors } = await mountPanel('公式 $x$ 后接文字。\n');
  const edit = root.querySelector<HTMLButtonElement>('.math-inline .math-preview')!;
  const mouseDown = new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0 });
  edit.dispatchEvent(mouseDown);
  edit.click();
  await nextTick();
  expect(root.querySelector<HTMLElement>('.math-inline .math-editor-panel')?.hidden).toBe(false);
  expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(document.activeElement).toBe(root.querySelector('.math-inline textarea'));
  expect(value.value).toBe('公式 $x$ 后接文字。\n');
  expect(errors).toEqual([]);
});

it('opens formula, Mermaid, and image panels without moving the editor selection', async () => {
  const { selectionChangeCount, errors } = await mountPanel('前 $x$ 后。\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n![图](assets/p.png)\n');
  const initial = selectionChangeCount();
  for (const selector of ['.math-inline .math-preview', '.tano-mermaid-preview', '.tano-image img']) {
    const button = root.querySelector<HTMLButtonElement>(selector)!;
    const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    button.dispatchEvent(down);
    button.click();
    await nextTick();
    expect(selectionChangeCount()).toBe(initial);
    expect(root.querySelectorAll('.tano-editor-panel:not([hidden])')).toHaveLength(1);
  }
  expect(errors).toEqual([]);
});

it('keeps only one formula panel open and closes it on an outside click', async () => {
  const source = '公式 $x$ 和 $y$。\n';
  const { value, revealMarkdown } = await mountPanel(source);
  const formulas = [...root.querySelectorAll<HTMLElement>('.math-inline')];
  const [first, second] = formulas;
  const firstPanel = first.querySelector<HTMLElement>('.math-editor-panel')!;
  const secondPanel = second.querySelector<HTMLElement>('.math-editor-panel')!;
  const pointerDown = (target: Element) =>
    target.dispatchEvent(new Event('pointerdown', { bubbles: true }));

  first.querySelector<HTMLButtonElement>('.math-preview')!.click();
  expect(firstPanel.hidden).toBe(false);
  pointerDown(firstPanel.querySelector('textarea')!);
  expect(firstPanel.hidden).toBe(false);

  second.querySelector<HTMLButtonElement>('.math-preview')!.click();
  expect(firstPanel.hidden).toBe(true);
  expect(secondPanel.hidden).toBe(false);
  pointerDown(document.body);
  expect(secondPanel.hidden).toBe(true);

  revealMarkdown.value = false;
  await nextTick();
  first.querySelector<HTMLElement>('.math-preview')!.click();
  expect(firstPanel.hidden).toBe(false);
  second.querySelector<HTMLElement>('.math-preview')!.click();
  expect(firstPanel.hidden).toBe(true);
  expect(secondPanel.hidden).toBe(false);
  second.querySelector<HTMLElement>('.math-preview')!.click();
  expect(secondPanel.hidden).toBe(true);
  expect(value.value).toBe(source);
});

it('closes the formula panel when source reveal is enabled', async () => {
  const { value, revealMarkdown, errors } = await mountPanel('公式 $x$。\n');
  root.querySelector<HTMLElement>('.math-preview')!.click();
  const input = root.querySelector<HTMLTextAreaElement>('.tano-math textarea')!;
  input.value = 'x^2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  revealMarkdown.value = true;
  await nextTick();
  expect(root.querySelector('.tano-editor-panel:not([hidden])')).toBeNull();
  root.querySelector<HTMLElement>('.math-preview')!.click();
  expect(root.querySelector('[data-tano-live-inline-source]')).not.toBeNull();
  expect(value.value).toBe('公式 $x^2$。\n');
  expect(errors).toEqual([]);
});

it('folds headings and list item children without changing Markdown, and can be disabled', async () => {
  const source = '# Project\n\nDetails\n\n## Notes\n\n- One\n  - Two\n\nAfter\n';
  const { value, preferences } = await mount(source);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const buttons = () =>
    [...prose.parentElement!.querySelectorAll<HTMLButtonElement>('.tano-fold-toggle')];
  expect(buttons().filter((button) => !button.hidden)).toHaveLength(3);

  buttons()[0]!.click();
  await nextTick();
  expect(prose.children[1]?.classList.contains('tano-folded-heading-content')).toBe(true);
  expect(prose.children[2]?.classList.contains('tano-folded-heading-content')).toBe(true);
  expect(value.value).toBe(source);

  buttons()[0]!.click();
  const listButton = buttons()[2]!;
  listButton.click();
  await nextTick();
  expect(prose.querySelector('li > ul')?.classList.contains('tano-folded-list-content')).toBe(true);
  expect(value.value).toBe(source);

  preferences.value = { ...defaultEditorPreferences, folding: false };
  await nextTick();
  expect(buttons().every((button) => button.hidden)).toBe(true);
  expect(prose.children[1]?.classList.contains('tano-folded-heading-content')).toBe(false);
  expect(prose.querySelector('li > ul')?.classList.contains('tano-folded-list-content')).toBe(false);
  expect(value.value).toBe(source);
});

it.each(['1. One\n2. Two\n3. Three\n', '- One\n- Two\n- Three\n'])(
  'has no folding controls for a flat list: %s', async source => {
    const { value } = await mount(source);
    root.querySelector('.ProseMirror li')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(root.querySelector('.tano-fold-toggle')).toBeNull();
    expect(value.value).toBe(source);
  },
);

it('folds only an ordered item’s children, keeps sibling numbering, and supports nested folds in readonly mode', async () => {
  const source = '1. First\n2. Second\n3. Parent\n   1. Child\n      - Grandchild\n4. Fourth\n5. Fifth\n';
  const { value, editor, readonly } = await mount(source);
  readonly.value = true;
  await nextTick();
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const list = prose.querySelector('ol')!;
  const items = [...list.children];
  const buttons = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-fold-toggle')];
  expect(buttons()).toHaveLength(2);
  items[0]!.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(buttons().some(button => button.classList.contains('is-visible'))).toBe(false);
  items[2]!.querySelector('p')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(buttons()[0]!.classList.contains('is-visible')).toBe(true);
  expect(buttons()[1]!.classList.contains('is-visible')).toBe(false);
  buttons()[1]!.click();
  expect(items[2]!.querySelector('ul')?.classList.contains('tano-folded-list-content')).toBe(true);
  buttons()[0]!.click();
  expect(items[2]!.querySelector('ol')?.classList.contains('tano-folded-list-content')).toBe(true);
  expect(buttons()[1]!.hidden).toBe(true);
  expect(items).toHaveLength(5);
  expect(items.filter(item => item.className || item.querySelector(':scope > p')?.className)).toEqual([]);
  buttons()[0]!.click();
  expect(items[2]!.querySelector('ol')?.classList.contains('tano-folded-list-content')).toBe(false);
  expect(items[2]!.querySelector('ul')?.classList.contains('tano-folded-list-content')).toBe(true);
  expect(buttons()[1]!.hidden).toBe(false);
  editor.value!.search('Grandchild');
  expect(prose.querySelector('.tano-folded-list-content')).toBeNull();
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
});

it('keeps a formula delimiter after editing its value and obeys explicit output policy', async () => {
  const { value, capabilities, errors } = await mountPanel('公式 \\(x\\)。\n');
  root.querySelector<HTMLButtonElement>('.math-preview')!.click();
  const input = root.querySelector<HTMLTextAreaElement>('.tano-math textarea')!;
  input.value = 'y^2';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe('公式 \\(y^2\\)。\n');
  capabilities.value.mathSyntax = 'dollar';
  await nextTick();
  expect(value.value).toContain('\\(y^2\\)');
  input.value = 'z';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe('公式 $z$。\n');
  expect(errors).toEqual([]);
});

function placeCaret(element: Element, offset: number) {
  const range = document.createRange();
  range.setStart(element.firstChild!, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
}

it.each([
  ['删除线', '~~删除线~~', 'del'],
  ['下划线', '<u>下划线</u>', 'u'],
  ['上标', '<sup>2</sup>', 'sup'],
  ['下标', '<sub>2</sub>', 'sub'],
  ['高亮', '<mark>高亮</mark>', 'mark'],
  ['文字颜色', '<span style="color: #db2777">文字颜色</span>', 'span[style]'],
])('reveals %s as editable Markdown as soon as the caret enters', async (_label, source, selector) => {
  const content = `Before ${source} after.\n`;
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector(selector)!, 1);
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(source);
  expect(value.value).toBe(content);
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector(selector)).not.toBeNull();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it.each([
  ['$$\nx^2\n$$\n', '$$\nx^2\n$$', '$$\ny^2\n$$'],
  ['\\[\nx^2\n\\]\n', '\\[\nx^2\n\\]', '\\[\ny^2\n\\]'],
])('reveals a formula block as editable Markdown on click: %s', async (content, source, updated) => {
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const rendered = prose.querySelector<HTMLElement>('.math-block')!;
  rendered.style.marginTop = '20px';
  rendered.style.marginBottom = '20px';
  prose.focus();
  prose.querySelector<HTMLElement>('.math-block .math-preview')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, button: 0 }),
  );
  await nextTick();
  const editable = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(editable.style.height).toBe('');
  expect(editable.style.marginTop).toBe('20px');
  expect(editable.style.marginBottom).toBe('20px');
  expect(editable.style.overflow).toBe('');
  expect(editable.querySelector('code')?.textContent).toBe(source);
  expect(editable.querySelector('.tano-live-math-preview .katex')?.textContent).toContain('x');
  expect(editable.querySelectorAll('.tano-math-token-delimiter')).toHaveLength(2);
  expect(editable.querySelector('.tano-math-token-number')?.textContent).toBe('2');
  expect(prose.querySelector('.math-block')).toBeNull();
  expect(value.value).toBe(content);
  editable.querySelector('code')!.textContent = updated;
  editable.querySelector('code')!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  expect(editable.querySelector('.tano-live-math-preview .katex')?.textContent).toContain('y');
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe(`${updated}\n`);
  expect(prose.querySelector('.math-block .katex-display')).not.toBeNull();
  prose.querySelector<HTMLElement>('.math-block')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, button: 0 }),
  );
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  prose.querySelector<HTMLElement>('.math-block .math-preview')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, button: 0 }),
  );
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source] code')?.textContent).toBe(updated);
  expect(errors).toEqual([]);
});

it('reserves whole-block selection for the handle and context menu', async () => {
  const { editor, revealMarkdown, errors } = await mount('Before.\n\n$$\nx^2\n$$\n\nAfter.\n');
  revealMarkdown.value = false;
  await nextTick();
  const block = root.querySelector<HTMLElement>('.math-block')!;
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const position = view.state.doc.firstChild!.nodeSize;
  const node = view.state.doc.nodeAt(position)!;
  const click = new MouseEvent('click', { bubbles: true, button: 0 });
  expect(view.someProp('handleClickOn', (handler) =>
    handler(view, position, node, position, click, true),
  )).toBe(true);
  expect(view.someProp('handleClickOn', (handler) =>
    handler(view, position, node, position, click, false),
  )).toBeFalsy();
  expect(view.someProp('handleClickOn', (handler) =>
    handler(view, position, node, position, new MouseEvent('click', { button: 2 }), true),
  )).toBeFalsy();
  block.dispatchEvent(click);
  expect(block.classList.contains('ProseMirror-selectednode')).toBe(false);
  root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[1]!.click();
  expect(block.classList.contains('ProseMirror-selectednode')).toBe(true);
  expect(errors).toEqual([]);
});

it('clears a selected column block when pressing document space outside it without editing', async () => {
  const content = ':::columns\n\n## Left\n\nLeft body\n\n## Right\n\nRight body\n\n:::\n\nOutside\n\n---\n';
  const { value, editor, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const columns = root.querySelector<HTMLElement>('.tano-columns')!;
  const paragraphs = columns.querySelectorAll('p');
  const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[1]!;
  const surface = view.dom.parentElement!.parentElement!;
  for (const target of [surface, view.dom, columns, paragraphs[1]!, view.dom.querySelector('hr')!]) {
    handle.click();
    expect(paragraphs[0]!.classList.contains('ProseMirror-selectednode')).toBe(true);
    const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
    target.dispatchEvent(press);
    expect(root.querySelector('.ProseMirror-selectednode')).toBeNull();
    expect(view.state.selection.empty).toBe(true);
    expect(press.defaultPrevented).toBe(false);
  }
  await nextTick();
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('preserves block selection for its contents, controls, right clicks and modified clicks', async () => {
  const { editor, errors } = await mount('Selected **content**\n\nOutside\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const handle = root.querySelector<HTMLButtonElement>('.tano-block-handle')!;
  handle.click();
  const selected = view.state.selection;
  const surface = view.dom.parentElement!.parentElement!;
  for (const [target, options] of [
    [view.dom.querySelector('strong')!, {}],
    [handle, {}],
    [surface, { button: 2 }],
    [surface, { shiftKey: true }],
  ] as const) {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...options }));
    expect(view.state.selection.eq(selected)).toBe(true);
  }
  expect(errors).toEqual([]);
});

it('previews the editable inline formula only while the preference is enabled', async () => {
  const content = '前 $x^2$ 后。\n';
  const { value, preferences, revealMarkdown } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  prose.querySelector<HTMLElement>('.math-inline .math-preview')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, button: 0 }),
  );
  await nextTick();
  const source = prose.querySelector<HTMLElement>('[data-tano-live-inline-source]')!;
  const preview = source.querySelector<HTMLElement>('.tano-live-math-preview')!;
  expect(preview.hidden).toBe(false);
  expect(preview.querySelector('.katex')?.textContent).toContain('x');
  expect(value.value).toBe(content);

  preferences.value = { ...preferences.value, previewMathWhileEditing: false };
  await nextTick();
  expect(preview.hidden).toBe(true);
  preferences.value = { ...preferences.value, previewMathWhileEditing: true };
  await nextTick();
  expect(preview.hidden).toBe(false);

  revealMarkdown.value = false;
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(prose.querySelector('.math-inline .katex')).not.toBeNull();
  expect(value.value).toBe(content);
});

it('colors LaTeX commands in an editable formula block', async () => {
  const content = '$$\n\\int_0^1 x^2\\,dx = \\frac{1}{3}\n$$\n';
  const { value } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  prose.querySelector<HTMLElement>('.math-block .math-preview')!.click();
  await nextTick();
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.querySelector('code')?.textContent).toBe(content.trimEnd());
  expect([...source.querySelectorAll('.tano-math-token-command')].map((token) => token.textContent))
    .toContain('\\int');
  expect([...source.querySelectorAll('.tano-math-token-command')].map((token) => token.textContent))
    .toContain('\\frac');
  expect(source.querySelectorAll('.tano-math-token-delimiter')).toHaveLength(2);
  expect(value.value).toBe(content);
});

it('edits a Mermaid block as fenced Markdown when source reveal is enabled', async () => {
  const content = '```mermaid\ngraph TD\n  A --> B\n```\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  expect(prose.querySelector('.tano-editor-trigger')).toBeNull();
  prose.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
  await nextTick();
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.querySelector('code')?.textContent).toContain('```mermaid\ngraph TD');
  expect(source.querySelector('.tano-mermaid-token-keyword')?.textContent).toBe('mermaid');
  expect(source.querySelector('.tano-mermaid-token-arrow')?.textContent).toBe('-->');
  expect(prose.querySelector('.tano-mermaid')).toBeNull();
  expect(value.value).toBe(content);
  source.querySelector('code')!.textContent = '```mermaid\ngraph LR\n  A --> Z\n```';
  source.querySelector('code')!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await vi.waitFor(() => expect(value.value).toContain('graph LR\n  A --> Z'));
  expect(prose.querySelector('.tano-mermaid')).not.toBeNull();
  expect(errors).toEqual([]);
});

it('keeps Mermaid source fence lines at a readable height after expanding a preview', async () => {
  const content = '# Mermaid 图表\n\n```mermaid\ngraph TD\n  A --> B\n```\n\n脚注\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const previewBlock = prose.querySelector<HTMLElement>('.tano-mermaid')!;
  previewBlock.style.paddingTop = '0px';
  prose.focus();
  previewBlock.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
  await nextTick();

  const source = prose.querySelector<HTMLElement>('pre[data-source-kind="code_block"]')!;
  expect(source.querySelector('code')?.textContent).toBe('```mermaid\ngraph TD\n  A --> B\n```');
  expect(source.style.getPropertyValue('--tano-code-fence-line-height')).toBe('');
  expect(source.style.paddingTop).toBe('');
  expect(source.nextElementSibling?.textContent).toBe('脚注');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('shows one quiet placeholder for an empty Mermaid block', async () => {
  const content = '```mermaid\n\n```\n';
  const { value, revealMarkdown, errors } = await mount(content);
  const block = root.querySelector<HTMLElement>('.tano-mermaid')!;
  const preview = root.querySelector<HTMLElement>('.tano-mermaid-preview')!;
  expect(block.classList.contains('tano-empty-block')).toBe(true);
  expect(preview.classList.contains('tano-mermaid-preview-empty')).toBe(true);
  expect(preview.querySelector('.tano-mermaid-placeholder')?.textContent).toBe('Mermaid 图表');
  expect(preview.textContent).not.toContain('图表暂无法渲染');
  expect(value.value).toBe(content);

  revealMarkdown.value = false;
  await nextTick();
  preview.click();
  const input = root.querySelector<HTMLTextAreaElement>('.tano-mermaid-editor-panel textarea')!;
  expect(input.hidden).toBe(false);
  input.value = 'graph TD\n  A --> B';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.waitFor(() => expect(preview.querySelector('.tano-mermaid-placeholder')).toBeNull());
  input.value = '';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.waitFor(() => expect(preview.querySelector('.tano-mermaid-placeholder')).not.toBeNull());
  expect(preview.textContent).not.toContain('图表暂无法渲染');
  expect(errors).toEqual([]);
});

it('edits Mermaid in one live panel and closes it on outside click', async () => {
  const content = '```mermaid\ngraph TD\n  A --> B\n```\n\n```mermaid\ngraph LR\n  C --> D\n```\n\n$$\nx^2\n$$\n';
  const { value, revealMarkdown, readonly, errors } = await mount(content);
  revealMarkdown.value = false;
  await nextTick();
  const previews = root.querySelectorAll<HTMLElement>('.tano-mermaid-preview');
  expect(previews).toHaveLength(2);
  expect(root.querySelector('.tano-mermaid-edit-trigger')).toBeNull();
  previews[0]!.click();
  const firstPanel = root.querySelector<HTMLElement>('.tano-mermaid-editor-panel')!;
  expect(firstPanel.classList.contains('tano-editor-panel')).toBe(true);
  expect(firstPanel.hidden).toBe(false);
  const input = firstPanel.querySelector('textarea')!;
  expect(firstPanel.querySelector('.tano-mermaid-token-keyword')?.textContent).toBe('graph');
  expect(firstPanel.querySelector('.tano-mermaid-token-arrow')?.textContent).toBe('-->');
  input.value = 'graph TD\n  A --> Z';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(firstPanel.querySelector('.tano-mermaid-token-node:last-child')?.textContent).toBe('Z');
  await vi.waitFor(() => expect(value.value).toContain('A --> Z'));
  expect(firstPanel.hidden).toBe(false);
  input.select();
  expect(input.selectionStart).toBe(0);
  previews[1]!.click();
  expect(firstPanel.hidden).toBe(true);
  expect(root.querySelectorAll('.tano-mermaid-editor-panel:not([hidden])')).toHaveLength(1);
  root.querySelector<HTMLElement>('.math-block .math-preview')!.click();
  expect(root.querySelectorAll('.tano-mermaid-editor-panel:not([hidden])')).toHaveLength(0);
  expect(root.querySelectorAll('.math-editor-panel:not([hidden])')).toHaveLength(1);
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  expect(root.querySelectorAll('.math-editor-panel:not([hidden])')).toHaveLength(0);
  readonly.value = true;
  await nextTick();
  previews[0]!.click();
  expect(root.querySelectorAll('.tano-mermaid-editor-panel:not([hidden])')).toHaveLength(0);
  expect(errors).toEqual([]);
});

it('keeps Enter in the Mermaid editor and closes with Escape', async () => {
    const { value, revealMarkdown, errors } = await mount('```mermaid\n\n```\n');
    revealMarkdown.value = false;
    await nextTick();
    root.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
    const panel = root.querySelector<HTMLElement>('.tano-mermaid-editor-panel')!;
    const input = panel.querySelector<HTMLTextAreaElement>('textarea')!;
    expect(input.placeholder).toBe('Esc 或点击外部关闭');
    expect(input.wrap).toBe('off');
    expect(panel.textContent).not.toContain('Enter 换行');

    for (const shiftKey of [false, true]) {
      const newline = new KeyboardEvent('keydown', {
        key: 'Enter', shiftKey, bubbles: true, cancelable: true,
      });
      input.dispatchEvent(newline);
      expect(newline.defaultPrevented).toBe(false);
    }
    expect(panel.hidden).toBe(false);
    input.value = 'graph TD';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = 'graph LR\n  A --> B';
    expect(panel.hidden).toBe(false);
    const finish = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    input.dispatchEvent(finish);
    expect(finish.defaultPrevented).toBe(true);
    expect(panel.hidden).toBe(true);
    expect(root.querySelector('.tano-mermaid.ProseMirror-selectednode')).toBeNull();
    await nextTick();
    expect(value.value).toContain('graph LR\n  A --> B');
    expect(errors).toEqual([]);
});

it('keeps ordinary code blocks directly editable', async () => {
  await mount('```js\nconst result = 1;\n```\n');
  const code = root.querySelector<HTMLElement>('.ProseMirror pre code')!;
  expect(code).not.toBeNull();
  expect(code.closest('.tano-mermaid')).toBeNull();
  expect(code.textContent).toBe('const result = 1;');
});

it('edits a code block language without entering its source when Markdown reveal is off', async () => {
  const { value, editor, revealMarkdown, readonly, errors } = await mount(
    'Intro\n\n```js\nconst result = 1;\n```\n',
  );
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  expect(prose.querySelector<HTMLInputElement>('.tano-code-language')?.hidden).toBe(true);

  revealMarkdown.value = false;
  await nextTick();
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  const input = prose.querySelector<HTMLInputElement>('.tano-code-language')!;
  expect(input.hidden).toBe(false);
  expect(input.value).toBe('js');
  input.setSelectionRange(1, 1);
  input.dispatchEvent(new FocusEvent('focus'));
  expect(input.selectionStart).toBe(1);
  expect(input.selectionEnd).toBe(1);

  input.value = 'python';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toBe('Intro\n\n```python\nconst result = 1;\n```\n');
  expect(prose.querySelector('pre.tano-code-block')?.getAttribute('data-language')).toBe('python');
  expect(prose.querySelector('pre code')?.textContent).toBe('const result = 1;');
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');

  input.value = '';
  input.dispatchEvent(new FocusEvent('blur'));
  await nextTick();
  expect(value.value).toBe('Intro\n\n```\nconst result = 1;\n```\n');
  expect(prose.querySelector('pre.tano-code-block')?.hasAttribute('data-language')).toBe(false);

  readonly.value = true;
  await nextTick();
  expect(input.hidden).toBe(true);
  expect(errors).toEqual([]);
});

it('lists, filters and accepts custom code block languages', async () => {
  const { value, revealMarkdown, errors } = await mount('Intro\n\n```js\nconst result = 1;\n```\n');
  revealMarkdown.value = false;
  await nextTick();
  const input = root.querySelector<HTMLInputElement>('.tano-code-language')!;
  // jsdom cannot hover the code block, so expose the input before focusing it.
  input.style.display = 'block';
  input.focus();
  await nextTick();
  expect(document.activeElement).toBe(input);
  expect(root.contains(input)).toBe(true);
  const menu = document.querySelector<HTMLElement>('.tano-code-language-menu')!;
  expect(menu.parentElement).toBe(document.body);
  expect(menu.querySelectorAll('[role="option"]').length).toBeGreaterThan(250);
  expect(menu.querySelectorAll('.tano-code-language-icon img').length).toBeGreaterThan(100);
  expect(menu.textContent).toContain('ABAP');
  expect(input.getAttribute('aria-expanded')).toBe('true');
  expect(input.getAttribute('aria-controls')).toBe(menu.querySelector('[role="listbox"]')?.id);
  expect(menu.querySelector('.tano-code-language-footer')).toBeNull();

  input.value = 'cpp';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const cpp = menu.querySelector('[role="option"]')!;
  expect(cpp.querySelector('.tano-code-language-label')?.textContent).toBe('C++');
  expect(cpp.querySelector('.tano-code-language-id')?.textContent).toBe('cpp');
  await vi.waitFor(() => {
    expect(cpp.querySelector<HTMLImageElement>('.tano-code-language-icon img')?.getAttribute('src'))
      .toBeTruthy();
  });

  input.value = 'abap';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(menu.querySelector('[role="option"] .tano-code-language-icon img')).not.toBeNull();

  input.value = 'abnf';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(menu.querySelector('[role="option"] .tano-code-language-icon img')).toBeNull();

  input.value = 'js';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect(menu.querySelector('[role="option"] .tano-code-language-label')?.textContent)
    .toBe('JavaScript');
  input.value = 'lat';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  expect([...menu.querySelectorAll('[role="option"]')]
    .map((option) => option.querySelector('.tano-code-language-label')?.textContent))
    .toEqual(expect.arrayContaining(['LaTeX', 'Latte']));

  input.value = 'tano-lang';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const custom = menu.querySelector<HTMLButtonElement>('[role="option"]')!;
  expect(menu.querySelectorAll('[role="option"]')).toHaveLength(1);
  expect(custom.querySelector('.tano-code-language-label')?.textContent)
    .toBe('使用“tano-lang”作为自定义语言');
  const down = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
  custom.dispatchEvent(down);
  expect(down.defaultPrevented).toBe(true);
  custom.click();
  await nextTick();
  expect(value.value).toBe('Intro\n\n```tano-lang\nconst result = 1;\n```\n');
  expect(document.querySelector('.tano-code-language-menu')).toBeNull();
  const updatedInput = root.querySelector<HTMLInputElement>('.tano-code-language')!;
  updatedInput.dispatchEvent(new FocusEvent('focus'));
  expect(document.querySelector('.tano-code-language-menu')).not.toBeNull();
  revealMarkdown.value = true;
  await nextTick();
  expect(document.querySelector('.tano-code-language-menu')).toBeNull();
  expect(root.querySelector<HTMLInputElement>('.tano-code-language')?.hidden).toBe(true);
  expect(errors).toEqual([]);
});

it.each([
  ['wiki 链接', 'a[data-tano-wiki-target]', '前 [[Note|说明]] 后。\n', '[[Note|说明]]'],
  ['行内公式', '.math-inline .math-preview', '前 $x^2$ 后。\n', '$x^2$'],
  ['脚注引用', 'sup[data-type="footnote_reference"]', '前[^a] 后。\n\n[^a]: 说明\n', '[^a]'],
  ['内嵌 HTML', '.tano-html-node', '前 <abbr title="Tano">同页</abbr> 后。\n', '<abbr title="Tano">同页</abbr>'],
  ['图片', '.tano-image', '前 ![图](assets/diagram.png) 后。\n', '![图](assets/diagram.png)'],
])('reveals %s directly when its inline node is clicked', async (_label, selector, content, source) => {
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const target = prose.querySelector<HTMLElement>(selector)!;
  expect(target).not.toBeNull();
  if (_label === '图片') {
    expect(target.querySelector<HTMLElement>('.tano-image-caption')?.hidden).toBe(true);
    expect(target.querySelector('img')?.title).toBe('');
  }
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await nextTick();
  expect(
    _label === '行内公式'
      ? prose.querySelector('[data-tano-live-inline-source] > span')?.textContent
      : prose.querySelector('[data-tano-live-inline-source]')?.textContent,
  ).toBe(source);
  if (_label === '行内公式')
    expect(prose.querySelector('.tano-live-source-inline .tano-math-token-number')?.textContent).toBe('2');
  expect(value.value).toBe(content);
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('keeps other callouts and prose separate after editing and reparsing an unknown marker', async () => {
  const source = '> [!NOTE]\n> 普通说明，包含 **强调**。\n>\n> 123\n\n> [!TIP]\n> 操作建议。\n\n> [!IMPORTANT]\n> 重要信息。\n\n> [!WARNING]\n> 警告信息。\n\n> [!CAUTION]\n> 谨慎操作。\n\n后面的正文。\n';
  const { value, editor, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.insertText('[!NOT]', 2, 9));
  await nextTick();
  expect(value.value).toContain('> \\[!NOT]\n>\n> 普通说明');
  value.value = value.value.replace('普通说明', '外部说明');
  await nextTick();
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  expect(prose.querySelectorAll(':scope > blockquote')).toHaveLength(5);
  expect(prose.querySelectorAll('.tano-callout-title')).toHaveLength(4);
  expect(prose.querySelector('blockquote')!.querySelectorAll('p')).toHaveLength(3);
  expect(prose.querySelector('blockquote p')!.textContent).toBe('[!NOT]');
  expect(prose.querySelector('blockquote p:nth-of-type(2)')!.textContent).toContain('外部说明');
  expect(prose.lastElementChild!.tagName).toBe('P');
  expect(prose.lastElementChild!.textContent).toBe('后面的正文。');
  expect(errors).toEqual([]);
});

it('does not expand a paragraph block when a hard break is clicked', async () => {
  const content = '前文  \n后文\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const hardbreak = prose.querySelector<HTMLElement>('br[data-type="hardbreak"]')!;
  expect(hardbreak).not.toBeNull();
  prose.focus();
  hardbreak.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('[data-tano-live-source]')).toBeNull();
  expect(prose.querySelector('p')?.textContent).toContain('后文');
  expect(value.value).toBe(content);
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('edits a standalone image as Markdown when source reveal is enabled', async () => {
  const content = '![图](assets/diagram.png)\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  expect(prose.querySelector('.tano-image-caption')?.textContent).toBe('图');
  expect(prose.querySelector<HTMLImageElement>('.tano-image img')?.title).toBe('');
  expect(prose.querySelector('.tano-editor-trigger')).toBeNull();
  prose.querySelector<HTMLElement>('.tano-image img')!.click();
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')).toBeNull();
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.querySelector('code')?.textContent).toBe('![图](assets/diagram.png)');
  expect(prose.querySelector('.tano-image')).toBeNull();
  expect(value.value).toBe(content);
  source.querySelector('code')!.textContent = '![新图](assets/updated.png "说明")';
  source.querySelector('code')!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await nextTick();
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await vi.waitFor(() => expect(value.value).toContain('![新图](assets/updated.png "说明")'));
  expect(prose.querySelector('.tano-image-block img')?.getAttribute('alt')).toBe('新图');
  expect(prose.querySelector('.tano-image-caption')?.textContent).toBe('新图');
  expect(prose.querySelector<HTMLImageElement>('.tano-image-block img')?.title).toBe('说明');
  expect(errors).toEqual([]);
});

it('edits standalone image fields live in one panel when source reveal is disabled', async () => {
  const content = '![第一张](assets/one.png)\n\n![第二张](assets/two.png)\n\n$$\nx^2\n$$\n';
  const { value, revealMarkdown, readonly, errors } = await mount(content);
  revealMarkdown.value = false;
  await nextTick();
  const images = root.querySelectorAll<HTMLElement>('.tano-image-block img');
  expect(images).toHaveLength(2);
  expect(root.querySelector('.tano-image-edit-trigger')).toBeNull();
  images[0]!.click();
  const firstPanel = root.querySelector<HTMLElement>('.tano-image-editor-panel')!;
  expect(firstPanel.classList.contains('tano-editor-panel')).toBe(true);
  expect(firstPanel.hidden).toBe(false);
  expect(images[0]!.closest('.tano-image')?.classList.contains('tano-editor-active')).toBe(true);
  const inputs = firstPanel.querySelectorAll<HTMLInputElement>('input');
  expect([...firstPanel.querySelectorAll('label > span')].map((label) => label.textContent)).toEqual([
    '图片地址',
    '图注（替代文字）',
    '悬停提示',
  ]);
  expect([...inputs].map((input) => input.value)).toEqual(['assets/one.png', '第一张', '']);
  inputs[0]!.value = 'assets/new.png';
  inputs[0]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  inputs[1]!.value = '更新图片';
  inputs[1]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  inputs[2]!.value = '详情';
  inputs[2]!.dispatchEvent(new InputEvent('input', { bubbles: true }));
  await vi.waitFor(() => expect(value.value).toContain('![更新图片](assets/new.png "详情")'));
  expect(root.querySelector('.tano-image-caption')?.textContent).toBe('更新图片');
  expect(firstPanel.hidden).toBe(false);
  images[1]!.click();
  expect(firstPanel.hidden).toBe(true);
  expect(images[0]!.closest('.tano-image')?.classList.contains('tano-editor-active')).toBe(false);
  expect(images[1]!.closest('.tano-image')?.classList.contains('tano-editor-active')).toBe(true);
  expect(root.querySelectorAll('.tano-image-editor-panel:not([hidden])')).toHaveLength(1);
  root.querySelector<HTMLElement>('.math-block .math-preview')!.click();
  expect(root.querySelectorAll('.tano-image-editor-panel:not([hidden])')).toHaveLength(0);
  expect(root.querySelectorAll('.math-editor-panel:not([hidden])')).toHaveLength(1);
  expect(images[1]!.closest('.tano-image')?.classList.contains('tano-editor-active')).toBe(false);
  expect(root.querySelector('.math-block')?.classList.contains('tano-editor-active')).toBe(true);
  document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
  images[0]!.click();
  inputs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  expect(firstPanel.hidden).toBe(true);
  readonly.value = true;
  await nextTick();
  images[0]!.click();
  expect(firstPanel.hidden).toBe(true);
  expect(errors).toEqual([]);
});

it('keeps an image editor panel visible while its document scrolls', async () => {
  const { revealMarkdown } = await mount('![图](assets/diagram.png)\n');
  revealMarkdown.value = false;
  await nextTick();
  const image = root.querySelector<HTMLElement>('.tano-image-block')!;
  const panel = image.querySelector<HTMLElement>('.tano-image-editor-panel')!;
  let imageTop = window.innerHeight - 100;
  image.getBoundingClientRect = () => new DOMRect(100, imageTop, 150, 30);
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 300, 180);
  image.querySelector<HTMLImageElement>('img')!.click();
  expect(panel.hidden).toBe(false);
  expect(Number.parseFloat(panel.style.top)).toBeLessThan(0);
  expect(Number.parseFloat(panel.style.top) + window.innerHeight - 100 + 180)
    .toBeLessThanOrEqual(window.innerHeight - 8);
  imageTop = 100;
  root.querySelector('.ProseMirror')!.dispatchEvent(new Event('scroll'));
  expect(panel.style.top).toBe('-92px');
});

it('keeps a list item intact while editing its standalone image source', async () => {
  const content = '- ![图](assets/diagram.png)\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  prose.querySelector<HTMLElement>('.tano-image-block img')!.click();
  await nextTick();
  expect(prose.querySelector('li [data-tano-live-inline-source]')?.textContent).toBe(
    '![图](assets/diagram.png)',
  );
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('li .tano-image-block')).not.toBeNull();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('opens editable inline Markdown immediately at the caret and responds to the preference', async () => {
  const { value, revealMarkdown, errors } = await mount(
    'Plain **important** and *italic* plus [Google](https://google.com/).\n',
  );
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const caret = (element: Element, offset: number) => {
    prose.focus();
    const range = document.createRange();
    range.setStart(element.firstChild!, offset);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
  };
  expect(root.querySelector('span[data-tano-live-inline-source]')).toBeNull();
  caret(prose.querySelector('strong')!, 3);
  await nextTick();
  expect(root.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe(
    '**important**',
  );
  expect(root.querySelector('.tano-markdown-token')).toBeNull();
  caret(prose.querySelector('a')!, 2);
  await nextTick();
  expect(prose.querySelector('strong')?.textContent).toBe('important');
  expect(root.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe(
    '[Google](https://google.com/)',
  );
  revealMarkdown.value = false;
  await nextTick();
  expect(root.querySelector('span[data-tano-live-inline-source]')).toBeNull();
  expect(value.value).toBe(
    'Plain **important** and *italic* plus [Google](https://google.com/).\n',
  );
  expect(errors).toEqual([]);
});

it.each([
  ['GFM 自动链接', 'https://example.com', 'https://example.com'],
  ['尖括号自动链接', '<test@example.com>', 'test@example.com'],
  ['引用式链接', '[返回导航][home]', '返回导航'],
])('opens %s as editable Markdown on caret entry', async (_label, syntax, visible) => {
  const content = `前文 ${syntax} 后文。\n${syntax === '[返回导航][home]' ? '\n[home]: https://example.com "导航"\n' : ''}`;
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const link = [...prose.querySelectorAll('a')].find((item) => item.textContent === visible)!;
  expect(link).toBeDefined();
  prose.focus();
  placeCaret(link, 1);
  await nextTick();
  const source = prose.querySelector('[data-tano-live-inline-source]')?.textContent;
  expect(source).toContain(visible);
  if (syntax !== '<test@example.com>') expect(source).toContain('https://example.com');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('opens a clicked document link as Markdown source while reveal is enabled', async () => {
  const { value, openedLinks } = await mount('查看 [目标文档](./target.md)。\n');
  const link = root.querySelector<HTMLAnchorElement>('.ProseMirror a[href]')!;
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('[目标文档](./target.md)');
  expect(openedLinks).toEqual([]);
  expect(value.value).toBe('查看 [目标文档](./target.md)。\n');
});

it.each([
  ['[目标文档](./target.md)', 'a[href]'],
  ['[[Notes/Plan|计划]]', 'a[data-tano-wiki-target]'],
  ['$x^2$', '.math-preview'],
  ['$$\nx^2\n$$', '.math-preview'],
  ['![图](assets/one.png)', '.tano-image img'],
  ['```mermaid\ngraph TD\nA --> B\n```', '.tano-mermaid-preview'],
])('places the source caret at the click for %s from another paragraph', async (syntax, selector) => {
  const content = `Unrelated paragraph\n\n${syntax}\n`;
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const position = vi.spyOn(view, 'posAtCoords').mockImplementation(() => {
    let pos = -1;
    view.state.doc.descendants((node, offset) => {
      if (node.type.name === 'tano_live_source' || node.type.name === 'tano_live_source_inline')
        pos = offset + 4;
    });
    expect(pos).toBeGreaterThan(0);
    return { pos, inside: -1 };
  });
  root.querySelector(selector)!.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 160, clientY: 220,
  }));
  expect(position).toHaveBeenCalledWith({ left: 160, top: 220 });
  expect(view.state.selection.$from.parentOffset).toBe(3);
  expect(document.activeElement).toBe(view.dom);
  expect(document.querySelector('.tano-editor-panel:not([hidden])')).toBeNull();
  expect(value.value).toBe(content);
  view.dispatch(view.state.tr.insertText('Z'));
  expect(view.state.selection.$from.parent.textContent).toBe(`${syntax.slice(0, 3)}Z${syntax.slice(3)}`);
  expect(errors).toEqual([]);
});

it.each([
  ['$x^2$', '.math-preview'],
  ['```mermaid\ngraph TD\nA --> B\n```', '.tano-mermaid-preview'],
  ['前 ![图](assets/one.png) 后', '.tano-image img'],
  ['[文档](./target.md)', 'a[href]'],
  ['[[Notes/Plan|计划]]', 'a[data-tano-wiki-target]'],
])('closes the field panel on enabling source reveal for %s', async (syntax, selector) => {
  const { value, revealMarkdown, errors } = await mountPanel(`${syntax}\n`);
  root.querySelector<HTMLElement>(selector)!.click();
  await nextTick();
  expect(document.querySelectorAll('.tano-editor-panel:not([hidden])')).toHaveLength(1);
  expect(root.querySelector('[data-tano-live-source], [data-tano-live-inline-source]')).toBeNull();
  revealMarkdown.value = true;
  await nextTick();
  expect(document.querySelector('.tano-editor-panel:not([hidden])')).toBeNull();
  root.querySelector<HTMLElement>(selector)!.click();
  await nextTick();
  expect(root.querySelector('[data-tano-live-source], [data-tano-live-inline-source]')).not.toBeNull();
  expect(value.value).toBe(`${syntax}\n`);
  expect(errors).toEqual([]);
});

it('obeys source reveal on touch devices for formulas', async () => {
  vi.stubGlobal('matchMedia', () => ({ matches: false }));
  try {
    const { revealMarkdown, errors } = await mount('公式 $x$。\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    root.querySelector<HTMLElement>('.math-preview')!.click();
    expect(prose.querySelector('[data-tano-live-inline-source]')).not.toBeNull();
    expect(prose.querySelector('.math-editor-panel:not([hidden])')).toBeNull();
    revealMarkdown.value = false;
    await nextTick();
    root.querySelector<HTMLElement>('.math-preview')!.click();
    expect(prose.querySelector<HTMLElement>('.math-editor-panel')?.hidden).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it.each([true, false])('has no hover edit buttons in reveal mode %s', async (enabled) => {
  const { value, revealMarkdown, errors } = await mount('[目标文档](./target.md) 和 [[Notes/Plan|计划]]。\n\n$x$\n\n![图](assets/one.png)\n\n```mermaid\ngraph TD\nA --> B\n```\n');
  revealMarkdown.value = enabled;
  await nextTick();
  for (const element of root.querySelectorAll('a, .math-preview, .tano-image, .tano-mermaid'))
    element.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  await nextTick();
  expect(document.querySelector('.tano-editor-trigger')).toBeNull();
  expect(document.querySelector('.tano-link-editor-panel')).toBeNull();
  expect(value.value).toContain('[目标文档](./target.md)');
  expect(errors).toEqual([]);
});

it('keeps a live link panel attached to its link while the document scrolls', async () => {
  const { revealMarkdown } = await mount('[文档](./old.md)\n');
  revealMarkdown.value = false;
  await nextTick();
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.querySelector<HTMLAnchorElement>('a[href="./old.md"]')!.click();
  await nextTick();
  const panel = document.querySelector<HTMLElement>('.tano-link-editor-panel')!;
  panel.getBoundingClientRect = () => new DOMRect(0, 0, 180, 100);
  const address = panel.querySelector<HTMLInputElement>('[aria-label="链接地址"]')!;
  address.value = './new.md';
  address.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  const updated = prose.querySelector<HTMLAnchorElement>('a[href="./new.md"]')!;
  updated.getBoundingClientRect = () => new DOMRect(100, 200, 50, 20);
  window.dispatchEvent(new Event('scroll'));
  await nextTick();
  expect(panel.style.left).toBe('100px');
  expect(panel.style.top).toBe('226px');
});

it.each([
  ['GFM 自动链接', 'https://example.com', 'https://example.com', 'https://example.com'],
  ['邮箱自动链接', '<test@example.com>', 'test@example.com', 'mailto:test@example.com'],
  ['引用式链接', '[返回导航][home]', '返回导航', 'https://example.com'],
])('opens %s with Ctrl or Command click before source activation', async (_label, syntax, visible, href) => {
  const content = `前文 ${syntax} 后文。\n${syntax === '[返回导航][home]' ? '\n[home]: https://example.com "导航"\n' : ''}`;
  const { value, openedLinks, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  for (const modifier of ['ctrlKey', 'metaKey'] as const) {
    const link = [...prose.querySelectorAll('a')].find((item) => item.textContent === visible)!;
    const down = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      button: 0,
      [modifier]: true,
    });
    link.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [modifier]: true }));
    expect(openedLinks.at(-1)).toBe(href);
    expect(prose.querySelector('[data-tano-live-inline-source]')).toBeNull();
  }
  expect(openedLinks).toEqual([href, href]);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it.each([
  ['https://example.com', 'https://example.com', 'https://example.com'],
  ['<test@example.com>', 'test@example.com', 'mailto:test@example.com'],
  ['[返回导航][home]', '返回导航', 'https://example.com'],
])('opens an already expanded %s link with Ctrl-click', async (syntax, visible, href) => {
  const content = `前文 ${syntax} 后文。\n${syntax === '[返回导航][home]' ? '\n[home]: https://example.com "导航"\n' : ''}`;
  const { value, openedLinks, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const link = [...prose.querySelectorAll('a')].find((item) => item.textContent === visible)!;
  placeCaret(link, 1);
  await nextTick();
  const source = prose.querySelector<HTMLElement>('[data-tano-live-inline-source]')!;
  expect(source).not.toBeNull();
  source.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true }));
  expect(openedLinks).toEqual([href]);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it.each([
  ['GFM 自动链接', 'https://example.com', 'https://example.com'],
  ['邮箱自动链接', '<test@example.com>', 'test@example.com'],
  ['引用式链接', '[返回导航][home]', '返回导航'],
])('shows the link cursor for %s before and after source expansion', async (_label, syntax, visible) => {
  const content = `前文 ${syntax} 后文。\n${syntax === '[返回导航][home]' ? '\n[home]: https://example.com "导航"\n' : ''}`;
  const { value, errors } = await mount(content);
  const host = root.querySelector<HTMLElement>('.milkdown-host')!;
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const link = [...prose.querySelectorAll('a')].find((item) => item.textContent === visible)!;
  expect(link).toBeDefined();
  expect(host.classList.contains('tano-link-modifier')).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true }));
  await nextTick();
  expect(host.classList.contains('tano-link-modifier')).toBe(true);
  prose.focus();
  placeCaret(link, 1);
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')?.classList.contains('tano-clickable-source')).toBe(true);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control' }));
  await nextTick();
  expect(host.classList.contains('tano-link-modifier')).toBe(false);
  host.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, metaKey: true }));
  await nextTick();
  expect(host.classList.contains('tano-link-modifier')).toBe(true);
  window.dispatchEvent(new Event('blur'));
  await nextTick();
  expect(host.classList.contains('tano-link-modifier')).toBe(false);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('keeps non-link inline Markdown in the text cursor state', async () => {
  await mount('Plain **important** text.\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('strong')!, 1);
  await nextTick();
  const source = prose.querySelector('[data-tano-live-inline-source]');
  expect(source?.textContent).toBe('**important**');
  expect(source?.classList.contains('tano-clickable-source')).toBe(false);
});

it.each([
  ['heading', '## Conflicts\n', '## Conflicts'],
])('opens %s directly as editable Markdown when the caret enters', async (_name, markdown, source) => {
  const content = `Intro\n\n${markdown}`;
  const { value, revealMarkdown, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const target = prose.children[1]!;
  const text = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, Math.min(1, text.textContent?.length ?? 0));
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent).toBe(source);
  expect(prose.querySelector('[data-markdown-prefix], [data-markdown-open]')).toBeNull();
  revealMarkdown.value = false;
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('preserves heading spacing and type while letting its Markdown source grow', async () => {
  const { value, errors } = await mount('Before\n\n## Heading\n\nAfter\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const heading = prose.querySelector<HTMLElement>('h2')!;
  heading.style.marginTop = '34px';
  heading.style.marginBottom = '13px';
  heading.style.fontSize = '24px';
  heading.style.lineHeight = '43.2px';
  heading.style.letterSpacing = '0.2px';
  prose.focus();
  placeCaret(heading, 2);
  await nextTick();
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.textContent).toBe('## Heading');
  expect(source.style.height).toBe('');
  expect(source.style.marginTop).toBe('34px');
  expect(source.style.marginBottom).toBe('13px');
  expect(source.style.fontSize).toBe('24px');
  expect(source.style.lineHeight).toBe('43.2px');
  expect(source.style.letterSpacing).toBe('0.2px');
  expect(source.style.overflow).toBe('');
  expect(value.value).toBe('Before\n\n## Heading\n\nAfter\n');
  expect(errors).toEqual([]);
});

it('uses the heading style when switching directly from fenced code source to a heading', async () => {
  const content = '```ts\nlet value = 1;\n```\n\n## Heading\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('pre code')!, 1);
  await nextTick();
  expect(prose.querySelector('pre[data-source-kind="code_block"]')).not.toBeNull();
  const heading = prose.querySelector<HTMLElement>('h2')!;
  heading.style.fontSize = '24px';
  heading.style.lineHeight = '43.2px';
  heading.style.marginTop = '34px';
  heading.style.backgroundColor = 'rgb(255, 255, 255)';

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const headingPos = view.state.doc.firstChild!.nodeSize;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, headingPos + 3)));
  await nextTick();
  const source = prose.querySelector<HTMLElement>('pre[data-source-kind="heading"]')!;
  expect(source.textContent).toBe('## Heading');
  expect(source.style.fontSize).toBe('24px');
  expect(source.style.lineHeight).toBe('43.2px');
  expect(source.style.marginTop).toBe('34px');
  expect(source.style.backgroundColor).toBe('rgb(255, 255, 255)');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('starts a paragraph when Enter is pressed at the end of a live heading', async () => {
  const { value, editor, errors } = await mount('## 11231\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('h2')!, 5);
  await nextTick();
  expect(prose.querySelector('pre[data-source-kind="heading"]')?.textContent).toBe('## 11231');

  const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
  prose.dispatchEvent(enter);
  await nextTick();

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  expect(enter.defaultPrevented).toBe(true);
  expect(Array.from(prose.children).map((node) => node.tagName)).toEqual(['H2', 'P']);
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(value.value).toBe('## 11231\n\n');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(prose.querySelector('h2')?.textContent).toBe('11231');
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(value.value).toBe('## 11231\n');
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(Array.from(prose.children).map((node) => node.tagName)).toEqual(['H2', 'P']);
  expect(value.value).toBe('## 11231\n\n');
  expect(errors).toEqual([]);
});

it('moves the rest of a live heading into a paragraph when Enter is pressed in the middle', async () => {
  const { value, editor, errors } = await mount('## BeforeAfter\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('h2')!, 6);
  await nextTick();
  expect(prose.querySelector('pre[data-source-kind="heading"]')?.textContent).toBe('## BeforeAfter');

  prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  expect(Array.from(prose.children).map((node) => node.tagName)).toEqual(['H2', 'P']);
  expect(prose.children[0]?.textContent).toBe('Before');
  expect(prose.children[1]?.textContent).toBe('After');
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(value.value).toBe('## Before\n\nAfter\n');
  expect(errors).toEqual([]);
});

it('keeps inline formatting on both sides of a split heading', async () => {
  const { value, editor, errors } = await mount('## **BeforeAfter** tail\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const heading = prose.querySelector('h2')!;
  const range = document.createRange();
  range.setStart(heading.lastChild!, 2);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(prose.querySelector('pre[data-source-kind="heading"]')?.textContent)
    .toBe('## **BeforeAfter** tail');
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const source = view.state.selection.$from.parent;
  const offset = source.textContent.indexOf('After');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.selection.$from.start() + offset)));

  prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();

  expect(prose.querySelector('h2 strong')?.textContent).toBe('Before');
  expect(prose.querySelector('p strong')?.textContent).toBe('After');
  expect(value.value).toBe('## **Before**\n\n**After** tail\n');
  expect(errors).toEqual([]);
});

it('starts a paragraph from a rendered heading when Markdown reveal is disabled', async () => {
  const { value, revealMarkdown, errors } = await mount('## BeforeAfter\n');
  revealMarkdown.value = false;
  await nextTick();
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('h2')!, 6);
  await nextTick();
  prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  expect(Array.from(prose.children).map((node) => node.tagName)).toEqual(['H2', 'P']);
  expect(value.value).toBe('## Before\n\nAfter\n');
  expect(errors).toEqual([]);
});

it('starts a paragraph when Enter is pressed inside formatted heading text', async () => {
  const { value, editor, errors } = await mount('## **BeforeAfter**\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('h2 strong')!, 6);
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**BeforeAfter**');

  prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  expect(Array.from(prose.children).map((node) => node.tagName)).toEqual(['H2', 'P']);
  expect(prose.querySelector('h2 strong')?.textContent).toBe('Before');
  expect(prose.querySelector('p strong')?.textContent).toBe('After');
  expect(value.value).toBe('## **Before**\n\n**After**\n');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(prose.querySelector('h2 strong')?.textContent).toBe('BeforeAfter');
  expect(prose.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(value.value).toBe('## **BeforeAfter**\n');
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(prose.querySelector('p strong')?.textContent).toBe('After');
  expect(errors).toEqual([]);
});

it('keeps a fenced code editor at the rendered text size without fixing its height', async () => {
  const content = 'Before\n\n```ts\nlet count = 1;\n```\n\nAfter\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const rendered = prose.querySelector<HTMLElement>('pre.tano-code-block')!;
  const code = rendered.querySelector<HTMLElement>('code')!;
  rendered.style.lineHeight = '27px';
  code.style.fontSize = '13px';
  prose.focus();
  placeCaret(code, 1);
  await nextTick();
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.textContent).toBe('```ts\nlet count = 1;\n```');
  expect(source.style.height).toBe('');
  expect(source.style.fontSize).toBe('13px');
  expect(source.style.lineHeight).toBe('27px');
  expect(source.style.paddingTop).toBe('0px');
  expect(source.style.paddingBottom).toBe('0px');
  expect([...source.querySelectorAll('.tano-live-code-body')].map((span) => span.textContent).join(''))
    .toBe('let count = 1;');
  expect(source.style.overflow).toBe('');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('does not add a Markdown line when an empty code block enters source editing', async () => {
  const content = 'Intro\n\n```\n```\n\nAfter\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  prose.focus();
  const block = prose.querySelector<HTMLElement>('pre.tano-code-block')!;
  expect(block.hasAttribute('data-empty-code')).toBe(true);
  block.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await nextTick();

  const source = prose.querySelector<HTMLElement>('pre[data-source-kind="code_block"]')!;
  expect(source.textContent).toBe('```\n```');
  expect(source.querySelector('.tano-live-code-spacer')).toBeNull();
  expect(source.querySelector('.tano-live-code-body')).toBeNull();
  expect(view.state.selection.$from.parentOffset).toBe(4);
  expect(value.value).toBe(content);

  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(prose.querySelector('pre.tano-code-block')?.hasAttribute('data-empty-code')).toBe(true);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('adds an editable line only after clicking empty code with source reveal disabled', async () => {
  const content = 'Intro\n\n```aba\n```\n\nAfter\n';
  const { value, revealMarkdown, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  revealMarkdown.value = false;
  await nextTick();
  const block = prose.querySelector<HTMLElement>('pre.tano-code-block')!;
  expect(block.hasAttribute('data-empty-code')).toBe(true);
  expect(value.value).toBe(content);

  block.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await nextTick();
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const code = view.state.doc.child(1);
  expect(code.type.name).toBe('code_block');
  expect(code.textContent).toBe('\n');
  expect(prose.querySelector('pre.tano-code-block')?.hasAttribute('data-empty-code')).toBe(false);
  expect(value.value).toBe('Intro\n\n```aba\n\n```\n\nAfter\n');

  const cursor = view.state.selection.from;
  expect(view.someProp('handleTextInput', (handle) =>
    handle(view, cursor, cursor, 'x', () => view.state.tr.insertText('x', cursor)))).toBe(true);
  await nextTick();
  expect(view.state.doc.child(1).textContent).toBe('x');
  expect(value.value).toBe('Intro\n\n```aba\nx\n```\n\nAfter\n');
  expect(errors).toEqual([]);
});

it('keeps an existing blank code body row when source reveal is enabled', async () => {
  const content = 'Intro\n\n```aba\n\n```\n\nAfter\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const block = prose.querySelector<HTMLElement>('pre.tano-code-block')!;
  expect(block.hasAttribute('data-empty-code')).toBe(false);
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  prose.focus();
  const pos = view.state.doc.firstChild!.nodeSize;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
  await nextTick();
  expect(prose.querySelector('pre[data-source-kind="code_block"]')?.textContent)
    .toBe('```aba\n\n```');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('creates a body line only when typing in an empty code block', async () => {
  const { value, editor, errors } = await mount('Intro\n\n```\n```\n\nAfter\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  prose.focus();
  const pos = view.state.doc.firstChild!.nodeSize;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos + 1)));
  await nextTick();

  const cursor = view.state.selection.from;
  expect(view.someProp('handleTextInput', (handle) =>
    handle(view, cursor, cursor, 'x', () => view.state.tr.insertText('x', cursor)))).toBe(true);
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent).toBe('```\nx\n```');
  expect(prose.querySelector('.tano-live-code-body')?.textContent).toBe('x');
  expect(view.state.selection.from).toBe(cursor + 1);

  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  await nextTick();
  expect(value.value).toBe('Intro\n\n```\nx\n```\n\nAfter\n');
  expect(errors).toEqual([]);
});

it.each([
  ['paragraph', 'Plain text\n'],
  ['bullet list', '- First\n- [x] Done\n'],
  ['ordered list', '3. Third\n4. Fourth\n'],
  ['blockquote', '> Quote\n'],
])('keeps %s rendered when its caret enters', async (_name, markdown) => {
  const content = `Intro\n\n${markdown}`;
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const target = prose.children[1]!;
  const text = document.createTreeWalker(target, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, Math.min(1, text.textContent?.length ?? 0));
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(prose.children[1]).toBe(target);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('reveals fenced code Markdown when the caret enters and restores the code block on exit', async () => {
  const content = 'Intro\n\n```latex\n\\[x^2 + y^2 = z^2\\]\n```\n';
  const { value, revealMarkdown, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const code = prose.querySelector<HTMLElement>('pre code')!;
  prose.focus();
  const firstText = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(firstText, 1);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();

  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.textContent).toBe('```latex\n\\[x^2 + y^2 = z^2\\]\n```');
  expect(source.getAttribute('data-source-kind')).toBe('code_block');
  expect(source.querySelector('.token')).not.toBeNull();
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  expect(view.state.selection.$from.parent.type.name).toBe('tano_live_source');
  expect(view.state.selection.$from.parentOffset).toBe('```latex\n'.length + 1);
  expect(value.value).toBe(content);

  revealMarkdown.value = false;
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(prose.querySelector('pre code')?.textContent).toBe('\\[x^2 + y^2 = z^2\\]');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('keeps syntax colors while editing fenced code source', async () => {
  const content = '```ts\nconst message: string = "hello";\n```\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const code = prose.querySelector('pre code')!;
  const text = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, 1);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();

  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.textContent).toBe('```ts\nconst message: string = "hello";\n```');
  expect(source.querySelector('.token.keyword')?.textContent).toBe('const');
  expect(source.querySelector('.token.string')?.textContent).toBe('"hello"');
  expect([...source.querySelectorAll('.token')].some((token) => token.textContent?.includes('```')))
    .toBe(false);

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const from = view.state.selection.$from.start() + source.textContent!.indexOf('hello');
  view.dispatch(view.state.tr.insertText('world', from, from + 5));
  await nextTick();
  expect(source.querySelector('.token.string')?.textContent).toBe('"world"');
  expect(value.value).toBe('```ts\nconst message: string = "world";\n```\n');
  expect(errors).toEqual([]);
});

it('reveals a clicked code block before the editor selection catches up', async () => {
  const content = 'Intro\n\n```latex\n\\[x^2 + y^2 = z^2\\]\n```\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const code = prose.querySelector<HTMLElement>('pre code')!;
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  prose.focus();
  expect(view.state.selection.$from.parent.type.name).not.toBe('code_block');

  const text = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, 1);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  code.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await nextTick();

  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent)
    .toBe('```latex\n\\[x^2 + y^2 = z^2\\]\n```');
  expect(view.state.selection.$from.parentOffset).toBe('```latex\n'.length + 1);
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('reveals code when the preference is enabled with the caret already inside', async () => {
  const content = 'Intro\n\n```ts\nconst message = 1;\n```\n';
  const { value, revealMarkdown, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  revealMarkdown.value = false;
  await nextTick();
  prose.focus();
  const code = prose.querySelector('pre code')!;
  const text = document.createTreeWalker(code, NodeFilter.SHOW_TEXT).nextNode()!;
  const range = document.createRange();
  range.setStart(text, 1);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();

  revealMarkdown.value = true;
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent)
    .toBe('```ts\nconst message = 1;\n```');
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('reveals a newly inserted code block without losing the document change', async () => {
  const { value, editor, errors } = await mount('Intro\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const pos = view.state.doc.content.size;
  const code = view.state.schema.nodes.code_block!.create(
    { language: 'ts' },
    view.state.schema.text('const message = 1;'),
  );
  const tr = view.state.tr.insert(pos, code);
  tr.setSelection(TextSelection.create(tr.doc, pos + 1 + 6));
  view.dispatch(tr);
  await nextTick();

  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent)
    .toBe('```ts\nconst message = 1;\n```');
  expect(value.value).toBe('Intro\n\n```ts\nconst message = 1;\n```\n');
  expect(errors).toEqual([]);
});

it('keeps edits to an expanded fenced code block when the caret leaves', async () => {
  const content = 'Intro\n\n```js\nconst value = 1;\n```\n';
  const { value, revealMarkdown, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('pre code')!, 1);
  await nextTick();

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
  expect(source.textContent).toBe('```js\nconst value = 1;\n```');
  const from = view.state.selection.$from.start() + source.textContent!.indexOf('1');
  view.dispatch(view.state.tr.insertText('2', from, from + 1));
  await nextTick();
  expect(value.value).toBe('Intro\n\n```js\nconst value = 2;\n```\n');

  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(prose.querySelector('pre code')?.textContent).toBe('const value = 2;');
  revealMarkdown.value = false;
  await nextTick();
  expect(value.value).toBe('Intro\n\n```js\nconst value = 2;\n```\n');
  expect(errors).toEqual([]);
});

it('reveals an inline field inside a list without expanding the list block', async () => {
  const content = '- Before **bold** after\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('strong')!, 2);
  await nextTick();
  expect(prose.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**bold**');
  expect(prose.querySelector('ul')).not.toBeNull();
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('opens the clicked block as editable Markdown source and restores the visual block on blur', async () => {
  const { value, errors, revealMarkdown } = await mount('# Conflicts\n\n1231 **124234**\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const heading = prose.querySelector('h1')!;
  prose.focus();
  const range = document.createRange();
  range.setStart(heading.firstChild!, 4);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  heading.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent).toBe('# Conflicts');
  expect(value.value).toBe('# Conflicts\n\n1231 **124234**\n');
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('h1')?.textContent).toBe('Conflicts');
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  revealMarkdown.value = false;
  await nextTick();
  prose.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(errors).toEqual([]);
});

it('saves edits to Markdown markers and changes the rendered block type', async () => {
  const { value, errors } = await mount('# Conflicts\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  prose.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const code = prose.querySelector('pre[data-tano-live-source] code')!;
  code.textContent = '## Conflicts';
  code.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'insertText', data: '#' }),
  );
  await vi.waitFor(() => expect(value.value).toContain('## Conflicts'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('h2')?.textContent).toBe('Conflicts');
  expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
  expect(errors).toEqual([]);
});

it('edits inline delimiters as source text and renders the new mark on exit', async () => {
  const { value, errors } = await mount('1231 **124234** and *italic*\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const strong = prose.querySelector('strong')!;
  placeCaret(strong, 2);
  strong.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const source = prose.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe('**124234**');
  expect(source.querySelector('.tano-live-source-strong')?.textContent).toBe('124234');
  expect(source.querySelectorAll('.tano-live-source-marker')).toHaveLength(2);
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('1231 ');
  expect(prose.querySelector('em')?.textContent).toBe('italic');
  source.textContent = '*124234*';
  source.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
  );
  await vi.waitFor(() => expect(value.value).toContain('1231 *124234* and *italic*'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect([...prose.querySelectorAll('em')].map((node) => node.textContent)).toEqual([
    '124234',
    'italic',
  ]);
  expect(prose.querySelector('strong')).toBeNull();
  expect(errors).toEqual([]);
});

it('switches inline source between fields without expanding the sentence', async () => {
  const { value, errors } = await mount('Before **bold** between *italic* after.\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const strong = prose.querySelector('strong')!;
  placeCaret(strong, 2);
  strong.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(prose.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe('**bold**');
  expect(prose.querySelector('em')?.textContent).toBe('italic');
  const emphasis = prose.querySelector('em')!;
  placeCaret(emphasis, 2);
  await nextTick();
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  expect(prose.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe('*italic*');
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('Before ');
  expect(value.value).toBe('Before **bold** between *italic* after.\n');
  expect(errors).toEqual([]);
});

it('switches between headings without displaying a read-only Markdown prefix', async () => {
  const content = 'Intro\n\n# First\n\n## Second\n';
  const { value, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  placeCaret(prose.querySelector('h1')!, 2);
  await nextTick();
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent).toBe('# First');
  placeCaret(prose.querySelector('h2')!, 2);
  await nextTick();
  expect(prose.querySelector('h1')?.textContent).toBe('First');
  expect(prose.querySelector('pre[data-tano-live-source]')?.textContent).toBe('## Second');
  expect(prose.querySelector('[data-markdown-prefix]')).toBeNull();
  expect(value.value).toBe(content);
  expect(errors).toEqual([]);
});

it('does not reveal the previous field when the caret is in following plain text', async () => {
  const { value, errors } = await mount('A **bold** tail\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const after = prose.querySelector('p')!.lastChild!;
  const range = document.createRange();
  range.setStart(after, 0);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(prose.querySelector('span[data-tano-live-inline-source]')).toBeNull();
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  expect(value.value).toBe('A **bold** tail\n');
  expect(errors).toEqual([]);
});

it('edits a heading mark directly when the caret enters that mark', async () => {
  const { value, errors } = await mount('Intro\n\n# Title **bold** suffix\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const strong = prose.querySelector('strong')!;
  placeCaret(strong, 2);
  strong.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(prose.querySelector('h1')?.getAttribute('data-markdown-prefix')).toBeNull();
  expect(prose.querySelector('h1')?.textContent).toBe('Title **bold** suffix');
  expect(prose.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe('**bold**');
  expect(value.value).toBe('Intro\n\n# Title **bold** suffix\n');
  expect(errors).toEqual([]);
});

it('edits only the current inline link destination', async () => {
  const { value, errors } = await mount('Go [Google](https://google.com/) and **bold**.\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const link = prose.querySelector('a')!;
  placeCaret(link, 2);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const source = prose.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe('[Google](https://google.com/)');
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  source.textContent = '[Google](https://example.com/)';
  source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  await vi.waitFor(() => expect(value.value).toContain('[Google](https://example.com/)'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('a')?.getAttribute('href')).toBe('https://example.com/');
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  expect(errors).toEqual([]);
});

it('keeps enclosing marks when editing a nested inline field', async () => {
  const { value, errors } = await mount('A **bold [link](https://example.com/) tail** Z\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const link = prose.querySelector('a')!;
  placeCaret(link, 2);
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const source = prose.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe('**[link](https://example.com/)**');
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('A ');
  source.textContent = '**[link](https://new.example/)**';
  source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  await vi.waitFor(() => expect(value.value).toContain('https://new.example/'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe('A **bold [link](https://new.example/) tail** Z\n');
  expect(prose.querySelector('strong')?.textContent).toBe('bold link tail');
  expect(prose.querySelector('a')?.getAttribute('href')).toBe('https://new.example/');
  expect(errors).toEqual([]);
});

it('opens only an Alt-clicked wiki link as editable inline source', async () => {
  const { value, openedWikiLinks, errors } = await mount('See [[Notes/Plan|计划]] and **bold**.\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const link = prose.querySelector<HTMLAnchorElement>('a[data-tano-wiki-target]')!;
  link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, altKey: true }));
  const source = prose.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe('[[Notes/Plan|计划]]');
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  expect(openedWikiLinks).toEqual([]);
  source.textContent = '[[Notes/Index|计划]]';
  source.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText' }));
  await vi.waitFor(() => expect(value.value).toContain('[[Notes/Index|计划]]'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(
    prose.querySelector('a[data-tano-wiki-target]')?.getAttribute('data-tano-wiki-target'),
  ).toBe('Notes/Index');
  expect(prose.querySelector('strong')?.textContent).toBe('bold');
  expect(errors).toEqual([]);
});

it('keeps unfinished Markdown markers editable after the inline source loses focus', async () => {
  const { value, errors } = await mount('1231 **124234**\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const strong = prose.querySelector('strong')!;
  placeCaret(strong, 2);
  strong.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  const source = prose.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  source.textContent = '**124234*';
  source.dispatchEvent(
    new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }),
  );
  await vi.waitFor(() => expect(value.value).toContain('1231 **124234*'));
  prose.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(prose.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe('**124234*');
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('1231 ');
  expect(errors).toEqual([]);
});

describe('click below the last block', () => {
  function clickBelow(target: Element, options: MouseEventInit = {}) {
    const event = new MouseEvent('mousedown', {
      bubbles: true,
      cancelable: true,
      clientY: 150,
      ...options,
    });
    target.dispatchEvent(event);
    return event;
  }

  it.each([
    '正文',
    '#',
    '- 列表内容',
    '> 引用',
    '```\ncode\n```',
    '---',
    '| A | B |\n| --- | --- |\n| 1 | 2 |',
    '![图片](assets/photo.png)',
  ])('appends a default paragraph outside the final block: %s', async (content) => {
    const { errors } = await mount(content);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const before = prose.lastElementChild!;
    const count = prose.childElementCount;
    vi.spyOn(before, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 300, 50));
    expect(clickBelow(prose).defaultPrevented).toBe(true);
    await nextTick();
    expect(prose.childElementCount).toBe(count + 1);
    expect(prose.children[count - 1]).toBe(before);
    const paragraph = prose.lastElementChild!;
    expect(paragraph.tagName).toBe('P');
    expect(paragraph.textContent).toBe('');
    expect(document.activeElement).toBe(prose);
    expect(paragraph.contains(window.getSelection()!.anchorNode)).toBe(true);
    expect(errors).toEqual([]);
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(prose.childElementCount).toBe(count);
    expect(prose.lastElementChild!.tagName).toBe(before.tagName);
  });

  it('reuses the final empty paragraph on repeated clicks and clears active marks', async () => {
    const { editor } = await mount('正文');
    const host = root.querySelector<HTMLElement>('.milkdown-host')!;
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.value!.command('bold');
    clickBelow(host);
    const paragraph = prose.lastElementChild!;
    clickBelow(host);
    expect(prose.childElementCount).toBe(2);
    expect(prose.lastElementChild).toBe(paragraph);
    expect(paragraph.contains(window.getSelection()!.anchorNode)).toBe(true);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [], getData: (type: string) => (type === 'text/plain' ? '普通文字' : '') },
    });
    prose.dispatchEvent(paste);
    await nextTick();
    expect(paragraph.textContent).toBe('普通文字');
    expect(paragraph.querySelector('strong')).toBeNull();
  });

  it('focuses the existing default paragraph in an empty document', async () => {
    await mount('');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    clickBelow(root.querySelector('.milkdown-host')!);
    expect(prose.childElementCount).toBe(1);
    expect(prose.firstElementChild!.contains(window.getSelection()!.anchorNode)).toBe(true);
  });

  it('handles blank space outside the editor host via the page handler', async () => {
    const { editor } = await mount('# 标题');
    root.addEventListener('mousedown', (event) => editor.value!.focusTrailingParagraph(event));
    expect(clickBelow(root).defaultPrevented).toBe(true);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    expect(prose.childElementCount).toBe(2);
    expect(prose.lastElementChild!.contains(window.getSelection()!.anchorNode)).toBe(true);
  });

  it('ignores content, side space, modified clicks, composition and readonly mode', async () => {
    const { editor, readonly } = await mount('# 标题');
    const host = root.querySelector<HTMLElement>('.milkdown-host')!;
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const heading = prose.firstElementChild!;
    vi.spyOn(heading, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 300, 50));
    for (const options of [{ clientY: 75 }, { button: 2 }, { shiftKey: true }, { ctrlKey: true }])
      expect(clickBelow(host, options).defaultPrevented).toBe(false);
    const contentClick = new MouseEvent('mousedown', { clientY: 150, cancelable: true });
    Object.defineProperty(contentClick, 'target', { value: heading });
    editor.value!.focusTrailingParagraph(contentClick);
    expect(contentClick.defaultPrevented).toBe(false);
    prose.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(clickBelow(host).defaultPrevented).toBe(false);
    prose.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    readonly.value = true;
    await nextTick();
    expect(clickBelow(host).defaultPrevented).toBe(false);
    expect(prose.childElementCount).toBe(1);
  });
});

describe('Markdown editor round trips', () => {
  it('deletes the first empty H1 and leaves the following heading levels unchanged', async () => {
    const { value } = await mount('#\n\n##\n\n###\n\n####\n\n正文\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const headings = () =>
      Array.from(prose.querySelectorAll('h1,h2,h3,h4')).map((node) => node.tagName);
    expect(headings()).toEqual(['H1', 'H2', 'H3', 'H4']);
    prose.focus();
    const range = document.createRange();
    range.selectNodeContents(prose.firstElementChild!);
    range.collapse(true);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await nextTick();
    expect(prose.firstElementChild!.contains(window.getSelection()!.anchorNode)).toBe(true);
    const event = new KeyboardEvent('keydown', {
      key: 'Backspace',
      bubbles: true,
      cancelable: true,
    });
    prose.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(headings()).toEqual(['H2', 'H3', 'H4']);
    expect(prose.childElementCount).toBe(4);
    expect(value.value).toBe('##\n\n###\n\n####\n\n正文\n');
    expect(prose.firstElementChild!.contains(window.getSelection()!.anchorNode)).toBe(true);
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(headings()).toEqual(['H1', 'H2', 'H3', 'H4']);
  });

  it('inserts and focuses an empty paragraph before the body while preserving YAML and existing blocks', async () => {
    const { value, editor } = await mount('---\ntitle: metadata\n---\n\n# 原标题\n\n原正文\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    editor.value!.insertBlockAtStart();
    await nextTick();
    expect(prose.children[0]!.tagName).toBe('P');
    expect(prose.children[0]!.textContent).toBe('');
    expect(prose.children[1]!.tagName).toBe('H1');
    expect(prose.children[1]!.textContent).toBe('原标题');
    expect(prose.children[2]!.textContent).toBe('原正文');
    expect(document.activeElement).toBe(prose);
    expect(prose.children[0]!.contains(window.getSelection()!.anchorNode)).toBe(true);
    expect(value.value).toContain('---\ntitle: metadata\n---\n');
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(prose.children[0]!.tagName).toBe('H1');
  });

  it('keeps pasted slash text literal without opening a command session', async () => {
    const { value, errors } = await mount('');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    expect(prose.querySelector('[data-placeholder]')).not.toBeNull();
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [], getData: (type: string) => (type === 'text/plain' ? '/table' : '') },
    });
    prose.dispatchEvent(paste);
    await nextTick();
    expect(document.querySelector<HTMLElement>('.tano-slash-menu')?.hidden).toBe(true);
    expect(prose.querySelector('table')).toBeNull();
    expect(value.value).toContain('/table');
    expect(value.value).not.toContain('输入 /');
    expect(errors).toEqual([]);
  });

  it('edits Level 1 titles and content, switches tabs without saving UI state, and reloads', async () => {
    const { value, editor, errors } = await mount('正文\n');
    editor.value!.command('toggle');
    await nextTick();
    const title = root.querySelector<HTMLInputElement>('[aria-label="折叠块标题"]')!;
    title.value = '详细 & 说明';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('<summary>详细 &amp; 说明</summary>');
    const saved = value.value;
    root.querySelector<HTMLButtonElement>('[aria-label="展开或收起折叠块"]')!.click();
    await nextTick();
    expect(root.querySelector<HTMLElement>('.tano-toggle > .tano-enhanced-content')!.hidden).toBe(
      true,
    );
    expect(value.value).toBe(saved);
    editor.value!.command('tabs');
    await nextTick();
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
    const tabsSaved = value.value;
    root.querySelectorAll<HTMLButtonElement>('[role="tab"]')[1]!.click();
    await nextTick();
    expect(
      root.querySelectorAll<HTMLElement>('.tano-tabs > .tano-enhanced-content > .tano-panel')[0]!
        .hidden,
    ).toBe(true);
    expect(value.value).toBe(tabsSaved);
    root.querySelector<HTMLButtonElement>('[aria-label="添加标签页"]')!.click();
    await nextTick();
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(3);
    const final = value.value;
    value.value = '临时';
    await nextTick();
    value.value = final;
    await nextTick();
    expect(root.querySelectorAll('[role="tab"]')).toHaveLength(3);
    expect(root.querySelector<HTMLInputElement>('[aria-label="折叠块标题"]')!.value).toBe(
      '详细 & 说明',
    );
    expect(root.querySelector('.tano-tabs')!.getAttribute('data-feature-level')).toBe('1');
    expect(errors).toEqual([]);
  });

  it('manages tab panels from the compact menu and keeps the selected panel when reordered', async () => {
    const { value, readonly, errors } = await mount('::::tabs\n\n:::panel "说明"\n\n第一段\n\n:::\n\n:::panel "代码"\n\n第二段\n\n:::\n\n::::\n');
    const tabs = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-tab-list [role="tab"]')];
    tabs()[1]!.click();
    const panel = root.querySelector<HTMLElement>('.tano-tabs > .tano-enhanced-content > .tano-panel:not([hidden])')!;
    const menu = panel.querySelector<HTMLDetailsElement>('.tano-panel-menu')!;
    expect(menu.open).toBe(false);
    expect(document.getElementById(tabs()[1]!.getAttribute('aria-controls')!)).toBe(panel);
    expect(panel.getAttribute('aria-labelledby')).toBe(tabs()[1]!.id);
    menu.open = true;
    const title = menu.querySelector<HTMLInputElement>('input')!;
    title.value = '示例代码';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(tabs()[1]!.textContent).toBe('示例代码');
    expect(value.value).toContain('示例代码');
    menu.querySelector<HTMLButtonElement>('[aria-label="前移分区"]')!.click();
    await nextTick();
    expect(tabs().map(tab => tab.textContent)).toEqual(['示例代码', '说明']);
    expect(tabs()[0]!.getAttribute('aria-selected')).toBe('true');
    const selected = root.querySelector<HTMLElement>('.tano-panel:not([hidden])')!;
    expect(selected.textContent).toContain('第二段');
    expect(selected.querySelector<HTMLButtonElement>('[aria-label="前移分区"]')!.disabled).toBe(true);
    const saved = value.value;
    readonly.value = true;
    await nextTick();
    expect(selected.querySelector<HTMLDetailsElement>('.tano-panel-menu')!.hidden).toBe(true);
    tabs()[1]!.click();
    await nextTick();
    expect(tabs()[1]!.getAttribute('aria-selected')).toBe('true');
    expect(value.value).toBe(saved);
    expect(errors).toEqual([]);
  });

  it('loads column ratios, edits nested blocks, and preserves layout through save, reload, and readonly mode', async () => {
    const source = '::::columns widths=40,60\n\n:::panel "Left"\n\n<details>\n<summary>Nested</summary>\n\nChild\n\n</details>\n\n:::\n\n:::panel "Right"\n\nOther\n\n:::\n\n::::\n';
    const { editor, value, readonly, errors } = await mount(source);
    const columns = () => root.querySelector<HTMLElement>('.tano-columns')!;
    const tracks = () => columns().querySelector<HTMLElement>(':scope > .tano-enhanced-content')!;
    expect(tracks().style.getPropertyValue('--tano-column-tracks')).toBe('minmax(0, 40fr) minmax(0, 60fr)');
    expect([...tracks().children].every(panel => panel.querySelector<HTMLElement>(':scope > .tano-enhanced-header')!.hidden)).toBe(true);
    const separator = columns().querySelector<HTMLElement>('[role="separator"]')!;
    separator.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    await nextTick();
    expect(value.value).toContain('columns widths=41,59');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    let child = 0;
    view.state.doc.descendants((node, pos) => { if (node.type.name === 'paragraph' && node.textContent === 'Child') child = pos + 1; });
    view.dispatch(view.state.tr.insertText(' edited', child + 5));
    await nextTick();
    expect(value.value).toContain('Child edited');
    expect(value.value).toContain('columns widths=41,59');
    const saved = value.value;
    value.value = 'Temporary';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(tracks().style.getPropertyValue('--tano-column-tracks')).toBe('minmax(0, 41fr) minmax(0, 59fr)');
    readonly.value = true;
    await nextTick();
    expect(columns().querySelector<HTMLElement>('.tano-column-controls')!.hidden).toBe(true);
    columns().querySelector<HTMLElement>('[role="separator"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(columns().querySelector('[aria-label="添加分栏"]')).toBeNull();
    expect(value.value).toBe(saved);
    expect(errors).toEqual([]);
  });

  it('previews column dragging, cancels without saving, commits once, and undoes the whole resize', async () => {
    const { editor, value, readonly, errors } = await mount(':::columns\n\n## Left\n\nChild\n\n## Right\n\nOther\n\n:::\n');
    const columns = root.querySelector<HTMLElement>('.tano-columns')!;
    const content = columns.querySelector<HTMLElement>(':scope > .tano-enhanced-content')!;
    [...content.children].forEach((panel, index) => {
      vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: index * 416, right: index * 416 + 384, width: 384, top: 0, bottom: 100, height: 100, x: index * 416, y: 0, toJSON: () => ({}) });
    });
    readonly.value = true;
    await nextTick();
    readonly.value = false;
    await nextTick();
    const separator = columns.querySelector<HTMLElement>('[role="separator"]')!;
    const pointer = (target: EventTarget, type: string, x: number) => {
      const event = new MouseEvent(type, { clientX: x, button: 0, bubbles: true, cancelable: true });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      target.dispatchEvent(event);
    };
    const saved = value.value;
    pointer(separator, 'pointerdown', 400);
    pointer(document, 'pointermove', 500);
    expect(content.style.getPropertyValue('--tano-column-tracks')).not.toBe('minmax(0, 50fr) minmax(0, 50fr)');
    expect(value.value).toBe(saved);
    const focusedTitle = root.querySelector<HTMLInputElement>('[aria-label="分区标题"]')!;
    focusedTitle.addEventListener('keydown', event => event.stopPropagation());
    focusedTitle.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    pointer(document, 'pointerup', 500);
    expect(value.value).toBe(saved);
    expect(content.style.getPropertyValue('--tano-column-tracks')).toBe('minmax(0, 50fr) minmax(0, 50fr)');
    expect(editor.value!.canUndo()).toBe(false);
    pointer(separator, 'pointerdown', 400);
    pointer(document, 'pointermove', 450);
    pointer(document, 'pointermove', 500);
    pointer(document, 'pointerup', 500);
    await nextTick();
    expect(value.value).toContain('columns widths=63.021,36.979');
    expect(editor.value!.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).not.toContain('widths=');
    expect(editor.value!.canUndo()).toBe(false);
    expect(value.value).toContain('Child');
    expect(value.value).toContain('Other');
    expect(errors).toEqual([]);
  });

  it('targets nested children for duplicate/delete and hides their handles when their parent closes', async () => {
    const { value, errors } = await mountPanel('<details>\n<summary>Parent</summary>\n\nChild\n\n</details>\n\nOutside\n');
    const handles = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')];
    expect(handles().map((handle) => handle.dataset.blockDepth)).toEqual(['0', '1', '0']);
    async function menuAction(target: Element, label: string) {
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await nextTick();
      [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')].find((button) => button.textContent?.includes(label))!.click();
      await nextTick();
    }
    await menuAction(root.querySelector('.tano-toggle p')!, '创建副本');
    expect(root.querySelectorAll('.tano-toggle p')).toHaveLength(2);
    expect(root.querySelectorAll('.ProseMirror > .tano-toggle')).toHaveLength(1);
    await menuAction(handles()[1]!, '删除块');
    await menuAction(handles()[1]!, '删除块');
    expect(root.querySelectorAll('.tano-toggle p')).toHaveLength(1);
    expect(root.querySelector('.tano-toggle p')?.textContent).toBe('');
    expect(value.value).toContain('Outside');
    const saved = value.value;
    root.querySelector<HTMLButtonElement>('[aria-label="展开或收起折叠块"]')!.click();
    await nextTick();
    expect(handles()[1]!.hidden).toBe(true);
    expect(handles()[0]!.hidden).toBe(false);
    expect(value.value).toBe(saved);
    root.querySelector<HTMLButtonElement>('[aria-label="添加子块"]')!.click();
    await nextTick();
    expect(handles()[1]!.hidden).toBe(false);
    expect(root.querySelectorAll('.tano-toggle p')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('creates recursively nested toggles from the child caret and moves children with the keyboard', async () => {
    const { editor, value, errors } = await mountPanel('');
    editor.value!.command('toggle');
    editor.value!.command('toggle');
    await nextTick();
    expect(root.querySelector('.tano-toggle .tano-toggle p')).not.toBeNull();
    root.querySelectorAll<HTMLButtonElement>('[aria-label="添加子块"]')[0]!.click();
    await nextTick();
    const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.insertText('Sibling'));
    await nextTick();
    const handle = [...root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')].at(-1)!;
    handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    await nextTick();
    expect(root.querySelector('.tano-toggle .tano-toggle')?.textContent).toContain('Sibling');
    [...root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')].at(-1)!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await nextTick();
    expect(root.querySelector('.tano-toggle .tano-toggle')?.textContent).not.toContain('Sibling');
    expect(root.querySelector('.ProseMirror > .tano-toggle > .tano-enhanced-content > p')?.textContent).toBe('Sibling');
    const saved = value.value;
    value.value = 'temporary';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(root.querySelector('.tano-toggle .tano-toggle p')).not.toBeNull();
    expect(errors).toEqual([]);
  });

  it.each(['', '[!TIP]\n'])('edits quote children independently and preserves their parent on delete and reload: %s', async (marker) => {
    const { editor, value, errors } = await mountPanel(`> ${marker.replace(/\n/g, '\n> ')}Child\n\nOutside\n`);
    const handles = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')];
    expect(handles().map(handle => handle.dataset.blockDepth)).toEqual(['0', '1', '0']);
    root.querySelector('blockquote')!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(handles()[0]!.classList.contains('is-visible')).toBe(true);
    handles()[0]!.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(handles()[0]!.classList.contains('is-visible')).toBe(true);
    async function action(target: Element, label: string) {
      target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      await nextTick();
      [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')].find(button => button.textContent?.includes(label))!.click();
      await nextTick();
    }
    await action(root.querySelector('blockquote > p:last-of-type')!, '创建副本');
    expect(root.querySelectorAll('.ProseMirror > blockquote')).toHaveLength(1);
    expect(root.querySelectorAll('blockquote > p')).toHaveLength(marker ? 3 : 2);
    await action(handles()[1]!, '删除块');
    await action(handles()[1]!, '删除块');
    expect(root.querySelector('blockquote > p:last-of-type')?.textContent).toBe('');
    if (marker) expect(root.querySelector('.tano-callout-title')?.textContent).toBe('提示');
    const saved = value.value;
    value.value = 'temporary';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(root.querySelector('blockquote > p:last-of-type')?.textContent).toBe('');
    expect(root.querySelector('.ProseMirror > p')?.textContent).toBe('Outside');
    expect(errors).toEqual([]);
  });

  it('indents and outdents a nested callout child with the handle keyboard shortcuts', async () => {
    const { value, errors } = await mountPanel('> [!IMPORTANT]\n>\n> > [!TIP]\n> > Nested\n>\n> Sibling\n\nOutside\n');
    const handles = () => [...root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')];
    expect(handles().map(handle => handle.dataset.blockDepth)).toEqual(['0', '1', '2', '1', '0']);
    handles()[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    await nextTick();
    expect(root.querySelector('blockquote blockquote')?.textContent).toContain('Sibling');
    expect(handles().map(handle => handle.dataset.blockDepth)).toEqual(['0', '1', '2', '2', '0']);
    handles()[3]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }));
    await nextTick();
    expect(root.querySelector('blockquote blockquote')?.textContent).not.toContain('Sibling');
    const saved = value.value;
    value.value = 'temporary';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(root.querySelectorAll('.tano-callout-title')).toHaveLength(2);
    expect(root.querySelector('.ProseMirror > blockquote > p:last-of-type')?.textContent).toBe('Sibling');
    expect(errors).toEqual([]);
  });

  it('renders portable file cards, previews images and preserves unsafe or malformed containers', async () => {
    const input =
      '正文\n\n:::embed\n\n[图片](assets/picture.png)\n\n:::\n\n:::file\n\n[危险](javascript:alert)\n\n:::\n';
    const { value, editor, errors } = await mount(input);
    expect(root.querySelector('.tano-embed img')?.getAttribute('src')).toBe(
      'https://example.test/assets/picture.png',
    );
    expect(root.querySelector('.tano-unsupported-block')?.textContent).toContain(
      'javascript:alert',
    );
    editor.value!.command('file', 'assets/Paper.pdf');
    await nextTick();
    expect(root.querySelector('.tano-file')).not.toBeNull();
    expect(value.value).toContain('assets/Paper.pdf');
    expect(value.value).toContain('[危险](javascript:alert)');
    expect(errors).toEqual([]);
  });

  it('imports non-image attachments as Level 1 cards without replacing text at the insertion point', async () => {
    const { value, errors } = await mount('原有正文\n', async () => ({
      url: 'assets/Paper.pdf',
      name: 'Paper.pdf',
      image: false,
    }));
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['pdf'], 'Paper.pdf', { type: 'application/pdf' })] },
    });
    root.querySelector('.ProseMirror')!.dispatchEvent(paste);
    await vi.waitFor(() => expect(root.querySelector('.tano-file')).not.toBeNull());
    expect(value.value).toContain('原有正文');
    expect(value.value).toContain(':::file');
    expect(value.value).toContain('[Paper.pdf](assets/Paper.pdf)');
    expect(errors).toEqual([]);
  });
  it('opens compact file rows and edits their Markdown metadata in a dismissible panel', async () => {
    const { value, openedLinks, openedNewTabLinks, readonly, errors } = await mount(':::file\n\n[说明文档](assets/guide.pdf)\n\n:::\n');
    const file = root.querySelector<HTMLElement>('.tano-file')!;
    const row = file.querySelector<HTMLButtonElement>('.tano-resource-row')!;
    expect(file.querySelector('.tano-enhanced-header')).toBeNull();
    expect(row.textContent).toBe('说明文档PDF');
    row.click();
    expect(openedLinks).toEqual(['assets/guide.pdf']);
    expect(openedNewTabLinks).toEqual(['assets/guide.pdf']);
    const panel = file.querySelector<HTMLElement>('.tano-resource-editor-panel')!;
    expect(panel.hidden).toBe(true);
    file.querySelector<HTMLButtonElement>('[aria-label="编辑附件"]')!.click();
    expect(panel.hidden).toBe(false);
    const title = panel.querySelector<HTMLInputElement>('[aria-label="附件名称"]')!;
    const url = panel.querySelector<HTMLInputElement>('[aria-label="附件地址"]')!;
    title.value = '阅读材料';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    url.value = 'javascript:alert(1)';
    url.dispatchEvent(new Event('change', { bubbles: true }));
    expect(panel.querySelector<HTMLElement>('[role="status"]')!.hidden).toBe(false);
    expect(value.value).toContain('[阅读材料](assets/guide.pdf)');
    url.value = 'assets/new%20guide.pdf';
    panel.querySelector<HTMLButtonElement>('.tano-resource-done')!.click();
    await nextTick();
    expect(value.value).toContain('[阅读材料](assets/new%20guide.pdf)');
    expect(panel.hidden).toBe(true);
    file.querySelector<HTMLButtonElement>('[aria-label="编辑附件"]')!.click();
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(panel.hidden).toBe(true);
    file.querySelector<HTMLButtonElement>('[aria-label="编辑附件"]')!.click();
    readonly.value = true;
    await nextTick();
    expect(panel.hidden).toBe(true);
    expect(file.querySelector<HTMLButtonElement>('[aria-label="编辑附件"]')!.hidden).toBe(true);
    row.click();
    expect(openedLinks.at(-1)).toBe('assets/new%20guide.pdf');
    expect(errors).toEqual([]);
  });

  it('shows embedded images directly and falls back to a file row when loading fails', async () => {
    const { value, errors } = await mount(':::embed\n\n[图片](assets/picture.png)\n\n:::\n');
    const embed = root.querySelector<HTMLElement>('.tano-embed')!;
    const image = embed.querySelector<HTMLImageElement>('img')!;
    const row = embed.querySelector<HTMLButtonElement>('.tano-resource-row')!;
    expect(embed.querySelector('.tano-enhanced-header')).toBeNull();
    expect(row.hidden).toBe(true);
    image.click();
    const panel = embed.querySelector<HTMLElement>('.tano-resource-editor-panel')!;
    expect(panel.hidden).toBe(false);
    const title = panel.querySelector<HTMLInputElement>('[aria-label="附件名称"]')!;
    title.value = '图片说明';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(embed.querySelector('img')).toBe(image);
    expect(image.alt).toBe('图片说明');
    image.dispatchEvent(new Event('error'));
    expect(row.hidden).toBe(false);
    expect(row.textContent).toContain('图片暂不可用');
    expect(embed.querySelector<HTMLElement>('.tano-embed-preview')!.hidden).toBe(true);
    const url = panel.querySelector<HTMLInputElement>('[aria-label="附件地址"]')!;
    url.value = 'assets/replacement.png';
    url.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(row.hidden).toBe(true);
    expect(embed.querySelector('img')).not.toBe(image);
    expect(value.value).toContain('[图片说明](assets/replacement.png)');
    expect(errors).toEqual([]);
  });

  it('preserves a playable embedded media element when its label or readonly state changes', async () => {
    const { readonly, errors } = await mount(':::embed\n\n[录音](assets/recording.mp3)\n\n:::\n');
    const embed = root.querySelector<HTMLElement>('.tano-embed')!;
    const audio = embed.querySelector<HTMLAudioElement>('audio')!;
    expect(audio.controls).toBe(true);
    expect(audio.src).toBe('https://example.test/assets/recording.mp3');
    embed.querySelector<HTMLButtonElement>('[aria-label="编辑附件"]')!.click();
    const title = embed.querySelector<HTMLInputElement>('[aria-label="附件名称"]')!;
    title.value = '会议录音';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    readonly.value = true;
    await nextTick();
    expect(embed.querySelector('audio')).toBe(audio);
    expect(errors).toEqual([]);
  });
  it('renders safe block and inline HTML while keeping the original tags', async () => {
    const input =
      '<div style="color: red">\n<strong>块内容</strong>\n</div>\n\n' +
      '前 <abbr title="缩写">Tano</abbr> 后\n';
    const { value, editor, errors } = await mount(input);
    expect(root.querySelector('.tano-html-node strong')?.textContent).toBe('块内容');
    expect(root.querySelector('.tano-html-node abbr')?.textContent).toBe('Tano');
    expect(root.querySelector('.tano-html-fallback')).toBeNull();
    editor.value!.command('math');
    await nextTick();
    expect(value.value).toContain('<div style="color: red">\n<strong>块内容</strong>\n</div>');
    expect(value.value).toContain('<abbr title="缩写">Tano</abbr>');
    expect(errors).toEqual([]);
  });

  it('resolves local images embedded in HTML through the workspace adapter', async () => {
    const { errors } = await mount('<img src="assets/picture.png" alt="图片">\n');
    expect(root.querySelector<HTMLImageElement>('.tano-html-node img')?.src).toBe(
      'https://example.test/assets/picture.png',
    );
    expect(root.querySelector('.tano-html-fallback')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('marks unsafe HTML red and never executes or discards it', async () => {
    const input =
      '正文\n\n<script>window.__tanoUnsafe = true</script>\n\n' +
      '<div style="background-image: url(javascript:alert(1))">危险样式</div>\n\n' +
      '<u onclick="alert(1)">危险属性</u>\n';
    const { value, editor, errors } = await mount(input);
    expect(root.querySelectorAll('.tano-html-fallback')).toHaveLength(3);
    expect(root.querySelector('.tano-html-fallback')?.textContent).toBe(
      '<script>window.__tanoUnsafe = true</script>',
    );
    expect((window as Window & { __tanoUnsafe?: boolean }).__tanoUnsafe).toBeUndefined();
    editor.value!.command('math');
    await nextTick();
    expect(value.value).toContain('<script>window.__tanoUnsafe = true</script>');
    expect(value.value).toContain('<u onclick="alert(1)">危险属性</u>');
    expect(errors).toEqual([]);
  });

  it('renders footnote references and definitions and preserves them after editing', async () => {
    const input = '正文\n\n脚注[^a]\n\n[^a]: 原文\n';
    const { value, editor, errors } = await mount(input);
    expect(root.querySelector('.tano-unsupported-block')).toBeNull();
    expect(root.querySelector('sup[data-type="footnote_reference"]')?.textContent).toBe('a');
    expect(root.querySelector('dl[data-type="footnote_definition"] dd')?.textContent).toBe('原文');
    editor.value!.command('math');
    await nextTick();
    expect(value.value).toContain('脚注[^a]');
    expect(value.value).toContain('[^a]: 原文');
    expect(errors).toEqual([]);
  });

  it('numbers footnotes by first reference while keeping Markdown labels', async () => {
    const input = '正文[^note]，再次[^note]，另一个[^second]。\n\n[^second]: 第二条\n\n[^note]: 第一条\n';
    const { value, editor, errors } = await mount(input);
    const references = [...root.querySelectorAll('sup[data-type="footnote_reference"]')];
    expect(references.map((node) => node.getAttribute('data-footnote-number'))).toEqual(['1', '1', '2']);
    const definitions = [...root.querySelectorAll('dl[data-type="footnote_definition"]')];
    expect(definitions.map((node) => node.getAttribute('data-footnote-number'))).toEqual(['2', '1']);
    editor.value!.command('math');
    await nextTick();
    expect(value.value).toContain('正文[^note]，再次[^note]，另一个[^second]');
    expect(value.value).toContain('[^note]: 第一条');
    expect(errors).toEqual([]);
  });

  it('keeps footnote numbers stable while the first reference source is expanded', async () => {
    const input = '第一处[^note]，第二处[^second]。\n\n[^note]: 第一条\n\n[^second]: 第二条\n';
    const { value, editor, errors } = await mount(input);
    const references = [...root.querySelectorAll<HTMLElement>('sup[data-type="footnote_reference"]')];
    expect(references.map((node) => node.getAttribute('data-footnote-number'))).toEqual(['1', '2']);

    references[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await nextTick();
    const source = root.querySelector<HTMLElement>('[data-tano-live-inline-source]')!;
    expect(source.textContent).toBe('[^note]');
    expect(root.querySelector('sup[data-type="footnote_reference"]')?.getAttribute('data-footnote-number'))
      .toBe('2');
    expect([...root.querySelectorAll('dl[data-type="footnote_definition"]')]
      .map((node) => node.getAttribute('data-footnote-number'))).toEqual(['1', '2']);

    const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.insertText('x', view.state.selection.from));
    expect(root.querySelector('sup[data-type="footnote_reference"]')?.getAttribute('data-footnote-number'))
      .toBe('2');
    expect(errors).toEqual([]);
    expect(value.value).toContain('[^note]');
  });

  it('expands a footnote number to edit its Markdown label', async () => {
    const input = '正文[^note]，另一个[^second]。\n\n[^note]: 第一条支持 **粗体** 和 [链接](https://example.com)。\n\n[^second]: 第二条\n';
    const { value, editor, errors } = await mount(input);
    const definition = root.querySelector<HTMLElement>('dl[data-type="footnote_definition"]')!;
    definition.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    await nextTick();

    const source = definition.querySelector<HTMLElement>('dd p > [data-tano-live-inline-source]')!;
    expect(source.textContent).toBe('[^note]: ');
    expect(source.nextSibling?.textContent).toContain('第一条支持');
    expect(definition.querySelector('input')).toBeNull();
    expect(definition.querySelector('strong')?.textContent).toBe('粗体');
    expect(definition.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接');
    expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect([...root.querySelectorAll('sup[data-type="footnote_reference"]')]
      .map((node) => node.getAttribute('data-footnote-number'))).toEqual(['1', '2']);

    const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
    let sourcePos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tano_live_source_inline' && node.attrs.origin === 'footnote_definition')
        sourcePos = pos;
    });
    expect(sourcePos).toBeGreaterThanOrEqual(0);
    expect(view.state.selection.from).toBe(sourcePos + 3);
    view.dispatch(view.state.tr.insertText('renamed', sourcePos + 3, sourcePos + 7));
    await nextTick();
    expect(value.value).toContain('[^renamed]: 第一条支持 **粗体** 和 [链接](https://example.com)。');
    view.dom.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape', bubbles: true, cancelable: true,
    }));
    await nextTick();
    expect(value.value).toContain('[^renamed]: 第一条支持 **粗体** 和 [链接](https://example.com)。');
    expect(value.value).toContain('正文[^note]，另一个[^second]');
    expect(root.querySelector('dl[data-type="footnote_definition"]')?.getAttribute('data-label'))
      .toBe('renamed');
    const updated = root.querySelector<HTMLElement>('dl[data-type="footnote_definition"]')!;
    expect(updated.querySelector('[data-tano-live-inline-source]')).toBeNull();
    expect(updated.querySelector('strong')?.textContent).toBe('粗体');
    expect(updated.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接');
    expect(editor.value!.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toContain('[^note]: 第一条支持 **粗体** 和 [链接](https://example.com)。');
    expect(editor.value!.redoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toContain('[^renamed]: 第一条支持 **粗体** 和 [链接](https://example.com)。');
    expect(errors).toEqual([]);
  });

  it('enters the footnote label naturally when moving left from the body start', async () => {
    const input = '正文[^note]\n\n[^note]: 第一条支持 **粗体** 和 [链接](https://example.com)。\n';
    const { value, editor, errors } = await mount(input);
    const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
    let definitionPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote_definition') definitionPos = pos;
    });
    expect(definitionPos).toBeGreaterThanOrEqual(0);
    const bodyStart = definitionPos + 2;
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart + 1)));
    const first = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    view.dom.dispatchEvent(first);
    expect(first.defaultPrevented).toBe(false);
    // jsdom does not move the native caret; this is the browser's first ArrowLeft.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, bodyStart)));
    const second = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    view.dom.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(true);
    const definition = root.querySelector<HTMLElement>('dl[data-type="footnote_definition"]')!;
    const source = definition.querySelector<HTMLElement>('dd p > [data-tano-live-inline-source]')!;
    expect(source.textContent).toBe('[^note]: ');
    expect(source.nextSibling?.textContent).toContain('第一条支持');
    let sourcePos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'tano_live_source_inline' && node.attrs.origin === 'footnote_definition')
        sourcePos = pos;
    });
    expect(view.state.selection.from).toBe(sourcePos + 1 + source.textContent!.length);
    expect(definition.querySelector('strong')?.textContent).toBe('粗体');
    expect(definition.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接');
    expect(value.value).toBe(input);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(
      view.state.doc, sourcePos + source.textContent!.length + 2,
    )));
    expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
    expect(root.querySelector('dl[data-type="footnote_definition"]')?.getAttribute('data-footnote-number'))
      .toBe('1');
    expect(value.value).toBe(input);
    expect(errors).toEqual([]);
  });

  it('keeps footnote body formatting rendered when the caret is outside its marks', async () => {
    const { editor, errors } = await mount(
      '正文[^note]\n\n[^note]: 第一条支持 **粗体** 和 [链接](https://example.com)。\n',
    );
    const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
    let definitionPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'footnote_definition') definitionPos = pos;
    });
    expect(definitionPos).toBeGreaterThanOrEqual(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, definitionPos + 2)));
    const definition = root.querySelector<HTMLElement>('dl[data-type="footnote_definition"]')!;
    definition.querySelector<HTMLElement>('dd p')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect(definition.querySelector('strong')?.textContent).toBe('粗体');
    expect(definition.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接');
    let boldPos = -1;
    view.state.doc.descendants((node, pos) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'strong')) boldPos = pos + 1;
    });
    expect(boldPos).toBeGreaterThanOrEqual(0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, boldPos)));
    definition.querySelector<HTMLElement>('strong')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
    expect(definition.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**粗体**');
    expect(definition.querySelector('a[href="https://example.com"]')?.textContent).toBe('链接');
    expect(errors).toEqual([]);
  });

  it('jumps from a modified footnote reference to its matching definition', async () => {
    const input = '第一处[^note]，第二处[^second]。\n\n[^second]: 第二条\n\n[^note]: 第一条\n';
    const { value, errors } = await mount(input);
    const references = [...root.querySelectorAll<HTMLElement>('sup[data-type="footnote_reference"]')];
    const definitions = [...root.querySelectorAll<HTMLElement>('dl[data-type="footnote_definition"]')];
    const scrollFirst = vi.fn();
    const scrollSecond = vi.fn();
    definitions[1]!.scrollIntoView = scrollFirst;
    definitions[0]!.scrollIntoView = scrollSecond;

    for (const modifier of ['ctrlKey', 'metaKey'] as const) {
      const down = new MouseEvent('mousedown', {
        bubbles: true, cancelable: true, button: 0, [modifier]: true,
      });
      references[0]!.dispatchEvent(down);
      expect(down.defaultPrevented).toBe(true);
      const click = new MouseEvent('click', {
        bubbles: true, cancelable: true, button: 0, [modifier]: true,
      });
      references[0]!.dispatchEvent(click);
      expect(click.defaultPrevented).toBe(true);
    }
    references[1]!.dispatchEvent(new MouseEvent('click', {
      bubbles: true, cancelable: true, button: 0, ctrlKey: true,
    }));
    expect(scrollFirst).toHaveBeenCalledTimes(2);
    expect(scrollSecond).toHaveBeenCalledTimes(1);
    expect(scrollFirst).toHaveBeenCalledWith({ block: 'center', behavior: 'smooth' });
    expect(value.value).toBe(input);
    expect(errors).toEqual([]);
  });

  it.each([
    ':::warning\n原文\n:::\n\n正文\n',
    '```js title=demo.js\nconst answer = 42;\n```\n\n正文\n',
    '![[嵌入]]\n\n正文\n',
  ])('keeps an unsupported block visible and intact: %s', async (input) => {
    const { value, editor, errors } = await mount(`可编辑正文\n\n${input}`);
    expect(root.querySelector('.tano-unsupported-block')).not.toBeNull();
    editor.value!.command('math');
    await nextTick();
    expect(value.value).toContain(input.slice(0, input.indexOf('\n')));
    expect(errors).toEqual([]);
  });

  it('keeps TOML frontmatter intact as a red block', async () => {
    const input = '+++\ntitle = "原文"\n+++\n\n正文\n';
    const { value, errors } = await mount(input);
    expect(root.querySelector('.tano-unsupported-block pre')?.textContent).toContain(
      '+++\ntitle = "原文"\n+++',
    );
    expect(value.value).toBe(input);
    expect(errors).toEqual([]);
  });

  it('keeps a document with unclosed frontmatter intact in a red block', async () => {
    const input = '---\nnot closed\n\n正文\n';
    const { value, errors } = await mount(input);
    expect(root.querySelector('.tano-unsupported-block pre')?.textContent).toBe(input);
    expect(value.value).toBe(input);
    expect(errors).toEqual([]);
  });

  it('does not leave rich text mode after repeated Enter presses', async () => {
    const { value, errors } = await mount('# 新建文档 8\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    for (let index = 0; index < 3; index++)
      prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    expect(value.value).toContain('<br />');
    expect(unsupportedMarkdown(value.value)).toEqual([]);
    expect(errors).toEqual([]);
  });

  it('reveals wiki-link Markdown on click and opens the target with Ctrl-click', async () => {
    const { value, revealMarkdown, openedWikiLinks, errors } = await mount(
      'See [[Notes/Plan|计划]] and [[Note#标题]].\n',
    );
    const links = root.querySelectorAll<HTMLAnchorElement>('a[data-tano-wiki-target]');
    expect(links).toHaveLength(2);
    expect(links[0].textContent).toBe('计划');
    expect(links[0].dataset.tanoWikiTarget).toBe('Notes/Plan');
    links[0].dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('[[Notes/Plan|计划]]');
    root.querySelector<HTMLElement>('.ProseMirror')!.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
    await nextTick();
    root.querySelector<HTMLAnchorElement>('a[data-tano-wiki-target]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true, ctrlKey: true }),
    );
    expect(openedWikiLinks).toEqual(['Notes/Plan']);
    revealMarkdown.value = false;
    await nextTick();
    root.querySelector<HTMLAnchorElement>('a[data-tano-wiki-target]')!.dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(openedWikiLinks).toEqual(['Notes/Plan']);
    await nextTick();
    expect(document.querySelector('.tano-link-editor-panel')).not.toBeNull();
    expect(value.value).toBe('See [[Notes/Plan|计划]] and [[Note#标题]].\n');
    expect(errors).toEqual([]);
  });

  it('edits regular and Wiki links live when Markdown reveal is off', async () => {
    const { value, revealMarkdown, openedLinks, openedWikiLinks, errors } = await mount(
      '[目标文档](./target.md) 和 [[Notes/Plan|计划]] 和 [Example](https://example.com)，公式 $x$。\n',
    );
    revealMarkdown.value = false;
    await nextTick();
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const clickLink = (text: string, modifier?: 'ctrlKey' | 'metaKey') => {
      const link = [...prose.querySelectorAll<HTMLAnchorElement>('a')].find((item) => item.textContent === text)!;
      link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, [modifier ?? 'detail']: true }));
    };
    clickLink('目标文档');
    await nextTick();
    let panel = document.querySelector<HTMLElement>('.tano-link-editor-panel')!;
    expect(panel.classList.contains('tano-editor-panel')).toBe(true);
    expect(prose.querySelector('a[href="./target.md"]')?.classList.contains('tano-editor-active')).toBe(true);
    expect(panel.querySelector<HTMLInputElement>('[aria-label="链接地址"]')?.value).toBe('./target.md');
    const text = panel.querySelector<HTMLInputElement>('[aria-label="链接文字"]')!;
    text.value = '新文档';
    text.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('[新文档](./target.md)');
    const address = panel.querySelector<HTMLInputElement>('[aria-label="链接地址"]')!;
    address.value = './renamed.md';
    address.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('[新文档](./renamed.md)');
    expect(prose.querySelector('a[href="./renamed.md"]')?.classList.contains('tano-editor-active')).toBe(true);
    expect(document.querySelectorAll('.tano-link-editor-panel')).toHaveLength(1);
    clickLink('计划');
    await nextTick();
    expect(prose.querySelector('a[href="./renamed.md"]')?.classList.contains('tano-editor-active')).toBe(false);
    expect(prose.querySelector('a[data-tano-wiki-target="Notes/Plan"]')?.classList.contains('tano-editor-active')).toBe(true);
    panel = document.querySelector<HTMLElement>('.tano-link-editor-panel')!;
    expect(panel.querySelector('[aria-label="Wiki 链接目标"]')).not.toBeNull();
    const target = panel.querySelector<HTMLInputElement>('[aria-label="Wiki 链接目标"]')!;
    target.value = 'Notes/New';
    target.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('[[Notes/New|计划]]');
    expect(prose.querySelector('a[data-tano-wiki-target="Notes/New"]')?.classList.contains('tano-editor-active')).toBe(true);
    prose.querySelector<HTMLElement>('.math-inline .math-preview')!.click();
    await nextTick();
    expect(document.querySelector('.tano-link-editor-panel')).toBeNull();
    expect(prose.querySelector('a[data-tano-wiki-target="Notes/New"]')?.classList.contains('tano-editor-active')).toBe(false);
    expect(prose.querySelector('.math-inline')?.classList.contains('tano-editor-active')).toBe(true);
    expect(prose.querySelector<HTMLElement>('.math-editor-panel')?.hidden).toBe(false);
    clickLink('计划');
    await nextTick();
    expect(prose.querySelector<HTMLElement>('.math-editor-panel')?.hidden).toBe(true);
    expect(document.querySelector('.tano-link-editor-panel')).not.toBeNull();
    clickLink('Example', 'ctrlKey');
    expect(openedLinks).toEqual(['https://example.com']);
    await nextTick();
    expect(document.querySelector('.tano-link-editor-panel')).toBeNull();
    clickLink('计划', 'metaKey');
    expect(openedWikiLinks).toEqual(['Notes/New']);
    clickLink('新文档');
    await nextTick();
    expect(document.querySelector('.tano-link-editor-panel')).not.toBeNull();
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    await nextTick();
    expect(document.querySelector('.tano-link-editor-panel')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('shows a block drag handle on hover and moves the block with the keyboard', async () => {
    const content = '# 新建文档 3\n\nNext paragraph.\n';
    const { value, errors } = await mount(content);
    const handles = Array.from(root.querySelectorAll<HTMLButtonElement>('.tano-block-handle'));
    const foldButtons = Array.from(root.querySelectorAll<HTMLButtonElement>('.tano-fold-toggle'));
    expect(handles).toHaveLength(2);
    expect(foldButtons).toHaveLength(1);
    root
      .querySelector('.ProseMirror > h1')!
      .dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    expect(handles[0].classList.contains('is-visible')).toBe(true);
    expect(handles[1].classList.contains('is-visible')).toBe(false);
    expect(foldButtons[0].classList.contains('is-visible')).toBe(true);
    handles[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', altKey: true, bubbles: true }),
    );
    await nextTick();
    expect(value.value.indexOf('Next paragraph.')).toBeLessThan(
      value.value.indexOf('# 新建文档 3'),
    );
    expect(errors).toEqual([]);
  });

  it('keeps a column block handle reachable across the gap and separator', async () => {
    const content = ':::columns\n\n## Left\n\nLeft body\n\n## Right\n\nRight body\n\n:::\n\nOutside\n';
    const { value, errors } = await mount(content);
    const columns = root.querySelector<HTMLElement>('.tano-columns')!;
    const paragraphs = columns.querySelectorAll<HTMLParagraphElement>('p');
    const handles = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle');
    const rightHandle = handles[2]!;
    vi.spyOn(paragraphs[0]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 300, 160));
    vi.spyOn(paragraphs[1]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(448, 100, 300, 160));
    vi.spyOn(rightHandle, 'getBoundingClientRect').mockReturnValue(new DOMRect(412, 100, 18, 24));
    const hover = (target: Element, x: number, y = 112) =>
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    hover(paragraphs[1]!, 480);
    expect(rightHandle.classList.contains('is-visible')).toBe(true);
    hover(columns, 440);
    expect(rightHandle.classList.contains('is-visible')).toBe(true);
    hover(columns.querySelector('[role="separator"]')!, 424);
    expect(rightHandle.classList.contains('is-visible')).toBe(true);
    hover(columns, 419);
    expect(rightHandle.classList.contains('is-visible')).toBe(true);
    hover(rightHandle, 421);
    rightHandle.click();
    expect(paragraphs[1]!.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(value.value).toBe(content);

    hover(paragraphs[0]!, 380);
    expect(rightHandle.classList.contains('is-visible')).toBe(false);
    expect(handles[1]!.classList.contains('is-visible')).toBe(true);
    hover(paragraphs[1]!, 480);
    hover(columns, 424, 180);
    expect(rightHandle.classList.contains('is-visible')).toBe(true);
    hover(columns, 424, 280);
    expect(rightHandle.classList.contains('is-visible')).toBe(false);
    hover(paragraphs[1]!, 480);
    root.querySelector('.ProseMirror')!.parentElement!.parentElement!.dispatchEvent(new MouseEvent('mouseleave'));
    expect(rightHandle.classList.contains('is-visible')).toBe(false);
    expect(errors).toEqual([]);
  });

  it('separates the columns handle from its first child and keeps both reachable in a narrow gutter', async () => {
    const content = ':::columns\n\n## Left\n\nLeft body\n\n## Right\n\nRight body\n\n:::\n';
    const { value, errors } = await mount(content);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const host = prose.parentElement!;
    const surface = host.parentElement!;
    const columns = prose.querySelector<HTMLElement>('.tano-columns')!;
    const paragraphs = columns.querySelectorAll<HTMLParagraphElement>('p');
    const handles = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle');
    const group = handles[0]!, child = handles[1]!;
    vi.spyOn(host, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 0, 648, 500));
    const pane = vi.spyOn(surface, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 800, 600));
    vi.spyOn(columns, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 648, 160));
    vi.spyOn(paragraphs[0]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 100, 300, 160));
    vi.spyOn(paragraphs[1]!, 'getBoundingClientRect').mockReturnValue(new DOMRect(448, 100, 300, 160));
    for (const handle of [group, child])
      vi.spyOn(handle, 'getBoundingClientRect').mockImplementation(() =>
        new DOMRect(100 + Number.parseFloat(handle.style.left), Number.parseFloat(handle.style.top), 18, 24));
    window.dispatchEvent(new Event('resize'));
    expect(group.getBoundingClientRect().right).toBeLessThan(child.getBoundingClientRect().left);
    const hover = (target: Element, x: number, y = 112) =>
      target.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
    hover(paragraphs[0]!, 120);
    expect(group.classList.contains('is-visible')).toBe(true);
    expect(child.classList.contains('is-visible')).toBe(true);
    hover(surface, 48);
    expect(group.classList.contains('is-visible')).toBe(true);
    hover(group, 37);
    group.click();
    expect(columns.classList.contains('ProseMirror-selectednode')).toBe(true);
    child.click();
    expect(columns.classList.contains('ProseMirror-selectednode')).toBe(false);
    expect(paragraphs[0]!.classList.contains('ProseMirror-selectednode')).toBe(true);

    pane.mockReturnValue(new DOMRect(80, 0, 800, 600));
    window.dispatchEvent(new Event('resize'));
    expect(group.getBoundingClientRect().left).toBeGreaterThanOrEqual(84);
    expect(child.getBoundingClientRect().left).toBeGreaterThanOrEqual(84);
    expect(group.getBoundingClientRect().bottom).toBeLessThan(child.getBoundingClientRect().top);
    hover(paragraphs[0]!, 120);
    hover(surface, 90, 90);
    expect(group.classList.contains('is-visible')).toBe(true);
    hover(group, 90, 84);
    group.click();
    expect(columns.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(value.value).toBe(content);
    expect(errors).toEqual([]);
  });

  it('temporarily selects the right-clicked block and restores the prior selection on Escape', async () => {
    const { value, revealMarkdown, errors } = await mount('First paragraph.\n\nSecond paragraph.\n');
    revealMarkdown.value = false;
    await nextTick();
    const paragraphs = root.querySelectorAll<HTMLElement>('.ProseMirror > p');
    root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[0]!.click();
    expect(paragraphs[0]?.classList.contains('ProseMirror-selectednode')).toBe(true);
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 90, clientY: 45 });
    paragraphs[1]!.dispatchEvent(event);
    await nextTick();
    const menu = document.querySelector<HTMLElement>('.block-context-menu');
    expect(event.defaultPrevented).toBe(true);
    expect(menu?.getAttribute('role')).toBe('menu');
    expect(paragraphs[1]?.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(paragraphs[0]?.classList.contains('ProseMirror-selectednode')).toBe(false);
    menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    expect(document.querySelector('.block-context-menu')).toBeNull();
    expect(paragraphs[1]?.classList.contains('ProseMirror-selectednode')).toBe(false);
    expect(paragraphs[0]?.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(value.value).toBe('First paragraph.\n\nSecond paragraph.\n');
    expect(errors).toEqual([]);
  });

  it('opens the block menu from the gutter handle and duplicates only that block', async () => {
    const { value, errors } = await mount('First paragraph.\n\nSecond paragraph.\n');
    const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[1]!;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    handle.dispatchEvent(event);
    await nextTick();
    const menu = document.querySelector<HTMLElement>('.block-context-menu')!;
    expect(event.defaultPrevented).toBe(true);
    expect(menu.getAttribute('aria-label')).toContain('第 2 个块');
    [...menu.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('创建副本'))!
      .click();
    await nextTick();
    expect(value.value).toBe('First paragraph.\n\nSecond paragraph.\n\nSecond paragraph.\n');
    expect(document.querySelector('.block-context-menu')).toBeNull();
    expect(errors).toEqual([]);
  });

  it('selects a heading for its right-click menu even while its Markdown source is open', async () => {
    const content = '# Heading\n\nBody.\n';
    const { value, errors } = await mount(content);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    prose.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const source = prose.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
    expect(source).not.toBeNull();
    source.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true }));
    const event = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    source.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(prose.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect(prose.querySelector('h1.ProseMirror-selectednode')?.textContent).toBe('Heading');
    expect(document.querySelector('.block-context-menu')).not.toBeNull();
    expect(value.value).toBe(content);
    expect(errors).toEqual([]);
  });

  it('right-clicks a rendered heading without opening its Markdown source', async () => {
    const content = '# Heading\n\nBody.\n';
    const { value, errors } = await mount(content);
    const heading = root.querySelector<HTMLElement>('.ProseMirror > h1')!;
    const down = new MouseEvent('mousedown', { button: 2, bubbles: true, cancelable: true });
    heading.dispatchEvent(down);
    const menuEvent = new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true });
    heading.dispatchEvent(menuEvent);
    await nextTick();
    expect(down.defaultPrevented).toBe(true);
    expect(menuEvent.defaultPrevented).toBe(true);
    expect(heading.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect(document.querySelector('.block-context-menu')).not.toBeNull();
    expect(value.value).toBe(content);
    expect(errors).toEqual([]);
  });

  it.each([
    { block: '| Name | Value |\n| --- | --- |\n| A | 1 |', label: '表格块', text: 'Name' },
    { block: '## Heading', label: '标题块', text: 'Heading' },
    { block: '<details>\n<summary>Details</summary>\n\nBody\n\n</details>', label: '折叠块', text: 'Body' },
  ])('reorders a whole $label by dragging without selecting it', async ({ block, label, text }) => {
    const content = `First.\n\n${block}\n\nLast.\n`;
    const { value, editor, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const before = editor.value!.withContext(ctx => ctx.get(editorViewCtx).state.doc);
    const prose = root.querySelector('.ProseMirror')!;
    const handles = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle');
    const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element,
    ) {
      const index = Array.from(prose.children).indexOf(this);
      return index < 0 ? new DOMRect() : new DOMRect(100, index * 100, 400, 60);
    });
    function pointerEvent(type: string, y: number) {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 100 },
        clientY: { value: y },
        pointerId: { value: 1 },
        button: { value: 0 },
      });
      return event;
    }
    try {
      expect(handles[1].getAttribute('aria-label')).toContain(label);
      // Even a previously selected source must not remain selected after a drop.
      handles[1].click();
      expect(root.querySelector('.ProseMirror-selectednode')).not.toBeNull();
      handles[1].dispatchEvent(pointerEvent('pointerdown', 120));
      const over = pointerEvent('pointermove', -10);
      prose.dispatchEvent(over);
      expect(root.querySelector('.tano-block-drag-preview')?.textContent).toContain(text);
      expect(over.defaultPrevented).toBe(true);
      expect(root.querySelector('.tano-block-drop-line')?.hasAttribute('hidden')).toBe(false);
      prose.dispatchEvent(pointerEvent('pointerup', -10));
      handles[1].click(); // The browser's click following pointerup must be suppressed.
      await nextTick();
      expect(value.value.indexOf(text)).toBeLessThan(value.value.indexOf('First.'));
      expect(value.value).toContain('Last.');
      expect(root.querySelector('.tano-block-drag-source')).toBeNull();
      expect(root.querySelector('.tano-block-drag-preview')).toBeNull();
      expect(root.querySelector('.ProseMirror-selectednode')).toBeNull();
      handles[0].click(); // An intentional click still selects the moved block.
      expect(root.querySelector('.ProseMirror-selectednode')?.textContent).toContain(text);
      expect(editor.value!.undoLastChange()).toBe(true);
      await nextTick();
      expect(editor.value!.withContext(ctx => ctx.get(editorViewCtx).state.doc.eq(before))).toBe(true);
      expect(errors).toEqual([]);
    } finally {
      rect.mockRestore();
    }
  });

  it.each(['left', 'right'] as const)('creates columns from a %s side drop with a vertical snap marker and one undo step', async side => {
    const { value, editor, errors } = await mount('Target\n\nMoved\n\nOutside\n');
    const before = editor.value!.withContext(ctx => ctx.get(editorViewCtx).state.doc);
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    const handles = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle');
    const rectangles = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      const index = Array.from(prose.children).indexOf(this);
      return index < 0 ? new DOMRect() : new DOMRect(100, index * 100, 400, 60);
    });
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, { clientX: { value: x }, clientY: { value: y }, pointerId: { value: 1 }, button: { value: 0 } });
      return event;
    };
    try {
      const x = side === 'left' ? 100 : 500;
      handles[1]!.dispatchEvent(pointer('pointerdown', 100, 120));
      prose.dispatchEvent(pointer('pointermove', x, 30));
      const marker = root.querySelector<HTMLElement>('.tano-block-drop-line')!;
      expect(marker.hidden).toBe(false);
      expect(marker.classList.contains('is-column')).toBe(true);
      expect(marker.style.width).toBe('3px');
      expect(marker.style.height).toBe('60px');
      prose.dispatchEvent(pointer('pointerup', x, 30));
      await nextTick();
      const columns = root.querySelector<HTMLElement>('.ProseMirror > .tano-columns')!;
      const panels = columns.querySelector<HTMLElement>(':scope > .tano-enhanced-content')!.children;
      expect(panels.length).toBe(2);
      expect(panels[side === 'left' ? 0 : 1]!.querySelector('p')?.textContent).toBe('Moved');
      expect(value.value).toContain('columns');
      expect(value.value).toContain('Outside');
      expect(root.querySelector('.tano-block-drag-preview')).toBeNull();
      expect(editor.value!.undoLastChange()).toBe(true);
      expect(editor.value!.withContext(ctx => ctx.get(editorViewCtx).state.doc.eq(before))).toBe(true);
      expect(errors).toEqual([]);
    } finally { rectangles.mockRestore(); }
  });

  it('shows frontmatter as collapsible property rows without changing the Markdown', async () => {
    const content =
      '---\ntype: reference\nstatus: active\ndomains: [meta, docs]\ncreated: 2026/05/11\n---\n\nBody\n';
    const { value } = await mount(content);
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    expect(panel.open).toBe(false);
    expect(panel.querySelector('summary')?.textContent?.trim()).toBe('文档属性');
    expect(
      [...panel.querySelectorAll('.frontmatter-property')].map((row) => row.textContent?.trim()),
    ).toEqual(['typereference', 'statusactive', 'domainsmeta、docs', 'created2026/05/11']);
    expect(panel.querySelector('.frontmatter-raw')).toBeNull();
    expect(value.value).toBe(content);
  });

  it('edits document properties in the panel and writes typed YAML', async () => {
    const content = '---\ntitle: "旧标题" # keep\ntags: [agent, human]\nenabled: true\n---\n\nBody\n';
    const { value, readonly } = await mount(content);
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    const title = [...panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-button')]
      .find((button) => button.title === '编辑 title')!;
    title.focus();
    title.click();
    await nextTick();
    const row = panel.querySelector<HTMLElement>('.frontmatter-row-editor')!;
    expect(row.closest('.frontmatter-property')).not.toBeNull();
    expect(panel.querySelector('.frontmatter-form')).toBeNull();
    expect(panel.querySelector('.frontmatter-add')).not.toBeNull();
    const input = row.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = '新标题';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: 新标题 # keep'));
    expect(panel.querySelector('.frontmatter-row-editor')).not.toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await nextTick();
    expect(value.value).toContain('tags: [agent, human]\n');
    expect(value.value).toContain('\nBody\n');

    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'count';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    const typeIcon = panel.querySelector<HTMLButtonElement>('[aria-label="切换 count 的类型"]')!;
    typeIcon.focus();
    typeIcon.click();
    await nextTick();
    expect(panel.querySelector('.frontmatter-type-menu')).not.toBeNull();
    [...panel.querySelectorAll<HTMLButtonElement>('.frontmatter-type-menu button')]
      .find((button) => button.textContent?.trim() === '数字')!.click();
    await vi.waitFor(() => expect(value.value).toContain('count: 0\n'));
    const number = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    number.value = '42';
    number.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('count: 42\n'));
    readonly.value = true;
    await nextTick();
    expect(panel.querySelector('.frontmatter-property-button')).toBeNull();
  });

  it('focuses the property name when clicked and saves renames inline', async () => {
    const { value } = await mount('---\ntitle: original\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-name')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    expect(document.activeElement).toBe(name);
    name.value = 'heading';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('"heading": original'));
    expect(value.value).not.toContain('title: original');
    expect(value.value).toContain('\nBody\n');
    expect(document.activeElement).toBe(name);
  });

  it('keeps a new property name focused while typing repeated digits', async () => {
    const { value } = await mount('---\nwww: text\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    for (const digit of '111') {
      name.value += digit;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      expect(panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')).toBe(name);
      expect(document.activeElement).toBe(name);
      expect(panel.querySelector('[role="alert"]')).toBeNull();
    }
    expect(value.value).toContain('"111":');
  });

  it('toggles property display order without moving an active new row', async () => {
    const { value } = await mount('---\nwww: text\naaa: first\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    const names = () => [...panel.querySelectorAll<HTMLElement>('.frontmatter-property')]
      .map((row) => row.dataset.propertyName);
    const toggle = panel.querySelector<HTMLButtonElement>('.frontmatter-order-toggle')!;
    expect(names()).toEqual(['www', 'aaa']);
    toggle.click();
    await nextTick();
    expect(panel.open).toBe(true);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(names()).toEqual(['aaa', 'www']);

    panel.querySelector<HTMLButtonElement>('.frontmatter-add')!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    for (const digit of '111') {
      name.value += digit;
      name.dispatchEvent(new Event('input', { bubbles: true }));
      await nextTick();
      expect(document.activeElement).toBe(name);
      expect(names()).toEqual(['aaa', 'www', name.value]);
    }
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(names()).toEqual(['111', 'aaa', 'www']);
    expect(value.value).toContain('"111":');

    toggle.click();
    await nextTick();
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    expect(names()).toEqual(['www', 'aaa', '111']);
  });

  it('reorders a renamed property only after leaving its editor', async () => {
    const { value } = await mount('---\nalpha: first\nmiddle: second\nzulu: third\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-order-toggle')!.click();
    await nextTick();
    const names = () => [...panel.querySelectorAll<HTMLElement>('.frontmatter-property')]
      .map((row) => row.dataset.propertyName);
    panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-name')[1]!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'zzzz';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(names()).toEqual(['alpha', 'zzzz', 'zulu']);
    expect(document.activeElement).toBe(name);
    expect(value.value).toContain('"zzzz": second');

    const input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.focus();
    await nextTick();
    expect(names()).toEqual(['alpha', 'zzzz', 'zulu']);
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(names()).toEqual(['alpha', 'zulu', 'zzzz']);
  });

  it('keeps a property draft when another edit arrives and reports a same-field conflict', async () => {
    const { value } = await mount('---\ntitle: first\nother: old\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('[title="编辑 title"]')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'draft';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: draft'));
    value.value = value.value.replace('other: old', 'other: new');
    await nextTick();
    expect(panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')?.value).toBe('draft');
    value.value = value.value.replace('title: draft', 'title: external');
    await nextTick();
    input.value = 'mine';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('[role="alert"]')?.textContent).toContain('属性已被其他修改更新');
    expect(value.value).toContain('title: external');
  });

  it('saves inline typing immediately and leaves the row on Escape or blur', async () => {
    const { value } = await mount('---\ntitle: original\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('[title="编辑 title"]')!.click();
    await nextTick();
    let input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'discarded';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('title: discarded'));
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    expect(value.value).toContain('title: discarded');
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();

    panel.querySelector<HTMLButtonElement>('[title="编辑 title"]')!.click();
    await nextTick();
    input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = 'saved';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await vi.waitFor(() => expect(value.value).toContain('title: saved'));
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
  });

  it('shows validation under the edited value and discards an invalid draft on blur', async () => {
    const { value } = await mount('---\nstamp: 2026-09-26T00:00:23\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelector<HTMLButtonElement>('.frontmatter-property-value')!.click();
    await nextTick();
    const input = panel.querySelector<HTMLInputElement>('input[aria-label="属性值"]')!;
    input.value = '2026-09-27T00:00:23';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await vi.waitFor(() => expect(value.value).toContain('stamp: 2026-09-27T00:00:23'));
    input.value = '2026-09-27T00:00:23423';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-value-editor [role="alert"]')?.textContent).toBe('请输入有效日期和时间');
    expect(panel.querySelector('.frontmatter-name-editor [role="alert"]')).toBeNull();
    input.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
    expect(panel.querySelector('.frontmatter-property-value')?.textContent).toBe('2026-09-27T00:00:23');
    expect(value.value).not.toContain('2026-09-27T00:00:23423');
  });

  it('shows duplicate-name validation under the property name and restores it on blur', async () => {
    const { value } = await mount('---\ntitle: first\nother: second\n---\n\nBody\n');
    const panel = root.querySelector<HTMLDetailsElement>('.frontmatter-panel')!;
    panel.open = true;
    panel.querySelectorAll<HTMLButtonElement>('.frontmatter-property-name')[1]!.click();
    await nextTick();
    const name = panel.querySelector<HTMLInputElement>('input[aria-label="属性名"]')!;
    name.value = 'title';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-name-editor [role="alert"]')?.textContent).toBe('属性名已存在');
    expect(panel.querySelector('.frontmatter-value-editor [role="alert"]')).toBeNull();
    name.dispatchEvent(new FocusEvent('focusout', { bubbles: true, relatedTarget: panel.querySelector('summary') }));
    await nextTick();
    expect(panel.querySelector('.frontmatter-row-editor')).toBeNull();
    expect([...panel.querySelectorAll('.frontmatter-property-name')].map((element) => element.textContent)).toEqual(['title', 'other']);
    expect(value.value).toContain('other: second');
  });

  it('preserves YAML bytes while editing math, code and relative image references', async () => {
    const metadata =
      '---\r\ntitle: "同页" # keep this comment\r\ntags: [agent, human]\r\n...\r\n\r\n';
    const content =
      metadata +
      '# Title\n\nInline $x^2 + y^2$ and ![figure](assets/a.png).\n\n$$\n\\frac{1}{2}\n$$\n\n```js\nconst answer = 42;\n```\n';
    const { value, editor, errors } = await mount(content);
    await vi.waitFor(() => expect(root.querySelectorAll('.katex')).toHaveLength(2));
    expect(root.querySelector('.token.keyword')?.textContent).toBe('const');
    expect(root.querySelector('img')?.getAttribute('src')).toBe(
      'https://example.test/assets/a.png',
    );
    editor.value!.command('math');
    await nextTick();
    expect(value.value.startsWith(metadata)).toBe(true);
    expect(value.value).toContain('$x^2 + y^2$');
    expect(value.value).toContain('\\frac{1}{2}');
    expect(value.value).toContain('(assets/a.png)');
    expect(value.value).not.toContain('https://example.test');
    expect(errors).toEqual([]);
  });
  it('maps an asynchronous pasted image through intervening editor changes', async () => {
    let complete!: (value: { url: string; name: string; image: boolean }) => void;
    const importer = vi.fn(
      () =>
        new Promise<{ url: string; name: string; image: boolean }>((resolve) => {
          complete = resolve;
        }),
    );
    const { value, editor, errors } = await mount('A paragraph.\n', importer);
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', {
      value: { files: [new File(['image'], 'pasted.png', { type: 'image/png' })] },
    });
    root.querySelector('.ProseMirror')!.dispatchEvent(paste);
    expect(paste.defaultPrevented).toBe(true);
    expect(root.querySelector('.asset-upload-placeholder')).not.toBeNull();
    editor.value!.command('math');
    complete({ url: 'assets/pasted.png', name: 'pasted.png', image: true });
    await vi.waitFor(() => expect(value.value).toContain('assets/pasted.png'));
    expect(value.value).toContain('$E = mc^2$');
    expect(value.value).toContain('A paragraph.');
    expect(root.querySelector('.asset-upload-placeholder')).toBeNull();
    expect(errors).toEqual([]);
  });
  it('detects collaboration-incompatible syntax and preserves frontmatter delimiters', () => {
    expect(splitFrontmatter('---\na: 1\n---\n\nbody')).toEqual({
      prefix: '---\na: 1\n---\n\n',
      body: 'body',
    });
    expect(unsupportedMarkdown('Footnote[^a]\n\n[^a]: details')).toEqual([]);
    expect(unsupportedMarkdown('<script>alert(1)</script>')).toContain('内嵌 HTML / MDX');
    expect(unsupportedMarkdown('---\nnot closed')).toContain('未闭合的 YAML 属性');
    expect(unsupportedMarkdown('```html\n<div>sample</div>\n```\n\n$\\text{<tag>}$')).toEqual([]);
  });
  it('edits formula source without granting KaTeX trusted HTML or URL access', async () => {
    const { value, errors } = await mountPanel('Formula $x$ and $\\href{javascript:alert(1)}{bad}$.\n');
    expect(root.querySelector('a[href^="javascript:"]')).toBeNull();
    const button = root.querySelector<HTMLButtonElement>('.math-preview')!;
    button.click();
    const input = root.querySelector<HTMLTextAreaElement>('textarea[aria-label="LaTeX 公式源码"]')!;
    input.value = '\\frac{a}{b}';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await nextTick();
    expect(value.value).toContain('$\\frac{a}{b}$');
    expect(errors).toEqual([]);
  });

  it('inserts a display formula and renders updated multiline source after reloading', async () => {
    const { value, editor, errors } = await mountPanel('正文\n');
    editor.value!.command('math-block');
    await nextTick();
    expect(root.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(value.value).toContain('$$\nE = mc^2\n$$');
    expect(value.value).toContain('正文');
    const button = root.querySelector<HTMLButtonElement>('.math-block .math-preview')!;
    button.click();
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    const latex = '\\begin{aligned}\na &= b + c \\\\\nd &= \\frac{1}{2}\n\\end{aligned}';
    input.value = latex;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    const modifiedEnter = new KeyboardEvent('keydown', {
      key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true,
    });
    input.dispatchEvent(modifiedEnter);
    expect(modifiedEnter.defaultPrevented).toBe(false);
    expect(input.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await nextTick();
    expect(input.hidden).toBe(true);
    expect(value.value).toContain(latex);
    const saved = value.value;
    value.value = '临时正文';
    await nextTick();
    value.value = saved;
    await nextTick();
    expect(root.querySelector('.math-block .katex-display')).not.toBeNull();
    expect(root.querySelector('.katex-error')).toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>('.math-block textarea')?.value).toBe(latex);
    expect(errors).toEqual([]);
  });

  it('keeps malformed LaTeX editable without breaking other rendered formulas', async () => {
    const { value, errors } = await mount('$\\frac{$ and $x^2$\n');
    expect(root.querySelector('.katex-error')?.textContent).toBe('\\frac{');
    expect(root.querySelectorAll('.katex')).toHaveLength(1);
    expect(value.value).toContain('$\\frac{$');
    expect(errors).toEqual([]);
  });

  it('renders portable text styles and keeps them when editing other content', async () => {
    const content =
      '**粗体** *斜体* ~~删除线~~ `代码` <u>下划线</u> x<sup>2</sup> H<sub>2</sub>O <mark>高亮</mark> <span style="color: #db2777">颜色</span>\n';
    const { value, editor, errors } = await mount(content);
    for (const [tag, text] of [
      ['strong', '粗体'],
      ['em', '斜体'],
      ['del', '删除线'],
      ['code', '代码'],
      ['u', '下划线'],
      ['sup', '2'],
      ['sub', '2'],
      ['mark', '高亮'],
    ])
      expect(root.querySelector(tag)?.textContent).toBe(text);
    expect(root.querySelector<HTMLElement>('span[style]')?.style.color).toBe('rgb(219, 39, 119)');
    editor.value!.command('math');
    await nextTick();
    expect(unsupportedMarkdown(value.value)).toEqual([]);
    expect(value.value).toContain('<u>下划线</u>');
    expect(value.value).toContain('<span style="color: #db2777">颜色</span>');
    expect(errors).toEqual([]);
  });

  it('applies text styles from commands and serializes selected text without losing it', async () => {
    const { value, editor, errors } = await mount('选中文字\n');
    const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
    prose.focus();
    const range = document.createRange();
    range.selectNodeContents(prose.querySelector('p')!);
    window.getSelection()!.removeAllRanges();
    window.getSelection()!.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    editor.value!.command('underline');
    await nextTick();
    expect(value.value).toContain('<u>选中文字</u>');
    editor.value!.command('text-color', '#db2777');
    await nextTick();
    expect(value.value).toContain('<span style="color: #db2777">');
    editor.value!.command('superscript');
    editor.value!.command('subscript');
    await nextTick();
    expect(value.value).toContain('<sub>');
    expect(value.value).not.toContain('<sup>');
    editor.value!.command('text-color');
    await nextTick();
    expect(value.value).not.toContain('style=');
    expect(value.value).toContain('选中文字');
    expect(errors).toEqual([]);
  });
});
