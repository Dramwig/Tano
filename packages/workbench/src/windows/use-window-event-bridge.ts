import { onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { installInteractionMotion } from '@tano/editor/motion';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from './context';
import type { useAuxiliaryWindows } from './manager';

export interface WindowEventBridgeDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  auxiliaryWindows: ReturnType<typeof useAuxiliaryWindows>;
  mainWindow: WindowContext;
  activeWindow: Ref<WindowContext>;
  isAuxiliaryWindow: boolean;
  routeConfiguredEditorShortcut: (event: KeyboardEvent) => void;
  handleWorkbenchShortcut: (event: KeyboardEvent) => void;
  handlePageSearchShortcut: (event: KeyboardEvent) => void;
  keydown: (event: KeyboardEvent) => void;
  beforeUnload: (event: BeforeUnloadEvent) => void;
  outsideClick: (event: MouseEvent) => void;
  outsideContextMenu: (event: MouseEvent) => void;
  dismissFileContextMenu: () => void;
  closeDirectoryContextMenu: () => void;
  dismissPageContextMenu: () => void;
  closeOutlineContextMenu: () => void;
  constrainSidebarToViewport: () => void;
  mobileVisibility: () => Promise<void>;
  mobileBack: (event: Event) => void;
}

export function useWindowEventBridge(deps: WindowEventBridgeDeps) {
  const {
    store,
    auxiliaryWindows,
    mainWindow,
    activeWindow,
    isAuxiliaryWindow,
    routeConfiguredEditorShortcut,
    handleWorkbenchShortcut,
    handlePageSearchShortcut,
    keydown,
    beforeUnload,
    outsideClick,
    outsideContextMenu,
    dismissFileContextMenu,
    closeDirectoryContextMenu,
    dismissPageContextMenu,
    closeOutlineContextMenu,
    constrainSidebarToViewport,
    mobileVisibility,
    mobileBack,
  } = deps;

  function bindAuxiliaryEvents(context: WindowContext) {
    const focus = () => {
      activeWindow.value = context;
      const paneId = store.windowLayouts[context.id]?.activePaneId;
      if (paneId) store.focusPane(paneId);
    };
    const handlers: [string, EventListener, boolean][] = [
      ['focus', focus, true],
      ['pointerdown', focus, true],
      ['keydown', routeConfiguredEditorShortcut as EventListener, true],
      ['keydown', handleWorkbenchShortcut as EventListener, true],
      ['keydown', handlePageSearchShortcut as EventListener, true],
      ['keydown', keydown as EventListener, false],
      ['click', outsideClick as EventListener, false],
      ['contextmenu', outsideContextMenu as EventListener, false],
      ['scroll', dismissPageContextMenu, true],
      ['scroll', closeOutlineContextMenu, true],
      ['resize', dismissPageContextMenu, false],
      ['resize', closeOutlineContextMenu, false],
    ];
    for (const [name, handler, capture] of handlers)
      context.window.addEventListener(name, handler, capture);
    const stopMotion = installInteractionMotion(context.document);
    return () => {
      for (const [name, handler, capture] of handlers)
        context.window.removeEventListener(name, handler, capture);
      stopMotion();
      if (activeWindow.value === context) activeWindow.value = mainWindow;
    };
  }

  const auxiliaryEventDisposers = new Map<string, () => void>();
  watch(
    () => [...auxiliaryWindows.entries.values()],
    (entries) => {
      for (const [id, dispose] of auxiliaryEventDisposers) {
        if (!entries.some((entry) => entry.id === id)) {
          dispose();
          auxiliaryEventDisposers.delete(id);
        }
      }
      for (const entry of entries) {
        if (!auxiliaryEventDisposers.has(entry.id))
          auxiliaryEventDisposers.set(entry.id, bindAuxiliaryEvents(entry.context));
      }
    },
    { flush: 'sync' },
  );

  const focusMain = () => {
    activeWindow.value = mainWindow;
    const paneId = store.windowLayouts.main.activePaneId;
    if (paneId) store.focusPane(paneId);
  };
  window.addEventListener('focus', focusMain);
  window.addEventListener('pointerdown', focusMain, true);

  onMounted(() => {
    window.addEventListener('keydown', handleWorkbenchShortcut, true);
    window.addEventListener('keydown', keydown);
    window.addEventListener('keydown', handlePageSearchShortcut, true);
    window.addEventListener('beforeunload', beforeUnload);
    window.addEventListener('click', outsideClick);
    window.addEventListener('contextmenu', outsideContextMenu);
    window.addEventListener('scroll', dismissFileContextMenu, true);
    window.addEventListener('scroll', closeDirectoryContextMenu, true);
    window.addEventListener('scroll', dismissPageContextMenu, true);
    window.addEventListener('scroll', closeOutlineContextMenu, true);
    window.addEventListener('resize', dismissFileContextMenu);
    window.addEventListener('resize', closeDirectoryContextMenu);
    window.addEventListener('resize', dismissPageContextMenu);
    window.addEventListener('resize', closeOutlineContextMenu);
    if (!isAuxiliaryWindow) window.addEventListener('resize', constrainSidebarToViewport);
    document.addEventListener('visibilitychange', mobileVisibility);
    window.addEventListener('tano:back', mobileBack);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('focus', focusMain);
    window.removeEventListener('pointerdown', focusMain, true);
    for (const dispose of auxiliaryEventDisposers.values()) dispose();
    auxiliaryEventDisposers.clear();
    window.removeEventListener('keydown', handleWorkbenchShortcut, true);
    window.removeEventListener('keydown', keydown);
    window.removeEventListener('keydown', handlePageSearchShortcut, true);
    window.removeEventListener('beforeunload', beforeUnload);
    window.removeEventListener('click', outsideClick);
    window.removeEventListener('contextmenu', outsideContextMenu);
    window.removeEventListener('scroll', dismissFileContextMenu, true);
    window.removeEventListener('scroll', closeDirectoryContextMenu, true);
    window.removeEventListener('scroll', dismissPageContextMenu, true);
    window.removeEventListener('scroll', closeOutlineContextMenu, true);
    window.removeEventListener('resize', dismissFileContextMenu);
    window.removeEventListener('resize', closeDirectoryContextMenu);
    window.removeEventListener('resize', dismissPageContextMenu);
    window.removeEventListener('resize', closeOutlineContextMenu);
    window.removeEventListener('resize', constrainSidebarToViewport);
    document.removeEventListener('visibilitychange', mobileVisibility);
    window.removeEventListener('tano:back', mobileBack);
  });
}
