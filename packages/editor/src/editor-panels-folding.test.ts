// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { BlockRangeSelection } from './block-selection';
import { blockTree } from './block-tree';
import mermaid from 'mermaid';
import { splitFrontmatter, unsupportedMarkdown } from './syntax';
import {
  defaultCapabilities,
  defaultChineseInput,
  defaultEditorPreferences,
  defaultSelectionWrapping,
  normalizeCopyFormat,
} from './runtime';
import { inlineSourceCodec } from './inline-source-session';
import {
  copyMarkdown,
  expandCopyMenu,
  mount,
  mountPanel,
  openSelectedBlockSources,
  placeCaret,
  registerEditorCleanup,
  root,
  wrapInput,
} from './editor.test.helpers';

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' })),
  },
}));

registerEditorCleanup();

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

it('changes page width without refreshing content views or dispatching editor transactions', async () => {
  const source = '公式 \\(x^2\\)\n\n```js\nconst x = 1;\n```\n';
  const { value, capabilities, editor } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const dispatch = vi.spyOn(view, 'dispatch');
  const refresh = vi.fn();
  root.addEventListener('tano-math-refresh', refresh, true);
  const formula = root.querySelector('.tano-math');
  const selection = view.state.selection;
  capabilities.value = { ...structuredClone(defaultCapabilities), pageWidthLimits: { a12345: false } };
  await nextTick();
  capabilities.value.pageWidthLimits.a12345 = true;
  await nextTick();
  expect(dispatch).not.toHaveBeenCalled();
  expect(refresh).not.toHaveBeenCalled();
  expect(root.querySelector('.tano-math')).toBe(formula);
  expect(view.state.selection).toBe(selection);
  expect(value.value).toBe(source);
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
  await vi.waitFor(() => expect(buttons().every((button) => button.hidden)).toBe(true));
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
  await vi.waitFor(() => expect(buttons()[1]!.hidden).toBe(true));
  expect(items).toHaveLength(5);
  expect(items.filter(item => item.className || item.querySelector(':scope > p')?.className)).toEqual([]);
  buttons()[0]!.click();
  expect(items[2]!.querySelector('ol')?.classList.contains('tano-folded-list-content')).toBe(false);
  expect(items[2]!.querySelector('ul')?.classList.contains('tano-folded-list-content')).toBe(true);
  await vi.waitFor(() => expect(buttons()[1]!.hidden).toBe(false));
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

it('applies a new bullet marker only after a content edit without changing ordered numbering', async () => {
  const source = '- One\n- Two\n\n1. First\n2. Second\n';
  const { value, editor, capabilities, errors } = await mountPanel(source);
  capabilities.value.bulletListMarker = '+';
  await nextTick();
  expect(value.value).toBe(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let end = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'One') end = pos + node.nodeSize;
  });
  view.dispatch(view.state.tr.insertText('!', end));
  await nextTick();
  expect(value.value).toBe('+ One!\n+ Two\n\n1. First\n2. Second\n');
  expect(errors).toEqual([]);
});

