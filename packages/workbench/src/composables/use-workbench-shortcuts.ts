import { computed, onBeforeUnmount, onMounted, watch, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { isElement } from '@tano/editor/dom-realm';
import { installInteractionMotion } from '@tano/editor/motion';
import { defaultSelectionContext, type EditorSelectionContext } from '@tano/editor/selection-context';
import type { FileEntry } from '@tano/protocol';
import { native } from '../workspace/adapter';
import type { useAssistantStore } from '../assistant/store';
import { editorPaletteCommands, type WorkbenchCommand } from '../shell/command-palette';
import type FileTree from '../files/components/FileTree.vue';
import type PageSearch from '../shell/components/PageSearch.vue';
import { configuredEditorShortcuts } from '../shell/configured-editor-shortcuts';
import type { DocumentExportFormat } from '../documents/document-export';
import { t } from '../i18n/i18n';
import { handleMobileVisibility } from '../shell/mobile-lifecycle';
import { mobile } from '../platform/platform';
import { pluginShortcutCommand } from '../plugins/workbench';
import type { WorkbenchExtensions } from '../runtime';
import type { SelectionTodoSession } from '../plans/selection-todo';
import type { SettingsPageId } from '../settings/settings-window';
import {
  isSidebarToggleShortcut,
  matchesShortcut,
  type ShortcutBindings,
} from '../shell/shortcuts';
import type { useUpdatesStore } from '../stores/updates';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { useAuxiliaryWindows } from '../windows/manager';
import type { MarkdownEditor } from '../shell/workbench-async-components';

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
  objectPanel: Ref<boolean>;
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
  createNewEntry: (kind: 'document' | 'folder', parent?: string) => Promise<void>;
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
  openSystemSync: (event?: Event) => void;
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
  const {
    store,
    assistant,
    updates,
    extensions,
    editing,
    auxiliaryWindows,
    mainWindow,
    activeWindow,
    isAuxiliaryWindow,
    compactPanes,
    sidebar,
    sidebarView,
    navigationContext,
    shortcuts,
    updateLock,
    editorReadonly,
    source,
    revealMarkdown,
    pageLocked,
    workspaceLocked,
    limitPageWidth,
    pageWidthWritable,
    showOutline,
    showDocumentProperties,
    editor,
    paneEditors,
    paneEditorScrolls,
    paneSearches,
    paneSelections,
    documentUndoAvailable,
    documentRedoAvailable,
    exportBusy,
    printBusy,
    menu,
    workspaceMenu,
    settingsPanel,
    commandPaletteOpened,
    importPanel,
    agentPanel,
    objectPanel,
    recyclePanel,
    historyPanel,
    historyPage,
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
    fileTree,
    selectedEntryIds,
    selectionAnchorId,
    selectedEntries,
    showModal,
    createNewDocument,
    createNewEntry,
    detachTab,
    openImport,
    openTemplateLibrary,
    exportDocument,
    printActiveDocument,
    openPaneSearch,
    undoDocument,
    redoDocument,
    toggleAssistant,
    togglePageLock,
    setLimitPageWidth,
    openDocumentDiscussion,
    toggleSidebar,
    selectContext,
    toggleWorkspaceMenu,
    selectModule,
    openCalendar,
    openSystemSync,
    openSettings,
    closeFileContextMenu,
    closeDirectoryContextMenu,
    closeWorkspaceEntryContextMenu,
    closePageContextMenu,
    closeOutlineContextMenu,
    fileMutationDisabled,
    directoryHasManagedFile,
    startTreeRename,
    removeDocuments,
    selectActiveFileInTree,
    canNavigatePage,
    navigatePage,
    constrainSidebarToViewport,
  } = deps;
  const { workspace, active, busy, openingWorkspace } = storeToRefs(store);

  const workbenchCommands = computed<WorkbenchCommand[]>(() => {
    const hasDocument = !!active.value;
    const writableWorkspace =
      !!workspace.value && !workspace.value.readOnly && !busy.value && !updateLock.value;
    const standardEditor = hasDocument && !editing.active && !editing.activeBusy;
    const editable = standardEditor && !editorReadonly.value && !active.value?.missing;
    return [
      {
        id: 'workbench.search',
        category: t('文档'),
        get label() {
          return t('查找文档');
        },
        shortcut: shortcuts.value.findDocument,
        available: !busy.value,
        run: () => showModal('search'),
      },
      {
        id: 'workbench.open',
        category: t('文档'),
        get label() {
          return t('打开文档');
        },
        shortcut: shortcuts.value.openDocument,
        available: !busy.value,
        run: () => showModal('newTab'),
      },
      {
        id: 'workbench.new',
        category: t('文档'),
        get label() {
          return t('新建文档');
        },
        shortcut: shortcuts.value.newDocument,
        available: writableWorkspace,
        run: createNewDocument,
      },
      // Opens a blank tab in its own window. It shares the current workspace; an independent
      // window with its own workspace would need a second app instance and is not supported.
      {
        id: 'workbench.new-window',
        category: t('文档'),
        get label() {
          return t('新建窗口');
        },
        available:
          native &&
          !mobile &&
          !isAuxiliaryWindow &&
          !!workspace.value &&
          !busy.value &&
          !updateLock.value,
        run: () => {
          const id = store.createBlankTab();
          if (id) return detachTab(id);
        },
      },
      {
        id: 'workbench.reveal',
        category: t('文档'),
        get label() {
          return t('在资源管理器中显示');
        },
        available: native && !mobile && !isAuxiliaryWindow && !!workspace.value && !store.isWeb,
        run: () => store.reveal(),
      },
      {
        id: 'workbench.open-folder',
        category: t('文档'),
        get label() {
          return t('打开文件夹');
        },
        available: !isAuxiliaryWindow && !busy.value && !updateLock.value,
        run: () => store.openWorkspace(),
      },
      {
        id: 'workbench.save',
        category: t('文档'),
        get label() {
          return t('立即保存');
        },
        shortcut: shortcuts.value.save,
        available: hasDocument && !busy.value && !updateLock.value,
        run: () => store.flush(),
      },
      {
        id: 'workbench.saveAs',
        category: t('文档'),
        get label() {
          return t('另存副本');
        },
        available: standardEditor && writableWorkspace,
        run: () => showModal('saveAs'),
      },
      {
        id: 'workbench.folder',
        category: t('文档'),
        get label() {
          return t('新建文件夹');
        },
        available: writableWorkspace,
        run: () => createNewEntry('folder'),
      },
      {
        id: 'workbench.import',
        category: t('文档'),
        get label() {
          return t('导入文档');
        },
        available: writableWorkspace,
        run: openImport,
      },
      {
        id: 'workbench.templates',
        category: t('文档'),
        get label() {
          return t('文档模板');
        },
        available: writableWorkspace,
        run: openTemplateLibrary,
      },
      ...(['markdown', 'docx', 'pdf', 'html', 'png'] as const).map((format) => ({
        id: `workbench.export.${format}`,
        category: t('导出'),
        label: { markdown: 'Markdown', docx: 'Word', pdf: 'PDF', html: 'HTML', png: t('图片') }[
          format
        ],
        keywords: format,
        available: hasDocument && !exportBusy.value,
        run: () => exportDocument(format),
      })),
      {
        id: 'workbench.print',
        category: t('文档'),
        get label() {
          return t('打印文档');
        },
        shortcut: shortcuts.value.print,
        available: hasDocument && !printBusy.value,
        run: printActiveDocument,
      },
      {
        id: 'workbench.find',
        category: t('编辑'),
        get label() {
          return t('页内搜索');
        },
        shortcut: shortcuts.value.pageSearch,
        available: standardEditor,
        run: () => openPaneSearch(),
      },
      {
        id: 'workbench.replace',
        category: t('编辑'),
        get label() {
          return t('查找与替换');
        },
        shortcut: shortcuts.value.pageReplace,
        available: editable,
        run: () => openPaneSearch(store.activePaneId, true),
      },
      {
        id: 'workbench.undo',
        category: t('编辑'),
        get label() {
          return t('撤销');
        },
        available: editable && documentUndoAvailable.value,
        run: undoDocument,
      },
      {
        id: 'workbench.redo',
        category: t('编辑'),
        get label() {
          return t('重做');
        },
        available: editable && documentRedoAvailable.value,
        run: redoDocument,
      },
      ...editorPaletteCommands({
        editable: editable && !!editor.value,
        source: source.value,
        context: paneSelections[store.activePaneId] ?? defaultSelectionContext,
        features: store.capabilities.features,
        run: (name, value) => editor.value?.command(name, value),
      }),
      {
        id: 'workbench.source',
        category: t('视图'),
        label: source.value ? t('返回可视化编辑') : t('切换源码模式'),
        shortcut: shortcuts.value.toggleSource,
        available: standardEditor,
        keywords: 'Markdown source',
        run: () => {
          source.value = !source.value;
        },
      },
      {
        id: 'workbench.markdown-reveal',
        category: t('视图'),
        get label() {
          return t('光标展开源码');
        },
        shortcut: shortcuts.value.toggleMarkdownReveal,
        available: standardEditor && !source.value,
        keywords: 'Markdown source cursor',
        run: () => {
          revealMarkdown.value = !revealMarkdown.value;
        },
      },
      {
        id: 'workbench.assistant',
        category: t('视图'),
        get label() {
          return t('打开或关闭同页助手');
        },
        shortcut: shortcuts.value.toggleAssistant,
        available: !!workspace.value && assistant.available,
        run: toggleAssistant,
      },
      {
        id: 'workbench.reading',
        category: t('视图'),
        label: pageLocked.value ? t('退出阅读模式') : t('进入阅读模式'),
        available: hasDocument && !workspaceLocked.value,
        keywords: t('锁定页面 解锁'),
        run: togglePageLock,
      },
      {
        id: 'workbench.width',
        category: t('视图'),
        label: limitPageWidth.value ? t('展开页面全宽') : t('限制页面宽度'),
        available: hasDocument && pageWidthWritable.value,
        run: () => setLimitPageWidth(!limitPageWidth.value),
      },
      {
        id: 'workbench.outline',
        category: t('视图'),
        label: showOutline.value ? t('隐藏文档目录') : t('显示文档目录'),
        available: hasDocument,
        keywords: t('大纲'),
        run: () => {
          showOutline.value = !showOutline.value;
        },
      },
      {
        id: 'workbench.properties',
        category: t('视图'),
        label: showDocumentProperties.value ? t('隐藏文档属性') : t('显示文档属性'),
        available: hasDocument,
        run: () => {
          showDocumentProperties.value = !showDocumentProperties.value;
        },
      },
      {
        id: 'workbench.discussion',
        category: t('文档'),
        get label() {
          return t('发起讨论');
        },
        keywords: t('文档讨论 评论'),
        available: editable,
        run: openDocumentDiscussion,
      },
      {
        id: 'workbench.sidebar',
        category: t('视图'),
        label: sidebar.value ? t('收起侧栏') : t('展开侧栏'),
        shortcut: shortcuts.value.toggleSidebar,
        available: !isAuxiliaryWindow,
        run: toggleSidebar,
      },
      {
        id: 'workbench.home',
        category: t('导航'),
        get label() {
          return t('切换到主页');
        },
        available: !isAuxiliaryWindow,
        run: () => {
          selectContext('home');
          sidebar.value = true;
        },
      },
      {
        id: 'workbench.switch-workspace',
        category: t('导航'),
        get label() {
          return t('切换工作区');
        },
        available: !isAuxiliaryWindow,
        run: () => {
          sidebar.value = true;
          toggleWorkspaceMenu();
        },
      },
      ...(extensions.commands ?? []),
      {
        id: 'workbench.repository',
        category: t('工作区'),
        get label() {
          return t('打开仓库');
        },
        available: !isAuxiliaryWindow,
        run: () => {
          sidebar.value = true;
          sidebarView.value = 'repository';
        },
      },
      {
        id: 'workbench.plan',
        category: t('工作区'),
        get label() {
          return t('打开计划');
        },
        available: !isAuxiliaryWindow && store.workspaceSettings.showPlan,
        run: () => {
          sidebar.value = true;
          selectModule('plan');
        },
      },
      {
        id: 'workbench.calendar',
        category: t('工作区'),
        get label() {
          return t('打开日历');
        },
        available: store.workspaceSettings.showPlan,
        run: () => openCalendar(),
      },
      {
        id: 'workbench.graph',
        category: t('工作区'),
        get label() {
          return t('打开关系图谱');
        },
        available: store.workspaceSettings.showGraph,
        run: () => store.openGraphTab(),
      },
      // Dev-only prototype; the native command is compiled out of release builds.
      {
        id: 'workbench.git',
        category: t('工作区'),
        label: 'Git 与同步',
        keywords: 'Git 状态 差异 提交 历史 同步',
        available: native && !mobile && !!workspace.value && !store.isWeb,
        run: () => openSystemSync(),
      },
      {
        id: 'workbench.plugins',
        category: t('工作区'),
        get label() {
          return t('打开插件中心');
        },
        available: store.workspaceSettings.showPlugins,
        run: () => store.openPluginsTab(),
      },
      {
        id: 'workbench.updates',
        category: t('历史'),
        get label() {
          return t('文档更新历史');
        },
        available: hasDocument,
        run: () => {
          historyPage.value = 'updates';
          historyPanel.value = true;
        },
      },
      {
        id: 'workbench.versions',
        category: t('历史'),
        get label() {
          return t('文档版本历史');
        },
        available: hasDocument && !!extensions.historyEnabled,
        run: () => {
          historyPage.value = 'versions';
          historyPanel.value = true;
        },
      },
      {
        id: 'workbench.settings',
        category: t('设置'),
        get label() {
          return t('外观设置');
        },
        keywords: t('打开设置'),
        run: () => openSettings('appearance'),
      },
      {
        id: 'workbench.settings.editing',
        category: t('设置'),
        get label() {
          return t('编辑设置');
        },
        run: () => openSettings('editing'),
      },
      {
        id: 'workbench.settings.shortcuts',
        category: t('设置'),
        get label() {
          return t('快捷键');
        },
        run: () => openSettings('shortcuts'),
      },
      {
        id: 'workbench.settings.workspace',
        category: t('设置'),
        get label() {
          return t('工作区设置');
        },
        available: navigationContext.value === 'workspace' && !!workspace.value,
        run: () => openSettings('workspace'),
      },
      {
        id: 'workbench.settings.about',
        category: t('设置'),
        get label() {
          return t('关于同页');
        },
        run: () => openSettings('about'),
      },
      {
        id: 'workbench.check-updates',
        category: t('设置'),
        get label() {
          return t('检查更新');
        },
        available: native && !mobile && !updateLock.value && !updates.state.busy,
        run: () => {
          openSettings('about');
          return updates.check();
        },
      },
    ];
  });

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
    if (treeRow && !modal.value) {
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
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault();
        selectedEntryIds.value = new Set(fileTree.value?.getVisibleIds() ?? []);
        selectionAnchorId.value = treeRow.dataset.entryId ?? null;
        return;
      }
      if (event.key === 'Delete' && selectedEntries.value.length) {
        event.preventDefault();
        void removeDocuments([...selectedEntries.value]);
        return;
      }
      if (event.key === 'Escape' && selectedEntryIds.value.size) {
        event.preventDefault();
        selectActiveFileInTree();
        return;
      }
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

  function beforeUnload(event: BeforeUnloadEvent) {
    if (store.pending) {
      event.preventDefault();
      event.returnValue = '';
    }
  }

  function mobileBack(event: Event) {
    // Android's system back first dismisses the current surface, then navigates.
    // Keep in-flight mutations mounted until their normal completion path runs.
    const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
    if (dialog) {
      event.preventDefault();
      dialog.dispatchEvent(new Event('cancel', { cancelable: true }));
      return;
    }
    const layer = [
      agentPanel,
      objectPanel,
      recyclePanel,
      historyPanel,
      referenceGraphOpened,
      commandPaletteOpened,
      templateLibraryOpen,
      touchOutlineOpen,
    ].find((opened) => opened.value);
    const dismiss =
      modalBusy.value || updateLock.value || busy.value
        ? () => {}
        : fileContextMenu.value
          ? () => closeFileContextMenu(true)
          : directoryContextMenu.value
            ? closeDirectoryContextMenu
            : workspaceEntryContextMenu.value
              ? closeWorkspaceEntryContextMenu
              : pageContextMenu.value
                ? closePageContextMenu
                : outlineContextMenu.value
                  ? closeOutlineContextMenu
                  : menu.value
                    ? () => {
                        menu.value = false;
                      }
                    : workspaceMenu.value
                      ? () => {
                          workspaceMenu.value = false;
                        }
                      : modal.value
                        ? () => {
                            modal.value = '';
                          }
                        : settingsPanel.value
                          ? () => {
                              settingsPanel.value = false;
                            }
                          : importPanel.value
                            ? () => {
                                importPanel.value = false;
                              }
                            : selectedDiff.value
                              ? () => {
                                  selectedDiff.value = undefined;
                                }
                              : selectionTodo.value
                                ? () => {
                                    selectionTodo.value = undefined;
                                  }
                                : layer
                                  ? () => {
                                      layer.value = false;
                                    }
                                  : compactPanes.value && sidebar.value
                                    ? () => {
                                        sidebar.value = false;
                                      }
                                    : assistant.opened
                                      ? () => {
                                          assistant.opened = false;
                                        }
                                      : canNavigatePage(-1)
                                        ? () => navigatePage(-1)
                                        : undefined;
    if (dismiss) {
      event.preventDefault();
      dismiss();
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

  return {
    workbenchCommands,
  };
}
