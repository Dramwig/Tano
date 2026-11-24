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

describe('ArrowDown below the last block', () => {
  function down(prose: HTMLElement, options: KeyboardEventInit = {}) {
    const event = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true, ...options });
    prose.dispatchEvent(event);
    return event;
  }

  it.each(['正文', '# 标题', '- 列表内容', '> 引用', '```\ncode\n```', '---'])
    ('appends and focuses a plain paragraph after %s, with undo', async content => {
      const { editor, errors, value } = await mount(content);
      const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
      const prose = view.dom;
      const before = view.state.doc;
      const markdown = editor.value!.withContext(ctx => ctx.get(serializerCtx)(before));
      const selection = content === '---'
        ? NodeSelection.create(before, 0)
        : TextSelection.atEnd(before);
      view.dispatch(view.state.tr.setSelection(selection));
      view.focus();
      vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
      expect(down(prose).defaultPrevented).toBe(true);
      expect(view.state.doc.childCount).toBe(before.childCount + 1);
      expect(view.state.doc.lastChild?.type.name).toBe('paragraph');
      expect(view.state.doc.lastChild?.content.size).toBe(0);
      expect(view.state.selection.from).toBe(view.state.doc.content.size - 1);
      expect(view.state.storedMarks ?? view.state.selection.$from.marks()).toEqual([]);
      expect(document.activeElement).toBe(prose);
      down(prose);
      expect(view.state.doc.childCount).toBe(before.childCount + 1);
      expect(editor.value!.undoLastChange()).toBe(true);
      expect(view.state.doc.childCount).toBe(before.childCount);
      expect(value.value).toBe(markdown);
      expect(errors).toEqual([]);
    });

  it('preserves normal movement within wrapped text and earlier nested blocks', async () => {
    const { editor } = await mount('前文\n\n- 第一项\n- 第二项');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const before = view.state.doc;
    const end = vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
    const positions: number[] = [];
    before.descendants((node, pos) => { if (node.isTextblock) positions.push(pos + 1); });
    for (const position of positions.slice(0, -1)) {
      view.dispatch(view.state.tr.setSelection(TextSelection.create(before, position)));
      down(view.dom);
      expect(view.state.doc.eq(before)).toBe(true);
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(before)));
    end.mockReturnValue(false);
    down(view.dom);
    expect(view.state.doc.eq(before)).toBe(true);
  });

  it('ignores modifiers, IME, ranges, readonly mode and existing empty paragraphs', async () => {
    const { editor, readonly } = await mount('正文');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const before = view.state.doc;
    vi.spyOn(view, 'endOfTextblock').mockReturnValue(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(before)));
    for (const options of [{ shiftKey: true }, { ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { keyCode: 229 }]) {
      down(view.dom, options);
      expect(view.state.doc.eq(before)).toBe(true);
    }
    view.dispatch(view.state.tr.setSelection(TextSelection.create(before, 1, 2)));
    down(view.dom);
    expect(view.state.doc.eq(before)).toBe(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(before)));
    readonly.value = true;
    await nextTick();
    down(view.dom);
    expect(view.state.doc.eq(before)).toBe(true);
  });
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
    const blocks = () => [...prose.children].filter(child => !child.classList.contains('ProseMirror-widget'));
    const count = blocks().length;
    vi.spyOn(before, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 50, 300, 50));
    expect(clickBelow(prose).defaultPrevented).toBe(true);
    await nextTick();
    expect(blocks().length).toBe(count + 1);
    expect(blocks()[count - 1]).toBe(before);
    const paragraph = prose.lastElementChild!;
    expect(paragraph.tagName).toBe('P');
    expect(paragraph.textContent).toBe('');
    expect(document.activeElement).toBe(prose);
    expect(paragraph.contains(window.getSelection()!.anchorNode)).toBe(true);
    expect(errors).toEqual([]);
    prose.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true }));
    await nextTick();
    expect(blocks().length).toBe(count);
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

