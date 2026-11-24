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

describe('Markdown editor round trips (media, links, and footnotes)', () => {
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
});
