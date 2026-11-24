import { computed, ref, watch } from 'vue';

export type NavigationContext = 'home' | 'workspace';
export type WorkspaceSidebarView = 'repository' | 'events' | 'assistant' | 'plugin-views' | `plugin-sidebar:${string}`;
const workspaceViews: WorkspaceSidebarView[] = ['repository', 'events', 'assistant', 'plugin-views'];
export const navigationStorageKey = 'tano.preference.navigationContext';
type WorkspaceNavigation = { module: 'workspace' | 'plan'; view: WorkspaceSidebarView };
type NavigationStorage = Pick<Storage, 'getItem' | 'setItem'>;

/** Browsing contexts never change the active document/tab or open a workspace. */
export function useWorkbenchNavigation(workspaceId: () => string | undefined, storage?: NavigationStorage) {
  const context = ref<NavigationContext>(workspaceId() ? 'workspace' : 'home');
  const homeModule = ref('plan');
  const workspaceModule = ref<'workspace' | 'plan'>('workspace');
  const workspaceView = ref<WorkspaceSidebarView>('repository');
  const saved = new Map<string, WorkspaceNavigation>();
  let ready = !storage;
  let restoredContext: NavigationContext | undefined;
  try {
    const value = JSON.parse(storage?.getItem(navigationStorageKey) ?? 'null');
    if (value?.version === 1) {
      restoredContext = value.context === 'home' ? 'home' : 'workspace';
      if (typeof value.homeModule === 'string' && (value.homeModule === 'plan' || value.homeModule.startsWith('view:'))) homeModule.value = value.homeModule;
      for (const [id, state] of Object.entries(value.workspaces ?? {}) as [string, { module: WorkspaceNavigation['module']; view: string }][]) {
        const view = state?.view === 'plugins' ? 'plugin-views' : state?.view === 'views' ? 'repository' : state?.view;
        if (state && ['workspace', 'plan'].includes(state.module) && (workspaceViews.includes(view as WorkspaceSidebarView) || (typeof view === 'string' && view.startsWith('plugin-sidebar:')))) saved.set(id, { module: state.module, view: view as WorkspaceSidebarView });
      }
    }
  } catch { /* Unavailable or invalid preferences must not block navigation. */ }
  function remember(id = workspaceId()) {
    if (id) saved.set(id, { module: workspaceModule.value, view: workspaceView.value });
  }
  function loadWorkspace(id?: string) {
    const state = id ? saved.get(id) : undefined;
    workspaceModule.value = state?.module ?? 'workspace';
    workspaceView.value = state?.view ?? 'repository';
  }
  loadWorkspace(workspaceId());
  watch(workspaceId, (id, previous) => {
    if (previous) remember(previous);
    loadWorkspace(id);
    context.value = id ? 'workspace' : 'home';
  }, { flush: 'sync' });
  function persist() {
    if (!ready || !storage) return;
    remember();
    try { storage.setItem(navigationStorageKey, JSON.stringify({ version: 1, context: context.value, homeModule: homeModule.value, workspaces: Object.fromEntries(saved) })); }
    catch { /* Private browsing and full storage still allow navigation. */ }
  }
  watch([context, homeModule, workspaceModule, workspaceView], persist);
  // Call after workspace initialization, so restoring its ID does not override Home.
  function restore() {
    context.value = workspaceId() && restoredContext !== 'home' ? 'workspace' : 'home';
    ready = true;
    persist();
  }
  function selectContext(value: NavigationContext) {
    context.value = value === 'workspace' && !workspaceId() ? 'home' : value;
  }
  function openInHome(id: string) {
    homeModule.value = id;
    context.value = 'home';
  }
  function selectWorkspaceView(view: WorkspaceSidebarView) {
    if (!workspaceId()) return;
    context.value = 'workspace';
    workspaceModule.value = 'workspace';
    workspaceView.value = view;
  }
  function selectModule(id: string) {
    if (id === 'workspace') selectContext('workspace');
    if (id !== 'workspace' && id !== 'plan') openInHome(id);
    else if (context.value === 'home') homeModule.value = 'plan';
    else workspaceModule.value = id;
  }
  const module = computed(() => context.value === 'home' ? homeModule.value : workspaceModule.value);
  const sidebarView = computed({
    get: () => module.value === 'workspace' ? workspaceView.value : module.value,
    set: (id: string) => {
      if (workspaceViews.includes(id as WorkspaceSidebarView) || id.startsWith('plugin-sidebar:')) selectWorkspaceView(id as WorkspaceSidebarView);
      else selectModule(id);
    },
  });
  return { context, homeModule, module, workspaceView, sidebarView, selectContext, openInHome, selectModule, selectWorkspaceView, restore };
}

/** Wait for plugin discovery before deciding whether a restored sidebar still exists. */
export function resolvePluginSidebar(view: string, loading: boolean, views: readonly { key: string; location?: string }[]): string {
 return !loading && view.startsWith('plugin-sidebar:') && !views.some(item => item.location === 'sidebar' && item.key === view.slice(15)) ? 'repository' : view;
}
