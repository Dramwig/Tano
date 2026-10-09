// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, ref, type App } from 'vue';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import type { PluginPackageUsage } from '@tano/protocol';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import PluginMaintenance from './PluginMaintenance.vue';

let app: App, pinia: Pinia, root: HTMLElement, store: ReturnType<typeof useWorkspaceStore>;
afterEach(() => { app?.unmount(); store?.dispose(); if (pinia) disposePinia(pinia); root?.remove(); });
const usage: PluginPackageUsage = { used: 3000, limit: 64 * 1024 * 1024, entryLimit: 1024,
  entries: [{ integrity: 'a'.repeat(64), pluginId: 'example', version: '2.0.0', bytes: 2000, state: 'ready', pinned: true, createdAt: new Date().toISOString() },
    { integrity: 'b'.repeat(64), pluginId: 'example', version: '1.0.0', bytes: 1000, state: 'pending', pinned: false, createdAt: new Date().toISOString() }] };
async function mount(load: () => Promise<PluginPackageUsage>, canManage = true, remove?: (workspace: string, integrity: string) => Promise<void>) {
  localStorage.clear(); pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false,
    plugins: { repository: { load: vi.fn(), publish: vi.fn(), usage: load, remove } } });
  setActivePinia(pinia); store = useWorkspaceStore(); await store.initialize();
  store.workspace!.canManagePlugins = canManage;
  const plugin = ref('example');
  root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(PluginMaintenance, { id: plugin.value })); app.use(pinia); app.mount(root);
  return plugin;
}
it('shows owner-only aggregate usage separately from device cache and exposes unfinished allocations', async () => {
  const load = vi.fn(async () => usage); await mount(load);
  await vi.waitFor(() => expect(root.textContent).toContain('2.9 KiB / 64.0 MiB'));
  expect(root.textContent).toContain('2 / 1024 个版本');
  expect(root.textContent).toContain('当前或历史版本'); expect(root.textContent).toContain('上传未完成');
  [...root.querySelectorAll('button')].find(button => button.textContent === '刷新云端容量')!.click();
  await vi.waitFor(() => expect(load).toHaveBeenCalledTimes(2));
});
it('does not request administrator package metadata for ordinary members', async () => {
  const load = vi.fn(async () => usage); await mount(load, false); await nextTick();
  expect(load).not.toHaveBeenCalled(); expect(root.textContent).not.toContain('工作区云端包存储');
});
it('only allows reclaimable cloud versions and refreshes the result after collection', async () => {
  const source = { ...usage, entries: usage.entries.map((entry, i) => ({ ...entry, state: 'ready' as const, removable: i === 1 })) };
  const load = vi.fn(async () => structuredClone(source));
  const remove = vi.fn(async () => { source.entries = source.entries.slice(0, 1); });
  await mount(load, true, remove);
  await vi.waitFor(() => expect(root.querySelectorAll('button[aria-label^="回收"]')).toHaveLength(2));
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('button[aria-label^="回收"]')];
  expect(buttons[0]!.disabled).toBe(true); expect(buttons[1]!.disabled).toBe(false);
  buttons[1]!.click();
  await vi.waitFor(() => expect(root.textContent).toContain('已回收云端版本'));
  expect(remove).toHaveBeenCalledWith(store.workspace!.id, 'b'.repeat(64));
  expect(root.querySelectorAll('button[aria-label^="回收"]')).toHaveLength(1);
});
it('discards pending usage results after the visible plugin changes', async () => {
  let release!: (value: PluginPackageUsage) => void;
  const load = vi.fn<() => Promise<PluginPackageUsage>>().mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
    .mockResolvedValue({ ...usage, used: 0, entries: [] });
  const plugin = await mount(load); plugin.value = 'other'; await nextTick();
  await vi.waitFor(() => expect(root.textContent).toContain('0 / 1024 个版本'));
  release(usage); await nextTick(); await nextTick();
  expect(root.textContent).not.toContain('2 / 1024 个版本'); expect(root.textContent).not.toContain('2.0.0');
});
