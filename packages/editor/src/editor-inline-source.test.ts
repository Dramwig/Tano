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

it.each(['superscript', 'subscript'] as const)('reveals disabled %s delimiters on click even when the caret is elsewhere', async name => {
  const { value, errors } = await mount('12312^文字^~文字~\n', undefined, {
    ...defaultCapabilities,
    features: { ...defaultCapabilities.features, superscript: false, subscript: false },
  });
  const marker = root.querySelector(`[data-tano-disabled-style="${name}"] > span:last-child`)!;
  marker.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }));
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(name === 'superscript' ? '^文字^' : '^文字^~文字~');
  expect(value.value).toBe('12312^文字^~文字~\n');
  expect(errors).toEqual([]);
});

it.each(['ArrowLeft', 'ArrowRight'])('moves through and out of inline source delimiters with %s without reopening the field', async key => {
  const source = '前 ++文字++ 后\n';
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  await nextTick();
  const field = root.querySelector('[data-tano-live-inline-source]')!;
  const start = view.posAtDOM(field, 0);
  const length = field.textContent!.length;
  const left = key === 'ArrowLeft';
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + (left ? 1 : length - 1))));
  const press = () => view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  press();
  expect(view.state.selection.from).toBe(start + (left ? 0 : length));
  press();
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.selection.from).toBe(left ? 2 : 6);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each([
  ['ArrowLeft', '文字'], ['ArrowRight', '文字'],
  ['ArrowLeft', '字'], ['ArrowRight', '字'],
  ['ArrowLeft', '😀字'], ['ArrowRight', '字😀'],
])('reveals both fields at the inline source boundary with %s into %s', async (key, text) => {
  const source = `~文字~++${text}++==文字==\n`;
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  const left = key === 'ArrowLeft';
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, left ? 4 + text.length : 2)));
  const field = root.querySelector('[data-tano-live-inline-source]')!;
  const start = view.posAtDOM(field, 0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,
    start + (left ? 0 : field.textContent!.length))));
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  await nextTick();
  const expanded = left ? `++${text}++==文字==` : `~文字~++${text}++`;
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(expanded);
  expect(view.state.selection.$from.parent.textContent).toBe(expanded);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each([
  ['前 **文字** 后\n', 3, '**文字**', 0],
  ['前 **文字** 后\n', 5, '**文字**', 6],
  ['**文字**++下划线++\n', 3, '**文字**++下划线++', 6],
  ['**123213**$12312$\n', 7, '**123213**$12312$', 10],
  ['$12312$**文字**\n', 2, '$12312$**文字**', 7],
] as const)('reveals all inline fields touching the caret in %s at %s', async (source, position, expanded, offset) => {
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(expanded);
  expect(view.state.selection.$from.parentOffset).toBe(offset);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each([
  ['==文字==%%文字%%123\n', 3, 9, '%%文字%%', 'mark', '文字'],
  ['==文字==%%文字%%123\n', 3, 3, '==文字==', '[data-tano-comment]', '文字'],
  ['**123213**$12312$\n', 7, 12, '$12312$', 'strong', '123213'],
  ['$12312$**123213**\n', 2, 10, '**123213**', '.math-inline', undefined],
] as const)('collapses the field left behind in %s', async (content, boundary, offset, expanded, selector, text) => {
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, boundary)));
  const field = root.querySelector('[data-tano-live-inline-source]')!;
  const start = view.posAtDOM(field, 0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + offset)));
  await nextTick();
  expect(view.state.selection.$from.parent.textContent).toBe(expanded);
  expect(root.querySelector(selector)).not.toBeNull();
  if (text) expect(root.querySelector(selector)?.textContent).toBe(text);
  expect(value.value).toBe(content);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('preserves edits made in the transaction that expands an adjacent field', async () => {
  const { editor, value, errors } = await mount('前 **文字**$x$ 后\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  const field = root.querySelector('[data-tano-live-inline-source]')!;
  const start = view.posAtDOM(field, 0);
  const tr = view.state.tr.insertText('新', start + 3);
  tr.setSelection(TextSelection.create(tr.doc, start + 7));
  view.dispatch(tr);
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**文新字**$x$');
  expect(value.value).toBe('前 **文新字**$x$ 后\n');
  view.dom.dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(value.value).toBe('前 **文新字**$x$ 后\n');
  expect(root.querySelector('strong')?.textContent).toBe('文新字');
  expect(errors).toEqual([]);
});

it('preserves edits and undo when moving between adjacent source fields', async () => {
  const source = '前 ==文字==%%注释%% 后\n';
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5)));
  const start = view.state.selection.$from.start();
  view.dispatch(view.state.tr.insertText('新', start + 3));
  expect(value.value).toBe('前 ==文新字==%%注释%% 后\n');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, start + 10)));
  expect(view.state.selection.$from.parent.textContent).toBe('%%注释%%');
  expect(value.value).toBe('前 ==文新字==%%注释%% 后\n');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe(source);
  expect(editor.value!.redoLastChange()).toBe(true);
  expect(value.value).toBe('前 ==文新字==%%注释%% 后\n');
  expect(errors).toEqual([]);
});

