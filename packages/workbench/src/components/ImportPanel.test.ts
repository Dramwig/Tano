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

it('opens a compact modal with file formats and third-party exports', async () => {
  await mount();
  expect(document.querySelector('dialog[open]')).not.toBeNull();
  expect(document.querySelector('.import-nav')).toBeNull();
  expect(document.body.textContent).not.toContain('浏览器演示 · 本浏览器存储');
  expect(document.body.textContent).not.toContain('文件与第三方应用导出');
  expect(document.querySelectorAll('.import-source')).toHaveLength(20);
  expect(document.querySelector('[aria-label="搜索导入来源"]')).toBeNull();
});

it.each([
  ['Asana', '.csv'], ['Workflowy', '.opml,.txt'], ['Jira', '.csv'],
  ['Monday.com', '.xlsx,.csv'], ['Quip', '.docx,.html,.htm'], ['Google Docs', '.docx,.html,.htm,.zip,.txt,.md'],
])('selects supported export files for %s', async (name, accept) => {
  await mount();
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  const select = vi.spyOn(input, 'click').mockImplementation(() => {});
  const button = [...document.querySelectorAll<HTMLButtonElement>('.import-source')].find(button => button.querySelector('strong')?.textContent === name)!;
  button.click();
  await nextTick();
  const fileTab = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent === '通过文件导入')!;
  await vi.waitFor(() => expect(fileTab.disabled).toBe(false));
  fileTab.click();
  await nextTick();
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('选择导出文件'))!.click();
  await nextTick();
  expect(input.accept).toBe(accept);
  expect(select).toHaveBeenCalledOnce();
});

it('opens a dedicated import detail panel before writing and records the completed import', async () => {
  const { records } = await mount();
  const bytes = new TextEncoder().encode('# Imported');
  const file = new File([bytes], 'Sample.md');
  Object.defineProperty(file, 'arrayBuffer', { value: async () => bytes.buffer });
  const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: [file] });
  input.dispatchEvent(new Event('change', { bubbles: true }));
  await vi.waitFor(() => expect(document.querySelector('.import-submit')).not.toBeNull());
  expect(document.querySelector('.import-detail')).not.toBeNull();
  expect(document.querySelector('[aria-label="导入目录"]')).not.toBeNull();
  expect(document.body.textContent).not.toContain('导入目录');
  expect(document.body.textContent).not.toContain('所选文件');
  expect(document.querySelectorAll('.import-source')).toHaveLength(0);
  expect((document.querySelector('[aria-label="导入位置"]') as HTMLSelectElement).value).toBe('');
  const store = useWorkspaceStore();
  expect(store.workspace!.files.some(file => file.path === 'Sample.md')).toBe(false);
  (document.querySelector('.import-submit') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(records).toHaveLength(1));
  expect(records[0].paths).toEqual(['Sample.md']);
  expect(store.active?.content).toBe('# Imported');
  expect(document.querySelector('.import-record')).not.toBeNull();
  expect(document.querySelector('h2')?.textContent).toBe('导入历史');
  expect(document.querySelectorAll('.import-source')).toHaveLength(0);
  (document.querySelector('[aria-label="返回导入来源"]') as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('.import-record')).toBeNull();
  expect(document.querySelectorAll('.import-source')).toHaveLength(20);
  expect(document.querySelector('.import-history-button')?.textContent).toContain('1');
});

it('opens a separate history page with records ordered by time and scoped to this workspace', async () => {
  const { records, close } = await mount();
  const workspaceId = useWorkspaceStore().workspace!.id;
  records.push(
    { id: 'older', workspaceId, time: 1, folder: '早期导入', paths: ['moved.md', '开始使用.md'], sourceCount: 2, issues: [{ name: 'old.pdf', message: '图片未导入' }] },
    { id: 'newer', workspaceId, time: 2, folder: '最新导入', paths: ['deleted.md'], sourceCount: 1, issues: [] },
    { id: 'other', workspaceId: 'other-workspace', time: 3, folder: '其他工作区', paths: [], sourceCount: 1, issues: [] },
  );
  await nextTick();
  expect(document.querySelector('.import-record')).toBeNull();
  (document.querySelector('.import-history-button') as HTMLButtonElement).click();
  await nextTick();
  expect([...document.querySelectorAll('.import-record-heading strong')].map(node => node.textContent)).toEqual(['最新导入', '早期导入']);
  expect(document.querySelector('.import-dropzone')).toBeNull();
  expect(document.body.textContent).toContain('old.pdf：图片未导入');
  expect(document.body.textContent).not.toContain('其他工作区');
  expect(document.querySelectorAll('.import-record-pages button')).toHaveLength(3);
  (document.querySelector('.import-record-pages button') as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain('导入的文件已被移动或删除');
  expect(close).not.toHaveBeenCalled();
  const openFile = vi.spyOn(useWorkspaceStore(), 'openFile').mockResolvedValue(undefined);
  (document.querySelectorAll('[aria-label="打开导入的页面"]')[1] as HTMLButtonElement).click();
  await vi.waitFor(() => expect(openFile).toHaveBeenCalledWith(expect.objectContaining({ path: '开始使用.md' })));
  expect(close).toHaveBeenCalledOnce();
});

it('allows viewing empty history in a read-only workspace and returning to import', async () => {
  useWorkspaceStore().workspace!.readOnly = true;
  await mount();
  const historyButton = document.querySelector('.import-history-button') as HTMLButtonElement;
  expect(historyButton.disabled).toBe(false);
  historyButton.click();
  await nextTick();
  expect(document.body.textContent).toContain('暂无导入记录');
  expect(document.body.textContent).toContain('本次会话的导入记录');
  expect(document.querySelector('.import-dropzone')).toBeNull();
  (document.querySelector('.import-history-empty button') as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('h2')?.textContent).toBe('导入');
  expect((document.querySelector('.import-dropzone') as HTMLButtonElement).disabled).toBe(true);
});

it('disables file selection in a read-only workspace and closes on Escape cancel', async () => {
  useWorkspaceStore().workspace!.readOnly = true;
  const { close } = await mount();
  expect((document.querySelector('.import-dropzone') as HTMLButtonElement).disabled).toBe(true);
  expect([...document.querySelectorAll<HTMLButtonElement>('.import-source')].every(button => button.disabled)).toBe(true);
  document.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true }));
  expect(close).toHaveBeenCalledOnce();
});
