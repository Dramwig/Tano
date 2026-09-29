// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import MarkdownEditor from '@tano/editor';
import { defaultSelectionContext } from '@tano/editor/document-model';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import EditorToolbar from './EditorToolbar.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(async () => {
  app?.unmount();
  app = undefined;
  root?.remove();
  await nextTick();
});
async function mount(content: string) {
  root = document.createElement('div');
  document.body.append(root);
  const value = ref(content);
  const readonly = ref(false);
  const source = ref(false);
  const levels = ref([0, 1]);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const context = ref<EditorSelectionContext>({ ...defaultSelectionContext });
  const errors: string[] = [];
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  app = createApp(
    defineComponent(() => () => [
      h(EditorToolbar, {
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
  return { value, editor, context, errors, readonly, source, levels };
}
function button(label: string) {
  return root.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
}
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
  expect(button('块级类型')).toBeNull();
  expect(button('行内公式')).not.toBeNull();
  await selectText(paragraph, 2, 2);
  expect(context.value.level).toBe('block');
  expect(value.value).toBe('# Heading\n\n正文文字\n');
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
  expect(button('块级类型')).toBeNull();
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
  const { context, editor } = await mount('First\n\nSecond\n\n```js\ncode\n```\n');
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
  await click(root.querySelector<HTMLElement>('.tano-math button')!);
  expect(root.querySelector('.math-editor-panel:not([hidden])')).not.toBeNull();
  expect(context.value.level).toBe('block');
  expect(context.value.activeInline).not.toContain('InlineMath');
});

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
  expect(root.querySelector('.editor-toolbar button')).toBeNull();
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
