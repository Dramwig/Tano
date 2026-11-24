// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { editorViewCtx, parserCtx, serializerCtx } from '@milkdown/kit/core';
import { AllSelection, NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import type { EditorView } from '@milkdown/kit/prose/view';
import { BlockRangeSelection } from '../plugins/block-selection';
import { blockTree } from '../plugins/block-tree';
import mermaid from 'mermaid';
import { splitFrontmatter, unsupportedMarkdown } from '../markdown/syntax';
import {
  defaultCapabilities,
  defaultChineseInput,
  defaultEditorPreferences,
  defaultSelectionWrapping,
  normalizeCopyFormat,
} from '../core/runtime';
import { inlineSourceCodec } from '../plugins/inline-source-session';
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

it('maps full-width yuan to an inline formula with preview and preserves the formula on blur', async () => {
  const { value, editor, preferences } = await mount('x_1\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
  expect(wrapInput(view, '￥')).toBeFalsy();
  preferences.value.chineseInput = { ...defaultChineseInput, yenToDollar: true };
  await nextTick();
  expect(wrapInput(view, '￥')).toBe(true);
  expect(value.value).toBe('$x_1$\n');
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('x_1');
  expect(root.querySelector('.tano-live-math-preview')).not.toBeNull();
  view.dom.blur();
  await nextTick();
  expect(value.value).toBe('$x_1$\n');
});

it.each([true, false])('maps newly typed Chinese punctuation and supports undo with revealMarkdown=%s', async reveal => {
  const { value, editor, preferences, readonly, revealMarkdown } = await mount('原文【，。】\n');
  revealMarkdown.value = reveal;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 7)));
  expect(wrapInput(view, '（！……')).toBeFalsy();
  preferences.value.chineseInput = { ...defaultChineseInput, parentheses: true, exclamation: true, ellipsisToCaret: true };
  await nextTick();
  expect(value.value).toBe('原文【，。】\n');
  expect(wrapInput(view, '（！……')).toBe(true);
  expect(value.value).toBe('原文【，。】(!^\n');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('原文【，。】\n');
  readonly.value = true;
  await nextTick();
  expect(wrapInput(view, '（！……')).toBeFalsy();
});

it.each(['keydown', 'beforeinput'])('inserts Chinese punctuation mapping before DOM mutation via %s', async method => {
  const { value, editor, preferences, readonly } = await mount('正文\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  const event = () => method === 'keydown'
    ? new KeyboardEvent('keydown', { key: '【', code: 'BracketLeft', keyCode: 219, bubbles: true, cancelable: true })
    : new InputEvent('beforeinput', { inputType: 'insertText', data: '【', bubbles: true, cancelable: true });
  const disabled = event();
  view.dom.dispatchEvent(disabled);
  expect(disabled.defaultPrevented).toBe(false);
  preferences.value.chineseInput = { ...defaultChineseInput, brackets: true };
  await nextTick();
  const enabled = event();
  view.dom.dispatchEvent(enabled);
  expect(enabled.defaultPrevented).toBe(true);
  expect(view.dom.textContent).toContain('正文[');
  expect(view.dom.textContent).not.toContain('【');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('正文\n');
  readonly.value = true;
  await nextTick();
  const locked = event();
  view.dom.dispatchEvent(locked);
  expect(locked.defaultPrevented).toBe(false);
});

it('honors the beforeinput target range instead of overwriting the current selection', async () => {
  const { value, editor, preferences } = await mount('甲乙\n');
  preferences.value.chineseInput = { ...defaultChineseInput, brackets: true };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  const text = view.dom.querySelector('p')!.firstChild!;
  const event = new InputEvent('beforeinput', { inputType: 'insertText', data: '【', bubbles: true, cancelable: true });
  Object.defineProperty(event, 'getTargetRanges', { value: () => [{ startContainer: text, startOffset: 0, endContainer: text, endOffset: 1 }] });
  view.dom.dispatchEvent(event);
  expect(event.defaultPrevented).toBe(true);
  expect(view.state.doc.textContent).toBe('[乙');
  expect(value.value).toBe('\\[乙\n');
});

it('converts committed IME punctuation without changing a composition in progress', async () => {
  const { value, editor, preferences } = await mount('正文\n');
  preferences.value.chineseInput = { ...defaultChineseInput, comma: true };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  expect(wrapInput(view, '，')).toBeFalsy();
  view.dispatch(view.state.tr.insertText('，'));
  expect(value.value).toBe('正文，\n');
  view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '，' }));
  // Conversion must finish in the microtask checkpoint, before any timer/paint.
  await new Promise<void>(resolve => queueMicrotask(() => queueMicrotask(resolve)));
  expect(value.value).toBe('正文,\n');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('正文\n');
});

it('uses mapped ellipsis with the superscript wrapper and keeps mapping active when wrapping is off', async () => {
  const { value, editor, preferences } = await mount('文字\n');
  preferences.value.chineseInput = { ...defaultChineseInput, ellipsisToCaret: true };
  preferences.value.selectionWrapping = { ...defaultSelectionWrapping, superscript: true };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 1)));
  expect(wrapInput(view, '……')).toBe(true);
  expect(value.value).toBe('^文字^\n');
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('文字');
  expect(editor.value!.undoLastChange()).toBe(true);
  preferences.value.selectionWrapping.enabled = false;
  await nextTick();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  expect(wrapInput(view, '……')).toBe(true);
  expect(value.value).toBe('文字^\n');
});

