// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import { configureWorkbench } from '../runtime';
import { DemoAdapter } from '../adapter';
import ImportAccountStep from './ImportAccountStep.vue';
import type { ImportAccountHost, ImportProviderId } from '../account-import/types';

let app: ReturnType<typeof createApp> | undefined;
let pinia: ReturnType<typeof createPinia>;
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ''; disposePinia(pinia); });
function mockHost(): ImportAccountHost {
  return {
    capabilities: vi.fn<ImportAccountHost['capabilities']>(async () => [{ provider: 'notion', oauth: true, token: true }]),
    accounts: vi.fn(async () => []),
    connect: vi.fn<ImportAccountHost['connect']>(async () => ({ id: 'a', provider: 'notion', label: 'Connected', context: '' })),
    cancel: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    request: vi.fn<ImportAccountHost['request']>(async (_account, input) => ({ status: 200, body: JSON.stringify({ results: input.path === '/v1/search'
      ? [{ id: 'page', properties: { title: { type: 'title', title: [{ plain_text: 'My page' }] } } }]
      : [{ type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'Imported body' }] } }], has_more: false }) })),
  };
}
async function mount(host?: ImportAccountHost, id: ImportProviderId = 'notion') {
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false, accountImports: host });
  const root = document.createElement('div'); document.body.append(root);
  const file = vi.fn(), prepared = vi.fn();
  app = createApp({ render: () => h(ImportAccountStep, { provider: { id, name: 'Notion', detail: 'Export', icon: '', color: '', accept: '.md' }, onFile: file, onPrepared: prepared }) });
  app.use(pinia); app.mount(root);
  await nextTick();
  await vi.waitFor(() => expect(document.querySelector('[aria-busy]')?.getAttribute('aria-busy')).toBe('false'));
  return { file, prepared };
}
const button = (value: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(node => node.textContent?.includes(value))!;

it('connects OAuth, lists readable content, requires a selection, and disconnects', async () => {
  const host = mockHost(); const { prepared } = await mount(host);
  Object.defineProperty(File.prototype, 'arrayBuffer', { configurable: true, value() {
    return new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = reject; reader.readAsArrayBuffer(this); });
  } });
  button('连接 Notion 账号').click();
  await vi.waitFor(() => expect(document.body.textContent).toContain('已连接 Connected'));
  expect(host.connect).toHaveBeenCalledWith(expect.objectContaining({ oauth: true, provider: 'notion', token: '', flowId: expect.any(String) }));
  expect(document.body.textContent).toContain('My page');
  expect(button('继续，预览').disabled).toBe(true);
  button('全选').click(); await nextTick();
  expect(button('继续，预览 1 项内容').disabled).toBe(false);
  button('继续，预览 1 项内容').click();
  await vi.waitFor(() => expect(prepared).toHaveBeenCalledOnce());
  expect(prepared.mock.calls[0][0].pages[0].content).toContain('Imported body');
  expect(prepared.mock.calls[0][1]).toBe(1);
  await nextTick();
  button('断开连接').click();
  await vi.waitFor(() => expect(document.body.textContent).not.toContain('已连接 Connected'));
  expect(host.disconnect).toHaveBeenCalledWith('a');
});

it('removes a connection when actual API permissions fail', async () => {
  const host = mockHost(); host.request = vi.fn(async () => ({ status: 403, body: '' }));
  await mount(host); button('连接 Notion 账号').click();
  await vi.waitFor(() => expect(document.querySelector('[role=alert]')?.textContent).toContain('授权'));
  expect(host.disconnect).toHaveBeenCalledWith('a');
  expect(document.body.textContent).not.toContain('已连接 Connected');
});

it('cancels an unfinished authorization and disconnects a late successful result', async () => {
  const host = mockHost(); let finish!: (value: Awaited<ReturnType<ImportAccountHost['connect']>>) => void;
  host.connect = vi.fn<ImportAccountHost['connect']>(() => new Promise(resolve => { finish = resolve; }));
  await mount(host); button('连接 Notion 账号').click(); await nextTick();
  button('取消连接').click(); await nextTick();
  expect(host.cancel).toHaveBeenCalledOnce();
  finish({ id: 'late', provider: 'notion', label: 'Late', context: '' });
  await vi.waitFor(() => expect(host.disconnect).toHaveBeenCalledWith('late'));
  expect(host.request).not.toHaveBeenCalled();
});

it('clears a manually entered API token after sending it to the host', async () => {
  const host = mockHost(); host.capabilities = vi.fn<ImportAccountHost['capabilities']>(async () => [{ provider: 'notion', oauth: false, token: true }]);
  await mount(host);
  const input = document.querySelector<HTMLInputElement>('input[type=password]')!;
  input.value = 'secret-api-token'; input.dispatchEvent(new Event('input')); await nextTick();
  button('连接 Notion 账号').click(); await nextTick();
  expect(input.value).toBe('');
  await vi.waitFor(() => expect(host.connect).toHaveBeenCalledWith(expect.objectContaining({ oauth: false, token: 'secret-api-token' })));
});

it('disables unconfigured OAuth while keeping file import available', async () => {
  const host = mockHost(); host.capabilities = vi.fn<ImportAccountHost['capabilities']>(async () => [{ provider: 'notion', oauth: false, token: false }]);
  const { file } = await mount(host);
  expect(button('连接 Notion 账号').disabled).toBe(true);
  expect(document.body.textContent).toContain('尚未配置');
  button('通过文件导入').click(); await nextTick(); button('选择导出文件').click();
  expect(file).toHaveBeenCalledOnce();
});

it('shows truthful file-only modes for Obsidian and the browser demo', async () => {
  await mount(undefined, 'obsidian');
  expect(button('通过账号导入').disabled).toBe(true);
  expect(document.body.textContent).toContain('没有公开的账号内容 API');
  app!.unmount(); app = undefined;
  disposePinia(pinia);
  await mount();
  expect(document.body.textContent).toContain('尚未接入账号授权服务');
});
