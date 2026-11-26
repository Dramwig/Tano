import { nextTick, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { useAgentInboxController } from '../assistant/agent-controller';
import { ASSISTANT_TAB_ID, openAssistantPage } from '../assistant/navigation';
import type { useAssistantStore, useInlineAssistantStore } from '../assistant/store';
import { tableFileId } from '../data-tables/data-tables';
import { t } from '../i18n/i18n';
import { LocalReminderScheduler } from '../plans/local-reminders';
import { expandRecurringPlans } from '../plans/recurrence';
import { nativeListen as listen } from '../platform/native-bridge';
import { mobile } from '../platform/platform';
import type { WorkbenchExtensions } from '../runtime';
import type { retainWorkbenchSession } from '../shell/workbench-session';
import type { usePlanStore } from '../stores/plans';
import type { useUpdatesStore } from '../stores/updates';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { useAuxiliaryWindows } from '../windows/manager';
import { native } from '../workspace/adapter';
import type { useDocumentActions } from './use-document-actions';
import type { useFileTreeController } from './use-file-tree-controller';
import type { useWorkbenchCalendar } from './use-workbench-calendar';
import type { useWorkbenchHistory } from './use-workbench-history';
import type { useWorkbenchModals } from './use-workbench-modals';
import type { useWorkbenchOutline } from './use-workbench-outline';

export interface WorkbenchLifecycleDeps {
  props: {
    initialWorkspace?: string;
    resolveInitialWorkspace?: () => Promise<string | undefined>;
    createWorkspace?: boolean;
  };
  emitReady: () => void;
  mainWindow: WindowContext;
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  inlineRunner: ReturnType<typeof useInlineAssistantStore>;
  agentInbox: ReturnType<typeof useAgentInboxController>;
  plans: ReturnType<typeof usePlanStore>;
  updates: ReturnType<typeof useUpdatesStore>;
  editing: WorkbenchExtensions['editing'];
  auxiliaryWindows: ReturnType<typeof useAuxiliaryWindows>;
  workbenchSession: ReturnType<typeof retainWorkbenchSession>;
  localNative: boolean;
  startupPending: Ref<boolean>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  navigationContext: Ref<'home' | 'workspace'>;
  navigationModule: Ref<string>;
  restoreNavigation: () => void;
  homeModule: Ref<string>;
  getPersonalPlanScope: () => ReturnType<typeof usePlanStore>['view'];
  extensionViews: NonNullable<WorkbenchExtensions['views']>;
  agentPanel: Ref<boolean>;
  selectedDiff: Ref<unknown>;
  recyclePanel: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  settingsPanel: Ref<boolean>;
  historyPanel: Ref<boolean>;
  menu: Ref<boolean>;
  calendar: ReturnType<typeof useWorkbenchCalendar>;
  docs: ReturnType<typeof useDocumentActions>;
  tree: ReturnType<typeof useFileTreeController>;
  outlineCtrl: ReturnType<typeof useWorkbenchOutline>;
  modals: ReturnType<typeof useWorkbenchModals>;
  history: ReturnType<typeof useWorkbenchHistory>;
}

export function useWorkbenchLifecycle(deps: WorkbenchLifecycleDeps) {
  const {
    props,
    emitReady,
    mainWindow,
    store,
    assistant,
    inlineRunner,
    agentInbox,
    plans,
    updates,
    editing,
    auxiliaryWindows,
    workbenchSession,
    localNative,
    startupPending,
    compactPanes,
    sidebar,
    navigationContext,
    navigationModule,
    restoreNavigation,
    homeModule,
    getPersonalPlanScope,
    extensionViews,
    agentPanel,
    selectedDiff,
    recyclePanel,
    workspaceMenu,
    settingsPanel,
    historyPanel,
    menu,
    calendar,
    docs,
    tree,
    outlineCtrl,
    modals,
    history,
  } = deps;
  const { activeId } = storeToRefs(store);

  let unmounted = false;
  let reminderTimer: ReturnType<typeof setInterval> | undefined;
  let unlistenClose: (() => void) | undefined;
  let unlistenWatchError: (() => void) | undefined;

  const reminderScheduler = new LocalReminderScheduler({
    onRemind: (item) => {
      store.report(t('日程提醒：{0}', [item.record.object.name]));
    },
  });

  function checkPlanReminders() {
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    const now = new Date();
    const windowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const windowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
    const records = expandRecurringPlans(plans.recordsFor('all'), windowStart, windowEnd);
    reminderScheduler.check(records, now.getTime());
  }

  watch(
    () => store.workspace?.id,
    (id, previous) => {
      agentPanel.value = false;
      selectedDiff.value = undefined;
      recyclePanel.value = false;
      if (navigationModule.value === 'workspace') {
        if (previous) calendar.rememberCalendar(previous);
        calendar.restoreCalendar(id);
      }
      calendar.calendarModeOpen.value = false;
      workspaceMenu.value = false;
      settingsPanel.value = false;
    },
  );

  watch(activeId, (id) => {
    calendar.calendarModeOpen.value = false;
    if (id === ASSISTANT_TAB_ID && compactPanes.value) sidebar.value = false;
    docs.closePageContextMenu();
    const treeId = activeId.value.startsWith('table:')
      ? tableFileId(activeId.value)
      : activeId.value;
    if (!tree.pendingTreeOpenIds.has(treeId) || !tree.selectedEntryIds.value.has(treeId))
      tree.selectActiveFileInTree();
    historyPanel.value = false;
    menu.value = false;
    outlineCtrl.resetOnActiveChange();
  });

  watch(
    () => [store.activeId, assistant.loading, store.busy] as const,
    ([id, loading, switching]) => {
      if (id === ASSISTANT_TAB_ID && !loading && !switching) openAssistantPage(store, assistant);
    },
  );

  watch(sidebar, (visible) => {
    if (!visible) {
      tree.closeFileContextMenu();
      tree.closeDirectoryContextMenu();
      outlineCtrl.closeOutlineContextMenu();
    }
  });

  onMounted(async () => {
    reminderTimer = setInterval(checkPlanReminders, 60_000);
    if (history.webPageRouting) {
      history.initializePageHistory();
      window.addEventListener('popstate', history.handlePagePopState);
    }
    try {
      await workbenchSession.initialize(async () => {
        if (props.createWorkspace) await modals.createNewWorkspace();
        else
          await store.initialize(
            history.initialPageRoute?.workspaceId ??
              (props.resolveInitialWorkspace
                ? await props.resolveInitialWorkspace()
                : props.initialWorkspace),
          );
      });
    } finally {
      restoreNavigation();
      if (
        homeModule.value !== 'plan' &&
        !extensionViews.some((view) => view.id === homeModule.value && view.sidebar)
      )
        homeModule.value = 'plan';
      plans.view = navigationContext.value === 'home' ? getPersonalPlanScope() : 'workspace';
      startupPending.value = false;
    }
    if (unmounted) return;
    emitReady();
    await nextTick();

    await history.finishInitialPageRouting(props.createWorkspace);
    if (native && !mobile) {
      void updates.initialize();
    }
    if (native) {
      if (localNative)
        unlistenWatchError = await listen<string>('workspace-watch-error', (event) => {
          store.enableWorkspacePolling();
          store.report(t('文件监听遇到错误：{0}。目录仍会定期自动检查。', [event.payload]));
        });
      if (!mobile)
        unlistenClose = await mainWindow.native!.onCloseRequested(async (event) => {
          event.preventDefault();
          if (updates.state.phase === 'installing') return;
          try {
            await editing.flush();
            if (await store.flush()) {
              await assistant.settle();
              await inlineRunner.settle();
              await agentInbox.settle();
              if (!(await auxiliaryWindows.closeAll())) {
                agentInbox.resume();
                return;
              }
              await editing.suspendAll();
              await mainWindow.native!.destroy();
            } else store.report(t('还有未保存的内容，窗口已保留。请先保存或另存副本。'));
          } catch (error) {
            agentInbox.resume();
            store.report(error);
          }
        });
    }
  });

  onBeforeUnmount(() => {
    unmounted = true;
    clearInterval(reminderTimer);
    document.documentElement.style.removeProperty('--sidebar-width');
    workbenchSession.release();
    window.removeEventListener('popstate', history.handlePagePopState);
    unlistenClose?.();
    unlistenWatchError?.();
  });
}
