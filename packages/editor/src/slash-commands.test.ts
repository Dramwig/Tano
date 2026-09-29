// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor, rootCtx, defaultValueCtx, editorViewCtx, serializerCtx } from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { gfm } from '@milkdown/kit/preset/gfm';
import { history } from '@milkdown/kit/plugin/history';
import { undo, redo } from '@milkdown/kit/prose/history';
import { TextSelection } from '@milkdown/kit/prose/state';
import { $prose } from '@milkdown/kit/utils';
import { enhanced } from './enhanced';
import { mathRemark, blockMath, inlineMath } from './math';
import { applySlashCommand, slashCommands, slashItems, slashQuery } from './slash-commands';

let editor: Editor | undefined;
let host: HTMLElement | undefined;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
  host?.remove();
});

async function mount(markdown = '') {
  host = document.createElement('div');
  document.body.append(host);
  Range.prototype.getBoundingClientRect = () => new DOMRect(80, 80, 1, 24);
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  let readonly = false;
  let levels: readonly number[] = [0, 1];
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, host!);
      ctx.set(defaultValueCtx, markdown);
    })
    .use(commonmark)
    .use(gfm)
    .use(mathRemark)
    .use(blockMath)
    .use(inlineMath)
    .use(enhanced)
    .use(history)
    .use($prose(() => slashCommands({ readonly: () => readonly, levels: () => levels })))
    .create();
  const view = editor.action((ctx) => ctx.get(editorViewCtx));
  view.focus();
  const type = (text: string) => {
    for (const char of text) {
      const { from, to } = view.state.selection;
      const insert = () => view.state.tr.insertText(char, from, to);
      if (!view.someProp('handleTextInput', (handler) => handler(view, from, to, char, insert)))
        view.dispatch(insert());
    }
  };
  const key = (key: string, isComposing = false) => {
    const event = new KeyboardEvent('keydown', {
      key,
      isComposing,
      bubbles: true,
      cancelable: true,
    });
    view.dom.dispatchEvent(event);
    return event;
  };
  const markdownValue = () => editor!.action((ctx) => ctx.get(serializerCtx)(view.state.doc));
  const menu = () => document.querySelector<HTMLElement>('.tano-slash-menu')!;
  return {
    view,
    type,
    key,
    markdownValue,
    menu,
    setReadonly() {
      readonly = true;
      view.setProps({ editable: () => false });
    },
    setLevels(next: readonly number[]) {
      levels = next;
      view.dispatch(view.state.tr);
    },
  };
}

