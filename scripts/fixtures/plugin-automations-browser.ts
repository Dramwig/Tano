import { createApp, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import type { PluginAutomationProvider, PluginPackage } from '../../packages/protocol/src';
import { configureWorkbench } from '../../packages/workbench/src/runtime';
import { DemoAdapter } from '../../packages/workbench/src/adapter';
import { useWorkspaceStore } from '../../packages/workbench/src/stores/workspace';
import PluginInstaller from '../../packages/workbench/src/components/PluginInstaller.vue';

export async function mountAutomations(pkg: PluginPackage) {
  const request = async (workspace: string, path: string, method: string, body: unknown, signal: AbortSignal, key?: string) => {
    const response = await fetch(`/fixture-automations/${workspace}${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body),
      headers: { 'Content-Type': 'application/json', ...(key ? { 'Idempotency-Key': key } : {}) }, signal });
    if (!response.ok) throw new Error((await response.json()).message);
    return response.status === 204 ? undefined : response.json();
  };
  const automations: PluginAutomationProvider = {
    webhook: {
      url: (workspace, id) => `${location.origin}/fixture-external-webhook/${workspace}/${id}`,
      rotate: (workspace, id, version, signal) => request(workspace, `/${id}/webhook`, 'POST', { version }, signal),
      revoke: (workspace, id, version, signal) => request(workspace, `/${id}/webhook`, 'DELETE', { version }, signal),
    },
    list: (workspace, signal) => request(workspace, '', 'GET', undefined, signal),
    save: (workspace, id, input, signal) => request(workspace, `/${id}`, 'PUT', input, signal),
    remove: (workspace, id, version, signal) => request(workspace, `/${id}`, 'DELETE', { version }, signal),
    run: (workspace, id, version, key, signal) => request(workspace, `/${id}/runs`, 'POST', { version }, signal, key),
    runs: (workspace, id, signal) => request(workspace, `/${id}/runs`, 'GET', undefined, signal),
    cancel: (workspace, id, run, signal) => request(workspace, `/${id}/runs/${run}/cancel`, 'POST', undefined, signal),
  };
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false, plugins: { principal: 'test-owner', automations } });
  setActivePinia(pinia); const store = useWorkspaceStore(); await store.initialize();
  await store.changePlugin({ install: pkg.manifest, package: pkg }, store.workspace!.id);
  const element = document.createElement('div'); element.id = 'automations-fixture'; element.style.cssText = 'position:fixed;inset:0;z-index:999999;background:var(--paper);overflow:auto;padding:24px'; document.body.append(element);
  const app = createApp(() => h(PluginInstaller)); app.use(pinia); app.mount(element);
  return { store, dispose: () => { app.unmount(); store.dispose(); store.$dispose(); element.remove(); } };
}
