// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import { TextSelection } from '@milkdown/kit/prose/state';
import MarkdownEditor from '@tano/editor';
import { defaultSelectionContext } from '@tano/editor/document-model';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import EditorTools from './EditorTools.vue';
import type { ToolbarMode } from '../toolbar-preference';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  app?.unmount();
  app = undefined;
  root?.remove();
  await nextTick();
});
async function mount(content: string, mode: ToolbarMode = 'fixed') {
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content);
  const readonly = ref(false);
  const source = ref(false);
  const toolbarMode = ref(mode);
  const active = ref(true);
  const revealMarkdown = ref(true);
  const levels = ref([0, 1]);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const context = ref<EditorSelectionContext>({ ...defaultSelectionContext });
  const errors: string[] = [];
  root.getBoundingClientRect = () => new DOMRect(0, 0, 800, 600);
  Range.prototype.getBoundingClientRect = () => new DOMRect(100, 200, 100, 24);
  Range.prototype.getClientRects = () => [new DOMRect(100, 200, 100, 24)] as unknown as DOMRectList;
  app = createApp(
    defineComponent(() => () => [
      h(EditorTools, {
        mode: toolbarMode.value,
        'onUpdate:mode': value => { toolbarMode.value = value; },
        active: active.value,
        editorElement: root,
        context: context.value,
        disabled: readonly.value,
        source: source.value,
        enabledLevels: levels.value,
        onCommand: (name, argument) => editor.value?.command(name, argument),
      }),
      h(MarkdownEditor, {
        ref: editor,
        modelValue: value.value,
        documentId: 'toolbar-test',
        readonly: readonly.value,
        enabledLevels: levels.value,
        revealMarkdown: revealMarkdown.value,
        'onUpdate:modelValue': (next) => {
          value.value = next;
        },
        onSelectionChange: (next) => {
          context.value = next;
        },
        onError: (error) => errors.push(error),
      }),
    ]),
  );
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.ProseMirror')).not.toBeNull());
  await nextTick();
  return { value, editor, context, errors, readonly, source, levels, revealMarkdown, toolbarMode, active };
}
function button(label: string) {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
it.each(['left', 'right', 'bottom'] as const)('keeps the same compact actions when switching from fixed to %s', async (mode) => {
  const state = await mount('正文文字\n');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 0);
  const labels = (element: Element) => Array.from(element.querySelectorAll('button[aria-label]'))
    .filter(button => !(button as HTMLButtonElement).hidden && !(button.closest('.inline-tools') as HTMLElement | null)?.style.display.includes('none'))
    .map(button => button.getAttribute('aria-label'));
  const fixed = labels(root.querySelector('.switchable-toolbar')!);
  expect(root.querySelector('.switchable-toolbar')!.classList.contains('editor-toolbar')).toBe(true);
  expect(root.querySelector('.selection-format-toolbar')).toBeNull();
  expect(root.querySelector('.selection-level')).toBeNull();
  expect(button('块级类型').closest('.format-actions')!.nextElementSibling!.classList.contains('toolbar-divider')).toBe(true);
  expect(button('块级类型').textContent!.trim()).toBe('正文');
  expect(button('块级类型').querySelector('svg')).not.toBeNull();
  expect(button('块级类型').querySelector('small')).toBeNull();
  expect(fixed).toEqual(['拖动工具栏', '块级类型', '更多格式']);
  state.toolbarMode.value = mode;
  await expectFloating();
  expect(labels(document.querySelector('.selection-toolbar')!)).toEqual(fixed);
  const blockTrigger = floatingButton('块级类型');
  expect(blockTrigger.textContent!.trim()).toBe('');
  expect(blockTrigger.querySelector('svg')).not.toBeNull();
  expect(blockTrigger.dataset.tooltip).toBe('正文');
});
async function click(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  element.click();
  await nextTick();
}
async function selectText(element: Element, start = 0, end = element.textContent!.length) {
  root.querySelector<HTMLElement>('.ProseMirror')!.focus();
  const range = document.createRange();
  range.setStart(element.firstChild!, start);
  range.setEnd(element.firstChild!, end);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
}
async function handle(index = 0) {
  await click(root.querySelectorAll<HTMLElement>('.tano-block-handle')[index]!);
}
async function fillForm(text: string) {
  const input = root.querySelector<HTMLInputElement>('.toolbar-input-panel input')!;
  input.value = text;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  root
    .querySelector('form')!
    .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
}

