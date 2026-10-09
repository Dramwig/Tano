// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { PluginReleaseCatalog } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import type { PluginCatalogProvider } from '../plugins/catalog';
import PluginCatalogBrowser from './PluginCatalogBrowser.vue';

let app: App, root: HTMLElement, store: ReturnType<typeof useWorkspaceStore>;
const catalog: PluginReleaseCatalog = { catalogVersion: 1, name: '团队目录', updatedAt: '2026-10-09T00:00:00.000Z',
  publishers: [{ id: 'author', name: '作者', homepage: 'https://example.com', pluginIds: ['example'] }],
  releases: [{ publisher: 'author', manifest: { manifestVersion: 1, id: 'example', name: '目录示例', version: '1.0.0', description: '', objectTypes: [], relationTypes: [] },
    integrity: 'a'.repeat(64), bytes: 100, publishedAt: '2026-10-09T00:00:00.000Z', source: 'https://example.com/source', license: 'MIT', notes: '<script>neverRun()</script>', status: 'published' }] };
const showModal = HTMLDialogElement.prototype.showModal, close = HTMLDialogElement.prototype.close;
beforeEach(() => { HTMLDialogElement.prototype.showModal = function() { this.open = true; }; HTMLDialogElement.prototype.close = function() { this.open = false; }; });
afterEach(() => { app?.unmount(); store?.dispose(); store?.$dispose(); root?.remove(); HTMLDialogElement.prototype.showModal = showModal; HTMLDialogElement.prototype.close = close; vi.restoreAllMocks(); });
async function mount(list?: PluginCatalogProvider['list']) {
  localStorage.clear();
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false,
    plugins: list ? { catalog: { source: 'https://example.com/index.json', list, download: vi.fn() } } : undefined });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.initialize();
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(PluginCatalogBrowser)); app.use(pinia); app.mount(root);
}
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>('button')].find(element => element.textContent?.trim() === label)!;
it('labels an unconfigured catalog without presenting a fictional public store', async () => {
  await mount(); expect(root.textContent).toContain('此产品尚未配置社区目录'); expect(root.querySelector('input')).toBeNull();
});
it('shows inert release notes and disables installation for a member', async () => {
  await mount(async () => catalog); store.workspace!.canManagePlugins = false;
  await vi.waitFor(() => expect(root.textContent).toContain('目录示例'));
  button('查看版本').click(); await nextTick();
  expect(root.textContent).toContain('<script>neverRun()</script>'); expect(root.querySelector('script')).toBeNull();
  expect(button('安装所选版本').disabled).toBe(true); expect(root.textContent).toContain('需要工作区管理员');
});
it('ignores a late catalog response when the workspace changes and retries a failed fresh load', async () => {
  let resolveOld!: (value: PluginReleaseCatalog) => void;
  const list = vi.fn<PluginCatalogProvider['list']>()
    .mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockRejectedValueOnce(new Error('暂时离线'))
    .mockResolvedValue(catalog);
  await mount(list);
  store.workspace = { ...store.workspace!, id: 'new-workspace' }; await nextTick();
  resolveOld({ ...catalog, name: '过期目录' });
  await vi.waitFor(() => expect(root.textContent).toContain('暂时离线'));
  expect(root.textContent).not.toContain('过期目录');
  button('刷新目录').click();
  await vi.waitFor(() => expect(root.textContent).toContain('团队目录'));
  expect(root.querySelector('[role=alert]')).toBeNull();
});