it.each(['123', '😀23', 'e\u030123', '👩‍💻23'])('closes comment source and advances past one character in %s with one right arrow', async following => {
  const source = `%%文字%%${following}\n`;
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)));
  const field = root.querySelector('[data-tano-live-inline-source]')!;
  const end = view.posAtDOM(field, 0) + field.textContent!.length;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.doc.content.size)).toBe('23');
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('opens the lightweight AI shortcut from an empty paragraph without inserting a space', async () => {
  const { editor, value, preferences, blankBlockAiCount } = await mount('已有内容\n\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const paragraph = view.state.schema.nodes.paragraph!;
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [
    paragraph.create(null, view.state.schema.text('已有内容')),
    paragraph.create(),
  ]));
  let blankPosition = -1;
  view.state.doc.descendants((node, pos) => {
    if (blankPosition < 0 && node.type.name === 'paragraph' && node.content.size === 0) blankPosition = pos;
  });
  expect(blankPosition).toBeGreaterThanOrEqual(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, blankPosition + 1)));
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.selection.$from.parent.content.size).toBe(0);
  view.focus();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await nextTick();
  expect(blankBlockAiCount()).toBe(1);
  expect(value.value).toBe('已有内容\n\n');
  preferences.value = { ...preferences.value, blankBlockAiShortcut: false };
  await nextTick();
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  await nextTick();
  expect(blankBlockAiCount()).toBe(1);
  expect(value.value).toBe('已有内容\n\n');
});

it('offers initialization only for one empty paragraph, reacting to edits and undo', async () => {
  const { editor, value, readonly } = await mount('---\ntitle: 已有标题\nowner: Alice\n---\n\n');
  const starter = () => root.querySelector('.test-document-starter');
  expect(starter()).not.toBeNull();
  const original = value.value;
  expect(editor.value!.initializeBody('## 议题\n\n- [ ] 待办\n', original)).toBe(true);
  await nextTick();
  expect(starter()).toBeNull();
  expect(value.value).toContain('title: 已有标题\nowner: Alice');
  expect(value.value).toContain('## 议题');
  expect(editor.value!.initializeBody('替换正文', value.value)).toBe(false);
  editor.value!.undoLastChange(); await nextTick();
  expect(starter()).not.toBeNull();
  expect(splitFrontmatter(value.value).body.trim()).toBe('');
  readonly.value = true; await nextTick();
  expect(starter()).toBeNull();
  expect(editor.value!.initializeBody('只读写入', value.value)).toBe(false);
});

it('does not treat empty structured blocks, attachments or multiple paragraphs as a new document', async () => {
  const { editor, value } = await mount('');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, [view.state.schema.nodes.paragraph!.create(), view.state.schema.nodes.paragraph!.create()]));
  await nextTick();
  expect(root.querySelector('.test-document-starter')).toBeNull();
  for (const markdown of ['# 标题\n', '>\n', '- [ ] \n', '```\n\n```\n', '![图片](assets/image.png)\n', '正文\n']) {
    value.value = markdown; await nextTick();
    expect(root.querySelector('.test-document-starter'), markdown).toBeNull();
    expect(editor.value!.initializeBody('新内容', markdown)).toBe(false);
  }
  value.value = ''; await nextTick();
  expect(root.querySelector('.test-document-starter')).not.toBeNull();
  value.value = '外部新内容'; await nextTick();
  expect(editor.value!.initializeBody('模板', '')).toBe(false);
  expect(value.value).toBe('外部新内容');
});

it.each(['*', '**', '正文*', '正文**', '2 * 3', '*.md'])(
  'saves keyboard-entered asterisks without adding escapes: %s', async (text) => {
    const { value, editor, errors } = await mount('');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    let typed = '';
    for (const character of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', handler =>
        handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      typed += character;
      expect(value.value).not.toContain('\\*');
      if (!/\s$/.test(typed)) expect(value.value).toBe(`${typed}\n`);
    }
    view.dom.blur();
    await nextTick();
    expect(value.value).toBe(`${text}\n`);
    expect(errors).toEqual([]);
  },
);