it('switches between block and inline tools for handles, text, and a collapsed caret without editing content', async () => {
  const { value, context } = await mount('# Heading\n\n正文文字\n');
  await handle(0);
  expect(context.value.block).toBe('Heading');
  expect(button('块级类型')).not.toBeNull();
  expect(button('粗体')).toBeNull();
  const paragraph = root.querySelector('.ProseMirror > p')!;
  await selectText(paragraph, 0, 2);
  expect(context.value.level).toBe('inline');
  expect(button('粗体')).not.toBeNull();
  expect(button('块级类型')).not.toBeNull();
  expect(button('行内公式')).toBeNull();
  await selectText(paragraph, 2, 2);
  expect(context.value.level).toBe('block');
  expect(value.value).toBe('# Heading\n\n正文文字\n');
});

it('marks the current text and background colors and follows resets and selection changes', async () => {
  const { editor, context, value } = await mount('正文文字\n');
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)));
  await nextTick();
  const openColors = async () => {
    await click(button('更多格式'));
    await click(button('文字颜色'));
  };
  await openColors();
  expect(button('恢复默认文字颜色').getAttribute('aria-pressed')).toBe('true');
  expect(button('恢复默认背景颜色').getAttribute('aria-pressed')).toBe('true');
  await click(button('红色文字'));
  await openColors();
  expect(button('红色文字').getAttribute('aria-pressed')).toBe('true');
  expect(button('恢复默认文字颜色').getAttribute('aria-pressed')).toBe('false');
  await click(button('蓝色背景'));
  await openColors();
  expect(button('红色文字').getAttribute('aria-pressed')).toBe('true');
  expect(button('蓝色背景').getAttribute('aria-pressed')).toBe('true');
  await click(button('恢复默认背景颜色'));
  await openColors();
  expect(button('恢复默认背景颜色').getAttribute('aria-pressed')).toBe('true');
  expect(button('红色文字').getAttribute('aria-pressed')).toBe('true');
  const saved = value.value;
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 5)));
  await nextTick();
  expect(context.value.textColor).toBeNull();
  expect(button('恢复默认文字颜色').getAttribute('aria-pressed')).toBe('true');
  expect(button('红色文字').getAttribute('aria-pressed')).toBe('false');
  expect(value.value).toBe(saved);
});

it('leaves mixed text colors unselected while marking the shared background color', async () => {
  const source = '<span style="background-color: #e3f2fd">'
    + '<span style="color: #dc2626">甲</span>乙<span style="color: #dc2626">丙</span></span>\n';
  const { editor, context, value } = await mount(source);
  const view = editor.value!.withContext(ctx => ctx.get(editorViewCtx));
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 4)));
  await nextTick();
  await click(button('更多格式'));
  await click(button('文字颜色'));
  expect(context.value.textColor).toBeUndefined();
  expect(context.value.backgroundColor).toBe('#e3f2fd');
  expect(root.querySelectorAll('.text-color-grid:not(.background-color-grid) [aria-pressed="true"]')).toHaveLength(0);
  expect(button('蓝色背景').getAttribute('aria-pressed')).toBe('true');
  expect(button('恢复默认背景颜色').getAttribute('aria-pressed')).toBe('false');
  expect(value.value).toBe(source);
});

it('uses inline tools for selected editable Markdown and applies the bold button', async () => {
  const { value, context, errors } = await mount('Before **31 124234** after\n');
  const strong = root.querySelector('.ProseMirror strong')!;
  await selectText(strong, 2, 2);
  const source = root.querySelector<HTMLElement>('span[data-tano-live-inline-source]')!;
  expect(source.textContent).toBe('**31 124234**');
  await selectText(source.querySelector('.tano-live-source-strong')!, 3, 9);
  expect(context.value.level).toBe('inline');
  expect(context.value.inlineSource).toBe(true);
  expect(context.value.activeInline).toContain('Bold');
  expect(button('粗体').disabled).toBe(false);
  expect(button('块级类型')).not.toBeNull();
  await click(button('粗体'));
  expect(value.value).toBe('Before **31** 124234 after\n');
  expect(root.querySelector('span[data-tano-live-inline-source]')?.textContent).toBe(
    '**31** 124234',
  );
  expect(context.value.activeInline).not.toContain('Bold');
  root
    .querySelector<HTMLElement>('.ProseMirror')!
    .dispatchEvent(new FocusEvent('blur', { bubbles: true }));
  await nextTick();
  expect(root.querySelector('.ProseMirror strong')?.textContent).toBe('31');
  expect(root.querySelector('.ProseMirror p')?.textContent).toBe('Before 31 124234 after');
  expect(errors).toEqual([]);
});

