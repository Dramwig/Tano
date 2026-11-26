import type { Ref } from 'vue';
import { storeToRefs } from 'pinia';
import type { FileEntry } from '@tano/protocol';
import type { useAssistantStore } from '../assistant/store';
import { mobile } from '../platform/platform';
import type { SelectionTodoSession } from '../plans/selection-todo';
import type { WorkbenchExtensions } from '../runtime';
import type { useWorkspaceStore } from '../stores/workspace';
import { handleMobileVisibility } from './mobile-lifecycle';

export interface SurfaceDismissalDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  extensions: WorkbenchExtensions;
  editing: WorkbenchExtensions['editing'];
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  updateLock: Ref<boolean>;
  menu: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  settingsPanel: Ref<boolean>;
  commandPaletteOpened: Ref<boolean>;
  importPanel: Ref<boolean>;
  agentPanel: Ref<boolean>;
  objectDetail: Ref<unknown>;
  planArchiveOpen: Ref<boolean>;
  recyclePanel: Ref<boolean>;
  historyPanel: Ref<boolean>;
  referenceGraphOpened: Ref<boolean>;
  templateLibraryOpen: Ref<boolean>;
  touchOutlineOpen: Ref<boolean>;
  calendarModeOpen: Ref<boolean>;
  selectedDiff: Ref<unknown>;
  selectionTodo: Ref<SelectionTodoSession | undefined>;
  modal: Ref<'' | 'newTab' | 'search' | 'delete' | 'saveAs'>;
  modalBusy: Ref<boolean>;
  fileContextMenu: Ref<{ file: FileEntry; x: number; y: number } | null>;
  directoryContextMenu: Ref<{ parent: string; x: number; y: number } | null>;
  workspaceEntryContextMenu: Ref<unknown>;
  pageContextMenu: Ref<unknown>;
  outlineContextMenu: Ref<unknown>;
  closeFileContextMenu: (restoreFocus?: boolean) => void;
  closeDirectoryContextMenu: () => void;
  closeWorkspaceEntryContextMenu: (restoreFocus?: boolean) => void;
  closePageContextMenu: () => void;
  closeOutlineContextMenu: () => void;
  canNavigatePage: (direction: -1 | 1) => boolean;
  navigatePage: (direction: -1 | 1) => void;
}

interface DismissableSurface {
  isOpen: () => boolean;
  dismiss: () => void;
}