it.each([
  ['*', '123 *312* 321\n'],
  ['$', '123 $312$ 321\n'],
  ['_', '123 _312_ 321\n'],
  ['**', '123 **312** 321\n'],
  ['__', '123 __312__ 321\n'],
  ['~', '123 ~~312~~ 321\n'],
  ['=', '123 ==312== 321\n'],
  ['`', '123 `312` 321\n'],
])('wraps a selected inline field with %s delimiters', async (delimiter, expected) => {
  const { value, editor, errors, preferences } = await mount('123 312 321\n');
  preferences.value.selectionWrapping = { ...defaultSelectionWrapping, highlight: true };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 5, 8)));
  const { from, to } = view.state.selection;
  const handled = view.someProp('handleTextInput', handler =>
    handler(view, from, to, delimiter, () => view.state.tr.insertText(delimiter, from, to)));
  expect(handled).toBe(true);
  await nextTick();
  expect(value.value).toBe(expected);
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('312');
  const source = root.querySelector<HTMLElement>('[data-tano-live-inline-source]');
  if (delimiter === '$') {
    expect(source?.textContent).toContain('$312$');
    expect(root.querySelector('.tano-live-math-preview')).not.toBeNull();
  } else {
    expect(source?.textContent).toBe(expected.trim().slice(4, -4));
    expect(root.querySelector('.tano-live-math-preview')).toBeNull();
  }
  expect(errors).toEqual([]);
});

it.each([
  ['*斜体*', 'emphasis', '*斜体*\n'],
  ['**粗体**', 'strong', '**粗体**\n'],
  ['* 项目', 'bullet_list', '* 项目\n'],
])('keeps Markdown input rules working for %s', async (text, type, expected) => {
  const { value, editor, errors } = await mount('');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', handler =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
    expect(value.value).not.toContain('\\*');
  }
  expect(value.value).toBe(expected);
  view.dom.blur();
  await nextTick();
  expect(type === 'bullet_list'
    ? view.state.doc.firstChild!.type.name === type
    : view.state.doc.firstChild!.firstChild!.marks.some(mark => mark.type.name === type)).toBe(true);
  expect(errors).toEqual([]);
});

it.each(['**123123*', '***123123*'])(
  'previews partial emphasis while typing and promotes it when another star closes bold: %s', async text => {
    const { value, editor, errors } = await mount('');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const type = (text: string) => {
      for (const character of text) {
        const { from, to } = view.state.selection;
        const handled = view.someProp('handleTextInput', handler =>
          handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
        if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
      }
    };
    view.focus();
    type(text);
    expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe(text);
    expect(root.querySelector('.tano-live-source-emphasis')?.textContent).toBe('123123');
    expect(value.value).toBe(`${text}\n`);
    type('*');
    expect(root.querySelector('.tano-live-source-strong')?.textContent).toBe('123123');
    expect(value.value).toBe(`${text}*\n`);
    view.dom.blur();
    await nextTick();
    expect(root.querySelector('strong')?.textContent).toBe('123123');
    expect(value.value).toBe(`${text}*\n`);
    expect(errors).toEqual([]);
  },
);

it.each([' ', '继续', ' 12321 321312'])(
  'renders completed bold when typing outside its delimiters: %j', async tail => {
    const { value, editor, errors } = await mount('123213\n\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    view.dispatch(view.state.tr.insert(view.state.doc.content.size,
      view.state.schema.nodes.paragraph!.create()));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    for (const character of `**34234**${tail}`) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', handler =>
        handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
    }
    expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
    expect(root.querySelector('strong')?.textContent).toBe('34234');
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(view.state.selection.$from.parentOffset).toBe('34234'.length + tail.length);
    view.dispatch(view.state.tr.insertText('Z'));
    expect(root.querySelector('strong')?.textContent).toBe('34234');
    expect(value.value).toBe(`123213\n\n**34234**${tail}Z\n`);
    expect(errors).toEqual([]);
  },
);