it('keeps the selected range when applying marks or opening and submitting a link form', async () => {
  const { value, context, errors } = await mount('选中文字及其后文\n');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 4);
  await click(button('粗体'));
  expect(value.value).toContain('**选中文字**及其后文');
  expect(context.value.activeInline).toContain('Bold');
  await click(button('链接'));
  await fillForm('https://example.com');
  expect(value.value).toContain('选中文字');
  expect(root.querySelector('.ProseMirror a')?.textContent).toBe('选中文字');
  expect(root.querySelector('.ProseMirror a')?.getAttribute('href')).toBe('https://example.com');
  expect(root.querySelector('.ProseMirror p')?.textContent).toBe('选中文字及其后文');
  expect(errors).toEqual([]);
});

it('converts a selected list without losing nested content and inserts blocks without replacing it', async () => {
  const { value, editor, context, errors } = await mount('- **第一项**\n  - 子项\n- 第二项\n');
  await handle();
  editor.value!.command('todo-list');
  await nextTick();
  expect(context.value.block).toBe('TodoList');
  expect(value.value).toContain('[ ] **第一项**');
  expect(value.value).toContain('子项');
  expect(root.querySelector('.ProseMirror ul ul')).not.toBeNull();
  editor.value!.command('ordered-list');
  await nextTick();
  expect(context.value.block).toBe('OrderedList');
  expect(value.value).toContain('1. **第一项**');
  const previous = value.value;
  editor.value!.command('table');
  await nextTick();
  expect(context.value.block).toBe('Table');
  expect(root.querySelector('.ProseMirror table')).not.toBeNull();
  expect(value.value).toContain(previous.trim());
  editor.value!.command('horizontal-rule');
  await nextTick();
  expect(root.querySelector('.ProseMirror table')).not.toBeNull();
  expect(root.querySelector('.ProseMirror hr')).not.toBeNull();
  expect(errors).toEqual([]);
});

it('preserves footnotes, callouts, Mermaid and mentions through Markdown normalization', async () => {
  const { value, editor, context, errors } = await mount('正文\n');
  await selectText(root.querySelector('.ProseMirror p')!);
  await click(button('更多格式'));
  await click(button('提及文档'));
  await fillForm('计划');
  expect(value.value).toContain('[[计划|正文]]');
  await handle();
  editor.value!.command('callout');
  await nextTick();
  expect(context.value.block).toBe('Callout');
  expect(root.querySelector('.tano-callout')).not.toBeNull();
  // Select a different plain paragraph to add a footnote.
  value.value += '\n脚注文字\n';
  await nextTick();
  await selectText(root.querySelector('.ProseMirror > p')!);
  await click(button('更多格式'));
  await click(button('脚注引用'));
  await fillForm('说明内容');
  expect(value.value).toContain('脚注文字[^1]');
  expect(value.value).toContain('[^1]: 说明内容');
  expect(context.value.level).toBe('inline');
  expect(context.value.activeInline).toContain('FootnoteReference');
  value.value += '\n```mermaid\ngraph TD\n A --> B\n```\n';
  await nextTick();
  const handles = root.querySelectorAll('.tano-block-handle');
  await handle(handles.length - 1);
  expect(context.value.block).toBe('MermaidBlock');
  const codec = await createHeadlessMarkdown();
  try {
    expect(codec.normalize(value.value)).toBe(value.value);
  } finally {
    await codec.destroy();
  }
  expect(errors).toEqual([]);
});

it('treats a cross-paragraph range and code text as block selections without moving selection for math editing', async () => {
  const { context, editor, revealMarkdown } = await mount('First\n\nSecond\n\n```js\ncode\n```\n');
  const paragraphs = root.querySelectorAll('.ProseMirror > p');
  root.querySelector<HTMLElement>('.ProseMirror')!.focus();
  const range = document.createRange();
  range.setStart(paragraphs[0]!.firstChild!, 1);
  range.setEnd(paragraphs[1]!.firstChild!, 3);
  window.getSelection()!.removeAllRanges();
  window.getSelection()!.addRange(range);
  document.dispatchEvent(new Event('selectionchange'));
  await nextTick();
  expect(context.value.level).toBe('block');
  expect(context.value.multiple).toBe(true);
  await selectText(root.querySelector('.ProseMirror pre code')!);
  expect(context.value.level).toBe('block');
  await selectText(paragraphs[0]!, 0, 5);
  editor.value!.command('math');
  await nextTick();
  // Opening the formula panel keeps the editor's existing selection.
  revealMarkdown.value = false;
  await nextTick();
  await click(root.querySelector<HTMLElement>('.math-preview')!);
  expect(root.querySelector('.math-editor-panel:not([hidden])')).not.toBeNull();
  expect(context.value.level).toBe('block');
  expect(context.value.activeInline).not.toContain('InlineMath');
}, 20_000); // The first rendered formula loads the math module on a cold test worker.

