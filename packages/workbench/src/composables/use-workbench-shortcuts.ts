import type { Ref } from 'vue';
import type { EditorSelectionContext } from '@tano/editor/selection-context';
import type { FileEntry } from '@tano/protocol';
import type { useAssistantStore } from '../assistant/store';
import type { DocumentExportFormat } from '../documents/document-export';
import type FileTree from '../files/components/FileTree.vue';
import type { SelectionTodoSession } from '../plans/selection-todo';
import type { WorkbenchExtensions } from '../runtime';
import type { SettingsPageId } from '../settings/settings-window';
import type PageSearch from '../shell/components/PageSearch.vue';
import type { ShortcutBindings } from '../shell/shortcuts';
import { useSurfaceDismissal } from '../shell/use-surface-dismissal';
import { useWorkbenchCommands } from '../shell/use-workbench-commands';
import { useWorkbenchKeybindings } from '../shell/use-workbench-keybindings';
import type { MarkdownEditor } from '../shell/workbench-async-components';
import type { useUpdatesStore } from '../stores/updates';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { useAuxiliaryWindows } from '../windows/manager';
import { useWindowEventBridge } from '../windows/use-window-event-bridge';

export { runWorkbenchCommandOrPlugin } from '../shell/use-workbench-commands';

export interface WorkbenchShortcutsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  updates: ReturnType<typeof useUpdatesStore>;
  extensions: WorkbenchExtensions;
  editing: WorkbenchExtensions['editing'];
  auxiliaryWindows: ReturnType<typeof useAuxiliaryWindows>;
  mainWindow: WindowContext;
  activeWindow: Ref<WindowContext>;
  isAuxiliaryWindow: boolean;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  sidebarView: Ref<string>;
  navigationContext: Ref<'home' | 'workspace'>;
  shortcuts: Ref<ShortcutBindings>;
  updateLock: Ref<boolean>;
  editorReadonly: Ref<boolean>;
  source: Ref<boolean>;
  revealMarkdown: Ref<boolean>;
  pageLocked: Ref<boolean>;
  workspaceLocked: Ref<boolean>;
  limitPageWidth: Ref<boolean>;
  pageWidthWritable: Ref<boolean>;
  showOutline: Ref<boolean>;
  showDocumentProperties: Ref<boolean>;
  editor: Ref<InstanceType<typeof MarkdownEditor> | undefined>;
  paneEditors: Map<string, InstanceType<typeof MarkdownEditor>>;
  paneEditorScrolls: Map<string, HTMLElement>;
  paneSearches: Map<string, InstanceType<typeof PageSearch>>;
  paneSelections: Record<string, EditorSelectionContext>;
  documentUndoAvailable: Ref<boolean>;
  documentRedoAvailable: Ref<boolean>;
  exportBusy: Ref<boolean>;
  printBusy: Ref<boolean>;
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
  historyPage: Ref<'versions' | 'updates'>;
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
  fileTree: Ref<InstanceType<typeof FileTree> | undefined>;
  selectedEntryIds: Ref<Set<string>>;
  selectionAnchorId: Ref<string | null>;
  selectedEntries: Ref<FileEntry[]>;
  showModal: (kind: 'newTab' | 'search' | 'delete' | 'saveAs', target?: FileEntry) => void;
  createNewDocument: () => Promise<void>;
  createNewEntry: (kind: 'document' | 'folder' | 'table', parent?: string) => Promise<void>;
  detachTab: (id: string) => Promise<void>;
  openImport: () => void;
  openTemplateLibrary: () => void;
  exportDocument: (format: DocumentExportFormat) => Promise<void>;
  printActiveDocument: () => Promise<void>;
  openPaneSearch: (id?: string, replace?: boolean) => void;
  undoDocument: () => void;
  redoDocument: () => void;
  toggleAssistant: () => void;
  togglePageLock: () => void;
  setLimitPageWidth: (value: boolean) => void;
  openDocumentDiscussion: () => unknown;
  toggleSidebar: () => void;
  selectContext: (context: 'home' | 'workspace') => void;
  toggleWorkspaceMenu: () => void;
  selectModule: (id: string) => void;
  openCalendar: (date?: Date) => void;
  openSettings: (page?: SettingsPageId) => void;
  closeFileContextMenu: (restoreFocus?: boolean) => void;
  closeDirectoryContextMenu: () => void;
  closeWorkspaceEntryContextMenu: (restoreFocus?: boolean) => void;
  closePageContextMenu: () => void;
  closeOutlineContextMenu: () => void;
  fileMutationDisabled: (file: FileEntry) => boolean;
  directoryHasManagedFile: (file: FileEntry) => boolean;
  startTreeRename: (file: FileEntry) => void;
  removeDocuments: (entries: FileEntry[]) => Promise<void>;
  selectActiveFileInTree: () => void;
  canNavigatePage: (direction: -1 | 1) => boolean;
  navigatePage: (direction: -1 | 1) => void;
  constrainSidebarToViewport: () => void;
}

export function useWorkbenchShortcuts(deps: WorkbenchShortcutsDeps) {
  const { workbenchCommands } = useWorkbenchCommands(deps);
  const keybindings = useWorkbenchKeybindings(deps);
  const dismissal = useSurfaceDismissal(deps);

  useWindowEventBridge({
    store: deps.store,
    auxiliaryWindows: deps.auxiliaryWindows,
    mainWindow: deps.mainWindow,
    activeWindow: deps.activeWindow,
    isAuxiliaryWindow: deps.isAuxiliaryWindow,
    routeConfiguredEditorShortcut: keybindings.routeConfiguredEditorShortcut,
    handleWorkbenchShortcut: keybindings.handleWorkbenchShortcut,
    handlePageSearchShortcut: keybindings.handlePageSearchShortcut,
    keydown: keybindings.keydown,
    beforeUnload: dismissal.beforeUnload,
    outsideClick: dismissal.outsideClick,
    outsideContextMenu: dismissal.outsideContextMenu,
    dismissFileContextMenu: dismissal.dismissFileContextMenu,
    closeDirectoryContextMenu: deps.closeDirectoryContextMenu,
    dismissPageContextMenu: dismissal.dismissPageContextMenu,
    closeOutlineContextMenu: deps.closeOutlineContextMenu,
    constrainSidebarToViewport: deps.constrainSidebarToViewport,
    mobileVisibility: dismissal.mobileVisibility,
    mobileBack: dismissal.mobileBack,
  });

  return {
    workbenchCommands,
  };
}
