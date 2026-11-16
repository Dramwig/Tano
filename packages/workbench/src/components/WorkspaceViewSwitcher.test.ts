// @vitest-environment jsdom
import { createApp, h, nextTick, reactive } from 'vue';
import { expect, it, vi } from 'vitest';
import WorkspaceViewSwitcher from './WorkspaceViewSwitcher.vue';
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => state }));
vi.mock('../assistant/store', () => ({ useAssistantStore: () => ({ available: true }) }));
const state = reactive({ workspaceSettings: { showPlugins: false, showPlan: true }, pluginViews: [] as object[], pluginCommands: [] as object[] });
for (const showPlugins of [false, true]) for (const content of ['none', 'views', 'commands']) {
  it(`shows the single plugin entry with setting=${showPlugins}, content=${content}`, async () => {
    state.workspaceSettings.showPlugins = showPlugins;
    state.pluginViews = content === 'views' ? [{}] : [];
    state.pluginCommands = content === 'commands' ? [{}] : [];
    const root = document.createElement('div'); document.body.append(root);
    const app = createApp(() => h(WorkspaceViewSwitcher, { active: true, modelValue: 'repository' }));
    try {
      app.mount(root);
      root.querySelector<HTMLButtonElement>('button')!.click(); await nextTick();
      const entries = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')];
      const plugins = entries.filter(entry => entry.textContent?.trim() === '插件');
      expect(plugins).toHaveLength(showPlugins ? 1 : 0);
      expect(entries).toHaveLength(showPlugins ? 4 : 3);
      expect(entries.map(entry => entry.textContent)).not.toContain('工作区插件');
      expect(entries.map(entry => entry.textContent)).not.toContain('数据库与视图');
    } finally { app.unmount(); root.remove(); }
  });
}

it('lists sidebar views independently while hiding other plugin locations', async () => {
 state.workspaceSettings.showPlugins = false;
 state.pluginViews = ['sidebar','tab','panel','settings'].map(location => ({ location, key:location, label:location, pluginId:'sample' }));
 const root = document.createElement('div'); document.body.append(root);
 const app = createApp(() => h(WorkspaceViewSwitcher, { active:true, modelValue:'repository' }));
 try { app.mount(root); root.querySelector<HTMLButtonElement>('button')!.click(); await nextTick();
 const entries = [...document.querySelectorAll('[role="menuitemradio"]')].map(item => item.textContent?.trim());
 expect(entries).toContain('sidebar'); expect(entries).not.toContain('插件');
 for (const label of ['tab','panel','settings']) expect(entries).not.toContain(label);
 } finally { app.unmount(); root.remove(); }
});