it.each([
  ['**粗体**', 'strong'],
  ['*斜体*', 'em'],
  ['~~删除~~', 'del'],
  ['`代码`', 'code'],
  ['[链接](https://example.com/)', 'a'],
])('renders an edited %s field when the caret enters its surrounding plain text', async (syntax, tag) => {
  const { value, editor, errors } = await mount(`之前 ${syntax} 之后\n`);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  view.focus();
  placeCaret(prose.querySelector(tag)!, 1);
  await nextTick();
  const source = prose.querySelector('[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe(syntax);
  const end = view.state.selection.$from.end();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
  view.dispatch(view.state.tr.insertText(' 新文字'));
  expect(prose.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(prose.querySelector(tag)).not.toBeNull();
  view.dispatch(view.state.tr.insertText('Z'));
  expect(value.value).toBe(`之前 ${syntax} 新文字Z 之后\n`);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe(`之前 ${syntax} 新文字 之后\n`);
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe(`之前 ${syntax} 之后\n`);
  expect(editor.value!.redoLastChange()).toBe(true);
  expect(value.value).toBe(`之前 ${syntax} 新文字 之后\n`);
  expect(editor.value!.redoLastChange()).toBe(true);
  expect(value.value).toBe(`之前 ${syntax} 新文字Z 之后\n`);
  expect(errors).toEqual([]);
});

it.each(['before', 'after'])(
  'renders inline syntax as soon as the caret moves to plain text %s it', async side => {
    const { value, editor, errors } = await mount('**粗体**\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    placeCaret(root.querySelector('strong')!, 1);
    await nextTick();
    const start = view.state.selection.$from.start();
    const end = view.state.selection.$from.end();
    // Keep the caret inside the bold syntax while surrounding text changes.
    view.dispatch(view.state.tr.insertText('普通文字', side === 'before' ? start : end));
    expect(root.querySelector('[data-tano-live-inline-source]')).not.toBeNull();
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,
      (side === 'before' ? start : end) + 2)));
    expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
    expect(root.querySelector('strong')?.textContent).toBe('粗体');
    view.dispatch(view.state.tr.insertText('Z'));
    expect(value.value).toBe(side === 'before'
      ? '普通Z文字**粗体**\n' : '**粗体**普通Z文字\n');
    expect(errors).toEqual([]);
  },
);

it('preserves surrounding Markdown escapes when leaving a completed inline field', async () => {
  const { value, editor, errors } = await mount('**粗体**\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  placeCaret(root.querySelector('strong')!, 1);
  await nextTick();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc,
    view.state.selection.$from.end())));
  view.dispatch(view.state.tr.insertText(' \\*原文'));
  expect(value.value).toBe('**粗体** \\*原文\n');
  expect(errors).toEqual([]);
});

it('waits for Chinese composition to finish before rendering completed inline syntax', async () => {
  const { value, editor, errors } = await mount('**粗体**\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  placeCaret(root.querySelector('strong')!, 1);
  await nextTick();
  const end = view.state.selection.$from.end();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
  view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  expect(view.composing).toBe(true);
  view.dispatch(view.state.tr.insertText('中文'));
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**粗体**中文');
  view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '中文' }));
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(root.querySelector('strong')?.textContent).toBe('粗体');
  view.dispatch(view.state.tr.insertText('继续'));
  expect(value.value).toBe('**粗体**中文继续\n');
  expect(errors).toEqual([]);
});

