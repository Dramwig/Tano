import { computed, ref, watch } from 'vue';

export type WorkspaceSidebarView = 'repository' | 'events' | 'views' | 'assistant' | 'plugins' | 'plugin-views';
const workspaceViews: WorkspaceSidebarView[] = ['repository', 'events', 'views', 'assistant', 'plugins', 'plugin-views'];

/** Browsing navigation is independent of the active document/tab. */
export function useWorkbenchNavigation(workspaceId: () => string | undefined) {
  const module = ref('workspace');
  const workspaceView = ref<WorkspaceSidebarView>('repository');
  const saved = new Map<string, WorkspaceSidebarView>();
  watch(workspaceId, (id, previous) => {
    if (previous) saved.set(previous, workspaceView.value);
    workspaceView.value = id ? saved.get(id) ?? 'repository' : 'repository';
  }, { flush: 'sync' });
  function selectWorkspaceView(view: WorkspaceSidebarView) {
    module.value = 'workspace';
    workspaceView.value = view;
  }
  function selectModule(id: string) { module.value = id; }
  // Compatibility for existing sidebar-only commands, not active-tab watchers.
  const sidebarView = computed({
    get: () => module.value === 'workspace' ? workspaceView.value : module.value,
    set: (id: string) => {
      if (workspaceViews.includes(id as WorkspaceSidebarView)) selectWorkspaceView(id as WorkspaceSidebarView);
      else selectModule(id);
    },
  });
  return { module, workspaceView, sidebarView, selectModule, selectWorkspaceView };
}
