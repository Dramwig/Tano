import { onBeforeUnmount, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { isElement } from '@tano/editor/dom-realm';
import type { FileEntry } from '@tano/protocol';
import type { useAssistantStore } from '../assistant/store';
import type FileTree from '../files/components/FileTree.vue';
import { pluginShortcutCommand } from '../plugins/workbench';
import type { WorkbenchExtensions } from '../runtime';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type PageSearch from './components/PageSearch.vue';
import { configuredEditorShortcuts } from './configured-editor-shortcuts';
import { isSidebarToggleShortcut, matchesShortcut, type ShortcutBindings } from './shortcuts';
import type { MarkdownEditor } from './workbench-async-components';

export interface WorkbenchKeybindingsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  editing: WorkbenchExtensions['editing'];
  activeWindow: Ref<WindowContext>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  shortcuts: Ref<ShortcutBindings>;
  updateLock: Ref<boolean>;
  source: Ref<boolean>;
  revealMarkdown: Ref<boolean>;
  paneEditors: Map<string, InstanceType<typeof MarkdownEditor>>;
  paneEditorScrolls: Map<string, HTMLElement>;
  paneSearches: Map<string, InstanceType<typeof PageSearch>>;
  menu: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  settingsPanel: Ref<boolean>;
  commandPaletteOpened: Ref<boolean>;
  importPanel: Ref<boolean>;
  modal: Ref<'' | 'newTab' | 'search' | 'delete' | 'saveAs'>;
  modalBusy: Ref<boolean>;
  fileContextMenu: Ref<{ file: FileEntry; x: number; y: number } | null>;
  directoryContextMenu: Ref<{ parent: string; x: number; y: number } | null>;
  outlineContextMenu: Ref<unknown>;
  fileTree: Ref<InstanceType<typeof FileTree> | undefined>;
  selectedEntryIds: Ref<Set<string>>;
  selectionAnchorId: Ref<string | null>;
  selectedEntries: Ref<FileEntry[]>;
  showModal: (kind: 'newTab' | 'search' | 'delete' | 'saveAs', target?: FileEntry) => void;
  createNewDocument: () => Promise<void>;
  printActiveDocument: () => Promise<void>;
  openPaneSearch: (id?: string, replace?: boolean) => void;
  toggleAssistant: () => void;
  toggleSidebar: () => void;
  closeFileContextMenu: (restoreFocus?: boolean) => void;
  closeDirectoryContextMenu: () => void;
  closeOutlineContextMenu: () => void;
  fileMutationDisabled: (file: FileEntry) => boolean;
  directoryHasManagedFile: (file: FileEntry) => boolean;
  startTreeRename: (file: FileEntry) => void;
  removeDocuments: (entries: FileEntry[]) => Promise<void>;
  selectActiveFileInTree: () => void;
}