it('reveals all stars when resuming partial emphasis from a saved document', async () => {
  const { value, editor, errors } = await mount('**123123*\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  expect(root.querySelector('em')?.textContent).toBe('123123');
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  await nextTick();
  expect(root.querySelector('[data-tano-live-inline-source]')?.textContent).toBe('**123123*');
  const end = view.state.selection.$from.end();
  view.dispatch(view.state.tr.insertText('*', end));
  expect(root.querySelector('.tano-live-source-strong')?.textContent).toBe('123123');
  view.dom.blur();
  await nextTick();
  expect(root.querySelector('strong')?.textContent).toBe('123123');
  expect(value.value).toBe('**123123**\n');
  expect(errors).toEqual([]);
});

it('keeps four-star delimiters after blur and subsequent document transactions', async () => {
  const { value, editor, errors } = await mount('');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  for (const character of '****test****') {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', handler =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
  expect(value.value).toBe('****test****\n');
  view.dom.blur();
  await nextTick();
  expect(value.value).toBe('****test****\n');
  view.dispatch(view.state.tr.insert(view.state.doc.content.size,
    view.state.schema.nodes.paragraph!.create(null, view.state.schema.text('下一段'))));
  await nextTick();
  expect(value.value).toBe('****test****\n\n下一段\n');
  view.dispatch(view.state.tr.insertText('继续', view.state.doc.content.size - 1));
  await nextTick();
  expect(value.value).toBe('****test****\n\n下一段继续\n');
  expect(errors).toEqual([]);
});

it('preserves four-star source after reopening and editing another paragraph', async () => {
  const source = '****test****\n\n下一段\n';
  const { value, editor, revealMarkdown, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.insertText('继续', view.state.doc.content.size - 1));
  await nextTick();
  expect(value.value).toBe('****test****\n\n下一段继续\n');
  revealMarkdown.value = false;
  await nextTick();
  revealMarkdown.value = true;
  await nextTick();
  expect(value.value).toBe('****test****\n\n下一段继续\n');
  expect(errors).toEqual([]);
});

it('can edit one retained emphasis field back to normal bold without changing its sibling', async () => {
  const { value, editor, errors } = await mount('****first**** 和 ****second****\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const first = view.state.doc.firstChild!.firstChild!;
  const secondPosition = 1 + first.nodeSize + ' 和 '.length;
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, secondPosition + 5)));
  root.querySelectorAll('[data-tano-live-inline-source]')[1]!
    .dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  const second = view.state.doc.nodeAt(secondPosition)!;
  view.dispatch(view.state.tr.insertText('**edited**', secondPosition + 1, secondPosition + second.nodeSize - 1));
  view.dom.blur();
  await nextTick();
  expect(value.value).toBe('****first**** 和 **edited**\n');
  expect(root.querySelector('strong')?.textContent).toBe('edited');
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe('****first**** 和 ****second****\n');
  expect(errors).toEqual([]);
});

it('can undo partial emphasis and enter its closing star again', async () => {
  const { value, editor, errors } = await mount('**123123\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
  const typeStar = () => {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', handler =>
      handler(view, from, to, '*', () => view.state.tr.insertText('*', from, to)));
    if (!handled) view.dispatch(view.state.tr.insertText('*', from, to));
  };
  typeStar();
  expect(root.querySelector('.tano-live-source-emphasis')?.textContent).toBe('123123');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(value.value).toBe('**123123\n');
  typeStar();
  expect(root.querySelector('.tano-live-source-emphasis')?.textContent).toBe('123123');
  expect(value.value).toBe('**123123*\n');
  expect(errors).toEqual([]);
});

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
  ['**123456**', 'strong', '123456', 4],
  ['==文字==', 'mark', '文字', 1],
  ['++文字++', 'u', '文字', 1],
  ['^文字^', 'sup', '文字', 1],
  ['~文字~', 'sub', '文字', 1],
  ['*文字*', 'em', '文字', 1],
  ['~~文字~~', 'del', '文字', 1],
  ['`123456`', 'code', '123456', 4],
  ['[文字](https://example.com)', 'a[href]', '文字', 1],
  ['## 123456', 'h2', '123456', 4],
  ['```js\n123456\n```', 'pre code', '123456', 4],
] as const)('preserves the clicked text boundary when revealing %s', async (syntax, selector, text, offset) => {
  const content = `Unrelated paragraph\n\n${syntax}\n`;
  const { editor, value, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let clickedPos = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === text) clickedPos = pos + offset;
  });
  expect(clickedPos).toBeGreaterThan(0);
  const position = vi.spyOn(view, 'posAtCoords').mockImplementation(() => {
    // Coordinates must be interpreted before new syntax shifts the text.
    expect(root.querySelector('[data-tano-live-inline-source], [data-tano-live-source]')).toBeNull();
    return { pos: clickedPos, inside: -1 };
  });
  root.querySelector(selector)!.dispatchEvent(new MouseEvent('click', {
    bubbles: true, cancelable: true, clientX: 160, clientY: 220,
  }));
  expect(position).toHaveBeenCalled();
  expect(view.state.selection.$from.parent.textContent).toBe(syntax);
  expect(view.state.selection.$from.parentOffset).toBe(syntax.indexOf(text) + offset);
  expect(value.value).toBe(content);
  view.dispatch(view.state.tr.insertText('X'));
  expect(view.state.selection.$from.parent.textContent).toBe(syntax.replace(text, `${text.slice(0, offset)}X${text.slice(offset)}`));
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