describe('Markdown editor round trips (blocks and containers)', () => {
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
    await vi.waitFor(() => expect(handles()[1]!.hidden).toBe(true));
    expect(handles()[0]!.hidden).toBe(false);
    expect(value.value).toBe(saved);
    root.querySelector<HTMLInputElement>('[aria-label="折叠块标题"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await nextTick();
    await vi.waitFor(() => expect(handles()[1]!.hidden).toBe(false));
    expect(root.querySelectorAll('.tano-toggle p')).toHaveLength(1);
    expect(errors).toEqual([]);
  });

  it('creates recursively nested toggles from the child caret and moves children with the keyboard', async () => {
    const { editor, value, errors } = await mountPanel('');
    editor.value!.command('toggle');
    editor.value!.command('toggle');
    await nextTick();
    expect(root.querySelector('.tano-toggle .tano-toggle p')).not.toBeNull();
    root.querySelector<HTMLInputElement>('[aria-label="折叠块标题"]')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
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
    await vi.waitFor(() => expect(group.getBoundingClientRect().right).toBeLessThan(child.getBoundingClientRect().left));
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
    await vi.waitFor(() => expect(group.getBoundingClientRect().left).toBeGreaterThanOrEqual(84));
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

  it('keeps the selected block when right-clicking another block and pressing Escape', async () => {
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
    expect(paragraphs[1]?.classList.contains('ProseMirror-selectednode')).toBe(false);
    expect(paragraphs[0]?.classList.contains('ProseMirror-selectednode')).toBe(true);
    menu!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await nextTick();
    expect(document.querySelector('.block-context-menu')).toBeNull();
    expect(paragraphs[1]?.classList.contains('ProseMirror-selectednode')).toBe(false);
    expect(paragraphs[0]?.classList.contains('ProseMirror-selectednode')).toBe(true);
    expect(value.value).toBe('First paragraph.\n\nSecond paragraph.\n');
    expect(errors).toEqual([]);
  });

  it.each([
    { left: 320, top: 100, x: 122, y: 100 },
    { left: 12, top: 100, x: 38, y: 100 },
    { left: 320, top: 750, x: 122, y: 352 },
  ])('selects a block and opens its handle menu within the viewport at $left, $top', async ({ left, top, x, y }) => {
    const content = 'First paragraph.\n\n- [ ] One\n- [ ] Two\n';
    const { value, editor, errors } = await mount(content);
    const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[1]!;
    const rect = vi.spyOn(handle, 'getBoundingClientRect').mockReturnValue(new DOMRect(left, top, 18, 24));
    const width = vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(190);
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(408);
    try {
      handle.click();
      await nextTick();
      await nextTick();
      const menu = document.querySelector<HTMLElement>('.block-context-menu')!;
      expect(root.querySelector('ul')?.classList.contains('ProseMirror-selectednode')).toBe(true);
      expect(handle.getAttribute('aria-haspopup')).toBe('menu');
      expect(menu.style.left).toBe(`${x}px`);
      expect(menu.style.top).toBe(`${y}px`);
      expect(document.activeElement).toBe(menu);
      const items = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[0]);
      items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
      expect(document.activeElement).toBe(items[1]);
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
      await nextTick();
      expect(document.querySelector('.block-context-menu')).toBeNull();
      expect(root.querySelector('ul')?.classList.contains('ProseMirror-selectednode')).toBe(true);
      expect(value.value).toBe(content);
      expect(editor.value!.canUndo()).toBe(false);
      expect(errors).toEqual([]);
    } finally {
      rect.mockRestore();
      width.mockRestore();
      height.mockRestore();
    }
  });

  it.each(['转换为', '合并放入新块', '复制为'])('opens the %s submenu without selecting its first item', async (label) => {
    const { errors } = await mount('First paragraph.\n\nSecond paragraph.\n');
    root.querySelector<HTMLButtonElement>('.tano-block-handle')!.click();
    await nextTick();
    const menu = document.querySelector<HTMLElement>('.block-context-menu')!;
    const trigger = [...menu.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes(label))!;
    trigger.click();
    await nextTick();
    await nextTick();
    const submenu = menu.querySelector<HTMLElement>('.block-convert-submenu')!;
    expect(document.activeElement).toBe(submenu);
    const items = [...submenu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    submenu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[0]);
    items[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(items[1]);
    items[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    await nextTick();
    expect(menu.querySelector('.block-convert-submenu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
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

  it('deletes the selected block with Backspace while its handle menu has focus', async () => {
    const { value, errors } = await mount('First paragraph.\n\nSecond paragraph.\n');
    const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[1]!;
    handle.click();
    await nextTick();
    const menu = document.querySelector<HTMLElement>('.block-context-menu')!;
    const event = new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true, cancelable: true });
    menu.dispatchEvent(event);
    await nextTick();
    expect(event.defaultPrevented).toBe(true);
    expect(root.querySelectorAll('.ProseMirror > *')).toHaveLength(1);
    expect(root.querySelector('.ProseMirror')?.textContent).toBe('First paragraph.');
    expect(document.querySelector('.block-context-menu')).toBeNull();
    expect(value.value).toBe('First paragraph.\n');
    expect(errors).toEqual([]);
  });

  it.each([true, false])('reveals selected mixed blocks together and restores their exact nodes without edits (automatic source: %s)', async automatic => {
    const content = 'Before.\n\n## Heading\n\nText with **bold**.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nAfter.\n';
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = automatic;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const original = view.state.doc;
    const positions = blockTree(original).slice(1, 4).map(block => block.pos);
    await openSelectedBlockSources(view, positions);
    const sources = view.dom.querySelectorAll('pre[data-tano-live-source]');
    expect(sources).toHaveLength(1);
    expect(sources[0]!.textContent).toContain('## Heading\n\nText with **bold**.\n\n| A');
    expect(sources[0]!.textContent).not.toContain('Before.');
    expect(sources[0]!.textContent).not.toContain('After.');
    expect(value.value).toBe(content);
    expect(editor.value!.canUndo()).toBe(false);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(view.dom.querySelector('[data-tano-live-source]')).toBeNull();
    expect(view.state.doc.eq(original)).toBe(true);
    expect(value.value).toBe(content);
    expect(editor.value!.canUndo()).toBe(false);
    expect(errors).toEqual([]);
  });

  it('edits selected blocks into new block types and undoes the edit without changing outside blocks', async () => {
    const content = 'Before.\n\nFirst.\n\nSecond.\n\nAfter.\n';
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    await openSelectedBlockSources(view, blockTree(view.state.doc).slice(1, 3).map(block => block.pos));
    const source = view.state.doc.child(1), pos = view.state.doc.firstChild!.nodeSize;
    view.dispatch(view.state.tr.insertText('## Updated\n\n* Item\n\nNew paragraph.', pos + 1, pos + source.nodeSize - 1));
    await nextTick();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(value.value).toBe('Before.\n\n## Updated\n\n* Item\n\nNew paragraph.\n\nAfter.\n');
    expect(view.state.doc.content.content.map(node => node.type.name)).toEqual(['paragraph', 'heading', 'bullet_list', 'paragraph', 'paragraph']);
    expect(editor.value!.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toBe(content);
    expect(editor.value!.redoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toContain('## Updated\n\n* Item\n\nNew paragraph.');
    expect(errors).toEqual([]);
  });

  it('edits disjoint selections across containers while preserving unselected blocks and their positions', async () => {
    const content = 'First.\n\nKeep between.\n\n> Nested.\n>\n> Keep nested.\n\nAfter.\n';
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const selected = blockTree(view.state.doc).filter(block => ['First.', 'Nested.'].includes(block.node.textContent));
    await openSelectedBlockSources(view, selected.map(block => block.pos));
    expect(view.dom.querySelectorAll('[data-tano-live-source]')).toHaveLength(2);
    for (const [index, text] of ['Updated first.', 'Updated nested.'].entries()) {
      const sources: { node: typeof view.state.doc; pos: number }[] = [];
      view.state.doc.descendants((node, pos) => { if (node.type.name === 'tano_live_source') sources.push({ node, pos }); });
      const source = sources[index]!;
      view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, source.pos + 1)));
      expect(view.dom.querySelectorAll('[data-tano-live-source]')).toHaveLength(2);
      view.dispatch(view.state.tr.insertText(text, source.pos + 1, source.pos + source.node.nodeSize - 1));
    }
    await nextTick();
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(view.dom.querySelector('[data-tano-live-source]')).toBeNull();
    expect(value.value).toBe('Updated first.\n\nKeep between.\n\n> Updated nested.\n>\n> Keep nested.\n\nAfter.\n');
    expect(view.dom.querySelector('blockquote')?.textContent).toBe('Updated nested.Keep nested.');
    for (let step = 0; step < 4 && editor.value!.canUndo(); step++) {
      expect(editor.value!.undoLastChange()).toBe(true);
      await nextTick();
      expect(value.value).toContain('Keep between.');
      expect(value.value).toContain('> Keep nested.');
      expect(value.value).toContain('After.');
    }
    expect(value.value).toBe(content);
    expect(errors).toEqual([]);
  });

  it('keeps all restored blocks selected when expanding out of a grouped source', async () => {
    const content = 'Before.\n\nFirst.\n\nSecond.\n\nAfter.\n';
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    await openSelectedBlockSources(view, blockTree(view.state.doc).slice(1, 3).map(block => block.pos));
    const positions = blockTree(view.state.doc).map(block => block.pos);
    view.dispatch(view.state.tr.setSelection(BlockRangeSelection.fromBlocks(view.state.doc, positions)!));
    await nextTick();
    expect(view.state.selection).toBeInstanceOf(BlockRangeSelection);
    expect((view.state.selection as BlockRangeSelection).blocks.map(block => block.node.textContent))
      .toEqual(['Before.', 'First.', 'Second.', 'After.']);
    expect(value.value).toBe(content);
    expect(editor.value!.canUndo()).toBe(false);
    expect(errors).toEqual([]);
  });

  it('preserves source spelling in one selected group while restoring the other groups', async () => {
    const content = 'First.\n\nKeep.\n\nLast.\n';
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const blocks = blockTree(view.state.doc);
    await openSelectedBlockSources(view, [blocks[0]!.pos, blocks[2]!.pos]);
    const source = view.state.doc.firstChild!;
    view.dispatch(view.state.tr.insertText('- Item', 1, source.nodeSize - 1));
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(value.value).toBe('- Item\n\nKeep.\n\nLast.\n');
    expect(view.dom.querySelectorAll('[data-tano-live-source]')).toHaveLength(1);
    expect(view.state.doc.lastChild!.type.name).toBe('paragraph');
    expect(view.state.doc.lastChild!.textContent).toBe('Last.');
    expect(errors).toEqual([]);
  });

  it.each([
    ['paragraph', 'Text with **bold** and [link](https://example.com).'],
    ['heading', '## Heading'],
    ['list', '- One\n- Two'],
    ['table', '| Name | Value |\n| --- | --- |\n| A | 1 |'],
    ['quote', '> Quoted **text**'],
    ['toggle', '<details>\n<summary>Details</summary>\n\nBody\n\n</details>'],
  ])('temporarily reveals an entire %s from the block menu without changing Markdown or undo', async (_kind, block) => {
    const content = `${block}\n\nOutside.\n`;
    const { editor, value, revealMarkdown, errors } = await mount(content);
    revealMarkdown.value = false;
    await nextTick();
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    const original = view.state.doc;
    root.querySelector('.tano-block-handle')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await nextTick();
    [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')]
      .find(button => button.textContent?.includes('编辑源码'))!.click();
    await nextTick();
    const source = root.querySelector<HTMLElement>('pre[data-tano-live-source]')!;
    expect(source).not.toBeNull();
    expect(source.textContent).not.toContain('Outside.');
    expect(view.state.doc.childCount).toBe(2);
    expect(view.state.doc.firstChild!.type.name).toBe('tano_live_source');
    expect(document.querySelector('.block-context-menu')).toBeNull();
    expect(value.value).toBe(content);
    expect(editor.value!.canUndo()).toBe(false);
    source.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    expect(root.querySelector('pre[data-tano-live-source]')).toBe(source);
    // An unfocusable blank area must dismiss the view even without a blur event.
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    await nextTick();
    expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect(view.state.doc.eq(original)).toBe(true);
    expect(value.value).toBe(content);
    expect(editor.value!.canUndo()).toBe(false);
    expect(errors).toEqual([]);
  });

  it('edits a nested block in temporary source and restores it when selecting another block', async () => {
    const { editor, value, errors } = await mount('> Child **bold**\n\nOutside.\n');
    const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
    root.querySelector('blockquote > p')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    await nextTick();
    [...document.querySelectorAll<HTMLButtonElement>('.block-context-menu button')]
      .find(button => button.textContent?.includes('编辑源码'))!.click();
    await nextTick();
    expect(root.querySelector('blockquote pre[data-tano-live-source]')?.textContent).toBe('Child **bold**');
    const from = view.state.selection.$from.start();
    view.dispatch(view.state.tr.insertText('Updated', from, from + 'Child'.length));
    await nextTick();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    await nextTick();
    expect(root.querySelector('pre[data-tano-live-source]')).toBeNull();
    expect(root.querySelector('blockquote > p')?.textContent).toBe('Updated bold');
    expect(root.querySelector('blockquote strong')?.textContent).toBe('bold');
    expect(value.value).toContain('> Updated **bold**');
    expect(value.value).toContain('Outside.');
    expect(editor.value!.undoLastChange()).toBe(true);
    await nextTick();
    expect(value.value).toContain('Child **bold**');
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
      expect(document.querySelector('.block-context-menu')).toBeNull();
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
});