export function useSurfaceDismissal(deps: SurfaceDismissalDeps) {
  const {
    store,
    assistant,
    extensions,
    editing,
    compactPanes,
    sidebar,
    updateLock,
    menu,
    workspaceMenu,
    settingsPanel,
    commandPaletteOpened,
    importPanel,
    agentPanel,
    objectDetail,
    planArchiveOpen,
    recyclePanel,
    historyPanel,
    referenceGraphOpened,
    templateLibraryOpen,
    touchOutlineOpen,
    calendarModeOpen,
    selectedDiff,
    selectionTodo,
    modal,
    modalBusy,
    fileContextMenu,
    directoryContextMenu,
    workspaceEntryContextMenu,
    pageContextMenu,
    outlineContextMenu,
    closeFileContextMenu,
    closeDirectoryContextMenu,
    closeWorkspaceEntryContextMenu,
    closePageContextMenu,
    closeOutlineContextMenu,
    canNavigatePage,
    navigatePage,
  } = deps;
  const { workspace, busy } = storeToRefs(store);

  // Ordered priority stack for Android back dismissal (topmost surface first).
  const backDismissStack: DismissableSurface[] = [
    { isOpen: () => !!fileContextMenu.value, dismiss: () => closeFileContextMenu(true) },
    { isOpen: () => !!directoryContextMenu.value, dismiss: closeDirectoryContextMenu },
    { isOpen: () => !!workspaceEntryContextMenu.value, dismiss: () => closeWorkspaceEntryContextMenu() },
    { isOpen: () => !!pageContextMenu.value, dismiss: closePageContextMenu },
    { isOpen: () => !!outlineContextMenu.value, dismiss: closeOutlineContextMenu },
    { isOpen: () => menu.value, dismiss: () => { menu.value = false; } },
    { isOpen: () => workspaceMenu.value, dismiss: () => { workspaceMenu.value = false; } },
    { isOpen: () => !!modal.value, dismiss: () => { modal.value = ''; } },
    { isOpen: () => settingsPanel.value, dismiss: () => { settingsPanel.value = false; } },
    { isOpen: () => importPanel.value, dismiss: () => { importPanel.value = false; } },
    { isOpen: () => !!selectedDiff.value, dismiss: () => { selectedDiff.value = undefined; } },
    { isOpen: () => !!objectDetail.value, dismiss: () => { objectDetail.value = undefined; } },
    { isOpen: () => !!selectionTodo.value, dismiss: () => { selectionTodo.value = undefined; } },
    ...[
      agentPanel,
      planArchiveOpen,
      recyclePanel,
      historyPanel,
      referenceGraphOpened,
      commandPaletteOpened,
      templateLibraryOpen,
      touchOutlineOpen,
    ].map<DismissableSurface>((layer) => ({
      isOpen: () => layer.value,
      dismiss: () => { layer.value = false; },
    })),
    { isOpen: () => compactPanes.value && sidebar.value, dismiss: () => { sidebar.value = false; } },
    { isOpen: () => assistant.opened, dismiss: () => { assistant.opened = false; } },
    { isOpen: () => canNavigatePage(-1), dismiss: () => navigatePage(-1) },
  ];

  function beforeUnload(event: BeforeUnloadEvent) {
    if (store.pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function mobileBack(event: Event) {
    // Android's system back first dismisses the current surface, then navigates.
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) {
      event.preventDefault();
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      return;
    }
    if (modalBusy.value || updateLock.value || busy.value) {
      event.preventDefault();
      return;
    }
    const topmost = backDismissStack.find((surface) => surface.isOpen());
    if (topmost) {
      event.preventDefault();
      topmost.dismiss();
    }
  }

  async function mobileVisibility() {
    try {
      await handleMobileVisibility({
        mobile,
        hasWorkspace: !!workspace.value,
        visibilityState: document.visibilityState,
        flushWorkspace: () => store.flush(),
        flushEditing: () => editing.flush(),
        refreshWorkspace: () => store.refresh(),
        synchronize: () => extensions.refresh(),
      });
    } catch (reason) {
      store.report(reason);
    }
  }

  function outsideClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('.calendar-view-picker')) calendarModeOpen.value = false;
    if (!target.closest('.file-context-menu')) closeFileContextMenu();
    if (!target.closest('.directory-context-menu')) closeDirectoryContextMenu();
    if (!target.closest('.workspace-entry-context-menu')) closeWorkspaceEntryContextMenu();
    if (!target.closest('.page-context-menu')) closePageContextMenu();
    if (!target.closest('.outline-context-menu')) closeOutlineContextMenu();
    if (!target.closest('.dropdown, .menu-wrap, .sidebar-bottom')) {
      menu.value = false;
      workspaceMenu.value = false;
    }
  }

  function dismissFileContextMenu() {
    closeFileContextMenu();
  }

  function outsideContextMenu(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.tree-row')) closeFileContextMenu();
    if (!event.defaultPrevented && !(event.target as HTMLElement).closest('.directory-context-menu'))
      closeDirectoryContextMenu();
    if (
      !event.defaultPrevented &&
      !(event.target as HTMLElement).closest('.workspace-entry-context-menu')
    )
      closeWorkspaceEntryContextMenu();
    if (!event.defaultPrevented) {
      closePageContextMenu();
      closeOutlineContextMenu();
    }
  }

  function dismissPageContextMenu() {
    closePageContextMenu();
  }

  return {
    beforeUnload,
    mobileBack,
    mobileVisibility,
    outsideClick,
    dismissFileContextMenu,
    outsideContextMenu,
    dismissPageContextMenu,
  };
}