it.each(['234234', '**234234**'])(
  'starts an empty paragraph after typing %s and pressing Enter', async text => {
    const { value, editor, errors } = await mount('124242342\n\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    view.focus();
    view.dispatch(view.state.tr.insert(view.state.doc.content.size,
      view.state.schema.nodes.paragraph!.create()));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    for (const character of text) {
      const { from, to } = view.state.selection;
      const handled = view.someProp('handleTextInput', handler =>
        handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)));
      if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
    }
    const enter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    view.dom.dispatchEvent(enter);
    await nextTick();

    expect(enter.defaultPrevented).toBe(true);
    expect(view.state.doc.childCount).toBe(3);
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(view.state.selection.$from.parent.content.size).toBe(0);
    expect(view.dom.lastElementChild?.getAttribute('data-placeholder')).toBe("输入 '/' 搜索并切换块类型，或按 space（空格）启用 AI");
    expect(value.value).toBe(`124242342\n\n${text}\n\n`);
    view.dispatch(view.state.tr.insertText('正文'));
    expect(view.state.doc.lastChild!.firstChild!.marks).toEqual([]);
    expect(value.value).toBe(`124242342\n\n${text}\n\n正文\n`);
    expect(errors).toEqual([]);
  },
);

it.each([
  ['', '**Before**\n\n**After** tail\n'],
  ['> ', '> **Before**\n>\n> **After** tail\n'],
  ['* ', '* **Before**\n* **After** tail\n'],
])('splits live inline formatting in a %s paragraph and preserves undo/redo', async (prefix, expected) => {
  const content = `${prefix}**BeforeAfter** tail\n`;
  const { value, editor, errors } = await mount(content);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  placeCaret(view.dom.querySelector('strong')!, 6);
  await nextTick();
  expect(view.state.selection.$from.parent.type.name).toBe('tano_live_source_inline');
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();

  expect(value.value).toBe(expected);
  expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
  expect(view.state.selection.$from.parentOffset).toBe(0);
  expect(view.dom.querySelector('[data-tano-live-inline-source]')).toBeNull();
  expect(editor.value!.undoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(content);
  expect(editor.value!.redoLastChange()).toBe(true);
  await nextTick();
  expect(value.value).toBe(expected);
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

it('keeps fenced code spacing stable when moving source focus between code blocks', async () => {
  const content = '```ts\nlet first = 1;\n```\n\n```ts\nlet second = 2;\n```\n';
  const { value, editor, errors } = await mount(content);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  const blocks = [...prose.querySelectorAll<HTMLElement>('pre.tano-code-block')];
  const first = blocks[0]!;
  for (const block of blocks) {
    block.style.paddingTop = '19px';
    block.style.paddingBottom = '19px';
    block.style.paddingLeft = '22px';
    block.style.paddingRight = '22px';
    block.style.lineHeight = '27px';
    block.querySelector<HTMLElement>('code')!.style.fontSize = '13px';
  }
  prose.focus();
  placeCaret(first.querySelector('code')!, 1);
  await nextTick();
  const firstSource = prose.querySelector<HTMLElement>('pre[data-source-kind="code_block"]')!;
  expect(firstSource.style.paddingTop).toBe('0px');
  expect(firstSource.style.lineHeight).toBe('27px');

  const view = editor.value!.withContext((ctx) => ctx.get(editorViewCtx));
  const secondPos = view.state.doc.child(0)!.nodeSize;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, secondPos + 2)));
  await nextTick();
  const secondSource = prose.querySelector<HTMLElement>('pre[data-source-kind="code_block"]')!;
  expect(secondSource.style.paddingTop).toBe('0px');
  expect(secondSource.style.lineHeight).toBe('27px');
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

it.each([0, 1])('reveals the previous field only at the adjacent plain-text boundary (offset %s)', async offset => {
  const { value, errors } = await mount('A **bold** tail\n');
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  prose.focus();
  const after = prose.querySelector('p')!.lastChild!;
  const range = document.createRange();
  range.setStart(after, offset);
  range.collapse(true);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  if (offset === 0) expect(prose.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe('**bold**');
  else {
    expect(prose.querySelector('span[data-tano-live-inline-source]')).toBeNull();
    expect(prose.querySelector('strong')?.textContent).toBe('bold');
  }
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
  expect(source.textContent).toBe('**bold [link](https://example.com/) tail**');
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('A ');
  source.textContent = '**bold [link](https://new.example/) tail**';
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

it('renders partial emphasis after the inline source loses focus without escaping the extra star', async () => {
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
  expect(prose.querySelector('span[data-tano-live-inline-source]')).toBeNull();
  expect(prose.querySelector('em')?.textContent).toBe('124234');
  expect(prose.querySelector('p')?.firstChild?.textContent).toBe('1231 *');
  expect(value.value).toBe('1231 **124234*\n');
  expect(errors).toEqual([]);
});
