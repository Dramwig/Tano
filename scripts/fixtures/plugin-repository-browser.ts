import { createApp, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { configureWorkbench } from '../../packages/workbench/src/runtime';
import { DemoAdapter } from '../../packages/workbench/src/adapter';
import { useWorkspaceStore } from '../../packages/workbench/src/stores/workspace';
import PluginRepositoryStorage from '../../packages/workbench/src/components/PluginRepositoryStorage.vue';

/** Browser fixture for a hosted repository provider, using the real workbench store. */
export async function mountRepository() {
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false,
    plugins: { repository: { load: async () => '', publish: async () => {},
      usage: async workspace => (await fetch(`/fixture-packages/${workspace}`)).json(),
      remove: async (workspace, integrity) => { const response = await fetch(`/fixture-packages/${workspace}/${integrity}`, { method: 'DELETE' });
        if (!response.ok) throw new Error((await response.json()).message); },
    } } });
  setActivePinia(pinia); const store = useWorkspaceStore(); await store.initialize();
  const element = document.createElement('div'); element.id = 'repository-fixture';
  element.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;overflow:auto;padding:24px'; document.body.append(element);
  const app = createApp(() => h(PluginRepositoryStorage)); app.use(pinia); app.mount(element);
  return () => { app.unmount(); store.dispose(); store.$dispose(); element.remove(); };
}