export function useWorkbenchKeybindings(deps: WorkbenchKeybindingsDeps) {
  const {
    store,
    assistant,
    editing,
    activeWindow,
    compactPanes,
    sidebar,
    shortcuts,
    updateLock,
    source,
    revealMarkdown,
    paneEditors,
    paneEditorScrolls,
    paneSearches,
    menu,
    workspaceMenu,
    settingsPanel,
    commandPaletteOpened,
    importPanel,
    modal,
    modalBusy,
    fileContextMenu,
    directoryContextMenu,
    outlineContextMenu,
    fileTree,
    selectedEntryIds,
    selectionAnchorId,
    selectedEntries,
    showModal,
    createNewDocument,
    printActiveDocument,
    openPaneSearch,
    toggleAssistant,
    toggleSidebar,
    closeFileContextMenu,
    closeDirectoryContextMenu,
    closeOutlineContextMenu,
    fileMutationDisabled,
    directoryHasManagedFile,
    startTreeRename,
    removeDocuments,
    selectActiveFileInTree,
  } = deps;
  const { workspace, active, openingWorkspace } = storeToRefs(store);

  const routeConfiguredEditorShortcut = configuredEditorShortcuts(
    () => shortcuts.value,
    () => !settingsPanel.value && !modal.value && !commandPaletteOpened.value && !updateLock.value,
    () => paneEditorScrolls.get(store.activePaneId),
    (id) => {
      const action = (
        {
          deleteBlock: 'delete',
          moveBlockUp: 'move-up',
          moveBlockDown: 'move-down',
          indentBlock: 'indent',
          outdentBlock: 'outdent',
        } as Record<string, string>
      )[id];
      if (action) paneEditors.get(store.activePaneId)?.blockShortcut(action);
    },
  );
  // Register during setup, before child editors install their native capture handlers.
  window.addEventListener('keydown', routeConfiguredEditorShortcut, true);
  onBeforeUnmount(() => window.removeEventListener('keydown', routeConfiguredEditorShortcut, true));

  function handleWorkbenchShortcut(event: KeyboardEvent) {
    if (openingWorkspace.value) return;
    if (
      event.defaultPrevented ||
      importPanel.value ||
      settingsPanel.value ||
      commandPaletteOpened.value ||
      updateLock.value ||
      modal.value
    )
      return;
    let action: (() => void) | undefined;
    const standardEditor = !!active.value && !editing.active && !editing.activeBusy;
    if (
      activeWindow.value.id === 'main' &&
      workspace.value &&
      isSidebarToggleShortcut(event, shortcuts.value)
    )
      action = toggleSidebar;
    else if (matchesShortcut(event, 'save', shortcuts.value))
      action = () => {
        void store.flush();
      };
    else if (active.value && matchesShortcut(event, 'print', shortcuts.value))
      action = () => {
        void printActiveDocument();
      };
    else if (standardEditor && matchesShortcut(event, 'toggleSource', shortcuts.value))
      action = () => {
        source.value = !source.value;
      };
    else if (
      standardEditor &&
      !source.value &&
      matchesShortcut(event, 'toggleMarkdownReveal', shortcuts.value)
    )
      action = () => {
        revealMarkdown.value = !revealMarkdown.value;
      };
    else if (
      workspace.value &&
      assistant.available &&
      matchesShortcut(event, 'toggleAssistant', shortcuts.value)
    )
      action = toggleAssistant;
    else if (matchesShortcut(event, 'findDocument', shortcuts.value))
      action = () => showModal('search');
    else if (workspace.value && matchesShortcut(event, 'openDocument', shortcuts.value))
      action = () => showModal('newTab');
    else if (workspace.value && matchesShortcut(event, 'newDocument', shortcuts.value))
      action = () => {
        void createNewDocument();
      };
    else if (workspace.value && matchesShortcut(event, 'commandPalette', shortcuts.value))
      action = () => {
        commandPaletteOpened.value = true;
      };
    if (!action && workspace.value) {
      const command = pluginShortcutCommand(event, store.pluginCommands, shortcuts.value);
      if (command)
        action = () => {
          void store
            .interactWithPlugin({
              workspaceId: workspace.value!.id,
              pluginId: command.pluginId,
              instanceId: command.instanceId,
              kind: 'command',
              name: command.id,
              payload: { workspaceId: workspace.value!.id, fileId: store.active?.id },
            })
            .catch(store.report);
        };
    }
    if (!action) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function handlePageSearchShortcut(event: KeyboardEvent) {
    if (openingWorkspace.value) return;
    if (
      importPanel.value ||
      settingsPanel.value ||
      commandPaletteOpened.value ||
      updateLock.value ||
      modal.value ||
      event.isComposing ||
      event.keyCode === 229 ||
      event.defaultPrevented
    )
      return;
    const search = paneSearches.get(store.activePaneId);
    if (!search) return;
    const find = matchesShortcut(event, 'pageSearch', shortcuts.value);
    const replace = matchesShortcut(event, 'pageReplace', shortcuts.value);
    if (find || replace) {
      event.preventDefault();
      event.stopPropagation();
      openPaneSearch(store.activePaneId, replace);
    } else if (
      search.isOpen() &&
      !(isElement(event.target) && event.target.closest('.page-search')) &&
      (matchesShortcut(event, 'closeSearch', shortcuts.value) ||
        matchesShortcut(event, 'nextMatchFromEditor', shortcuts.value) ||
        matchesShortcut(event, 'previousMatchFromEditor', shortcuts.value))
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (matchesShortcut(event, 'closeSearch', shortcuts.value)) search.close();
      else
        search.navigate(matchesShortcut(event, 'previousMatchFromEditor', shortcuts.value) ? -1 : 1);
    }
  }

  function handleFileTreeKeydown(event: KeyboardEvent, treeRow: HTMLElement): boolean {
    if (event.key === 'F2') {
      event.preventDefault();
      const file = workspace.value?.files.find((entry) => entry.id === treeRow.dataset.entryId);
      if (
        file &&
        !fileMutationDisabled(file) &&
        !directoryHasManagedFile(file) &&
        (!store.isWeb || file.kind === 'file')
      )
        startTreeRename(file);
      return true;
    }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      selectedEntryIds.value = new Set(fileTree.value?.getVisibleIds() ?? []);
      selectionAnchorId.value = treeRow.dataset.entryId ?? null;
      return true;
    }
    if (event.key === 'Delete' && selectedEntries.value.length) {
      event.preventDefault();
      void removeDocuments([...selectedEntries.value]);
      return true;
    }
    if (event.key === 'Escape' && selectedEntryIds.value.size) {
      event.preventDefault();
      selectActiveFileInTree();
      return true;
    }
    return false;
  }

  function keydown(event: KeyboardEvent) {
    const { document } = activeWindow.value;
    if (openingWorkspace.value) return;
    if (importPanel.value) return;
    if (settingsPanel.value) {
      if (event.key === 'Escape') settingsPanel.value = false;
      return;
    }
    if (event.key === 'Escape' && fileContextMenu.value) {
      event.preventDefault();
      closeFileContextMenu(true);
      return;
    }
    if (event.key === 'Escape' && directoryContextMenu.value) {
      event.preventDefault();
      closeDirectoryContextMenu();
      return;
    }
    if (event.key === 'Escape' && outlineContextMenu.value) {
      event.preventDefault();
      closeOutlineContextMenu();
      return;
    }
    if (updateLock.value && event.key !== 'Tab') {
      if (event.key === 'Escape' || event.ctrlKey || event.metaKey) event.preventDefault();
      return;
    }
    const treeRow = (event.target as HTMLElement | null)?.closest<HTMLElement>(
      '.tree-scroll .tree-row[data-entry-id]',
    );
    if (treeRow && !modal.value && handleFileTreeKeydown(event, treeRow)) {
      return;
    }
    if (event.key === 'Escape' && !modalBusy.value) {
      modal.value = '';
      menu.value = false;
      workspaceMenu.value = false;
      if (compactPanes.value) sidebar.value = false;
    }
    if (event.key === 'Tab' && modal.value) {
      const targets = [
        ...document.querySelectorAll<HTMLElement>(
          ':is(.modal, .search-modal) :is(button:not(:disabled), input, a)',
        ),
      ];
      const first = targets[0];
      const last = targets.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  return {
    routeConfiguredEditorShortcut,
    handleWorkbenchShortcut,
    handlePageSearchShortcut,
    keydown,
  };
}