it('keeps read-only and source modes non-editable and closes stale menus', async () => {
  const { readonly, source, value, editor } = await mount('正文\n');
  await click(button('块级类型'));
  expect(root.querySelector('.block-type-menu')).not.toBeNull();
  readonly.value = true;
  await nextTick();
  expect(root.querySelector('.block-type-menu')).toBeNull();
  expect(button('块级类型').disabled).toBe(true);
  editor.value!.command('heading');
  expect(value.value).toBe('正文\n');
  source.value = true;
  await nextTick();
  expect(button('块级类型')).toBeNull();
  expect(button('粗体')).toBeNull();
});

it('filters Level 1 tools and commands while keeping existing enhanced Markdown readable', async () => {
  const { value, editor, levels, errors } = await mount(
    '正文\n\n<details>\n<summary>保留</summary>\n\n内容\n\n</details>\n',
  );
  levels.value = [0];
  await nextTick();
  await click(button('块级类型'));
  expect(root.querySelector('.block-type-menu [data-feature-level="1"]')).toBeNull();
  expect(button('提及文档')).toBeNull();
  const saved = value.value;
  editor.value!.command('tabs');
  editor.value!.command('callout');
  editor.value!.command('mention', '计划');
  expect(value.value).toBe(saved);
  expect(root.querySelector('.tano-toggle')?.textContent).toContain('内容');
  levels.value = [0, 1];
  await nextTick();
  editor.value!.command('columns');
  await nextTick();
  expect(value.value).toContain(':::columns');
  expect(value.value).toContain('<summary>保留</summary>');
  expect(errors).toEqual([]);
});

function floatingButton(label: string) {
  return document.querySelector<HTMLButtonElement>(`.selection-toolbar button[aria-label="${label}"]`)!;
}
async function expectFloating() {
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).not.toBeNull());
}

it('shows a compact selection toolbar only for text, and preserves the selection when applying bold', async () => {
  const { value, errors } = await mount('正文文字\n', 'selection');
  expect(root.querySelector('.editor-toolbar')).toBeNull();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  expect(floatingButton('粗体')).not.toBeNull();
  expect(floatingButton('更多格式')).not.toBeNull();
  expect(floatingButton('行内公式')).toBeNull();
  await click(floatingButton('粗体'));
  expect(value.value).toContain('**正文**文字');
  expect(errors).toEqual([]);
});

it('keeps a selected range while entering a link and commits it to that range', async () => {
  const { value, errors } = await mount('正文文字\n', 'selection');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  await click(floatingButton('链接'));
  const input = document.querySelector<HTMLInputElement>('.selection-toolbar input')!;
  expect(document.activeElement).toBe(input);
  window.getSelection()!.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
  await expectFloating();
  input.value = 'https://example.com';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toContain('[正文](https://example.com)文字');
  expect(errors).toEqual([]);
});

it('dismisses with Escape until the selection changes and hides when a pane becomes inactive, read-only, or source', async () => {
  const { active, source, readonly } = await mount('正文文字\n', 'selection');
  const paragraph = root.querySelector('.ProseMirror p')!;
  await selectText(paragraph, 0, 2);
  await expectFloating();
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  window.dispatchEvent(new Event('resize'));
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  await selectText(paragraph, 0, 3);
  await expectFloating();
  active.value = false;
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  active.value = true;
  await expectFloating();
  readonly.value = true;
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  readonly.value = false;
  await expectFloating();
  source.value = true;
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
});

it('switches from the capsule menu to fixed mode and back without editing content or losing the selection', async () => {
  const { toolbarMode, value } = await mount('正文文字\n', 'selection');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  await click(floatingButton('拖动工具栏'));
  await click(floatingButton('固定到顶部'));
  expect(toolbarMode.value).toBe('fixed');
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  expect(root.querySelector('.editor-toolbar')).not.toBeNull();
  expect(button('粗体')).not.toBeNull();
  await click(button('拖动工具栏'));
  button('随选区显示').focus();
  await click(button('随选区显示'));
  expect(toolbarMode.value).toBe('selection');
  await expectFloating();
  expect(document.activeElement).toBe(root.querySelector('.ProseMirror'));
  expect(value.value).toBe('正文文字\n');
  await click(floatingButton('粗体'));
  expect(value.value).toContain('**正文**文字');
});

async function pointer(target: EventTarget, type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'pointerId', { value: 1 });
  target.dispatchEvent(event);
  await nextTick();
}