it.each([
  ['删除线', '~~删除线~~', 'del'],
  ['下划线', '<u>下划线</u>', 'u'],
  ['上标', '<sup>2</sup>', 'sup'],
  ['下标', '<sub>2</sub>', 'sub'],
  ['高亮', '<mark>高亮</mark>', 'mark'],
  ['文字颜色', '<span style="color: #db2777">文字颜色</span>', 'span[style]'],
  ['背景颜色', '<span style="background-color: #e3f2fd">背景颜色</span>', 'span[style]'],
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

it.each([
  '+++\ntitle = "TOML"\n+++\n\n# Body\n\nText\n',
  '+++\ntitle = "TOML"\n+++\n',
])('opens leading unsupported Markdown without selecting the block: %s', async content => {
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  expect(root.querySelector('.tano-unsupported-block')).not.toBeNull();
  expect(view.state.selection).not.toBeInstanceOf(NodeSelection);
  expect(view.state.selection.empty).toBe(true);
  expect(root.querySelector('.ProseMirror-selectednode')).toBeNull();
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
  root.querySelector<HTMLButtonElement>('.tano-block-handle')!.click();
  expect(root.querySelector('.tano-unsupported-block.ProseMirror-selectednode')).not.toBeNull();
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

it('preserves block selection for controls, right clicks and modified clicks', async () => {
  const { editor, errors } = await mount('Selected **content**\n\nOutside\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const handle = root.querySelector<HTMLButtonElement>('.tano-block-handle')!;
  handle.click();
  const selected = view.state.selection;
  const surface = view.dom.parentElement!.parentElement!;
  for (const [target, options] of [
    [handle, {}],
    [surface, { button: 2 }],
    [surface, { shiftKey: true }],
  ] as const) {
    target.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0, ...options }));
    expect(view.state.selection.eq(selected)).toBe(true);
  }
  expect(errors).toEqual([]);
});

it('releases a selected block on text pointerdown without preventing native text selection', async () => {
  const content = 'Selected **content**\n\nOutside\n';
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  root.querySelector<HTMLButtonElement>('.tano-block-handle')!.click();
  await nextTick();
  expect(root.querySelector('.ProseMirror-selectednode')).not.toBeNull();
  expect(document.querySelector('.block-context-menu')).not.toBeNull();
  const press = new MouseEvent('pointerdown', { bubbles: true, cancelable: true, button: 0 });
  view.dom.querySelector('strong')!.dispatchEvent(press);
  await nextTick();
  expect(press.defaultPrevented).toBe(false);
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(root.querySelector('.ProseMirror-selectednode')).toBeNull();
  expect(document.querySelector('.block-context-menu')).toBeNull();
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
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

it('previews Mermaid source independently of math and closes without changing Markdown or history', async () => {
  const content = '```mermaid\ngraph TD\n  A --> B\n```\n\n脚注\n';
  const { editor, value, preferences, capabilities, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(view.dom.querySelector('.tano-mermaid-preview svg')).not.toBeNull());
  view.dom.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
  const source = view.dom.querySelector<HTMLElement>('[data-tano-live-source]')!;
  const preview = source.querySelector<HTMLElement>('.tano-live-mermaid-preview')!;
  await vi.waitFor(() => expect(preview.querySelector('svg')).not.toBeNull());
  expect(preview.hidden).toBe(false);
  expect(source.querySelector('code')!.textContent).toBe(content.split('\n\n')[0]);
  preferences.value = { ...preferences.value, previewMathWhileEditing: false };
  await nextTick();
  expect(preview.hidden).toBe(false);
  preferences.value = { ...preferences.value, previewMermaidWhileEditing: false };
  await nextTick();
  expect(preview.hidden).toBe(true);
  preferences.value = { ...preferences.value, previewMermaidWhileEditing: true };
  await nextTick();
  await vi.waitFor(() => expect(preview.hidden).toBe(false));
  capabilities.value.features.mermaid = false;
  await nextTick();
  expect(view.dom.querySelector<HTMLElement>('.tano-live-mermaid-preview')!.hidden).toBe(true);
  capabilities.value.features.mermaid = true;
  await nextTick();
  await vi.waitFor(() => expect(view.dom.querySelector<HTMLElement>('.tano-live-mermaid-preview')!.hidden).toBe(false));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
  expect(view.dom.querySelector('.tano-live-mermaid-preview')).toBeNull();
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('keeps the last valid Mermaid editing preview during invalid input and recovers', async () => {
  const { editor, value, errors } = await mount('```mermaid\ngraph TD\n  A --> B\n```\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dom.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
  const preview = view.dom.querySelector<HTMLElement>('.tano-live-mermaid-preview')!;
  await vi.waitFor(() => expect(preview.querySelector('svg')).not.toBeNull());
  const previous = preview.innerHTML;
  vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('incomplete diagram'));
  const replaceSource = (source: string) => {
    const node = view.state.doc.firstChild!;
    view.dispatch(view.state.tr.insertText(source, 1, node.nodeSize - 1));
  };
  replaceSource('```mermaid\ngraph TD\n  A[\n```');
  await vi.waitFor(() => expect(preview.classList.contains('tano-mermaid-preview-stale')).toBe(true));
  expect(preview.innerHTML).toBe(previous);
  expect(preview.hidden).toBe(false);
  replaceSource('```mermaid\ngraph LR\n  A --> C\n```');
  await vi.waitFor(() => expect(preview.classList.contains('tano-mermaid-preview-stale')).toBe(false));
  expect(preview.hidden).toBe(false);
  expect(vi.mocked(mermaid.render).mock.calls.at(-1)?.[1]).toContain('A --> C');
  replaceSource('```mermaid\n\n```');
  expect(preview.hidden).toBe(true);
  expect(preview.querySelector('svg')).toBeNull();
  expect(value.value).toContain('```mermaid');
  expect(errors).toEqual([]);
});

it('discards late Mermaid editing renders after disabling the preview', async () => {
  const { editor, preferences, errors } = await mount('```mermaid\ngraph TD\n  A --> B\n```\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(view.dom.querySelector('.tano-mermaid-preview svg')).not.toBeNull());
  let complete!: (value: Awaited<ReturnType<typeof mermaid.render>>) => void;
  vi.mocked(mermaid.render).mockImplementationOnce(() => new Promise(resolve => { complete = resolve; }));
  view.dom.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
  const preview = view.dom.querySelector<HTMLElement>('.tano-live-mermaid-preview')!;
  await vi.waitFor(() => expect(complete).toBeTypeOf('function'));
  preferences.value = { ...preferences.value, previewMermaidWhileEditing: false };
  await nextTick();
  complete({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', diagramType: 'flowchart-v2' });
  await vi.waitFor(() => expect(document.querySelector('body > [aria-hidden="true"] svg')).toBeNull());
  expect(preview.hidden).toBe(true);
  expect(preview.querySelector('svg')).toBeNull();
  expect(errors).toEqual([]);
});

it('restores an unchanged Mermaid preview synchronously when the caret leaves its source', async () => {
  const content = '```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello\n```\n\n脚注\n';
  const render = vi.mocked(mermaid.render).mockClear();
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(view.dom.querySelector('.tano-mermaid-preview svg')).not.toBeNull());
  const calls = render.mock.calls.length;
  for (let index = 0; index < 3; index++) {
    view.dom.querySelector<HTMLElement>('.tano-mermaid-preview')!.click();
    expect(view.dom.querySelector('[data-tano-live-source]')).not.toBeNull();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, view.state.doc.content.size - 1)));
    // No microtask/frame may see an empty preview that collapses the block.
    expect(view.dom.querySelector('.tano-mermaid-preview svg')).not.toBeNull();
    expect(render.mock.calls).toHaveLength(calls);
  }
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('gives cached Mermaid previews independent SVG and marker namespaces', async () => {
  vi.mocked(mermaid.render).mockImplementationOnce(async id => ({
    svg: `<svg xmlns="http://www.w3.org/2000/svg" id="${id}"><defs><marker id="${id}-arrow"/></defs><path marker-end="url(#${id}-arrow)"/></svg>`,
    diagramType: 'flowchart-v2',
  }));
  const { editor } = await mount('```mermaid\ngraph TD\n  A --> B\n```\n\n脚注\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  await vi.waitFor(() => expect(view.dom.querySelector('.tano-mermaid-preview svg')).not.toBeNull());
  const originalId = view.dom.querySelector('svg')!.id;
  const diagram = view.state.doc.firstChild!;
  view.dispatch(view.state.tr.insert(view.state.doc.content.size, diagram));
  const svgs = [...view.dom.querySelectorAll('.tano-mermaid-preview svg')];
  expect(svgs).toHaveLength(2);
  expect(svgs[0]!.id).toBe(originalId);
  expect(svgs[1]!.id).not.toBe(originalId);
  for (const svg of svgs)
    expect(svg.querySelector('path')!.getAttribute('marker-end')).toBe(`url(#${svg.id}-arrow)`);
});

it.each([false, true])('isolates and removes Mermaid measurement DOM (failure: %s)', async failure => {
  let complete!: (value: Awaited<ReturnType<typeof mermaid.render>>) => void;
  let fail!: (reason: Error) => void;
  const render = vi.mocked(mermaid.render).mockClear().mockImplementationOnce(() => new Promise((resolve, reject) => {
    complete = resolve;
    fail = reject;
  }));
  await mount('```mermaid\ngraph TD\n  A --> B\n```\n');
  await vi.waitFor(() => expect(render).toHaveBeenCalled());
  const host = render.mock.calls[0]![2] as HTMLElement;
  expect(host.isConnected).toBe(true);
  expect(host.parentElement).toBe(document.body);
  expect(host.style.position).toBe('fixed');
  expect(host.style.visibility).toBe('hidden');
  if (failure) fail(new Error('incomplete diagram'));
  else complete({ svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', diagramType: 'flowchart-v2' });
  await vi.waitFor(() => expect(host.isConnected).toBe(false));
  expect(root.querySelector(failure ? '.tano-mermaid-preview-stale' : '.tano-mermaid-preview svg')).not.toBeNull();
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
}, 15000); // Cold Mermaid/math rendering can exceed the default five seconds in the full suite.

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
