// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  Editor,
  rootCtx,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  serializerCtx,
} from '@milkdown/kit/core';
import { commonmark } from '@milkdown/kit/preset/commonmark';
import { NodeSelection, TextSelection } from '@milkdown/kit/prose/state';
import { undoInputRule } from '@milkdown/kit/prose/inputrules';
import type { EditorView } from '@milkdown/kit/prose/view';
import {
  blockMath,
  blockMathInput,
  inlineMath,
  inlineMathInput,
  mathRemark,
  mathView,
  latexMathInput,
} from './math';

let editor: Editor | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  await editor?.destroy();
  editor = undefined;
  root?.remove();
});
async function mount(markdown = '') {
  root = document.createElement('div');
  document.body.append(root);
  editor = await Editor.make()
    .config((ctx) => {
      ctx.set(rootCtx, root);
      ctx.set(defaultValueCtx, markdown);
      ctx.update(editorViewOptionsCtx, (previous) => ({
        ...previous,
        nodeViews: {
          math_inline: mathView(false, () => false, () => true, () => false),
          math_block: mathView(true, () => false, () => true, () => false),
        },
      }));
    })
    .use(commonmark)
    .use(mathRemark)
    .use(latexMathInput)
    .use(inlineMath)
    .use(blockMath)
    .use(inlineMathInput)
    .use(blockMathInput)
    .create();
  return editor.action((ctx) => ctx.get(editorViewCtx));
}
function type(view: EditorView, text: string) {
  for (const character of text) {
    const { from, to } = view.state.selection;
    const handled = view.someProp('handleTextInput', (handler) =>
      handler(view, from, to, character, () => view.state.tr.insertText(character, from, to)),
    );
    if (!handled) view.dispatch(view.state.tr.insertText(character, from, to));
  }
}
function markdown() {
  return editor!.action((ctx) => ctx.get(serializerCtx)(ctx.get(editorViewCtx).state.doc));
}

