import { nextTick, onBeforeUnmount, onMounted, ref, type ComputedRef, type Ref } from 'vue';
import { nativeInvoke as invoke } from '../platform/native-bridge';
import type { DocumentTab, useWorkspaceStore } from '../stores/workspace';
import type { useWindowContext } from '../windows/context';

export type DesktopTabContextAction =
  | 'split-right'
  | 'split-bottom'
  | 'new-tab'
  | 'detach'
  | 'close'
  | 'close-others'
  | 'close-right'
  | 'close-all'
  | 'open-devtools';

export interface DesktopTabMenuOptions {
  paneId: () => string | undefined;
  canOpenDevtools: ComputedRef<boolean>;
  store: ReturnType<typeof useWorkspaceStore>;
  windowContext: ReturnType<typeof useWindowContext>;
  tabList: Ref<HTMLElement | undefined>;
  blankTrack: Ref<HTMLElement | null>;
  paneTabs: ComputedRef<DocumentTab[]>;
  activatePane: () => void;
  closeTab: (id: string) => void;
  onNewTab: () => void;
  onDetachTab: (id: string) => void;
}

export function useDesktopTabMenu(options: DesktopTabMenuOptions) {
  const {
    paneId,
    canOpenDevtools,
    store,
    windowContext,
    tabList,
    blankTrack,
    paneTabs,
    activatePane,
    closeTab,
    onNewTab,
    onDetachTab,
  } = options;
  const { window, document } = windowContext;

  const contextMenuElement = ref<HTMLElement>();
  const contextMenu = ref<{ tabId: string | null; x: number; y: number }>();
  let contextTrigger: HTMLElement | null = null;

  function closeContextMenu(restoreFocus = false) {
    contextMenu.value = undefined;
    if (restoreFocus) void nextTick(() => contextTrigger?.focus({ preventScroll: true }));
  }

  function openContextMenu(event: MouseEvent | KeyboardEvent, tabId: string | null) {
    event.preventDefault();
    const trigger = tabId
      ? (event.target as HTMLElement)
          .closest<HTMLElement>('.desktop-tab')
          ?.querySelector<HTMLElement>('.desktop-tab-switch')
      : (event.currentTarget as HTMLElement);
    if (!trigger) return;
    contextTrigger = tabId
      ? trigger
      : (tabList.value?.parentElement?.querySelector('.desktop-tab-add') ?? trigger);
    const rect = trigger.getBoundingClientRect();
    const x = 'clientX' in event && event.clientX ? event.clientX : rect.left + 16;
    const y = 'clientY' in event && event.clientY ? event.clientY : rect.bottom;
    contextMenu.value = { tabId, x: Math.max(8, x), y: Math.max(8, y) };
    void nextTick(() => {
      const menu = contextMenuElement.value;
      if (!menu || contextMenu.value?.tabId !== tabId) return;
      contextMenu.value.x = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
      contextMenu.value.y = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
      // Window controls live in the browser top layer, above any z-index. Keep
      // menus below them when viewport clamping puts the menu in their column.
      const controls = document.querySelector<HTMLElement>('.desktop-window-actions');
      const controlsRect = controls?.getBoundingClientRect();
      if (
        controlsRect &&
        contextMenu.value.x < controlsRect.right &&
        contextMenu.value.x + menu.offsetWidth > controlsRect.left &&
        contextMenu.value.y < controlsRect.bottom &&
        contextMenu.value.y + menu.offsetHeight > controlsRect.top
      ) {
        contextMenu.value.y = controlsRect.bottom + 8;
      }
      menu.style.maxHeight = `${Math.max(0, window.innerHeight - contextMenu.value.y - 8)}px`;
      menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
    });
  }

  function onBlankTrackContext(event: MouseEvent) {
    openContextMenu(event, null);
  }

  function onOutsidePointer(event: PointerEvent) {
    if (contextMenu.value && !contextMenuElement.value?.contains(event.target as Node)) {
      closeContextMenu();
    }
  }

  function onOutsideContext(event: MouseEvent) {
    if (
      contextMenu.value &&
      !event.defaultPrevented &&
      !contextMenuElement.value?.contains(event.target as Node)
    ) {
      closeContextMenu();
    }
  }

  function onContextKeydown(event: KeyboardEvent) {
    if (!contextMenu.value) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closeContextMenu(true);
      return;
    }
    if (event.key === 'Tab') {
      closeContextMenu();
      return;
    }
    if (!contextMenuElement.value?.contains(event.target as Node)) return;
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const buttons = [
      ...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
        []),
    ];
    if (!buttons.length) return;
    event.preventDefault();
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
    buttons[next]?.focus();
  }

  function dismissContextMenu() {
    closeContextMenu();
  }

  async function closeTabs(ids: string[]) {
    for (const id of ids) {
      await store.close(id);
      if (paneTabs.value.some((tab) => tab.id === id)) break;
    }
  }

  async function contextAction(action: DesktopTabContextAction) {
    const tabId = contextMenu.value?.tabId;
    closeContextMenu();
    if (action === 'open-devtools') {
      if (canOpenDevtools.value) {
        await invoke<void>('open_devtools', { windowLabel: windowContext.label }).catch(
          store.report,
        );
      }
      return;
    }
    activatePane();
    const currentPaneId = paneId();
    if ((action === 'split-right' || action === 'split-bottom') && tabId && currentPaneId) {
      if (paneTabs.value.length === 1) store.createBlankTab();
      store.dockTab(tabId, {
        paneId: currentPaneId,
        side: action === 'split-right' ? 'right' : 'bottom',
      });
      return;
    }
    if (action === 'new-tab') return onNewTab();
    if (action === 'detach' && tabId) return onDetachTab(tabId);
    if (action === 'close' && tabId) return closeTab(tabId);
    const ids = paneTabs.value.map((tab) => tab.id);
    if (action === 'close-others' && tabId) {
      await closeTabs(ids.filter((id) => id !== tabId));
      if (paneTabs.value.some((tab) => tab.id === tabId)) store.activeId = tabId;
    } else if (action === 'close-right' && tabId) {
      await closeTabs(ids.slice(ids.indexOf(tabId) + 1));
    } else if (action === 'close-all') {
      await closeTabs(ids);
    }
  }

  onMounted(() => {
    blankTrack.value =
      tabList.value?.closest('.workspace-tabbar')?.querySelector('.workspace-window-drag') ??
      tabList.value?.closest('.desktop-window-titlebar')?.querySelector('.desktop-window-drag') ??
      null;
    blankTrack.value?.addEventListener('contextmenu', onBlankTrackContext);
    window.addEventListener('pointerdown', onOutsidePointer, true);
    window.addEventListener('contextmenu', onOutsideContext);
    window.addEventListener('keydown', onContextKeydown, true);
    window.addEventListener('scroll', dismissContextMenu, true);
    window.addEventListener('resize', dismissContextMenu);
  });

  onBeforeUnmount(() => {
    blankTrack.value?.removeEventListener('contextmenu', onBlankTrackContext);
    window.removeEventListener('pointerdown', onOutsidePointer, true);
    window.removeEventListener('contextmenu', onOutsideContext);
    window.removeEventListener('keydown', onContextKeydown, true);
    window.removeEventListener('scroll', dismissContextMenu, true);
    window.removeEventListener('resize', dismissContextMenu);
  });

  return {
    contextMenuElement,
    contextMenu,
    openContextMenu,
    closeContextMenu,
    contextAction,
  };
}
