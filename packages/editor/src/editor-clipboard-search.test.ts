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

describe('inline source field model', () => {
  it.each([
    ['**粗体**++下划线++', ['**粗体**', '++下划线++']],
    ['==文字==%%文字%%123', ['==文字==', '%%文字%%']],
    ['**123213**$12312$', ['**123213**', '$12312$']],
    ['**粗体 [链接](https://example.com/) 结尾**', ['**粗体 [链接](https://example.com/) 结尾**']],
    ['<abbr title="Tano">同页</abbr>++文字++', ['<abbr title="Tano">同页</abbr>', '++文字++']],
    ['[[Notes/Plan|计划]]++文字++', ['[[Notes/Plan|计划]]', '++文字++']],
    ['  **粗体**  ++下划线++  ', ['**粗体**', '++下划线++']],
  ] as const)('finds complete semantic fields without changing %s', async (source, expected) => {
    const { editor } = await mount('测试\n');
    editor.value!.withContext(ctx => {
      const codec = inlineSourceCodec(ctx.get(editorViewCtx).state.schema, ctx.get(parserCtx), ctx.get(serializerCtx));
      const parts = codec.parts(source)!;
      expect(parts).not.toBeNull();
      expect(parts.filter(part => part.formatted).map(part => source.slice(part.from, part.to))).toEqual(expected);
      expect(parts.map(part => source.slice(part.from, part.to)).join('')).toBe(source);
      expect(codec.serialize(codec.parse(source)!)).toBe(source);
    });
  });
});

it('preserves disabled extension source when editing and saving an existing document', async () => {
  const markdown = '^上标^ ~下标~ ++下划线++ ==高亮== %%注释%%\n';
  const capabilities = structuredClone(defaultCapabilities);
  for (const feature of ['superscript', 'subscript', 'underline', 'highlight', 'inlineComment'] as const)
    capabilities.features[feature] = false;
  const { editor, value, errors } = await mount(markdown, undefined, capabilities, {
    ...defaultEditorPreferences, selectionWrapping: { ...defaultSelectionWrapping, superscript: true },
  });
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  expect(view.dom.textContent).toContain(markdown.trimEnd());
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  expect(wrapInput(view, '^')).toBeFalsy();
  view.dispatch(view.state.tr.insertText('前 ', 1));
  await nextTick();
  expect(value.value).toContain('~下标~ ++下划线++ ==高亮== %%注释%%');
  expect(value.value).toContain('上标^');
  expect(errors).toEqual([]);
});

it.each([
  ['superscript', '^文字^', 'sup'], ['subscript', '~文字~', 'sub'],
  ['underline', '++文字++', 'u'], ['highlight', '==文字==', 'mark'],
  ['inlineComment', '%%文字%%', '[data-tano-comment]'],
] as const)('toggles workspace %s presentation without changing Markdown or undo history', async (feature, source, selector) => {
  const markdown = `前 ${source} 后\n`;
  const { value, editor, capabilities, errors } = await mount(markdown);
  const prose = root.querySelector<HTMLElement>('.ProseMirror')!;
  expect(prose.querySelector(selector)?.textContent).toBe('文字');
  capabilities.value.features[feature] = false;
  await nextTick();
  expect(prose.querySelector(selector)).toBeNull();
  expect(prose.textContent).toContain(`前 ${source} 后`);
  expect(value.value).toBe(markdown);
  expect(editor.value!.canUndo()).toBe(false);
  capabilities.value.features[feature] = true;
  await nextTick();
  expect(prose.querySelector(selector)?.textContent).toBe('文字');
  expect(value.value).toBe(markdown);
  expect(errors).toEqual([]);
});

