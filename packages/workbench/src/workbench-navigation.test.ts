import { effectScope, ref } from 'vue';
import { expect, it } from 'vitest';
import { useWorkbenchNavigation } from './workbench-navigation';

it('keeps module and workspace browsing independent and restores each workspace view', () => {
  const scope = effectScope();
  const workspace = ref('a');
  const nav = scope.run(() => useWorkbenchNavigation(() => workspace.value))!;
  nav.selectWorkspaceView('assistant');
  nav.selectModule('view:chat');
  expect(nav.sidebarView.value).toBe('view:chat');
  workspace.value = 'b';
  expect(nav.module.value).toBe('view:chat');
  nav.selectModule('workspace');
  expect(nav.sidebarView.value).toBe('repository');
  nav.selectWorkspaceView('events');
  workspace.value = 'a';
  expect(nav.sidebarView.value).toBe('assistant');
  nav.selectModule('plan');
  workspace.value = 'b';
  expect(nav.sidebarView.value).toBe('plan');
  nav.selectModule('workspace');
  expect(nav.sidebarView.value).toBe('events');
  scope.stop();
});
