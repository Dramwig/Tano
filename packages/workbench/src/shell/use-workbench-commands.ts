import { computed, type Ref } from 'vue';
import { storeToRefs } from 'pinia';
import { defaultSelectionContext, type EditorSelectionContext } from '@tano/editor/selection-context';
import type { FileEntry } from '@tano/protocol';
import type { useAssistantStore } from '../assistant/store';
import type { DocumentExportFormat } from '../documents/document-export';
import { t } from '../i18n/i18n';
import { mobile } from '../platform/platform';
import type { WorkbenchExtensions } from '../runtime';
import type { SettingsPageId } from '../settings/settings-window';
import type { useUpdatesStore } from '../stores/updates';
import type { useWorkspaceStore } from '../stores/workspace';
import { native } from '../workspace/adapter';
import { editorPaletteCommands, type WorkbenchCommand } from './command-palette';
import type { ShortcutBindings } from './shortcuts';
import type { MarkdownEditor } from './workbench-async-components';

export interface WorkbenchCommandsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  assistant: ReturnType<typeof useAssistantStore>;
  updates: ReturnType<typeof useUpdatesStore>;
  extensions: WorkbenchExtensions;
  editing: WorkbenchExtensions['editing'];
  isAuxiliaryWindow: boolean;
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
  paneSelections: Record<string, EditorSelectionContext>;
  documentUndoAvailable: Ref<boolean>;
  documentRedoAvailable: Ref<boolean>;
  exportBusy: Ref<boolean>;
  printBusy: Ref<boolean>;
  historyPanel: Ref<boolean>;
  historyPage: Ref<'versions' | 'updates'>;
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
}

/**
 * Unified command runner shared by the status bar pinned-commands rail and
 * command palette: resolves built-in workbench commands first, then falls back
 * to registered workspace plugin commands.
 */
export function runWorkbenchCommandOrPlugin(
  commandId: string,
  commands: readonly WorkbenchCommand[],
  store: ReturnType<typeof useWorkspaceStore>,
) {
  const builtin = commands.find((item) => item.id === commandId);
  if (builtin) {
    void builtin.run();
    return;
  }
  const ws = store.workspace;
  if (!ws) return;
  const cmd = store.pluginCommands.find(
    (item) => `${item.pluginId}:${item.id}` === commandId || item.id === commandId,
  );
  if (!cmd) return;
  void store
    .interactWithPlugin({
      workspaceId: ws.id,
      pluginId: cmd.pluginId,
      instanceId: cmd.instanceId,
      kind: 'command',
      name: cmd.id,
      payload: {
        workspaceId: ws.id,
        ...(store.active?.id ? { fileId: store.active.id } : {}),
      },
    })
    .catch(() => {});
}

export function useWorkbenchCommands(deps: WorkbenchCommandsDeps) {
  const {
    store,
    assistant,
    updates,
    extensions,
    editing,
    isAuxiliaryWindow,
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
    paneSelections,
    documentUndoAvailable,
    documentRedoAvailable,
    exportBusy,
    printBusy,
    historyPanel,
    historyPage,
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
    openSettings,
  } = deps;
  const { workspace, active, busy } = storeToRefs(store);

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
        id: 'workbench.table',
        category: t('文档'),
        get label() {
          return t('新建数据表');
        },
        available: writableWorkspace,
        run: () => createNewEntry('table'),
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
        available: hasDocument && !!extensions.historyEnabled && !!extensions.historyView,
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

  return {
    workbenchCommands,
  };
}