it('previews a drop, commits only on release, and keeps text selected through top, side, and bottom docking', async () => {
  const { toolbarMode, value } = await mount('正文文字\n', 'selection');
  root.classList.add('workspace-pane');
  const outline = document.createElement('aside');
  outline.className = 'inspector-outline';
  root.append(outline);
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  await pointer(floatingButton('拖动工具栏'), 'pointerdown', 130, 160);
  await pointer(window, 'pointermove', 130, 14);
  expect(document.querySelector('.toolbar-dock-preview')?.getAttribute('data-target')).toBe('fixed');
  const topPreview = document.querySelector<HTMLElement>('.toolbar-dock-preview')!;
  expect(topPreview.querySelector('.editor-toolbar')).not.toBeNull();
  expect(topPreview.querySelector('[inert][aria-hidden="true"]')).not.toBeNull();
  expect(document.querySelector('.toolbar-drop-hint')).toBeNull();
  expect(topPreview.style.top).toBe('0px');
  expect(topPreview.style.width).toBe('800px');
  expect(toolbarMode.value).toBe('selection');
  await pointer(window, 'pointerup', 130, 14);
  expect(toolbarMode.value).toBe('fixed');
  expect(document.querySelector('.toolbar-drag-preview')).toBeNull();
  await pointer(button('拖动工具栏'), 'pointerdown', 40, 20);
  await pointer(window, 'pointermove', 785, 260);
  const preview = document.querySelector<HTMLElement>('.toolbar-dock-preview')!;
  expect(preview.querySelector('.selection-format-toolbar[aria-orientation="vertical"]')).not.toBeNull();
  expect(preview.querySelector<HTMLButtonElement>('button[aria-label="粗体"]')?.disabled).toBe(false);
  expect(document.querySelector('.toolbar-drag-ghost')).toBeNull();
  expect(document.querySelector('.toolbar-drop-hint')).toBeNull();
  preview.getBoundingClientRect = () => new DOMRect(0, 0, 46, 250);
  await pointer(window, 'pointermove', 785, 270);
  const centeredTop = preview.style.top;
  await pointer(window, 'pointermove', 785, 550);
  expect(preview.style.top).toBe(centeredTop);
  expect(Number.parseFloat(preview.style.top) + 250 / 2).toBe(300);
  expect(Number.parseFloat(preview.style.left) + 46).toBe(792);
  await pointer(window, 'pointerup', 785, 550);
  expect(toolbarMode.value).toBe('right');
  await expectFloating();
  expect(document.querySelector('.selection-toolbar')?.getAttribute('data-dock')).toBe('right');
  await pointer(floatingButton('拖动工具栏'), 'pointerdown', 785, 300);
  await pointer(window, 'pointermove', 400, 590);
  const bottomPreview = document.querySelector<HTMLElement>('.toolbar-dock-preview')!;
  expect(bottomPreview.dataset.target).toBe('bottom');
  expect(bottomPreview.querySelector('.selection-format-toolbar[aria-orientation="horizontal"]')).not.toBeNull();
  bottomPreview.getBoundingClientRect = () => new DOMRect(0, 0, 270, 42);
  await pointer(window, 'pointermove', 420, 590);
  expect(bottomPreview.style.left).toBe('265px');
  expect(bottomPreview.style.top).toBe('550px');
  expect(toolbarMode.value).toBe('right');
  await pointer(window, 'pointerup', 420, 590);
  expect(toolbarMode.value).toBe('bottom');
  await expectFloating();
  expect(document.querySelector('.selection-toolbar')?.getAttribute('data-dock')).toBe('bottom');
  expect(window.getSelection()?.toString()).toBe('正文');
  await click(floatingButton('粗体'));
  expect(value.value).toContain('**正文**文字');
});

it('cancels drags on Escape, outside drops, pointer cancellation and pane changes without changing content', async () => {
  const { toolbarMode, value, active } = await mount('正文文字\n', 'fixed');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  for (const reason of ['escape', 'outside', 'pointercancel', 'inactive']) {
    active.value = true;
    await nextTick();
    await pointer(button('拖动工具栏'), 'pointerdown', 50, 20);
    await pointer(window, 'pointermove', 15, 260);
    expect(document.querySelector('.toolbar-dock-preview')).not.toBeNull();
    if (reason === 'escape') {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    } else if (reason === 'outside') {
      await pointer(window, 'pointerup', 900, 260);
    } else if (reason === 'pointercancel') {
      await pointer(window, 'pointercancel', 15, 260);
    } else active.value = false;
    await nextTick();
    expect(toolbarMode.value).toBe('fixed');
    expect(document.querySelector('.toolbar-drag-preview')).toBeNull();
    await pointer(window, 'pointerup', 15, 260);
    expect(toolbarMode.value).toBe('fixed');
  }
  expect(value.value).toBe('正文文字\n');
});