it.each([
  ['**加粗文字**', '**加粗文字**'],
  ['*斜体文字*', '*斜体文字*'],
  ['`tano:object-card`', '`tano:object-card`'],
  ['[链接文字](https://example.com/)', '[链接文字](https://example.com/)'],
  ['## 标题文字', '## 标题文字'],
  ['- 列表文字', '* 列表文字'],
])('copies rendered %s as Markdown even when it contains only one text node', async (source, expected) => {
  const { editor, revealMarkdown, value, errors } = await mount(source + '\n');
  revealMarkdown.value = false;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let from = 0, to = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText) { from = pos; to = pos + node.nodeSize; }
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  expect(copyMarkdown(view).get('text/plain')?.trimEnd()).toBe(expected);
  expect(value.value).toBe(source + '\n');
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('copies a partial cross-block selection with code delimiters and complete object reference source', async () => {
  const source = '预置记录位于外层工作区根目录的 `.tano/objects/`。身份与文件路径无关。\n\n'
    + '- Person：[[object://person/e82f91]]\n- Task：[[object://task/f82f91]]\n'
    + '- Project：[[object://project/182f91]]\n- Event：[[object://event/282f91]]\n\n'
    + '下面的独占段落通过 `tano:object-card` 标题成为对象卡片：\n';
  const { editor, value, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  let to = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.isText && node.text === 'tano:object-card') to = pos + 'tano:object-c'.length;
  });
  const from = 1 + source.indexOf('层工作区');
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, to)));
  const copied = copyMarkdown(view);
  expect(copied.get('text/plain')?.trimEnd()).toBe(
    source.slice(source.indexOf('层工作区'), source.indexOf('tano:object-card')).replace(/^- /gm, '* ') + 'tano:object-c`',
  );
  expect([...copied.keys()]).toEqual(['text/plain']);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('copies Markdown in readonly mode and cuts partial formatted text as one undoable edit', async () => {
  const { editor, readonly, revealMarkdown, value, errors } = await mount('前 **加粗文字** 后\n');
  revealMarkdown.value = false;
  readonly.value = true;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4, 6)));
  expect(copyMarkdown(view).get('text/plain')?.trimEnd()).toBe('**粗文**');
  expect(value.value).toBe('前 **加粗文字** 后\n');
  expect(editor.value!.canUndo()).toBe(false);
  readonly.value = false;
  await nextTick();
  expect(copyMarkdown(view, 'cut').get('text/plain')?.trimEnd()).toBe('**粗文**');
  expect(view.state.doc.textContent).toBe('前 加字 后');
  editor.value!.undoLastChange();
  expect(view.state.doc.textContent).toBe('前 加粗文字 后');
  expect(errors).toEqual([]);
});

it('copies characters selected inside a live Markdown source field verbatim', async () => {
  const { editor, value, errors } = await mount('前 **加粗文字** 后\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 4)));
  let from = 0;
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'tano_live_source_inline') from = pos + 1;
  });
  expect(from).toBeGreaterThan(0);
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, from, from + 4)));
  expect(copyMarkdown(view).get('text/plain')?.trimEnd()).toBe('**加粗');
  expect(value.value).toBe('前 **加粗文字** 后\n');
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each(['markdown', 'rich', 'html', 'text', 'word', 'wechat', 'zhihu'] as const)('immediately applies the %s preference to copy and cut', async copyFormat => {
  const { editor, preferences, revealMarkdown, value, errors } = await mount('前 **加粗** 后\n');
  revealMarkdown.value = false;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
  expect(copyMarkdown(view).get('text/plain')?.trimEnd()).toBe('**加粗**');
  preferences.value = { ...preferences.value, copyFormat: normalizeCopyFormat(copyFormat) };
  if (copyFormat === 'word') expect(preferences.value.copyFormat).toBe('rich');
  await nextTick();
  for (const type of ['copy', 'cut']) {
    const data = copyMarkdown(view, type);
    const plain = data.get('text/plain')!.trimEnd();
    if (copyFormat === 'markdown') expect(plain).toBe('**加粗**');
    else if (copyFormat === 'html') expect(plain).toContain('<strong>加粗</strong>');
    else expect(plain).toBe('加粗');
    if (['rich', 'word', 'wechat', 'zhihu'].includes(copyFormat)) expect(data.get('text/html')).toContain('<strong>加粗</strong>');
    else expect(data.has('text/html')).toBe(false);
  }
  expect(view.state.doc.textContent).toBe('前  后');
  expect(editor.value!.undoLastChange()).toBe(true);
  expect(view.state.doc.textContent).toBe('前 加粗 后');
  expect(value.value).toBe('前 **加粗** 后\n');
  expect(errors).toEqual([]);
});

