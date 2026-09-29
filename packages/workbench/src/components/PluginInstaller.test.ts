// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia, setActivePinia } from 'pinia';
import { DemoAdapter } from '../adapter';
import { configureWorkbench } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import PluginInstaller from './PluginInstaller.vue';

let app: App;
let root: HTMLElement;
let store: ReturnType<typeof useWorkspaceStore>;
let pinia: ReturnType<typeof createPinia>;

beforeEach(async () => {
  localStorage.clear();
  pinia = createPinia();
  configureWorkbench(pinia, { adapter: new DemoAdapter(), native: false, mobile: false });
  setActivePinia(pinia);
  store = useWorkspaceStore();
  await store.openWorkspace();
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(PluginInstaller));
  app.use(pinia);
  app.mount(root);
});

afterEach(() => {
  app.unmount();
  store.dispose();
  disposePinia(pinia);
  root.remove();
});

function button(label: string) {
  return [...root.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => element.textContent?.trim() === label,
  )!;
}

it('installs a plugin and preserves its objects when disabled and re-enabled', async () => {
  button('安装插件').click();
  await vi.waitFor(() => expect(store.installedPlugins).toHaveLength(1));
  const paper = await store.createObject({
    type: 'research.paper',
    name: '论文',
    properties: {},
    description: '',
    archived: false,
  });
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(true);

  button('停用').click();
  await vi.waitFor(() => expect(store.installedPlugins[0]?.enabled).toBe(false));
  expect(store.objects).toHaveLength(1);
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(false);

  button('启用').click();
  await vi.waitFor(() => expect(store.installedPlugins[0]?.enabled).toBe(true));
  expect(store.referenceTargets.some((item) => item.id === paper.object.id)).toBe(true);
});
