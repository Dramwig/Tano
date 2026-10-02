// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref } from 'vue';
import type { App } from 'vue';
import DescriptionEditor from './DescriptionEditor.vue';
let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
it('searches documents and inserts a stable escaped reference at the captured text selection', async () => {
  root = document.createElement('div'); document.body.append(root);
  const value = ref('before placeholder after');
  app = createApp(() => h(DescriptionEditor, { modelValue: value.value, targets: [
    { workspace: 'ws', type: 'document', id: 'a00001', name: 'Plan [2026]', path: 'Plan.md' },
    { workspace: 'ws', type: 'event', id: 'b00001', name: 'Task', path: '.tano/objects/b00001.tano.json' },
  ], 'onUpdate:modelValue': next => { value.value = next; } }));
  app.mount(root);
  const textarea = root.querySelector('textarea')!;
  textarea.setSelectionRange(7, 18);
  root.querySelector<HTMLButtonElement>('[aria-label="插入文档引用"]')!.click();
  await nextTick();
  const search = root.querySelector<HTMLInputElement>('[aria-label="搜索引用文档"]')!;
  search.value = 'Plan'; search.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  expect(root.querySelectorAll('.description-candidates button')).toHaveLength(1);
  search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await nextTick();
  expect(value.value).toBe('before [@Plan \\[2026\\]](object://document/a00001) after');
  expect(document.activeElement).toBe(textarea);
});
it('shows a readable reference without normalizing the source, and preserves it through editing', async () => {
  Range.prototype.getBoundingClientRect = () => new DOMRect();
  Range.prototype.getClientRects = () => [] as unknown as DOMRectList;
  root = document.createElement('div'); document.body.append(root);
  const original = 'Read [@Old title](object://document/a00001).\n\n> Context\n';
  const value = ref(original), openReference = vi.fn();
  app = createApp(() => h(DescriptionEditor, { preview: true, modelValue: value.value, targets: [
    { workspace: 'ws', type: 'document', id: 'a00001', name: 'Current title', path: 'Plan.md' },
  ], 'onUpdate:modelValue': next => { value.value = next; }, onOpenReference: openReference }));
  app.mount(root);
  await vi.waitFor(() => expect(root.querySelector('.tano-reference button')).not.toBeNull());
  expect(root.querySelector('.description-preview')?.textContent).toContain('Current title');
  expect(root.querySelector('.description-preview')?.textContent).not.toContain('object://');
  expect(value.value).toBe(original);
  root.querySelector<HTMLButtonElement>('.tano-reference button')!.click(); await nextTick();
  expect(openReference).toHaveBeenCalledWith({ type: 'document', id: 'a00001' });
  root.querySelector<HTMLButtonElement>('[aria-label=编辑描述]')!.click(); await nextTick();
  const field = root.querySelector<HTMLTextAreaElement>('textarea')!;
  expect(field.value).toBe(original);
  field.value += '\nAdditional context'; field.dispatchEvent(new Event('input', { bubbles: true })); await nextTick();
  root.querySelector<HTMLButtonElement>('[aria-label=完成描述编辑]')!.click(); await nextTick();
  expect(value.value).toBe(original + '\nAdditional context');
  expect(root.querySelector('textarea')).toBeNull();
});
