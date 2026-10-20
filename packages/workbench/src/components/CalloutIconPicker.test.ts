// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import { editorViewCtx } from '@milkdown/kit/core';
import MarkdownEditor from '@tano/editor';
import CalloutIconPicker from './CalloutIconPicker.vue';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });

async function mount() {
  root = document.createElement('div'); document.body.append(root);
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  const value = ref('> [!CUSTOM:💡]\n> **Hello**\n>\n> - Keep this list\n\nOutside\n');
  const readonly = ref(false);
  const editor = ref<InstanceType<typeof MarkdownEditor>>();
  const errors: string[] = [];
  app = createApp({ render: () => h(MarkdownEditor, {
    ref: editor, documentId: 'custom-callout-test', modelValue: value.value, readonly: readonly.value,
    customCalloutIcon: CalloutIconPicker,
    'onUpdate:modelValue': next => { value.value = next; }, onError: error => errors.push(error),
  }) });
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.callout-icon-trigger')).not.toBeNull());
  return { value, editor, readonly, errors };
}
async function open() {
  root.querySelector<HTMLButtonElement>('.callout-icon-trigger')!.click(); await nextTick();
  const panel = document.querySelector<HTMLElement>('.workspace-icon-picker')!;
  expect(panel).not.toBeNull();
  return panel;
}

it('changes emoji and built-in icons, removes them, and supports undo without changing the body', async () => {
  const { value, editor, errors } = await mount();
  let panel = await open();
  expect(panel.querySelector('[data-tab="upload"]')).toBeNull();
  const input = panel.querySelector<HTMLInputElement>('input')!;
  input.value = 'rocket'; input.dispatchEvent(new Event('input')); await nextTick();
  expect([...panel.querySelectorAll('[data-icon-value]')].map(node => node.getAttribute('data-icon-value'))).toContain('🚀');
  [...panel.querySelectorAll<HTMLButtonElement>('[data-icon-value]')].find(node => node.dataset.iconValue === '🚀')!.click(); await nextTick();
  expect(value.value).toContain('[!CUSTOM:🚀]');
  expect(value.value).toContain('**Hello**');
  expect(value.value).toContain('Keep this list');
  expect(value.value).toContain('Outside');
  expect(document.querySelector('.workspace-icon-picker')).toBeNull();
  editor.value!.undoLastChange(); await nextTick();
  expect(value.value).toContain('[!CUSTOM:💡]');
  editor.value!.redoLastChange(); await nextTick();
  expect(value.value).toContain('[!CUSTOM:🚀]');
  panel = await open();
  panel.querySelector<HTMLButtonElement>('[data-tab="icons"]')!.click(); await nextTick();
  panel.querySelector<HTMLButtonElement>('[data-icon-value="icon:star"]')!.click(); await nextTick();
  expect(value.value).toContain('[!CUSTOM:icon:star]');
  expect(root.querySelector('.callout-icon-trigger svg')).not.toBeNull();
  panel = await open();
  panel.querySelector<HTMLButtonElement>('.workspace-icon-picker-remove')!.click(); await nextTick();
  expect(value.value).toContain('[!CUSTOM:none]');
  expect(root.querySelector('.callout-icon-placeholder')).not.toBeNull();
  expect(errors).toEqual([]);
});

it('closes the picker on readonly changes and does not retain a picker after its block is removed', async () => {
  const { value, readonly, editor } = await mount();
  await open(); readonly.value = true; await nextTick();
  expect(document.querySelector('.workspace-icon-picker')).toBeNull();
  expect(root.querySelector('.callout-icon-trigger')).toBeNull();
  expect(value.value).toContain('[!CUSTOM:💡]');
  readonly.value = false; await nextTick();
  await open();
  editor.value!.withContext(ctx => {
    const view = ctx.get(editorViewCtx);
    view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize));
  });
  await nextTick();
  expect(document.querySelector('.workspace-icon-picker')).toBeNull();
  expect(value.value.trim()).toBe('Outside');
});