describe('slash block commands', () => {
  it('decorates the empty caret paragraph without changing Markdown and removes it when typing', async () => {
    const { view, type, markdownValue } = await mount();
    const original = markdownValue();
    expect(host!.querySelectorAll('[data-placeholder]')).toHaveLength(1);
    expect(markdownValue()).toBe(original);
    type('文字');
    expect(host!.querySelector('[data-placeholder]')).toBeNull();
    expect(view.state.doc.textContent).toBe('文字');
  });

  it('keeps all empty heading labels away from the caret and after blur, until text is entered', async () => {
    const { view, type, markdownValue, setReadonly } = await mount('#\n\n##\n\n###\n\n####\n\n#####\n\n######\n\n正文');
    const original = markdownValue();
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    const labels = () => Array.from(host!.querySelectorAll('.tano-empty-heading'))
      .map((heading) => heading.getAttribute('data-placeholder'));
    const expected = Array.from({ length: 6 }, (_, i) => `Heading ${i + 1}`);
    expect(labels()).toEqual(expected);
    view.dom.blur();
    expect(view.hasFocus()).toBe(false);
    expect(labels()).toEqual(expected);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, view.state.doc.content.size - 1)));
    expect(labels()).toEqual(expected);
    expect(markdownValue()).toBe(original);

    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    type('标题');
    expect(labels()).toEqual(expected.slice(1));
    view.dispatch(view.state.tr.delete(1, 3));
    expect(labels()).toEqual(expected);
    setReadonly();
    expect(labels()).toEqual([]);
  });

  it('filters English and Chinese, respects feature levels, and expands H1–H4', () => {
    expect(slashItems('table').map((item) => item.command)).toEqual(['table']);
    expect(slashItems('表格').map((item) => item.command)).toEqual(['table']);
    expect(slashItems('H2')[0]?.value).toBe('2');
    expect(slashItems('heading')).toHaveLength(4);
    expect(slashItems('toggle', [0])).toEqual([]);
  });

  it.each([
    ['list', 'List'], ['ordered-list', 'List'], ['todo-list', 'Task List'],
    ['quote', 'Empty quote'], ['callout', 'Callout'],
    ['mermaid', 'Mermaid'], ['table', 'Empty cell'], ['toggle', 'Toggle'],
    ['tabs', 'Tabs'], ['columns', 'Columns'],
  ])('keeps empty %s hints visible away from the caret and removes them when filled', async (command, label) => {
    const { view, type, markdownValue, setReadonly } = await mount();
    type('/');
    const item = slashItems('').find((item) => item.command === command)!;
    view.dispatch(applySlashCommand(view.state, item)!);
    if (command === 'mermaid')
      view.dispatch(view.state.tr.delete(1, view.state.doc.firstChild!.nodeSize - 1));
    const tr = view.state.tr.insert(view.state.doc.content.size,
      view.state.schema.nodes.paragraph!.create(null, view.state.schema.text('正文')));
    tr.setSelection(TextSelection.atEnd(tr.doc));
    view.dispatch(tr);
    const original = markdownValue();
    view.dom.blur();
    expect(view.hasFocus()).toBe(false);
    const hints = () => host!.querySelectorAll(`.tano-empty-block-persistent[data-placeholder="${label}"]`);
    const count = hints().length;
    expect(count).toBeGreaterThan(0);
    expect(markdownValue()).toBe(original);
    if (command === 'table')
      expect(host!.querySelector('th p')?.getAttribute('data-placeholder')).toBe('Empty header');

    const position = view.posAtDOM(hints()[0]!, 0);
    view.dispatch(view.state.tr.insertText('内容', position));
    expect(hints()).toHaveLength(count - 1);
    view.dispatch(view.state.tr.delete(position, position + 2));
    expect(hints()).toHaveLength(count);
    setReadonly();
    expect(host!.querySelector('[data-placeholder]')).toBeNull();
  });

  it('does not add a placeholder to an empty code block', async () => {
    const { view } = await mount('```\n```\n');
    const code = host!.querySelector('pre')!;
    view.focus();
    expect(code.hasAttribute('data-placeholder')).toBe(false);
    expect(code.classList.contains('tano-empty-block')).toBe(false);
    view.dom.blur();
    expect(code.hasAttribute('data-placeholder')).toBe(false);
  });

  it('uses the nearest nested block label and does not label nonempty media paragraphs', async () => {
    const { view } = await mount('> -\n\n- >\n\n![图片](photo.png "图片")\n\n正文');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(host!.querySelector('blockquote li p')?.getAttribute('data-placeholder')).toBe('List');
    expect(host!.querySelector('li blockquote p')?.getAttribute('data-placeholder')).toBe('Empty quote');
    expect(host!.querySelector('img')?.closest('p')?.hasAttribute('data-placeholder')).toBe(false);
  });

  it('converts with Enter, puts the caret in a table, and undoes/redoes atomically', async () => {
    const { view, type, key, menu, markdownValue } = await mount();
    type('/table');
    expect(menu().hidden).toBe(false);
    expect(menu().querySelector('[aria-selected="true"]')?.textContent).toContain('表格');
    expect(key('Enter').defaultPrevented).toBe(true);
    expect(view.state.doc.firstChild?.type.name).toBe('table');
    expect(view.state.selection.$from.parent.type.name).toBe('paragraph');
    expect(menu().hidden).toBe(true);
    expect(markdownValue()).not.toContain('/table');
    undo(view.state, view.dispatch);
    expect(view.state.doc.textContent).toBe('/table');
    expect(menu().hidden).toBe(true);
    redo(view.state, view.dispatch);
    expect(view.state.doc.firstChild?.type.name).toBe('table');
  });

  it('navigates results and converts by click without losing the editor selection', async () => {
    const { view, type, key, menu } = await mount();
    type('/heading');
    key('ArrowDown');
    expect(menu().querySelector('[aria-selected="true"]')?.textContent).toContain('2 级标题');
    key('Enter');
    expect(view.state.doc.firstChild?.attrs.level).toBe(2);
    expect(host!.querySelector('h2')?.getAttribute('data-placeholder')).toBe('Heading 2');
    expect(view.state.doc.textContent).toBe('');
    type('/表格');
    expect(menu().hidden, view.state.doc.toString()).toBe(false);
    expect(menu().querySelector('[role="option"]')?.textContent).toContain('表格');
    menu().querySelector<HTMLButtonElement>('[role="option"]')!.click();
    expect(view.state.doc.childCount).toBe(1);
    expect(view.state.doc.firstChild?.type.name).toBe('table');
  });

  it('keeps the query on Escape and closes when clicking elsewhere', async () => {
    const { view, type, key, menu } = await mount();
    type('/');
    key('Escape');
    expect(menu().hidden).toBe(true);
    expect(view.state.doc.textContent).toBe('/');
    view.dispatch(view.state.tr);
    expect(menu().hidden).toBe(true);
    type('h');
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('/');
    expect(menu().hidden).toBe(false);
    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu().hidden).toBe(true);
  });

  it('does not intercept composition Enter', async () => {
    const { view, type, key } = await mount();
    type('/table');
    view.dom.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(key('Enter', true).defaultPrevented).toBe(false);
    expect(view.state.doc.firstChild?.type.name).toBe('paragraph');
    view.dom.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });

  it('closes on whitespace and stays closed after deleting the space or typing more', async () => {
    const { view, type, menu } = await mount();
    type('/head');
    expect(menu().hidden).toBe(false);
    type(' ');
    expect(menu().hidden).toBe(true);
    expect(view.state.doc.textContent).toBe('/head ');
    view.dispatch(view.state.tr.delete(view.state.selection.from - 1, view.state.selection.from));
    expect(menu().hidden).toBe(true);
    type('ing');
    expect(menu().hidden).toBe(true);
  });

  it('ends the session as soon as Space is pressed, without consuming the key', async () => {
    const { type, key, menu } = await mount();
    type('/head');
    expect(key(' ').defaultPrevented).toBe(false);
    expect(menu().hidden).toBe(true);
  });

  it('never reopens when the caret moves away and back to the existing slash query', async () => {
    const { view, type, menu } = await mount();
    type('/head');
    const end = view.state.selection.from;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end - 1)));
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, end)));
    expect(menu().hidden).toBe(true);
    type('ing');
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('/');
    expect(menu().hidden).toBe(false);
  });

  it('does not open for existing, pasted, or programmatically replaced slash text', async () => {
    const { view, type, menu } = await mount('/head');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(menu().hidden).toBe(true);
    type('ing');
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    view.dispatch(view.state.tr.insertText('/table'));
    expect(menu().hidden).toBe(true);
    undo(view.state, view.dispatch);
    redo(view.state, view.dispatch);
    expect(menu().hidden).toBe(true);
  });

  it('closes on blur or clicking the editor and stays closed on refocus', async () => {
    const { view, type, menu } = await mount();
    type('/head');
    view.dom.blur();
    expect(menu().hidden).toBe(true);
    view.focus();
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('/head');
    view.dom.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(menu().hidden).toBe(true);
    type('ing');
    expect(menu().hidden).toBe(true);
  });

  it('closes on cursor navigation keys even before the selection transaction arrives', async () => {
    const { type, key, menu } = await mount();
    type('/head');
    key('ArrowLeft');
    expect(menu().hidden).toBe(true);
    key('ArrowRight');
    expect(menu().hidden).toBe(true);
  });

  it('does not consume Enter without a match', async () => {
    const { view, type, key, menu } = await mount();
    type('/tablex');
    expect(menu().textContent).toContain('没有匹配');
    expect(menu().hidden).toBe(false);
    key('Enter');
    expect(view.state.doc.firstChild?.textContent).toBe('/tablex');
    expect(menu().hidden).toBe(true);
  });

  it('closes after two more characters without matches and never reopens on further typing', async () => {
    const { view, type, menu } = await mount();
    type('/tablex');
    expect(menu().hidden).toBe(false);
    expect(menu().textContent).toContain('没有匹配');
    type('y');
    expect(menu().hidden).toBe(false);
    type('z');
    expect(menu().hidden).toBe(true);
    expect(view.state.doc.textContent).toBe('/tablexyz');
    type('more');
    expect(menu().hidden).toBe(true);
  });

  it('resets the no-match allowance when backspacing restores matching results', async () => {
    const { view, type, menu } = await mount();
    type('/tablex');
    type('y');
    view.dispatch(view.state.tr.delete(view.state.selection.from - 2, view.state.selection.from));
    expect(menu().hidden).toBe(false);
    expect(menu().textContent).toContain('Table');
    type('z');
    expect(menu().hidden).toBe(false);
    type('x');
    expect(menu().hidden).toBe(false);
    type('y');
    expect(menu().hidden).toBe(true);
  });

  it('counts Unicode characters and handles two characters committed in one input', async () => {
    const { view, type, menu } = await mount();
    type('/tablex');
    expect(menu().hidden).toBe(false);
    type('😀');
    expect(menu().hidden).toBe(false);
    type('字');
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('/tablex');
    expect(menu().hidden).toBe(false);
    view.dispatch(view.state.tr.insertText('中文'));
    expect(menu().hidden).toBe(true);
  });

  it('does not trigger in prose, inline atoms or code blocks and closes on selection changes', async () => {
    const { view, type, menu } = await mount('正文');
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    type('/table');
    expect(slashQuery(view.state)).toBeNull();
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
    expect(menu().hidden).toBe(true);
    const code = view.state.schema.nodes.code_block!.create(null, view.state.schema.text('/table'));
    view.dispatch(view.state.tr.replaceWith(0, view.state.doc.content.size, code));
    view.dispatch(view.state.tr.setSelection(TextSelection.atEnd(view.state.doc)));
    expect(slashQuery(view.state)).toBeNull();
  });

  it('preserves the surrounding list items when converting a nested paragraph', async () => {
    const { view, type, menu } = await mount('- first\n- second\n');
    let target = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'second') target = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
    type('/quote');
    expect(applySlashCommand(view.state, slashItems('quote')[0]!)).toBeNull();
    expect(view.state.doc.firstChild?.type.name).toBe('bullet_list');
    expect(view.state.doc.firstChild?.child(0).textContent).toBe('first');
    // A list item requires its first paragraph; invalid conversions must preserve the query.
    expect(view.state.doc.firstChild?.child(1).textContent).toBe('/quotesecond');
    expect(menu().hidden).toBe(true);
    view.state.doc.check();
  });

  it.each([
    ['paragraph', 'paragraph'],
    ['h3', 'heading'],
    ['quote', 'blockquote'],
    ['bullet', 'bullet_list'],
    ['ordered-list', 'ordered_list'],
    ['todo', 'bullet_list'],
    ['code', 'code_block'],
    ['mermaid', 'code_block'],
    ['callout', 'blockquote'],
    ['toggle', 'tano_toggle'],
    ['tabs', 'tano_tabs'],
    ['columns', 'tano_columns'],
    ['divider', 'hr'],
    ['math', 'math_block'],
  ])('creates /%s as a valid %s block and round trips without query text', async (query, node) => {
    const { view, type, key, markdownValue } = await mount();
    type(`/${query}`);
    key('Enter');
    expect(view.state.doc.firstChild?.type.name).toBe(node);
    expect(markdownValue()).not.toContain(`/${query}`);
    view.state.doc.check();
  });

  it('preserves neighboring quote paragraphs and remaining text when converting locally', async () => {
    const { view, type, menu } = await mount('> first\n>\n> second\n');
    let target = 0;
    view.state.doc.descendants((node, pos) => {
      if (node.type.name === 'paragraph' && node.textContent === 'second') target = pos + 1;
    });
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, target)));
    type('/h2');
    expect(menu().hidden).toBe(true);
    view.dispatch(applySlashCommand(view.state, slashItems('h2')[0]!)!);
    expect(view.state.doc.firstChild?.type.name).toBe('blockquote');
    expect(view.state.doc.firstChild?.child(0).textContent).toBe('first');
    expect(view.state.doc.firstChild?.child(1).type.name).toBe('heading');
    expect(view.state.doc.firstChild?.child(1).textContent).toBe('second');
  });

  it('requests a resource URL and keeps invalid submissions intact', async () => {
    const { view, type, key, menu, markdownValue } = await mount();
    type('/image');
    key('Enter');
    const input = menu().querySelector('input')!;
    const form = menu().querySelector('form')!;
    input.value = 'javascript:alert(1)';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(view.state.doc.textContent).toBe('/image');
    expect(menu().querySelector('[role="alert"]')?.textContent).toContain('有效');
    input.value = 'assets/photo.png';
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(markdownValue()).toContain('assets/photo.png');
    expect(markdownValue()).not.toContain('/image');
  });

  it('closes stale URL forms after document edits and hides disabled commands immediately', async () => {
    const { view, type, key, menu, setLevels, setReadonly } = await mount();
    type('/file');
    key('Enter');
    expect(menu().querySelector('input')).not.toBeNull();
    view.dispatch(view.state.tr.insertText('changed'));
    expect(menu().hidden).toBe(true);
    view.focus();
    view.dispatch(view.state.tr.insertText('/toggle', 1, view.state.doc.content.size - 1));
    expect(menu().hidden).toBe(true);
    view.dispatch(view.state.tr.delete(1, view.state.doc.content.size - 1));
    type('/toggle');
    expect(menu().querySelector('[role="option"]')?.textContent).toContain('折叠');
    setLevels([0]);
    expect(menu().textContent).toContain('没有匹配');
    setReadonly();
    expect(menu().hidden).toBe(true);
    expect(host!.querySelector('[data-placeholder]')).toBeNull();
  });
});
