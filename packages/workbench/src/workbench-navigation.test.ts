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