it.each(['fixed', 'left', 'bottom', 'selection'] as const)('follows the pointer from %s mode and returns to the selection only on release', async (mode) => {
  const { toolbarMode, value } = await mount('正文文字\n', mode);
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  if (mode !== 'fixed') await expectFloating();
  await pointer(mode === 'fixed' ? button('拖动工具栏') : floatingButton('拖动工具栏'), 'pointerdown', 40, 20);
  await pointer(window, 'pointermove', 400, 300);
  const preview = document.querySelector<HTMLElement>('.toolbar-drag-preview')!;
  preview.getBoundingClientRect = () => new DOMRect(0, 0, 270, 42);
  await pointer(window, 'pointermove', 430, 350);
  expect(preview.classList.contains('toolbar-preview-inactive')).toBe(false);
  expect(preview.querySelector('.selection-format-toolbar[aria-orientation="horizontal"]')).not.toBeNull();
  expect(preview.style.left).toBe('444px');
  expect(preview.style.top).toBe('368px');
  await pointer(window, 'pointermove', 500, 400);
  expect(preview.style.left).toBe('514px');
  expect(preview.style.top).toBe('418px');
  await pointer(window, 'pointermove', 15, 260);
  expect(preview.dataset.target).toBe('left');
  expect(preview.querySelector('[aria-orientation="vertical"]')).not.toBeNull();
  await pointer(window, 'pointermove', 450, 320);
  expect(preview.dataset.target).toBe('selection');
  expect(preview.querySelector('[aria-orientation="horizontal"]')).not.toBeNull();
  expect(preview.style.left).toBe('464px');
  expect(preview.style.top).toBe('338px');
  expect(toolbarMode.value).toBe(mode);
  expect(document.querySelector('.toolbar-drop-hint')).toBeNull();
  await pointer(window, 'pointerup', 450, 320);
  expect(toolbarMode.value).toBe('selection');
  await expectFloating();
  expect(window.getSelection()?.toString()).toBe('正文');
  await click(floatingButton('粗体'));
  expect(value.value).toContain('**正文**文字');
});

it('ignores handle clicks and waits for the next text selection after a body drop with no selected text', async () => {
  const { toolbarMode, value } = await mount('正文文字\n', 'fixed');
  await pointer(button('拖动工具栏'), 'pointerdown', 40, 20);
  await pointer(window, 'pointermove', 43, 21);
  await pointer(window, 'pointerup', 43, 21);
  expect(toolbarMode.value).toBe('fixed');
  expect(document.querySelector('.toolbar-drag-ghost')).toBeNull();
  await pointer(button('拖动工具栏'), 'pointerdown', 40, 20);
  await pointer(window, 'pointermove', 400, 250);
  expect(document.querySelector('.toolbar-drop-hint')).toBeNull();
  expect(document.querySelector('.toolbar-drag-preview.toolbar-preview-inactive')).not.toBeNull();
  expect(document.querySelector('.toolbar-drag-status')?.textContent).toContain('选中文字时显示');
  await pointer(window, 'pointerup', 400, 250);
  expect(toolbarMode.value).toBe('selection');
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  expect(value.value).toBe('正文文字\n');
});

