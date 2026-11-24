import { ref, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { isMarkdown } from '@tano/protocol';
import { native } from '../adapter';
import { isTableTab, tableFileId, TABLES_TAB_ID } from '../data-tables';
import { t } from '../i18n';
import type { useWorkspaceStore } from '../stores/workspace';
import { pageRoutePath, parsePageRoute } from '../web-navigation';
import type { WindowContext } from '../windows/context';

export interface WorkbenchHistoryDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  activeWindow: Ref<WindowContext>;
  leaveWorkspace: () => Promise<void>;
}

export function useWorkbenchHistory(deps: WorkbenchHistoryDeps) {
  const { store, activeWindow, leaveWorkspace } = deps;
  const { workspace, activeId, busy } = storeToRefs(store);

  const webPageRouting = !native && (store.isDemo || store.isWeb);
  const initialPageRoute = webPageRouting ? parsePageRoute(window.location.pathname) : null;
  const pageRouteStateKey = '__tanoPageRoute';
  const pageRouteIndex = ref(0);
  const pageRouteMax = ref(0);
  let pageRouteReady = false;
  let applyingPageRoute = false;
  let initialPageRouteSuperseded = false;

  function routeStateIndex() {
    const { window: activeWin } = activeWindow.value;
    const value = (activeWin.history.state as Record<string, unknown> | null)?.[pageRouteStateKey];
    return value &&
      typeof value === 'object' &&
      Number.isInteger((value as { index?: unknown }).index)
      ? Math.max(0, (value as { index: number }).index)
      : 0;
  }

  function initializePageHistory() {
    if (!webPageRouting) return;
    pageRouteIndex.value = routeStateIndex();
    pageRouteMax.value = pageRouteIndex.value;
    const state =
      window.history.state && typeof window.history.state === 'object'
        ? { ...window.history.state }
        : {};
    window.history.replaceState(
      { ...state, [pageRouteStateKey]: { index: pageRouteIndex.value } },
      '',
      window.location.href,
    );
  }

  function currentPageRoute() {
    const currentWorkspace = workspace.value;
    if (currentWorkspace && isTableTab(activeId.value))
      return pageRoutePath(currentWorkspace.id, activeId.value);
    if (currentWorkspace && store.tabs.find((tab) => tab.id === activeId.value)?.pluginDetail)
      return pageRoutePath(currentWorkspace.id, activeId.value);
    const pluginView = store.pluginViews.find(
      (view) => view.key === activeId.value && view.location === 'tab',
    );
    if (currentWorkspace && pluginView) return pageRoutePath(currentWorkspace.id, pluginView.key);
    const currentFile = currentWorkspace?.files.find(
      (file) => file.id === activeId.value && file.kind === 'file' && isMarkdown(file.path),
    );
    return currentWorkspace && currentFile
      ? pageRoutePath(currentWorkspace.id, currentFile.id)
      : null;
  }

  function writePageRoute(replace: boolean) {
    const path =
      currentPageRoute() ??
      (!workspace.value && parsePageRoute(window.location.pathname) ? '/' : null);
    if (!webPageRouting || !path) return;
    const url = new URL(window.location.href);
    if (url.pathname === path) return;
    const nextIndex = replace ? pageRouteIndex.value : pageRouteIndex.value + 1;
    const state =
      window.history.state && typeof window.history.state === 'object'
        ? { ...window.history.state }
        : {};
    const nextState = { ...state, [pageRouteStateKey]: { index: nextIndex } };
    pageRouteIndex.value = nextIndex;
    if (!replace) pageRouteMax.value = nextIndex;
    window.history[replace ? 'replaceState' : 'pushState'](
      nextState,
      '',
      `${path}${url.search}${url.hash}`,
    );
  }

  function canNavigatePage(direction: -1 | 1) {
    if (native) return store.canNavigateHistory(direction);
    if (!webPageRouting || busy.value) return false;
    return direction < 0 ? pageRouteIndex.value > 0 : pageRouteIndex.value < pageRouteMax.value;
  }

  function navigatePage(direction: -1 | 1) {
    const { window: activeWin } = activeWindow.value;
    if (!canNavigatePage(direction)) return;
    if (native) {
      void store.navigateHistory(direction);
      return;
    }
    activeWin.history[direction < 0 ? 'back' : 'forward']();
  }

  watch([() => workspace.value?.id, activeId], () => {
    if (pageRouteReady && !applyingPageRoute) writePageRoute(false);
  });

  async function applyPageRoute(fromHistory = false) {
    if (!webPageRouting) return;
    const route = parsePageRoute(window.location.pathname);
    pageRouteIndex.value = routeStateIndex();
    pageRouteMax.value = Math.max(pageRouteMax.value, pageRouteIndex.value);
    if (!route) {
      if (fromHistory && window.location.pathname === '/' && workspace.value) {
        applyingPageRoute = true;
        try {
          await leaveWorkspace();
        } finally {
          applyingPageRoute = false;
        }
      }
      writePageRoute(true);
      return;
    }
    applyingPageRoute = true;
    try {
      if (workspace.value?.id !== route.workspaceId) await store.openWorkspace(route.workspaceId);
      if (workspace.value?.id !== route.workspaceId) {
        store.report(t('链接中的工作区不存在或你已失去访问权限'));
      } else if (isTableTab(route.fileId)) {
        await store.openDataTable(
          route.fileId === TABLES_TAB_ID ? undefined : tableFileId(route.fileId),
        );
      } else if (route.fileId.startsWith('plugin:')) {
        const view = store.pluginViews.find(
          (view) => view.key === route.fileId && view.location === 'tab',
        );
        if (view) store.openPluginView(view.pluginId, view.id);
        else await store.openPluginDetail(route.fileId.slice(7));
      } else {
        const file = workspace.value.files.find(
          (entry) => entry.id === route.fileId && entry.kind === 'file' && isMarkdown(entry.path),
        );
        if (!file) store.report(t('链接中的文档不存在或已被删除'));
        else if (activeId.value !== file.id) await store.openFile(file);
      }
    } finally {
      applyingPageRoute = false;
    }
    writePageRoute(true);
  }

  function handlePagePopState() {
    void applyPageRoute(true).catch(store.report);
  }

  function markInitialPageRouteSuperseded() {
    if (webPageRouting && !pageRouteReady) initialPageRouteSuperseded = true;
  }

  async function finishInitialPageRouting(createWorkspace?: boolean) {
    if (!webPageRouting) return;
    pageRouteReady = true;
    if (createWorkspace || initialPageRouteSuperseded) writePageRoute(true);
    else await applyPageRoute();
  }

  return {
    webPageRouting,
    initialPageRoute,
    initializePageHistory,
    canNavigatePage,
    navigatePage,
    handlePagePopState,
    markInitialPageRouteSuperseded,
    finishInitialPageRouting,
  };
}