describe('formula input', () => {
  it('opens the formula panel without moving the editor selection', async () => {
    const view = await mount('前 $x$ 后。\n');
    const original = TextSelection.create(view.state.doc, view.state.doc.content.size - 1);
    view.dispatch(view.state.tr.setSelection(original));
    const button = root.querySelector<HTMLButtonElement>('.math-inline .math-preview')!;
    button.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    button.click();
    expect(view.state.selection.eq(original)).toBe(true);
    expect(root.querySelector<HTMLElement>('.math-inline .math-editor-panel')?.hidden).toBe(false);
  });

  it.each([
    ['Escape', '公式 $x$。\n', '.math-inline', '$y$'],
    ['Escape', '$$\nx\n$$\n', '.math-block', '$$\ny\n$$'],
  ])('saves %s and leaves the %s selection', async (key, source, selector, expected) => {
    const view = await mount(source);
    root.querySelector<HTMLButtonElement>(`${selector} .math-preview`)!.click();
    const input = root.querySelector<HTMLTextAreaElement>(`${selector} textarea`)!;
    input.value = 'y';
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(input.hidden).toBe(true);
    expect(view.state.selection).not.toBeInstanceOf(NodeSelection);
    expect(root.querySelector(`${selector}.ProseMirror-selectednode`)).toBeNull();
    expect(document.activeElement).toBe(view.dom);
    expect(markdown()).toContain(expected);
  });

  it('keeps Enter in the formula editor and updates multiline LaTeX live', async () => {
    const view = await mount('$$\nx\n$$\n');
    root.querySelector<HTMLButtonElement>('.math-block .math-preview')!.click();
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    for (const shiftKey of [false, true]) {
      const event = new KeyboardEvent('keydown', {
        key: 'Enter', shiftKey, bubbles: true, cancelable: true,
      });
      input.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }
    expect(input.hidden).toBe(false);
    expect(document.activeElement).toBe(input);
    input.value = 'x\n+ y';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(view.state.doc.firstChild!.attrs.value).toBe('x\n+ y');
    expect(input.hidden).toBe(false);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(input.hidden).toBe(true);
    expect(markdown()).toContain('x\n+ y');
  });

  it('renders typed LaTeX delimiters and preserves their spelling', async () => {
    const view = await mount();
    type(view, '\\(x^2\\)');
    expect(view.state.doc.firstChild!.firstChild!.type.name).toBe('math_inline');
    expect(markdown()).toBe('\\(x^2\\)\n');
  });
  it('renders single and double dollar delimiters only when the full expression is entered', async () => {
    const view = await mount();
    type(view, '公式 $x^2$，另一个 $$');
    type(view, '\\frac{a}{b}$');
    expect(view.state.doc.firstChild!.childCount).toBe(3);
    expect(view.state.doc.lastChild!.lastChild!.text).toBe('，另一个 $$\\frac{a}{b}$');
    type(view, '$');
    expect(view.state.doc.lastChild!.lastChild!.type.name).toBe('math_inline');
    expect(markdown()).toContain('$\\frac{a}{b}$');
    expect(markdown()).toContain('$x^2$');
  });

  it('keeps escaped dollars as literal text while typing', async () => {
    const view = await mount();
    type(view, '\\$x$');
    expect(view.state.doc.firstChild!.textContent).toBe('\\$x$');
    expect(view.state.doc.firstChild!.childCount).toBe(1);
  });

  it.each(['`$x`', '```latex\n$x\n```'])('keeps formulas inside code: %s', async (source) => {
    const view = await mount(source);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3)));
    type(view, '$');
    expect(view.state.doc.firstChild!.textContent).toBe('$x$');
    expect(view.state.doc.firstChild!.firstChild!.isText).toBe(true);
  });

  it('creates a block from $$ and a space, and supports undoing the shortcut', async () => {
    const view = await mount();
    type(view, '$$ ');
    expect(view.state.doc.firstChild!.type.name).toBe('math_block');
    expect(markdown()).toContain('$$\n$$');
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    expect(input.hidden).toBe(false);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('Esc 或点击外部关闭');
    expect(markdown()).not.toContain(input.placeholder);
    expect(document.activeElement).toBe(input);
    expect(undoInputRule(view.state, view.dispatch)).toBe(true);
    expect(view.state.doc.firstChild!.textContent).toBe('$$ ');
  });

  it('shows a placeholder in an empty formula block without saving it as Markdown', async () => {
    const view = await mount();
    type(view, '$$ ');
    const preview = root.querySelector<HTMLElement>('.math-block .math-preview')!;
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    expect(preview.classList.contains('math-preview-empty')).toBe(true);
    expect(preview.querySelector('.katex')?.textContent).toContain('公式');
    expect(markdown()).not.toContain('\\LaTeX');

    input.value = 'x^2';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(preview.classList.contains('math-preview-empty')).toBe(false);
    expect(preview.querySelector('.katex-display')).not.toBeNull();
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(preview.classList.contains('math-preview-empty')).toBe(true);
    expect(preview.querySelector('.katex-display')).toBeNull();
  });

  it('keeps only the close placeholder in an empty formula panel', async () => {
    const view = await mount();
    type(view, '$$ ');
    const input = root.querySelector<HTMLTextAreaElement>('.math-block textarea')!;
    const panel = root.querySelector<HTMLElement>('.math-block .math-editor-panel')!;
    expect(input.placeholder).toBe('Esc 或点击外部关闭');
    expect(panel.textContent).not.toContain('Enter 换行');
    input.value = 'x';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.value = '';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    expect(panel.textContent).not.toContain('Enter 换行');
    expect(markdown()).not.toContain('Enter 换行');
  });

  it('does not discard following text when the block shortcut is entered mid-paragraph', async () => {
    const view = await mount('保留正文');
    type(view, '$$ ');
    expect(view.state.doc.firstChild!.type.name).toBe('paragraph');
    expect(view.state.doc.firstChild!.textContent).toBe('$$ 保留正文');
  });

  it('accepts the nonbreaking space inserted by contenteditable browsers', async () => {
    const view = await mount();
    type(view, '$$\u00a0');
    expect(view.state.doc.firstChild!.type.name).toBe('math_block');
  });
});