it.each(['left', 'right', 'bottom'] as const)('shows %s tools only while the editor or toolbar owns focus', async (mode) => {
  const { value } = await mount('正文文字\n', mode);
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  const paragraph = root.querySelector('.ProseMirror p')!;
  const content = root.querySelector<HTMLElement>('.ProseMirror')!;
  await selectText(paragraph, 2, 2);
  await expectFloating();
  expect(floatingButton('块级类型')).not.toBeNull();
  content.blur();
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  await selectText(paragraph, 0, 2);
  await expectFloating();
  await click(floatingButton('链接'));
  const input = document.querySelector<HTMLInputElement>('.selection-toolbar input')!;
  expect(document.activeElement).toBe(input);
  window.getSelection()!.removeAllRanges();
  document.dispatchEvent(new Event('selectionchange'));
  await expectFloating();
  input.value = 'https://example.com';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.closest('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toContain('[正文](https://example.com)文字');
  await expectFloating();
  const outside = document.createElement('button');
  root.append(outside);
  outside.focus();
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  content.focus();
  await expectFloating();
  window.dispatchEvent(new Event('blur'));
  window.dispatchEvent(new Event('resize'));
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  await new Promise(resolve => setTimeout(resolve, 35));
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  window.dispatchEvent(new Event('focus'));
  await expectFloating();
});

it('offers all other placements in the side menu while editing', async () => {
  const { toolbarMode, source, readonly, value } = await mount('正文文字\n', 'left');
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  await selectText(root.querySelector('.ProseMirror p')!, 0, 0);
  await expectFloating();
  expect(floatingButton('块级类型')).not.toBeNull();
  await click(floatingButton('拖动工具栏'));
  expect(floatingButton('随选区显示')).not.toBeNull();
  expect(floatingButton('固定到顶部')).not.toBeNull();
  await click(floatingButton('吸附在底部'));
  expect(toolbarMode.value).toBe('bottom');
  await expectFloating();
  await click(floatingButton('拖动工具栏'));
  expect(floatingButton('吸附在底部')).toBeNull();
  expect(floatingButton('靠左停靠')).not.toBeNull();
  await click(floatingButton('靠右停靠'));
  expect(toolbarMode.value).toBe('right');
  await click(floatingButton('拖动工具栏'));
  expect(floatingButton('靠左停靠')).not.toBeNull();
  readonly.value = true;
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  readonly.value = false;
  source.value = true;
  await nextTick();
  expect(document.querySelector('.selection-toolbar')).toBeNull();
  expect(value.value).toBe('正文文字\n');
});

it('opens placement options from the drag handle and switches mode', async () => {
  const { toolbarMode } = await mount('正文文字\n', 'fixed');
  await click(button('拖动工具栏'));
  expect(button('靠左停靠')).not.toBeNull();
  expect(button('靠右停靠')).not.toBeNull();
  expect(button('吸附在底部')).not.toBeNull();
  expect(button('随选区显示')).not.toBeNull();
  await click(button('吸附在底部'));
  expect(toolbarMode.value).toBe('bottom');
});

it('opens placement options after a real pointer tap without movement', async () => {
  await mount('正文文字\n', 'fixed');
  await pointer(button('拖动工具栏'), 'pointerdown', 40, 20);
  await pointer(window, 'pointerup', 40, 20);
  expect(button('靠左停靠')).not.toBeNull();
});

it('does not open placement options for a pointer release that started elsewhere', async () => {
  await mount('正文文字\n', 'fixed');
  const handle = button('拖动工具栏')!;
  await pointer(handle, 'pointerup', 40, 20);
  handle.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  await nextTick();
  expect(document.querySelector('.toolbar-dock-menu')).toBeNull();
});

it('forgets the open docking menu when the selection toolbar disappears', async () => {
  await mount('正文文字\n', 'selection');
  const paragraph = root.querySelector('.ProseMirror p')!;
  await selectText(paragraph, 0, 2);
  await expectFloating();
  await click(floatingButton('拖动工具栏'));
  expect(document.querySelector('.toolbar-dock-menu')).not.toBeNull();
  window.dispatchEvent(new Event('blur'));
  await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  window.dispatchEvent(new Event('focus'));
  await selectText(paragraph, 1, 3);
  await expectFloating();
  expect(document.querySelector('.toolbar-dock-menu')).toBeNull();
});

it.each(['left', 'right', 'bottom'] as const)('keeps the toolbar visible when switching from %s to fixed mode', async (mode) => {
  const { toolbarMode } = await mount('正文文字\n', mode);
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  await click(floatingButton('拖动工具栏'));
  await click(floatingButton('固定到顶部'));
  expect(toolbarMode.value).toBe('fixed');
  expect(root.querySelector('.editor-toolbar')).not.toBeNull();
  expect(button('拖动工具栏')).not.toBeNull();
});

it('keeps the drag menu and formatting menus mutually exclusive', async () => {
  await mount('正文文字\n', 'selection');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
  await expectFloating();
  await click(floatingButton('拖动工具栏'));
  const dockMenu = document.querySelector<HTMLElement>('.toolbar-dock-menu')!;
  expect(dockMenu).not.toBeNull();
  expect(dockMenu.classList.contains('compact-action-menu')).toBe(true);
  await click(floatingButton('更多格式'));
  expect(document.querySelector('.toolbar-dock-menu')).toBeNull();
  expect(document.querySelector('.text-style-dropdown')).not.toBeNull();
  await click(floatingButton('拖动工具栏'));
  expect(document.querySelector('.text-style-dropdown')).toBeNull();
  expect(document.querySelector('.toolbar-dock-menu')).not.toBeNull();
});

it('anchors the horizontal bottom toolbar and upward menus to its pane on scroll and resize', async () => {
  await mount('正文文字\n', 'bottom');
  root.classList.add('document-layout');
  root.getBoundingClientRect = () => new DOMRect(100, 50, 420, 320);
  await selectText(root.querySelector('.ProseMirror p')!, 0, 0);
  await expectFloating();
  const panel = document.querySelector<HTMLElement>('.selection-toolbar')!;
  panel.getBoundingClientRect = () => new DOMRect(175, 320, 270, 42);
  root.dispatchEvent(new Event('scroll'));
  await vi.waitFor(() => expect(panel.style.getPropertyValue('--selection-menu-height')).toBe('256px'));
  expect(panel.style.left).toBe('310px');
  expect(panel.style.top).toBe('362px');
  expect(panel.dataset.menuSide).toBe('above');
  expect(panel.getAttribute('aria-label')).toBe('底部工具栏');
  expect(panel.querySelector('[aria-orientation="horizontal"]')).not.toBeNull();
  expect(panel.style.getPropertyValue('--selection-toolbar-width')).toBe('337px');
  await click(floatingButton('更多格式'));
  expect(panel.querySelector('.dropdown')).not.toBeNull();
  root.getBoundingClientRect = () => new DOMRect(100, 50, 320, 220);
  window.dispatchEvent(new Event('resize'));
  await vi.waitFor(() => expect(panel.style.top).toBe('262px'));
  expect(panel.style.left).toBe('260px');
  expect(panel.style.getPropertyValue('--selection-menu-height')).toBe('156px');
  expect(panel.style.getPropertyValue('--selection-toolbar-width')).toBe('287px');
});

it('positions newly opened docked menus using their trigger and actual height', async () => {
  await mount('正文文字\n', 'left');
  await selectText(root.querySelector('.ProseMirror p')!, 0, 0);
  await expectFloating();
  const panel = document.querySelector<HTMLElement>('.selection-toolbar')!;
  panel.getBoundingClientRect = () => new DOMRect(8, 243, 46, 114);
  const more = floatingButton('更多格式');
  more.getBoundingClientRect = () => new DOMRect(16, 283, 30, 30);
  await click(more);
  const menu = panel.querySelector<HTMLElement>('.text-style-dropdown')!;
  Object.defineProperty(menu, 'offsetHeight', { value: 147 });
  // Opening a menu must trigger positioning even when the toolbar itself has not resized.
  await vi.waitFor(() => expect(menu.style.getPropertyValue('--dock-menu-top')).toBe('40px'));
  await click(more);
  const blockTrigger = floatingButton('块级类型');
  blockTrigger.getBoundingClientRect = () => new DOMRect(16, 250, 30, 30);
  await click(blockTrigger);
  const blockMenu = panel.querySelector<HTMLElement>('.block-type-menu')!;
  Object.defineProperty(blockMenu, 'offsetHeight', { value: 700 });
  await vi.waitFor(() => expect(blockMenu.style.getPropertyValue('--dock-menu-top')).toBe('-235px'));
  expect(panel.style.getPropertyValue('--selection-menu-height')).toBe('584px');
});

it('disables a fading toolbar and keeps a reopened toolbar when the previous exit finishes', async () => {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'animate');
  const nativeAnimations: { onfinish: (() => void) | null; cancel: ReturnType<typeof vi.fn> }[] = [];
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: vi.fn(() => {
      const animation = {
        onfinish: null as (() => void) | null,
        cancel: vi.fn(),
        playState: 'running',
        playbackRate: 1,
        currentTime: 0,
      };
      nativeAnimations.push(animation);
      return animation;
    }),
  });
  const finishAnimations = () => nativeAnimations.splice(0).forEach(animation => animation.onfinish?.());
  try {
    const { value } = await mount('正文文字\n', 'left');
    const content = root.querySelector<HTMLElement>('.ProseMirror')!;
    await selectText(root.querySelector('.ProseMirror p')!, 0, 2);
    await expectFloating();
    finishAnimations();
    await nextTick();
    const outgoing = document.querySelector('.selection-toolbar')!;
    const bold = floatingButton('粗体');
    content.blur();
    await vi.waitFor(() => expect(outgoing.hasAttribute('inert')).toBe(true));
    expect(outgoing.getAttribute('aria-hidden')).toBe('true');
    expect(outgoing.isConnected).toBe(true);
    await click(bold);
    expect(value.value).toBe('正文文字\n');
    content.focus();
    await vi.waitFor(() => expect(document.querySelector('.selection-toolbar:not([inert])')).not.toBeNull());
    const reopened = document.querySelector('.selection-toolbar:not([inert])')!;
    finishAnimations();
    await nextTick();
    expect(reopened.isConnected).toBe(true);
    expect(reopened.hasAttribute('inert')).toBe(false);
    content.blur();
    await vi.waitFor(() => expect(reopened.hasAttribute('inert')).toBe(true));
    finishAnimations();
    await vi.waitFor(() => expect(document.querySelector('.selection-toolbar')).toBeNull());
  } finally {
    if (descriptor) Object.defineProperty(Element.prototype, 'animate', descriptor);
    else Reflect.deleteProperty(Element.prototype, 'animate');
  }
});
