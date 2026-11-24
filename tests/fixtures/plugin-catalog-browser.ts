import { createApp, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../../packages/workbench/src/runtime';
import { DemoAdapter } from '../../packages/workbench/src/workspace/adapter';
import { useWorkspaceStore } from '../../packages/workbench/src/stores/workspace';
import { HttpPluginCatalog } from '../../packages/workbench/src/plugins/catalog';
import PluginDetailPage from '../../packages/workbench/src/plugins/components/PluginDetailPage.vue';
import PluginInstaller from '../../packages/workbench/src/plugins/components/PluginInstaller.vue';

export async function mountCatalog(source: string) {
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false,
    plugins: { catalog: new HttpPluginCatalog(source) } });
  setActivePinia(pinia); const store = useWorkspaceStore(); await store.initialize();
  const element = document.createElement('div'); element.id = 'catalog-fixture';
  element.style.cssText = 'position:fixed;inset:0;z-index:999999;background:var(--paper);overflow:auto;padding:24px'; document.body.append(element);
  const app = createApp(() => h('div', [h(PluginInstaller), ...(store.tabs.find(tab => tab.id === store.activeId)?.pluginDetail ? [h(PluginDetailPage, { pluginId: store.tabs.find(tab => tab.id === store.activeId)!.pluginDetail!.id })] : [])])); app.use(pinia); app.mount(element);
  return { store, dispose: () => { app.unmount(); store.dispose(); store.$dispose(); element.remove(); } };
}