it('upgrades retained backward selections to bold and undoes the wrapper', async () => {
  const { value, editor } = await mount('前 文字 后\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 3)));
  expect(wrapInput(view, '*')).toBe(true);
  expect(wrapInput(view, '*')).toBe(true);
  expect(value.value).toBe('前 **文字** 后\n');
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('文字');
  expect(view.state.selection.anchor).toBeGreaterThan(view.state.selection.head);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('前 文字 后\n');
});

it.each([['^', '^文字^', 'sup'], ['~', '~文字~', 'sub'], ['+', '++文字++', 'u'], ['%', '%%文字%%', '[data-tano-comment]']])(
  'renders and preserves the optional %s extension after leaving the field', async (key, expected, tag) => {
    const { value, editor } = await mount('前 文字 后\n', undefined, defaultCapabilities, {
      ...defaultEditorPreferences, selectionWrapping: { ...defaultSelectionWrapping, superscript: true, subscript: true, underline: true, comment: true },
    });
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
    expect(wrapInput(view, key)).toBe(true);
    view.dom.blur();
    await nextTick();
    expect(value.value).toBe('前 ' + expected + ' 后\n');
    expect(root.querySelector(tag)?.textContent).toBe('文字');
  });

it('honors live preference changes and wraps in rendered editing mode', async () => {
  const { value, editor, preferences, revealMarkdown } = await mount('文字\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  preferences.value.selectionWrapping = { ...defaultSelectionWrapping, enabled: false };
  await nextTick();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  expect(wrapInput(view, '*')).toBeFalsy();
  preferences.value.selectionWrapping.enabled = true;
  preferences.value.selectionWrapping.highlight = true;
  revealMarkdown.value = false;
  await nextTick();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  expect(wrapInput(view, '=')).toBe(true);
  expect(value.value).toBe('==文字==\n');
  expect(root.querySelector('mark')?.textContent).toBe('文字');
});

it('does not wrap cross-block selections or selections inside code and math', async () => {
  const { editor } = await mount('第一段\n\n第二段\n\n`code` $x+1$\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 8)));
  expect(wrapInput(view, '*')).toBeFalsy();
  editor.value!.restoreModeSelection({ anchor: 13, head: 15 });
  expect(wrapInput(view, '*')).toBeFalsy();
});

it.each([['*', '**文字**\n'], ['_', '__文字__\n'], ['~', '~~文字~~\n'], ['=', '==文字==\n']])(
  'keeps repeated %s wrapping consistent when source reveal is disabled', async (key, expected) => {
    const { value, editor, revealMarkdown } = await mount('文字\n', undefined, defaultCapabilities, {
      ...defaultEditorPreferences, selectionWrapping: { ...defaultSelectionWrapping, subscript: true, highlight: true },
    });
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    for (let press = 0; press < 3; press++) expect(wrapInput(view, key)).toBe(true);
    expect(value.value).toBe(expected);
  });

it('switches recognized formula syntax immediately without changing source or undo history', async () => {
  const markdown = '前 $x_1$ 和 \\(y_2\\) 后\n';
  const { value, editor, capabilities, errors } = await mount(markdown);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  expect(prose.querySelectorAll('.tano-math')).toHaveLength(2);
  for (const [recognition, raw] of [['dollar', '\\(y_2\\)'], ['latex', '$x_1$']] as const) {
    capabilities.value.mathRecognition = recognition;
    await nextTick();
    expect(prose.querySelectorAll('.tano-math')).toHaveLength(1);
    expect(prose.querySelector('.tano-feature-source')?.textContent).toBe(raw);
    expect(value.value).toBe(markdown);
    expect(editor.value!.canUndo()).toBe(false);
  }
  capabilities.value.mathRecognition = 'all'; await nextTick();
  expect(prose.querySelectorAll('.tano-math')).toHaveLength(2);
  expect(errors).toEqual([]);
});

it.each([
  ['$$\nx^2\n$$\n', 'latex'],
  ['\\[\nx^2\n\\]\n', 'dollar'],
] as const)('hides editing previews for unrecognized block syntax: %s', async (content, recognition) => {
  const { value, capabilities, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  prose.querySelector<HTMLElement>('.math-block .math-preview')!.dispatchEvent(
    new MouseEvent('click', { bubbles: true, button: 0 }),
  );
  await nextTick();
  expect(prose.querySelector<HTMLElement>('.tano-live-math-preview')?.hidden).toBe(false);
  capabilities.value.mathRecognition = recognition;
  await nextTick();
  expect(prose.querySelector<HTMLElement>('.tano-live-math-preview')?.hidden).toBe(true);
  expect(value.value).toBe(content);
  capabilities.value.mathRecognition = 'all';
  await nextTick();
  expect(prose.querySelector<HTMLElement>('.tano-live-math-preview')?.hidden).toBe(false);
  expect(errors).toEqual([]);
});
