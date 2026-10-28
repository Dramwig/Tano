// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, type App } from 'vue';
import PluginRuntimePanel from './PluginRuntimePanel.vue';

const fake = vi.hoisted(() => ({ store: { workspace: { id: 'workspace' }, pluginRuntime: [] as unknown[] } }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fake.store }));
vi.mock('./PluginCustomView.vue', () => ({ default: { render: () => h('div', { class: 'sandbox-fixture' }) } }));
let app: App, root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); });

it('mounts only panel views so a tab editor is not duplicated invisibly in the plugin center', () => {
  const custom = { bundle: { html: '', css: '', source: 'render()' }, state: {} };
  fake.store.pluginRuntime = [{ id: 'test', instanceId: 'one', name: '测试', status: 'running', commands: [], views: [
    { id: 'board', label: '白板', location: 'tab', custom },
    { id: 'sidebar', label: '侧栏', location: 'sidebar', custom },
    { id: 'panel', label: '面板', location: 'panel', custom },
  ] }];
  root = document.createElement('div'); document.body.append(root);
  app = createApp(PluginRuntimePanel); app.mount(root);
  expect(root.querySelectorAll('.sandbox-fixture')).toHaveLength(1);
  expect(root.textContent).toContain('打开标签页');
  expect(root.textContent).toContain('打开侧栏');
});
