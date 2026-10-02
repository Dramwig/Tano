// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import { useWorkspaceStore } from '../stores/workspace';
import ImportPanel from './ImportPanel.vue';
import type { ImportRecord } from './ImportPanel.vue';

let app: ReturnType<typeof createApp>;
let pinia: ReturnType<typeof createPinia>;
let root: HTMLDivElement;
beforeEach(async () => {
  localStorage.clear();
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open'); } });
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  await useWorkspaceStore().openWorkspace();
  root = document.createElement('div');
  document.body.append(root);
});
afterEach(() => { app?.unmount(); root.remove(); useWorkspaceStore().dispose(); disposePinia(pinia); vi.restoreAllMocks(); });
async function mount() {
  const records = reactive<ImportRecord[]>([]);
  const close = vi.fn();
  app = createApp({ render: () => h(ImportPanel, { records, onClose: close, onCompleted: record => records.push(record) }) });
  app.use(pinia);
  app.mount(root);
  await nextTick();
  return { records, close };
}

it('opens a modal with searchable file formats, third-party exports, and demo storage label', async () => {
  await mount();
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  expect(document.querySelector('.import-nav')).toBeNull();
  expect(document.body.textContent).toContain('浏览器演示 · 本浏览器存储');
  expect(document.querySelectorAll('.import-source')).toHaveLength(15);
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索导入来源"]')!;
  search.value = 'Trello';
  search.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  expect(document.querySelectorAll('.import-source')).toHaveLength(2);
});

it('previews a selected file before writing and records the completed import', async () => {
  const { records } = await mount();
  const bytes = new TextEncoder().encode('# Imported');
  const file = new File([bytes], 'Sample.md');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.import-submit')).not.toBeNull());
  const store = useWorkspaceStore();
  expect(store.workspace!.files.some(file => file.path === '导入/Sample.md')).toBe(false);
  (document.querySelector('.import-submit') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(records).toHaveLength(1));
  expect(records[0].paths).toEqual(['导入/Sample.md']);
  expect(store.active?.content).toBe('# Imported');
  expect(document.querySelector('.import-record')).not.toBeNull();
  expect(document.querySelectorAll('.import-source')).toHaveLength(15);
});

it('disables file selection in a read-only workspace and closes on Escape cancel', async () => {
  useWorkspaceStore().workspace!.readOnly = true;
  const { close } = await mount();
  expect((document.querySelector('.import-dropzone') as HTMLButtonElement).disabled).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('.import-source')].every(button => button.disabled)).toBe(true);
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});
