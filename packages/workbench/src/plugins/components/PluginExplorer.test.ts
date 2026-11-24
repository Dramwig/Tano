// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { bundledObjectPlugins } from '@tano/protocol';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../../workspace/adapter';
import { configureWorkbench } from '../../runtime';
import { useWorkspaceStore } from '../../stores/workspace';
import PluginInstaller from './PluginExplorer.vue';
import PluginDetailPage from './PluginDetailPage.vue';
import { bundledPluginCatalog, type PluginCatalogEntry } from '../plugin-catalog';

let app: App;
let root: HTMLElement;
let store: ReturnType<typeof useWorkspaceStore>;
let pinia: ReturnType<typeof createPinia>;
const showModal = HTMLDialogElement.prototype.showModal;
const close = HTMLDialogElement.prototype.close;
const catalogOverride = shallowRef<readonly PluginCatalogEntry[]>();
const publishingAvailable = shallowRef(false);

beforeEach(async () => {
  // jsdom does not implement the native dialog top layer.
  HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  localStorage.clear();
  catalogOverride.value = undefined;
  publishingAvailable.value = false;
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h('div', [h(PluginInstaller, { catalog: catalogOverride.value }, publishingAvailable.value
    ? { publishing: () => h('textarea', { 'aria-label': '投稿草稿' }) } : undefined), ...(store.tabs.find(tab => tab.id === store.activeId)?.pluginDetail ? [h(PluginDetailPage, { pluginId: store.tabs.find(tab => tab.id === store.activeId)!.pluginDetail!.id })] : [])]));
  app.use(pinia);
  app.mount(root);
});

afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
  HTMLDialogElement.prototype.showModal = showModal;
  HTMLDialogElement.prototype.close = close;
  vi.restoreAllMocks();
});

function button(label: string) {
  return [...document.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) =>
      element.textContent?.trim() === label || element.getAttribute('aria-label') === label,
  )!;
}


it('groups system installations and filters by plugin id and description', async () => {
 expect(root.querySelectorAll('.row')).toHaveLength(store.installedPlugins.length);
 const search = root.querySelector('input')!;
 search.value = 'no-such-plugin'; search.dispatchEvent(new Event('input')); await nextTick();
 expect(root.textContent).toContain('没有找到匹配的插件');
 expect(root.querySelectorAll('.row')).toHaveLength(0);
 search.value = store.installedPlugins[0]!.manifest.id; search.dispatchEvent(new Event('input')); await nextTick();
 expect(root.querySelectorAll('.row')).toHaveLength(1);
 expect(button('卸载插件')).toBeUndefined();
});
it('toggles device activation and respects required and disabled policies', async () => {
 button('停用插件').click();
 await vi.waitFor(() => expect(store.installedPlugins[0]!.enabled).toBe(false));
 expect(root.querySelector('.disabled')?.textContent).toContain('已停用');
 button('启用插件').click();
 await vi.waitFor(() => expect(store.installedPlugins[0]!.enabled).toBe(true));
 for (const mode of ['required', 'disabled'] as const) {
  store.installedPlugins = store.installedPlugins.map(item => ({ ...item, rule: { ...item.rule!, mode } })); await nextTick();
  expect(button('停用插件').disabled).toBe(true);
 }
});
it('installs a recommendation, then removes it without deleting content', async () => {
 [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.classList.contains('group') && item.textContent?.includes('推荐'))!.click(); await nextTick();
 button('安装').click();
 await vi.waitFor(() => expect(store.installedPlugins.some(item => !item.system)).toBe(true));
 expect(root.textContent).toContain('已安装并启用');
 button('卸载插件').click();
 await vi.waitFor(() => expect(store.installedPlugins.every(item => item.system)).toBe(true));
});

it('disables recommendation installs for members without management access', async () => {
 vi.spyOn(store, 'canManagePlugins', 'get').mockReturnValue(false);
 [...root.querySelectorAll<HTMLButtonElement>('button')].find(item => item.classList.contains('group') && item.textContent?.includes('推荐'))!.click(); await nextTick();
 const installs = [...root.querySelectorAll<HTMLButtonElement>('button')].filter(item => item.getAttribute('aria-label') === '安装');
 expect(installs.length).toBeGreaterThan(0); expect(installs.every(item => item.disabled)).toBe(true);
});
