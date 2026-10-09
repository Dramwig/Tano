// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, shallowRef, type App } from 'vue';
import PluginSurface from './PluginSurface.vue';
import type { PluginRuntimeState } from '../plugins/host';

let app: App | undefined;
let root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); });
function mountSurface(execute = vi.fn().mockResolvedValue(undefined)) {
  root = document.createElement('div'); document.body.append(root);
  const view = { id: 'preferences', key: 'plugin:test:preferences', label: '插件偏好', pluginId: 'test', pluginName: '测试插件' };
  const runtime = shallowRef<PluginRuntimeState>({ id: 'test', instanceId: 'first', name: '测试插件', status: 'running', message: '', commands: [],
    views: [{ id: 'preferences', label: '插件偏好', tree: { type: 'stack', children: [
      { type: 'input', key: 'title', label: '标题', value: '初始值' }, { type: 'button', label: '保存', action: 'save' },
    ] } }] });
  app = createApp({ render: () => h(PluginSurface, { view, runtime: runtime.value, workspaceId: 'workspace', execute }) });
  app.mount(root);
  return { runtime, execute };
}

it('sends form values and the originating instance, then resets values for a new instance', async () => {
  const { runtime, execute } = mountSurface();
  const input = root.querySelector('input')!;
  input.value = '新标题'; input.dispatchEvent(new Event('input')); await nextTick();
  root.querySelector('button')!.click(); await nextTick();
  expect(execute).toHaveBeenCalledWith({ workspaceId: 'workspace', pluginId: 'test', instanceId: 'first', kind: 'action', name: 'preferences', payload: { action: 'save', values: { title: '新标题' } } });
  runtime.value = { ...runtime.value, instanceId: 'second' }; await nextTick();
  expect(input.value).toBe('初始值');
  root.querySelector('button')!.click(); await nextTick();
  expect(execute).toHaveBeenLastCalledWith(expect.objectContaining({ instanceId: 'second', payload: { action: 'save', values: { title: '初始值' } } }));
});

it('does not leak a pending interaction or its error into the replacement instance', async () => {
  let reject!: (error: Error) => void;
  const { runtime } = mountSurface(vi.fn(() => new Promise((_resolve, failure) => { reject = failure; })));
  root.querySelector('button')!.click(); await nextTick();
  expect(root.querySelector('button')!.disabled).toBe(true);
  runtime.value = { ...runtime.value, instanceId: 'second' }; await nextTick();
  reject(new Error('old error')); await nextTick();
  expect(root.querySelector('button')!.disabled).toBe(false);
  expect(root.querySelector('[role="alert"]')).toBeNull();
  runtime.value = { ...runtime.value, status: 'error', message: '已停止' }; await nextTick();
  expect(root.querySelector('button')!.disabled).toBe(true);
});
