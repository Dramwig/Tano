// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import PluginCustomView from './PluginCustomView.vue';
const bridge = vi.hoisted(() => ({ create: vi.fn(), dispose: vi.fn(), update: vi.fn() }));
vi.mock('../plugins/ui-sandbox', () => ({ createPluginUiSandbox: bridge.create }));
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); });
it('updates state without restarting a native-window snapshot, then disposes on instance or workspace changes', async () => {
  bridge.create.mockReturnValue({ update: bridge.update, dispose: bridge.dispose });
  const data = shallowRef({ workspaceId: 'workspace', pluginId: 'test', instanceId: 'one', viewId: 'board', bundle: { html: '', css: '', source: 'render()' }, state: { count: 1 } });
  const execute = vi.fn().mockResolvedValue(undefined);
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(PluginCustomView, { ...data.value, execute }) }); app.mount(root); await nextTick();
  expect(bridge.create).toHaveBeenCalledOnce();
  const oldCallback = bridge.create.mock.calls[0]![3];
  data.value = { ...structuredClone(data.value), state: { count: 2 } }; await nextTick();
  expect(bridge.create).toHaveBeenCalledOnce();
  expect(bridge.update).toHaveBeenCalledWith({ count: 2 });
  data.value = { ...data.value, workspaceId: 'next', instanceId: 'two' }; await nextTick();
  expect(bridge.dispose).toHaveBeenCalledOnce();
  expect(bridge.create).toHaveBeenCalledTimes(2);
  await oldCallback({ type: 'move' });
  expect(execute).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 'workspace', instanceId: 'one', kind: 'message' }));
  app.unmount(); expect(bridge.dispose).toHaveBeenCalledTimes(2);
});