it('uses the preferred format for the context-menu shortcut while explicit Markdown copy overrides it', async () => {
  const { editor, preferences, revealMarkdown } = await mount('**加粗**\n');
  revealMarkdown.value = false;
  preferences.value = { ...preferences.value, copyFormat: 'text' };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  const writeText = vi.fn().mockResolvedValue(undefined);
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    const open = async () => {
      view.dom.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
      await nextTick();
      await expandCopyMenu();
      return document.querySelector<HTMLElement>('.block-context-menu')!;
    };
    const menu = await open();
    expect(menu.querySelector('kbd')!.parentElement!.textContent).toContain('复制纯文本');
    menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'c', ctrlKey: true, bubbles: true, cancelable: true }));
    await nextTick();
    expect(writeText).toHaveBeenLastCalledWith('加粗');
    const reopened = await open();
    [...reopened.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '复制 Markdown')!.click();
    await nextTick();
    expect(writeText.mock.lastCall![0].trimEnd()).toBe('**加粗**');
    expect(preferences.value.copyFormat).toBe('text');
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each(['selection', 'block', 'blocks'] as const)('offers Markdown, HTML source, rich text and plain text for a %s', async mode => {
  const source = '前 **加粗** & 后\n\n第二段\n';
  const { editor, revealMarkdown, value, errors } = await mount(source);
  revealMarkdown.value = false;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const writeText = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class {
    constructor(readonly data: Record<string, Blob>) {}
  } });
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText, write } });
  try {
    for (const label of ['复制 Markdown', '复制 HTML', '复制纯文本', '复制富文本（Word / WPS）']) {
      if (mode === 'selection')
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
      else if (mode === 'blocks')
        view.dispatch(view.state.tr.setSelection(BlockRangeSelection.fromBlocks(view.state.doc, blockTree(view.state.doc).map(block => block.pos))!));
      else view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)));
      const selection = view.state.selection;
      view.dom.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
      await nextTick();
      const menu = document.querySelector<HTMLElement>('.block-context-menu')!;
      expect(menu).not.toBeNull();
      expect(menu.querySelector('[aria-label="复制为"]')).toBeNull();
      await expandCopyMenu();
      const button = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.startsWith(label))!;
      expect(button).toBeDefined();
      button.click();
      await nextTick();
      let copied = writeText.mock.lastCall![0];
      if (label === '复制富文本（Word / WPS）') {
        expect(write).toHaveBeenCalledTimes(1);
        const data = write.mock.lastCall![0][0].data as Record<string, Blob>;
        expect(Object.keys(data)).toEqual(['text/html', 'text/plain']);
        const readBlob = (blob: Blob) => new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = reject;
          reader.readAsText(blob);
        });
        copied = await readBlob(data['text/html']!);
        expect(await readBlob(data['text/plain']!)).toBe(mode === 'selection' ? '加粗' : '前 加粗 & 后' + (mode === 'blocks' ? '\n\n第二段' : ''));
        expect(writeText).toHaveBeenCalledTimes(3);
      }
      if (label === '复制 HTML' || label === '复制富文本（Word / WPS）') {
        expect(copied).toContain('<strong>加粗</strong>');
        if (mode !== 'selection') expect(copied).toContain('&amp;');
        if (mode === 'blocks') expect(copied).toContain('第二段</p>');
        expect(copied).not.toContain('data-pm-slice');
        expect(copied).not.toContain('tano-block-handle');
      } else if (label === '复制纯文本') {
        expect(copied).toBe(mode === 'selection' ? '加粗' : '前 加粗 & 后' + (mode === 'blocks' ? '\n\n第二段' : ''));
      } else expect(copied).toContain('**加粗**');
      expect(document.querySelector('.block-context-menu')).toBeNull();
      expect(view.state.selection.eq(selection)).toBe(true);
      expect(value.value).toBe(source);
      expect(editor.value!.canUndo()).toBe(false);
    }
    expect(errors).toEqual([]);
  } finally {
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor);
    else Reflect.deleteProperty(globalThis, 'ClipboardItem');
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each(['rich', 'wechat', 'zhihu', 'mathml', 'tsv'] as const)('copies the %s context-menu format without editing the document', async format => {
  const source = format === 'tsv' ? '| 名称 | 内容 |\n| --- | --- |\n| A | B |\n' : '前 `code` $x^2$ 后\n';
  const { editor, value, errors, revealMarkdown } = await mount(source);
  revealMarkdown.value = false;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const writeText = vi.fn().mockResolvedValue(undefined);
  const write = vi.fn().mockResolvedValue(undefined);
  const itemDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'ClipboardItem');
  const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(globalThis, 'ClipboardItem', { configurable: true, value: class {
    constructor(readonly data: Record<string, Blob>) {}
  } });
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { write, writeText } });
  const readBlob = (blob: Blob) => new Promise<string>(resolve => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob);
  });
  try {
    // Open inside a cell to exercise copying the containing table, not just its paragraph.
    const target = view.dom.querySelector(format === 'tsv' ? 'td p' : 'p')!;
    target.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
    await nextTick();
    await expandCopyMenu();
    const labels = { rich: '复制富文本（Word / WPS）', wechat: '复制到微信公众号', zhihu: '复制到知乎', mathml: '复制公式 MathML', tsv: '复制表格 TSV' };
    expect([...document.querySelectorAll('.block-context-menu button')].some(button => button.textContent?.includes('复制到 Word'))).toBe(false);
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')];
    const button = buttons.find(button => button.textContent?.startsWith(labels[format]));
    expect(button).toBeDefined();
    expect(buttons.some(button => button.textContent === (format === 'tsv' ? '复制公式 MathML' : '复制表格 TSV'))).toBe(false);
    button!.click();
    await nextTick();
    if (format === 'tsv') {
      expect(writeText).toHaveBeenCalledWith('名称\t内容\r\nA\tB');
      expect(write).not.toHaveBeenCalled();
    } else {
      expect(write).toHaveBeenCalledTimes(1);
      const data = write.mock.lastCall![0][0].data as Record<string, Blob>;
      const html = await readBlob(data['text/html']!);
      if (format === 'mathml') {
        expect(html).toContain('<math');
        expect(html).toContain('<msup>');
        expect(await readBlob(data['text/plain']!)).toBe(html);
      } else if (format === 'rich') {
        expect(html).toContain('mso-ascii-font-family:Consolas');
        expect(html).toContain('<math');
      } else if (format === 'wechat') {
        expect(html).toContain('<svg');
        expect(html).toContain('<path');
      } else {
        expect(html).toContain('class="Formula-image"');
        expect(html).toContain('alt="x^2"');
      }
    }
    expect(value.value).toBe(source);
    expect(editor.value!.canUndo()).toBe(false);
    expect(errors).toEqual([]);
  } finally {
    if (itemDescriptor) Object.defineProperty(globalThis, 'ClipboardItem', itemDescriptor);
    else Reflect.deleteProperty(globalThis, 'ClipboardItem');
    if (clipboardDescriptor) Object.defineProperty(navigator, 'clipboard', clipboardDescriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each(['wechat', 'zhihu'] as const)('copies dollar and LaTeX math delimiters using %s platform formulas', async copyFormat => {
  const source = '美元行内：$a^2+b^2=c^2$；LaTeX 行内：\\(a^2+b^2=c^2\\)。\n\n$$\nE = mc^2\n$$\n\n\\[\n\\frac{1}{2}\n\\]\n';
  const { editor, preferences, revealMarkdown, value, errors } = await mount(source);
  revealMarkdown.value = false;
  preferences.value = { ...preferences.value, copyFormat };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(new AllSelection(view.state.doc)));
  const copied = copyMarkdown(view);
  const container = document.createElement('div');
  container.innerHTML = copied.get('text/html')!;
  if (copyFormat === 'wechat') expect(container.querySelectorAll('svg')).toHaveLength(4);
  else {
    const formulas = [...container.querySelectorAll<HTMLImageElement>('img.Formula-image')];
    expect(formulas).toHaveLength(4);
    expect(formulas[0]!.alt).toBe('a^2+b^2=c^2');
    expect(formulas[1]!.alt).toBe('a^2+b^2=c^2');
    expect(formulas[2]!.alt.trim()).toBe('E = mc^2\\\\');
  }
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('preserves the document when a WeChat formula fails during cut', async () => {
  const source = '公式 $\\frac{$\n';
  const { editor, preferences, revealMarkdown, value, errors } = await mount(source);
  revealMarkdown.value = false;
  preferences.value = { ...preferences.value, copyFormat: 'wechat' };
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
  expect(copyMarkdown(view, 'cut').size).toBe(0);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors.some(error => error.includes('无法转换公众号公式'))).toBe(true);
});

it('reports unsupported rich text copying without silently copying HTML source', async () => {
  const { editor, errors, revealMarkdown } = await mount('**加粗**\n');
  revealMarkdown.value = false;
  await nextTick();
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const writeText = vi.fn();
  const descriptor = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  try {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    view.dom.querySelector('p')!.dispatchEvent(new MouseEvent('contextmenu', { button: 2, bubbles: true, cancelable: true }));
    await nextTick();
    await expandCopyMenu();
    [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')]
      .find(button => button.textContent === '复制富文本（Word / WPS）')!.click();
    await nextTick();
    expect(writeText).not.toHaveBeenCalled();
    expect(errors).toEqual(['当前环境不支持复制富文本，请使用复制 HTML 或复制 Markdown']);
  } finally {
    if (descriptor) Object.defineProperty(navigator, 'clipboard', descriptor);
    else Reflect.deleteProperty(navigator, 'clipboard');
  }
});

it.each(['ctrlKey', 'metaKey'] as const)('%s+A expands block selection one level at a time and resets at a new caret', async modifier => {
  const markdown = 'Before\n\n> Outer\n>\n> > Inner A\n> >\n> > Inner B\n>\n> Tail\n\nAfter';
  const { editor, value, errors } = await mount(markdown);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const inner = blockTree(view.state.doc).find(block => block.node.textContent === 'Inner A')!;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, inner.pos + 3)));
  view.focus();
  const scrollToSelection = vi.fn(() => true);
  view.setProps({ handleScrollToSelection: scrollToSelection });
  const press = () => {
    const event = new KeyboardEvent('keydown', { key: 'a', [modifier]: true, bubbles: true, cancelable: true });
    view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  };
  press();
  expect(view.state.selection).toBeInstanceOf(TextSelection);
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('Inner A');
  for (const expected of [['Inner A', 'Inner B'], ['Outer', 'Inner AInner B', 'Tail'], ['Before', 'OuterInner AInner BTail', 'After']]) {
    press();
    expect((view.state.selection as BlockRangeSelection).blocks.map(block => block.node.textContent)).toEqual(expected);
    expect(view.dom.querySelectorAll('.tano-block-selected')).toHaveLength(expected.length);
  }
  const all = view.state.selection;
  press();
  expect(view.state.selection.eq(all)).toBe(true);
  expect(scrollToSelection).not.toHaveBeenCalled();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  press();
  expect(view.state.doc.textBetween(view.state.selection.from, view.state.selection.to)).toBe('Before');
  expect(value.value).toBe(markdown);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it.each(['# Heading words', '```js\nconst x = 1;\n```'])('keeps %s selected when expanding out of live Markdown', async block => {
  const { editor, value, errors } = await mount(block + '\n\nAfter\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.focus();
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
  expect(view.state.doc.firstChild!.type.name).toBe('tano_live_source');
  for (let i = 0; i < 2; i++)
    view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', ctrlKey: true, bubbles: true, cancelable: true }));
  expect(view.state.selection).toBeInstanceOf(BlockRangeSelection);
  expect((view.state.selection as BlockRangeSelection).blocks).toHaveLength(2);
  expect(view.state.doc.firstChild!.type.name).toBe(block.startsWith('#') ? 'heading' : 'code_block');
  expect(value.value).toBe(block + '\n\nAfter\n');
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('preserves source carets and backward selections across mode restoration without edits', async () => {
  const markdown = '---\ntitle: Example\n---\n\n# 标题\n\n第一段重复\n\n第二段 **加粗文字**\n';
  const { editor, value, errors } = await mount(markdown);
  const position = markdown.indexOf('加粗文字') + 2;
  editor.value!.restoreModeSelection({ anchor: position, head: position });
  expect(editor.value!.captureModeSelection()).toEqual({ anchor: position, head: position });
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  expect(view.hasFocus()).toBe(true);
  expect(view.state.selection.$head.parent.textContent).toContain('**加粗文字**');
  expect(view.state.doc.textBetween(view.state.selection.head - 2, view.state.selection.head)).toBe('加粗');
  expect(value.value).toBe(markdown);
  expect(editor.value!.canUndo()).toBe(false);
  const selection = { anchor: position, head: markdown.indexOf('第一段') + 1 };
  editor.value!.restoreModeSelection(selection);
  expect(editor.value!.captureModeSelection()).toEqual(selection);
  expect(view.state.selection.anchor).toBeGreaterThan(view.state.selection.head);
  expect(value.value).toBe(markdown);
  expect(errors).toEqual([]);
});

it('maps a moved prose caret back to its new source position', async () => {
  const markdown = '重复文字\n\n重复文字\n';
  const { editor } = await mount(markdown);
  editor.value!.restoreModeSelection({ anchor: 2, head: 2 });
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const position = view.state.doc.firstChild!.nodeSize + 3;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)));
  expect(editor.value!.captureModeSelection()).toEqual({ anchor: 8, head: 8 });
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

it('toggles visual spacing without changing Markdown, selection, history or copied content', async () => {
  const source = '中文Word与2026年，公式$x$与[[中文引用]]相邻。\n\n[[cite]][[next]] [[spaced]]，[[punctuated]]\n\n`代码A中1`\n';
  const { value, preferences, editor, errors } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  const before = view.state.doc.toJSON();
  const selection = view.state.selection;
  expect(root.querySelector('.tano-auto-space-before')).toBeNull();
  preferences.value = { ...preferences.value, autoSpacing: true };
  await nextTick();
  expect(root.querySelectorAll('.tano-auto-space-before')).toHaveLength(9);
  expect([...root.querySelectorAll('.tano-auto-space-before[data-tano-wiki-target]')]
    .map(link => link.getAttribute('data-tano-wiki-target'))).toEqual(['中文引用', 'next']);
  expect(root.querySelector('code .tano-auto-space-before')).toBeNull();
  expect(view.state.doc.toJSON()).toEqual(before);
  expect(view.state.selection.eq(selection)).toBe(true);
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  // Clipboard serialization uses the unchanged document slice, not display margins.
  expect(view.state.doc.textBetween(0, view.state.doc.content.size)).toContain('中文Word与2026年');
  preferences.value = { ...preferences.value, autoSpacing: false };
  await nextTick();
  expect(root.querySelector('.tano-auto-space-before')).toBeNull();
  expect(value.value).toBe(source);
  expect(editor.value!.canUndo()).toBe(false);
  expect(errors).toEqual([]);
});

it('respects visible disabled-style delimiters when spacing and refreshes after capability changes', async () => {
  const source = '12312^文字^A 中~文字~1 ++文字++A ==文字==1\n';
  const { value, capabilities, errors } = await mount(source, undefined, {
    ...defaultCapabilities,
    features: { ...defaultCapabilities.features, superscript: false, subscript: false, underline: false, highlight: false },
  }, { ...defaultEditorPreferences, autoSpacing: true });
  expect(root.querySelector('[data-tano-disabled-style="superscript"]')?.textContent).toBe('^文字^');
  expect(root.querySelector('.tano-auto-space-before')).toBeNull();
  capabilities.value = { ...defaultCapabilities, features: { ...defaultCapabilities.features } };
  await nextTick();
  expect(root.querySelectorAll('.tano-auto-space-before')).toHaveLength(5);
  capabilities.value = { ...capabilities.value, features: { ...capabilities.value.features, superscript: false, subscript: false, underline: false, highlight: false } };
  await nextTick();
  expect(root.querySelector('.tano-auto-space-before')).toBeNull();
  expect(value.value).toBe(source);
  expect(errors).toEqual([]);
});
