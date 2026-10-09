import { createApp, h, ref } from 'vue';
import type { PluginPackage } from '../../packages/protocol/src';
import { PluginPackageCache } from '../../packages/workbench/src/plugins/packages';
import { PluginExecutionHost, type PluginRuntimeState } from '../../packages/workbench/src/plugins/host';
import { createNativePluginServices } from '../../packages/workbench/src/plugins/native';
import PluginCustomView from '../../packages/workbench/src/components/PluginCustomView.vue';

/** Real package/Worker/UI/IPC bridge; only the OS endpoint is a fixture. Native behavior has Rust tests. */
export async function mountNative(pkg: PluginPackage) {
  const internals = (window as unknown as { __TAURI_INTERNALS__?: unknown });
  const previous = internals.__TAURI_INTERNALS__;
  internals.__TAURI_INTERNALS__ = { invoke: async (command: string, args: unknown) => {
    const response = await fetch('/fixture-native', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, args }) });
    if (!response.ok) throw new Error((await response.json()).message);
    return response.json();
  } };
  const integrity = await new PluginPackageCache().put(pkg);
  const states = ref<PluginRuntimeState[]>([]);
  const workspaceId = '81c90c74-1c40-4d24-9440-bb51228e4563';
  const host = new PluginExecutionHost({ call: async () => {} }, value => { states.value = value; }, { native: createNativePluginServices() });
  const element = document.createElement('div'); element.id = 'native-fixture';
  element.style.cssText = 'position:fixed;inset:0;z-index:999999;background:white;overflow:auto;padding:24px'; document.body.append(element);
  const app = createApp(() => {
    const plugin = states.value[0], view = plugin?.views.find(view => view.id === 'changes');
    return view?.custom ? h(PluginCustomView, { workspaceId, pluginId: pkg.manifest.id, instanceId: plugin!.instanceId, viewId: view.id, ...view.custom,
      execute: interaction => host.invoke(interaction.pluginId, interaction.kind, interaction.name, interaction.payload, interaction.instanceId) })
      : h('p', plugin?.message ?? '正在启动 Git 插件');
  });
  app.mount(element);
  host.sync({ id: workspaceId, name: 'Git 示例', path: '/fixture', files: [] }, [{ manifest: pkg.manifest, enabled: true, authorized: true, rule: { manifest: pkg.manifest, integrity, mode: 'required', settings: {} } }]);
  return { integrity, states, dispose: () => { host.dispose(); app.unmount(); element.remove(); internals.__TAURI_INTERNALS__ = previous; } };
}
