// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef } from 'vue';
import { bundledObjectPlugins } from '@tano/protocol';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import PluginInstaller from './PluginInstaller.vue';
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


it('shows only populated detail tabs and opens one page per plugin', async () => {
 await store.openPluginDetail('research'); await nextTick();
 const page = document.querySelector('.plugin-detail-page')!;
 expect(page).not.toBeNull();
 const labels = [...page.querySelectorAll('nav button')].map(item => item.textContent);
 expect(labels).toEqual(['详细信息']);
 await store.openPluginDetail('research');
 expect(store.tabs.filter(tab => tab.pluginDetail?.id === 'research')).toHaveLength(1);
 button('安装插件').click();
 await vi.waitFor(() => expect(store.installedPlugins.some(item => item.manifest.id === 'research')).toBe(true));
 expect(page.textContent).toContain('停用插件');
 await store.openGraphTab({ newTab:true });
 store.dockTab('plugin:research', { paneId:store.panes[0]!.id, side:'right' }); await nextTick();
 expect(store.panes).toHaveLength(2);
 expect(store.tabs.find(tab => tab.id === 'plugin:research')?.pluginDetail?.name).toBe('研究工作台');
 button('卸载插件').click();
 await vi.waitFor(() => expect(store.tabs.some(tab => tab.pluginDetail?.id === 'research')).toBe(false));
});
it('hides workspace settings and uninstall for system plugins', async () => {
 await store.openPluginDetail(store.installedPlugins.find(item => item.system)!.manifest.id); await nextTick();
 const page = document.querySelector('.plugin-detail-page')!;
 expect(page.textContent).toContain('系统插件');
 const labels = [...page.querySelectorAll('nav button')].map(item => item.textContent);
 expect(labels).toContain('功能'); expect(labels).toContain('权限'); expect(labels).not.toContain('设置');
 expect(button('卸载插件')).toBeUndefined();
});
