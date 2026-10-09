import { createApp, h } from 'vue';
import { createPinia, setActivePinia } from 'pinia';
import { parsePluginPackage, type PluginConnectionProvider } from '../../packages/protocol/src';
import { configureWorkbench } from '../../packages/workbench/src/runtime';
import { DemoAdapter } from '../../packages/workbench/src/adapter';
import { useWorkspaceStore } from '../../packages/workbench/src/stores/workspace';
import PluginInstaller from '../../packages/workbench/src/components/PluginInstaller.vue';

export async function mountConnections(withOAuth = false) {
  const request = async (workspace: string, method: string, body?: unknown, signal?: AbortSignal) => {
    const response = await fetch(`/fixture-connections/${workspace}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { 'Content-Type': 'application/json' }, signal });
    if (!response.ok) throw new Error((await response.json()).message);
    return response.status === 204 ? undefined : response.json();
  };
  const connections: PluginConnectionProvider = { storageLabel: '测试服务保管密钥',
    ...(withOAuth ? { oauth: {
      providers: (workspace: string, signal: AbortSignal) => request(`${workspace}/oauth/providers`, 'GET', undefined, signal),
      start: (workspace: string, input: unknown, signal: AbortSignal) => request(`${workspace}/oauth`, 'POST', input, signal),
      status: (workspace: string, id: string, signal: AbortSignal) => request(`${workspace}/oauth/${id}`, 'GET', undefined, signal),
      cancel: (workspace: string, id: string, signal: AbortSignal) => request(`${workspace}/oauth/${id}`, 'DELETE', undefined, signal),
    } } : {}),
    list: (workspace, signal) => request(workspace, 'GET', undefined, signal),
    save: (workspace, input, signal) => request(workspace, 'PUT', input, signal),
    remove: (workspace, pluginId, origin, version, signal) => request(workspace, 'DELETE', { pluginId, origin, version }, signal),
    request: (context, origin, input) => request(context.workspaceId, 'POST', { pluginId: context.pluginId, integrity: context.integrity, origin, request: input }, context.signal) };
  const pinia = configureWorkbench(createPinia(), { adapter: new DemoAdapter({ files: {} }), native: false, mobile: false, plugins: { connections } });
  setActivePinia(pinia); const store = useWorkspaceStore(); await store.initialize();
  const pkg = parsePluginPackage(JSON.stringify({ packageVersion: 1, manifest: { manifestVersion: 2, apiVersion: 1, id: 'service-example', name: '服务连接示例', version: '1.0.0',
    description: '', objectTypes: [], relationTypes: [], permissions: ['connections'], networkOrigins: ['https://api.example.com'], commands: [{ id: 'request', label: '请求服务' }], views: [{ id: 'main', label: '服务响应' }] },
    source: `await tano.commands.register('request', async () => { const result = await tano.connections.request('https://api.example.com', { path: '/v1/items' }); await tano.views.render('main', { type: 'text', text: result.body }); });` }));
  await store.changePlugin({ install: pkg.manifest, package: pkg }, store.workspace!.id);
  const element = document.createElement('div'); element.id = 'connections-fixture'; element.style.cssText = 'position:fixed;inset:0;z-index:999999;background:var(--paper);overflow:auto;padding:24px'; document.body.append(element);
  const app = createApp(() => h(PluginInstaller)); app.use(pinia); app.mount(element);
  return { store, dispose: () => { app.unmount(); store.dispose(); store.$dispose(); element.remove(); } };
}
