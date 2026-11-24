import { resolvePluginSidebar } from './workbench-navigation';
import { effectScope, nextTick, ref } from 'vue';
import { expect, it } from 'vitest';
import { navigationStorageKey, useWorkbenchNavigation } from './workbench-navigation';

it('keeps home independent and restores each workspace module and view', () => {
  const scope = effectScope();
  const workspace = ref<string | undefined>('a');
  const nav = scope.run(() => useWorkbenchNavigation(() => workspace.value))!;
  nav.selectWorkspaceView('assistant');
  nav.openInHome('view:chat');
  expect(nav.context.value).toBe('home');
  expect(nav.sidebarView.value).toBe('view:chat');
  nav.selectContext('workspace');
  expect(nav.sidebarView.value).toBe('assistant');
  nav.selectModule('plan');
  workspace.value = 'b';
  expect(nav.context.value).toBe('workspace');
  expect(nav.sidebarView.value).toBe('repository');
  nav.selectWorkspaceView('events');
  workspace.value = 'a';
  expect(nav.sidebarView.value).toBe('plan');
  nav.selectModule('workspace');
  expect(nav.sidebarView.value).toBe('assistant');
  nav.selectContext('home');
  expect(nav.sidebarView.value).toBe('view:chat');
  workspace.value = undefined;
  nav.selectContext('workspace');
  expect(nav.context.value).toBe('home');
  scope.stop();
});

it('restores Home after asynchronous workspace initialization without losing workspace state', async () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
  let scope = effectScope();
  const workspace = ref<string | undefined>('a');
  let nav = scope.run(() => useWorkbenchNavigation(() => workspace.value, storage))!;
  nav.restore();
  nav.selectWorkspaceView('assistant');
  nav.openInHome('view:chat');
  await nextTick();
  scope.stop();
  scope = effectScope();
  workspace.value = undefined;
  nav = scope.run(() => useWorkbenchNavigation(() => workspace.value, storage))!;
  workspace.value = 'a';
  nav.restore();
  expect(nav.context.value).toBe('home');
  expect(nav.sidebarView.value).toBe('view:chat');
  nav.selectContext('workspace');
  expect(nav.sidebarView.value).toBe('assistant');
  await nextTick();
  expect(JSON.parse(values.get(navigationStorageKey)!).context).toBe('workspace');
  scope.stop();
});

it('defaults to workspace when available, and safely falls back from unavailable storage', () => {
  const scope = effectScope();
  const nav = scope.run(() => useWorkbenchNavigation(() => 'a', {
    getItem() { throw Error('blocked'); }, setItem() { throw Error('blocked'); },
  }))!;
  expect(() => nav.restore()).not.toThrow();
  expect(nav.context.value).toBe('workspace');
  nav.selectModule('view:chat');
  expect(nav.context.value).toBe('home');
  nav.sidebarView.value = 'repository';
  expect(nav.context.value).toBe('workspace');
  scope.stop();
});

for (const module of ['workspace', 'plan'] as const) {
  it(`migrates the legacy plugins sidebar while preserving ${module}`, () => {
    const scope = effectScope();
    let saved = JSON.stringify({ version: 1, context: 'workspace', workspaces: { a: { module, view: 'plugins' } } });
    const nav = scope.run(() => useWorkbenchNavigation(() => 'a', {
      getItem: () => saved, setItem: (_key, value) => { saved = value; },
    }))!;
    nav.restore();
    expect(nav.workspaceView.value).toBe('plugin-views');
    expect(nav.module.value).toBe(module);
    expect(JSON.parse(saved).workspaces.a).toEqual({ module, view: 'plugin-views' });
    scope.stop();
  });
}

for (const module of ['workspace', 'plan'] as const) {
  it(`restores removed views to files while preserving ${module}`, () => {
    const scope = effectScope();
    let saved = JSON.stringify({ version: 1, context: 'workspace', workspaces: { a: { module, view: 'views' } } });
    const nav = scope.run(() => useWorkbenchNavigation(() => 'a', {
      getItem: () => saved, setItem: (_key, value) => { saved = value; },
    }))!;
    nav.restore();
    expect(nav.workspaceView.value).toBe('repository');
    expect(nav.module.value).toBe(module);
    expect(JSON.parse(saved).workspaces.a).toEqual({ module, view: 'repository' });
    scope.stop();
  });
}

it('preserves dynamic sidebar ids until discovery finishes', () => {
 const id = 'plugin-sidebar:plugin:kanban:board';
 expect(resolvePluginSidebar(id, true, [])).toBe(id);
 expect(resolvePluginSidebar(id, false, [])).toBe('repository');
 expect(resolvePluginSidebar(id, false, [{ key:'plugin:kanban:board', location:'sidebar' }])).toBe(id);
});

it('saves and restores dynamic sidebar ids through the sidebar binding', async () => {
 const scope = effectScope(); let saved = '';
 const storage = { getItem: () => saved || null, setItem: (_key: string, value: string) => { saved = value; } };
 const nav = scope.run(() => useWorkbenchNavigation(() => 'a', storage))!; nav.restore();
 nav.sidebarView.value = 'plugin-sidebar:plugin:kanban:board'; await nextTick();
 expect(nav.context.value).toBe('workspace');
 const restored = scope.run(() => useWorkbenchNavigation(() => 'a', storage))!; restored.restore();
 expect(restored.sidebarView.value).toBe('plugin-sidebar:plugin:kanban:board'); scope.stop();
});
