import {
  computed,
  nextTick,
  provide,
  ref,
  shallowReactive,
  shallowRef,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { version as appVersion } from '../../package.json';
import {
  fileHandlers,
  isObjectPath,
  isPlanObject,
  isPlanObjectType,
  resolveReference,
  type FileEntry,
  type ReferenceIdentity,
} from '@tano/protocol';
import { native } from '../workspace/adapter';
import { agentInboxKey, useAgentInboxController } from '../assistant/agent-controller';
import { butterflyScope } from '../assistant/butterfly';
import { butterflyPerchDirective, provideButterflyController } from '../assistant/butterfly-vue';
import { useAssistantStore, useInlineAssistantStore } from '../assistant/store';
import type { AttachmentStatusUpdate } from '../files/attachment-status';
import { nativeAttachments } from '../files/attachments';
import type FileTree from '../files/components/FileTree.vue';
import type { ImportRecord } from '../workspace/components/ImportPanel.vue';
import { useDocumentActions } from '../composables/use-document-actions';
import { useFileTreeController } from '../composables/use-file-tree-controller';
import { useInlineAssistant } from '../composables/use-inline-assistant';
import { useWorkbenchHelp } from '../composables/use-workbench-help';
import { useWorkbenchHistory } from '../composables/use-workbench-history';
import { useWorkbenchLifecycle } from '../composables/use-workbench-lifecycle';
import { useWorkbenchModals } from '../composables/use-workbench-modals';
import { useWorkbenchOutline } from '../composables/use-workbench-outline';
import { useWorkbenchPreferences } from '../composables/use-workbench-preferences';
import { useWorkbenchSettings } from '../composables/use-workbench-settings';
import { useWorkbenchShortcuts } from '../composables/use-workbench-shortcuts';
import { useWorkbenchViews } from '../composables/use-workbench-views';
import { isTableTab } from '../data-tables/data-tables';
import { appearanceText } from '../documents/document-appearance';
import { useDocumentFavicon } from '../documents/document-favicon';
import { t } from '../i18n/i18n';
import { planKey } from '../plans/personal-plans';
import { planDocumentSource } from '../plans/selection-todo';
import { mobile } from '../platform/platform';
import {
  createLocalExtensions,
  useWorkbenchRuntime,
  type WorkbenchActions,
} from '../runtime';
import { usePlanSyncStore } from '../stores/plan-sync';
import { usePlanStore } from '../stores/plans';
import { useSuggestionStore } from '../stores/suggestions';
import { useUpdatesStore } from '../stores/updates';
import { useWorkspaceStore } from '../stores/workspace';
import type { ObjectRecord } from '../objects/workspace-objects';
import { useWindowContext } from '../windows/context';
import { useAuxiliaryWindows } from '../windows/manager';
import { useViewport } from './viewport';
import { retainWorkbenchSession } from './workbench-session';

export interface WorkbenchProps {
  initialWorkspace?: string;
  resolveInitialWorkspace?: () => Promise<string | undefined>;
  createWorkspace?: boolean;
}

export function useWorkbench(props: WorkbenchProps, emit: (event: 'ready') => void) {
  const mainWindow = useWindowContext();
  const activeWindow = shallowRef(mainWindow);
  const store = useWorkspaceStore();
  const auxiliaryWindows = useAuxiliaryWindows(
    store,
    async () => {
      await editing.flush();
      return store.flush();
    },
    (context) => {
      activeWindow.value = context;
    },
  );
  const startupPending = ref(true);
  const documentSuggestions = useSuggestionStore();
  const suggestionModeBusy = ref(false);
  async function toggleSuggestionMode(fileId: string) {
    if (suggestionModeBusy.value) return;
    menu.value = false;
    suggestionModeBusy.value = true;
    try {
      await documentSuggestions.toggle(fileId);
    } catch (error) {
      store.report(error);
    } finally {
      suggestionModeBusy.value = false;
    }
  }

  const assistant = useAssistantStore();
  const agentInbox = useAgentInboxController();
  provide(agentInboxKey, agentInbox);
  watch(agentInbox.error, (error) => {
    if (error) store.report(error);
  });
  const assistantPanelMounted = ref(assistant.opened);
  watch(
    () => assistant.opened,
    (open) => {
      if (open) assistantPanelMounted.value = true;
    },
  );
  const inlineRunner = useInlineAssistantStore();
  const butterfly = provideButterflyController();
  const vButterflyPerch = butterflyPerchDirective(butterfly);
  const paneButterflyScope = (paneId: string, fileId: string) =>
    butterflyScope(store.workspace?.id ?? '', paneId, fileId);
  watch(
    () => [
      store.workspace?.id,
      store.activePaneId,
      store.activeId,
      assistant.available,
      assistant.opened,
      store.documents.length,
    ],
    () => {
      butterfly.setContext(
        paneButterflyScope(store.activePaneId, store.activeId),
        assistant.available &&
          !assistant.opened &&
          (isTableTab(store.activeId) || !!store.documentForTab(store.activeId)),
      );
    },
    { immediate: true },
  );
  const assistantHosts = shallowReactive(new Map<string, HTMLElement>());
  function setAssistantHost(paneId: string, value: unknown) {
    if (value) assistantHosts.set(paneId, value as HTMLElement);
    else assistantHosts.delete(paneId);
  }
  const assistantTab = computed(() =>
    assistant.opened && assistant.displayMode === 'fullscreen'
      ? {
          id: assistant.fullscreenTabId,
          title: assistant.session?.messages.length ? assistant.session.title : t('Tano 助手'),
        }
      : undefined,
  );

  const plans = usePlanStore();
  usePlanSyncStore();
  const tabsEnabled = native && !mobile;
  const { width: viewportWidth, touch: touchLayout, compact: compactPanes } = useViewport(mobile);
  const isAuxiliaryWindow = false;
  const localNative = native && !store.isWeb;
  const attachments =
    useWorkbenchRuntime().attachments ?? (localNative ? nativeAttachments : undefined);
  const workspaceAdapter = useWorkbenchRuntime().adapter;
  const documentationBaseUrl = useWorkbenchRuntime().documentationBaseUrl;
  const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
  const editing = extensions.editing;

  const { workspace, active, activeId, activities, fatal, busy } = storeToRefs(store);
  const filesPending = computed(
    () => store.workspaceLoading.files || (startupPending.value && !workspace.value),
  );
  const sessionPending = computed(() => filesPending.value || store.workspaceLoading.session);
  const switchingWorkspace = computed(() => store.workspaceLoading.files);
  if (!native)
    useDocumentFavicon(() =>
      workspace.value && active.value ? appearanceText(active.value.content, 'icon') : '',
    );

  // Panel / menu flags shared across composables
  const menu = ref(false);
  const workspaceMenu = ref(false);
  const settingsPanel = ref(false);
  const commandPaletteOpened = ref(false);
  const historyPanel = ref(false);
  const historyPage = ref<'versions' | 'updates'>('versions');
  const importPanel = ref(false);
  const importRecords = ref<ImportRecord[]>([]);
  const agentPanel = ref(false);
  const recyclePanel = ref(false);
  const templateLibraryOpen = ref(false);
  const templatePaneId = ref('');
  const templateSource = ref('');
  const templateInitialization = shallowRef<{ title: string; apply: (content: string) => void }>();
  const selectedDiff = ref<{
    title: string;
    before: string;
    after: string;
    beforeLabel?: string;
    afterLabel?: string;
  }>();
  const sidebar = ref(!isAuxiliaryWindow && !compactPanes.value);
  const mainColumn = ref<HTMLElement>();
  watch(compactPanes, (compact) => {
    if (compact) sidebar.value = false;
  });

  store.setBeforeWorkspaceChange(async () => {
    if (!(await auxiliaryWindows.closeAll()))
      throw new Error(t('还有未保存的修改，请先处理保存错误。'));
    await assistant.settle();
    await inlineRunner.settle();
    await agentInbox.settle();
  });

  // Views, sidebar navigation, calendar & toolbar visibility items
  const views = useWorkbenchViews({
    store,
    plans,
    extensions,
    attachments,
    isAuxiliaryWindow,
    compactPanes,
    sidebar,
    workspaceMenu,
    openSettings: (page) => settingsCtrl.openSettings(page),
  });
  const {
    extensionViews,
    navigation,
    navigationContext,
    navigationModule,
    workspaceView,
    sidebarView,
    calendar,
    selectContext,
    selectWorkspaceView,
    selectModule,
  } = views;

  // Attachment status
  const attachmentStates = ref<Record<string, AttachmentStatusUpdate>>({});
  function receiveAttachmentStatus(paneId: string, update: AttachmentStatusUpdate) {
    if (update.state) attachmentStates.value[paneId] = update;
    else if (attachmentStates.value[paneId]?.source === update.source)
      delete attachmentStates.value[paneId];
  }
  function currentAttachmentStatus(paneId: string, file?: FileEntry) {
    const update = attachmentStates.value[paneId];
    return update?.documentKey === `${workspace.value?.id}:${file?.id}` ? update.state : undefined;
  }
  const attachmentStatus = (paneId: string, file?: FileEntry) =>
    currentAttachmentStatus(paneId, file)?.items ??
    (attachments?.writeSpreadsheet &&
    file &&
    /\.(xlsx|xls)$/i.test(file.path) &&
    !file.readOnly &&
    !workspace.value?.readOnly
      ? [
          {
            kind: 'preview' as const,
            label: t('Excel 编辑'),
            detail: t('支持调整列宽、编辑单元格和新增工作表；修改会自动保存。'),
          },
        ]
      : [
          {
            kind: 'locked' as const,
            label: t('只读预览'),
            detail: t('附件以只读方式打开，不会修改原文件。'),
          },
        ]);
  const workspaceStatusLabel = computed(() =>
    store.workspace?.readOnly ? t('只读权限') : store.isDemo ? t('浏览器演示') : null,
  );

  // Workbench session
  const workbenchSession = retainWorkbenchSession(store, () => {
    void extensions.disconnect().catch(store.report);
    assistant.stop();
    inlineRunner.stop();
    void editing.dispose().catch(store.report);
    store.dispose();
  });
  assistant.setManaged((id) => editing.isManaging(id));
  inlineRunner.setManaged((id) => editing.isManaging(id));

  const updates = useUpdatesStore();
  const updateLock = computed(() => ['downloading', 'installing'].includes(updates.state.phase));

  watch(templateLibraryOpen, (opened) => {
    if (!opened) templateInitialization.value = undefined;
  });
  watch(
    () => [
      store.workspace?.id,
      store.workspace?.path,
      store.panes.find((pane) => pane.id === templatePaneId.value)?.activeId,
    ],
    () => {
      templateLibraryOpen.value = false;
    },
  );
  function openTemplateLibrary() {
    menu.value = false;
    workspaceMenu.value = false;
    templatePaneId.value = store.activePaneId;
    templateSource.value = store.active?.content ?? '';
    templateInitialization.value = undefined;
    void nextTick(() => {
      templateLibraryOpen.value = true;
    });
  }
  function openImport() {
    menu.value = false;
    workspaceMenu.value = false;
    importPanel.value = true;
  }

  // Preferences, appearance, fonts & sidebar resizing
  const prefs = useWorkbenchPreferences({
    store,
    mainWindow,
    activeWindow,
    isAuxiliaryWindow,
    viewportWidth,
    compactPanes,
    sidebar,
    workspaceMenu,
    editing,
    onDefaultSourceChange: (value, previous) => {
      docs.setPaneSource(store.activeId, value, docs.sourceModes[store.activeId] ?? previous);
    },
  });

  // Web page routing & browser history
  const history = useWorkbenchHistory({
    store,
    activeWindow,
    leaveWorkspace: () => modals.leaveWorkspace(),
  });

  // Document actions, pane registries, export/print & page context menu
  const docs = useDocumentActions({
    store,
    activeWindow,
    editing,
    extensions,
    attachments,
    localNative,
    compactPanes,
    sidebar,
    menu,
    updateLock,
    workspaceLocked: prefs.workspaceLocked,
    pageLocked: prefs.pageLocked,
    showPageTitle: prefs.showPageTitle,
    showDocumentProperties: prefs.showDocumentProperties,
    showOutline: computed({
      get: () => outlineCtrl.showOutline.value,
      set: (value) => {
        outlineCtrl.showOutline.value = value;
      },
    }),
    showAllLineNumbers: prefs.showAllLineNumbers,
    editorPreferences: prefs.editorPreferences,
    selectedVisualFontFamily: prefs.selectedVisualFontFamily,
    visualFontSize: prefs.visualFontSize,
    defaultSource: prefs.defaultSource,
    commandPaletteOpened,
    templateInitialization,
    openTemplateLibrary,
    openEntry: (file, newTab) => openEntry(file, newTab),
    closeOtherContextMenus: () => {
      tree.closeFileContextMenu();
      tree.closeDirectoryContextMenu();
      outlineCtrl.closeOutlineContextMenu();
    },
    getOutline: () => outlineCtrl.outline.value,
    jumpToHeading: (index, userInitiated) => outlineCtrl.jumpToHeading(index, userInitiated),
  });

  // Heading outline & scroll spy
  const outlineCtrl = useWorkbenchOutline({
    active,
    activeId,
    source: docs.source,
    documentScroll: docs.documentScroll,
    editorScroll: docs.editorScroll,
    sourceEditor: docs.sourceEditor,
    showPageTitle: prefs.showPageTitle,
    activeWindow,
    touchLayout,
    closeOtherContextMenus: () => {
      tree.closeFileContextMenu();
      tree.closeDirectoryContextMenu();
      docs.closePageContextMenu();
    },
  });

  // Inline assistant, butterfly idle & selection-to-todo
  const inlineAssist = useInlineAssistant({
    store,
    assistant,
    inlineRunner,
    butterfly,
    editing,
    activeWindow,
    sidebar,
    paneEditors: docs.paneEditors,
    paneSourceEditors: docs.paneSourceEditors,
    paneComments: docs.paneComments,
    paneSelections: docs.paneSelections,
    paneSourceSelections: docs.paneSourceSelections,
    paneSource: docs.paneSource,
    paneReadonly: docs.paneReadonly,
    source: docs.source,
    editor: docs.editor,
    sourceEditor: docs.sourceEditor,
    paneButterflyScope,
  });

  // File tree selection, drag/drop, rename & sidebar context menus
  const tree = useFileTreeController({
    store,
    workspaceAdapter,
    attachments,
    localNative,
    activeWindow,
    menu,
    workspaceMenu,
    updateLock,
    showDocumentProperties: prefs.showDocumentProperties,
    setPaneSource: docs.setPaneSource,
    sessionBlocksFileMutation: docs.sessionBlocksFileMutation,
    withFileMutation: docs.withFileMutation,
    fileMutationIds: docs.fileMutationIds,
    closePageContextMenu: docs.closePageContextMenu,
    closeOutlineContextMenu: outlineCtrl.closeOutlineContextMenu,
    selectContext,
    openEntry: (file, newTab) => openEntry(file, newTab),
    openImport,
    createNewEntry: (kind, parent) => modals.createNewEntry(kind, parent),
    removeDocument: (target) => modals.removeDocument(target),
    removeDocuments: (entries) => modals.removeDocuments(entries),
  });

  // Modals, search, file/workspace lifecycle & detached tab windows
  const modals = useWorkbenchModals({
    store,
    workspaceAdapter,
    attachments,
    editing,
    auxiliaryWindows,
    activeWindow,
    compactPanes,
    sidebar,
    sidebarView,
    menu,
    workspaceMenu,
    settingsPanel,
    updateLock,
    editorReadonly: docs.editorReadonly,
    source: docs.source,
    sourceEditor: docs.sourceEditor,
    editorScroll: docs.editorScroll,
    assistantTab,
    selectedEntryIds: tree.selectedEntryIds,
    selectedEntries: tree.selectedEntries,
    fileContextMenu: tree.fileContextMenu,
    directoryContextMenu: tree.directoryContextMenu,
    selectActiveFileInTree: tree.selectActiveFileInTree,
    fileDeleteDisabled: tree.fileDeleteDisabled,
    sessionBlocksFileMutation: docs.sessionBlocksFileMutation,
    withFileMutation: docs.withFileMutation,
    fileMutationIds: docs.fileMutationIds,
    markInitialPageRouteSuperseded: history.markInitialPageRouteSuperseded,
  });

  // Objects & plans
  const objectDetail = shallowRef<{ record?: ObjectRecord; initialType?: string }>();
  const planArchiveOpen = ref(false);
  const planDetail = shallowRef<ObjectRecord>();

  function openObjectDetail(record: ObjectRecord) {
    planDetail.value = undefined;
    objectDetail.value = { record };
    workspaceMenu.value = false;
    if (compactPanes.value) sidebar.value = false;
  }
  function createPluginObject(initialType: string) {
    planDetail.value = undefined;
    objectDetail.value = { initialType };
    workspaceMenu.value = false;
  }
  function openPlanArchive() {
    planArchiveOpen.value = true;
    workspaceMenu.value = false;
  }
  function showPlanEvent(key: string) {
    const personal = plans.personal.find((item) => planKey(item) === key);
    const local = store.objects.find(
      (item) => item.object.id === key && isPlanObject(item.object),
    );
    const record =
      personal ??
      (local && workspace.value
        ? {
            ...local,
            source: {
              scope: 'workspace' as const,
              id: workspace.value.id,
              name: workspace.value.name,
            },
          }
        : undefined);
    if (!record) {
      store.report(t('事项已不存在，请刷新计划后重试'));
      return;
    }
    objectDetail.value = undefined;
    if (record.source?.scope === 'workspace') selectContext('workspace');
    planDetail.value = record;
    if (compactPanes.value) sidebar.value = false;
  }
  async function openBreadcrumbDirectory(path: string, newTab = false) {
    const home = tree.folderHomes.value.get(path);
    if (home) await openEntry(home, newTab);
    else await store.openDirectory(path, { newTab });
    if (compactPanes.value) sidebar.value = false;
  }
  async function openEntry(file: FileEntry, newTab = false) {
    newTab = newTab && tabsEnabled;
    if (file.kind === 'directory') {
      await openBreadcrumbDirectory(file.path, newTab);
      return;
    }
    const handler = fileHandlers.resolve(file.path);
    if (isObjectPath(file.path)) {
      const record = store.objects.find((item) => item.path === file.path);
      if (!record) store.report(t('对象文件不可用，请检查格式或是否存在重复 ID'));
      else if (isPlanObject(record.object)) showPlanEvent(record.object.id);
      else openObjectDetail(record);
      return;
    }
    if (handler.preview === 'markdown' || handler.preview === 'table') {
      if (newTab) await store.openFileInNewTab(file);
      else await store.openFile(file);
      if (store.activePaneId === templatePaneId.value && store.activeId === file.id)
        templateLibraryOpen.value = false;
      if (compactPanes.value) sidebar.value = false;
      return;
    }
    if (workspace.value) {
      if (newTab) await store.openAttachmentInNewTab(file);
      else await store.openAttachment(file);
      if (compactPanes.value) sidebar.value = false;
      return;
    }
  }
  async function openReference(identity: ReferenceIdentity) {
    const result = resolveReference(store.referenceTargets, identity);
    if (!result.target) {
      if (result.error === 'unregistered') {
        const legacy = store.objects.find(
          (item) => item.object.type === identity.type && item.object.id === identity.id,
        );
        if (legacy) {
          openObjectDetail(legacy);
          return;
        }
      }
      store.report(t('当前工作区中引用目标不可用，请检查对象是否被移除或 ID 是否重复'));
      return;
    }
    if (identity.type === 'document' || identity.type === 'asset') {
      const file =
        workspace.value?.files.find(
          (file) => file.id === identity.id && file.path === result.target!.path,
        ) ?? workspace.value?.files.find((file) => file.id === identity.id);
      if (file) await openEntry(file);
      return;
    }
    if (isPlanObjectType(identity.type)) {
      showPlanEvent(identity.id);
      return;
    }
    const record = store.objects.find(
      (item) => item.object.type === identity.type && item.object.id === identity.id,
    );
    if (record) openObjectDetail(record);
  }
  async function openObjectReference(identity: ReferenceIdentity) {
    if (identity.type === 'document' || identity.type === 'asset' || isPlanObjectType(identity.type))
      objectDetail.value = undefined;
    await openReference(identity);
  }
  async function openPlanReference(identity: ReferenceIdentity) {
    const current = planDetail.value;
    if (current?.source?.scope === 'personal') {
      const record = plans.personal.find(
        (item) => item.object.type === identity.type && item.object.id === identity.id,
      );
      if (record) planDetail.value = record;
      else store.report(t('个人事项引用目标不可用'));
      return;
    }
    const docSource = planDocumentSource(current?.object.properties.documentSource);
    planDetail.value = undefined;
    await openReference(identity);
    if (docSource && identity.type === 'document' && identity.id === docSource.fileId)
      await docs.revealAssistantSelection(docSource);
  }

  // Settings controller
  const settingsCtrl = useWorkbenchSettings({
    store,
    updates,
    workspaceAdapter,
    extensions,
    auxiliaryWindows,
    activeWindow,
    navigationContext,
    compactPanes,
    sidebar,
    tabsEnabled,
    menu,
    workspaceMenu,
    settingsPanel,
    agentPanel,
    recyclePanel,
    prefs,
    outlineCtrl,
    modals,
  });

  const extensionActions: WorkbenchActions = {
    closeMenus: () => {
      workspaceMenu.value = false;
      menu.value = false;
    },
    createWorkspace: () => {
      void modals.createNewWorkspace();
    },
    openSettings: settingsCtrl.openSettings,
    showDiff: (value) => {
      selectedDiff.value = value;
    },
  };

  function toggleWorkspaceMenu() {
    workspaceMenu.value = !workspaceMenu.value;
    if (!workspaceMenu.value) tree.closeWorkspaceEntryContextMenu();
    if (workspaceMenu.value && store.isWeb) void store.refreshWorkspaces();
  }
  watch(workspaceMenu, (opened) => {
    if (!opened) tree.closeWorkspaceEntryContextMenu();
  });

  function closeButtonVisibilityMenus() {
    tree.closeFileContextMenu();
    tree.closeDirectoryContextMenu();
    docs.closePageContextMenu();
    outlineCtrl.closeOutlineContextMenu();
    menu.value = false;
    workspaceMenu.value = false;
    calendar.calendarModeOpen.value = false;
  }

  function toggleSidebar() {
    if (activeWindow.value.id !== 'main') return;
    sidebar.value = !sidebar.value;
    workspaceMenu.value = false;
  }

  // Commands, shortcuts, window listeners & auxiliary window event bindings
  const { workbenchCommands } = useWorkbenchShortcuts({
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
    shortcuts: prefs.shortcuts,
    updateLock,
    editorReadonly: docs.editorReadonly,
    source: docs.source,
    revealMarkdown: prefs.revealMarkdown,
    pageLocked: prefs.pageLocked,
    workspaceLocked: prefs.workspaceLocked,
    limitPageWidth: prefs.limitPageWidth,
    pageWidthWritable: prefs.pageWidthWritable,
    showOutline: outlineCtrl.showOutline,
    showDocumentProperties: prefs.showDocumentProperties,
    editor: docs.editor,
    paneEditors: docs.paneEditors,
    paneEditorScrolls: docs.paneEditorScrolls,
    paneSearches: docs.paneSearches,
    paneSelections: docs.paneSelections,
    documentUndoAvailable: docs.documentUndoAvailable,
    documentRedoAvailable: docs.documentRedoAvailable,
    exportBusy: docs.exportBusy,
    printBusy: docs.printBusy,
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
    historyPage,
    referenceGraphOpened: docs.referenceGraphOpened,
    templateLibraryOpen,
    touchOutlineOpen: outlineCtrl.touchOutlineOpen,
    calendarModeOpen: calendar.calendarModeOpen,
    selectedDiff,
    selectionTodo: inlineAssist.selectionTodo,
    modal: modals.modal,
    modalBusy: modals.modalBusy,
    fileContextMenu: tree.fileContextMenu,
    directoryContextMenu: tree.directoryContextMenu,
    workspaceEntryContextMenu: tree.workspaceEntryContextMenu,
    pageContextMenu: docs.pageContextMenu,
    outlineContextMenu: outlineCtrl.outlineContextMenu,
    fileTree: tree.fileTree,
    selectedEntryIds: tree.selectedEntryIds,
    selectionAnchorId: tree.selectionAnchorId,
    selectedEntries: tree.selectedEntries,
    showModal: modals.showModal,
    createNewDocument: modals.createNewDocument,
    createNewEntry: modals.createNewEntry,
    detachTab: modals.detachTab,
    openImport,
    openTemplateLibrary,
    exportDocument: docs.exportDocument,
    printActiveDocument: docs.printActiveDocument,
    openPaneSearch: docs.openPaneSearch,
    undoDocument: docs.undoDocument,
    redoDocument: docs.redoDocument,
    toggleAssistant: inlineAssist.toggleAssistant,
    togglePageLock: prefs.togglePageLock,
    setLimitPageWidth: prefs.setLimitPageWidth,
    openDocumentDiscussion: docs.openDocumentDiscussion,
    toggleSidebar,
    selectContext,
    toggleWorkspaceMenu,
    selectModule,
    openCalendar: calendar.openCalendar,
    openSettings: settingsCtrl.openSettings,
    closeFileContextMenu: tree.closeFileContextMenu,
    closeDirectoryContextMenu: tree.closeDirectoryContextMenu,
    closeWorkspaceEntryContextMenu: tree.closeWorkspaceEntryContextMenu,
    closePageContextMenu: docs.closePageContextMenu,
    closeOutlineContextMenu: outlineCtrl.closeOutlineContextMenu,
    fileMutationDisabled: tree.fileMutationDisabled,
    directoryHasManagedFile: tree.directoryHasManagedFile,
    startTreeRename: tree.startTreeRename,
    removeDocuments: modals.removeDocuments,
    selectActiveFileInTree: tree.selectActiveFileInTree,
    canNavigatePage: history.canNavigatePage,
    navigatePage: history.navigatePage,
    constrainSidebarToViewport: prefs.constrainSidebarToViewport,
  });

  // Help guidance state
  const help = useWorkbenchHelp({
    store,
    assistant,
    plans,
    workspaceAdapter,
    editing,
    compactPanes,
    sidebarView,
    activeExtensionView: views.activeExtensionView,
    editorReadonly: docs.editorReadonly,
    source: docs.source,
    workspaceMenu,
    menu,
    modal: modals.modal,
    settingsPanel,
    importPanel,
    templateLibraryOpen,
    agentPanel,
    objectDetail,
    planArchiveOpen,
    selectedDiff,
    selectionTodo: inlineAssist.selectionTodo,
    recyclePanel,
    referenceGraphOpened: docs.referenceGraphOpened,
    fileContextMenu: tree.fileContextMenu,
    directoryContextMenu: tree.directoryContextMenu,
    pageContextMenu: docs.pageContextMenu,
    outlineContextMenu: outlineCtrl.outlineContextMenu,
    resizingSidebar: prefs.resizingSidebar,
    draggedEntry: tree.draggedEntry,
    updateLock,
  });

  // Cross-domain watchers, reminders & native window lifecycle
  useWorkbenchLifecycle({
    props,
    emitReady: () => emit('ready'),
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
    restoreNavigation: navigation.restore,
    homeModule: navigation.homeModule,
    getPersonalPlanScope: views.getPersonalPlanScope,
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
  });

  // Explicit DOM ref setters (avoid mutating injected contexts directly).
  const setFileTree = (el: unknown) => {
    tree.fileTree.value = (el as InstanceType<typeof FileTree> | null) ?? undefined;
  };
  const setDocumentMenuElement = (el: unknown) => {
    docs.documentMenuElement.value = (el as HTMLElement | null) ?? undefined;
  };
  const setOutlineSearchInput = (el: unknown) => {
    outlineCtrl.outlineSearchInput.value = (el as HTMLInputElement | null) ?? undefined;
  };
  const setWorkspaceEntryContextMenuElement = (el: unknown) => {
    tree.workspaceEntryContextMenuElement.value = (el as HTMLElement | null) ?? undefined;
  };
  const setPageContextMenuElement = (el: unknown) => {
    docs.pageContextMenuElement.value = (el as HTMLElement | null) ?? undefined;
  };
  const setOutlineContextMenuElement = (el: unknown) => {
    outlineCtrl.outlineContextMenuElement.value = (el as HTMLElement | null) ?? undefined;
  };

  return {
    prefs: {
      tabsEnabled,
      developerMode: prefs.developerMode,
      shortcuts: prefs.shortcuts,
      shortcutHint: prefs.shortcutHint,
      defaultSource: prefs.defaultSource,
      theme: prefs.theme,
      appearance: prefs.appearance,
      appearanceController: prefs.appearanceController,
      visualFontChoice: prefs.visualFontChoice,
      customFontName: prefs.customFontName,
      splitFontSettings: prefs.splitFontSettings,
      revealMarkdown: prefs.revealMarkdown,
      toolbarMode: prefs.toolbarMode,
      showPageTitle: prefs.showPageTitle,
      showDocumentProperties: prefs.showDocumentProperties,
      showDocumentDiscussion: prefs.showDocumentDiscussion,
      showAllLineNumbers: prefs.showAllLineNumbers,
      visualFontSize: prefs.visualFontSize,
      sourceFontSize: prefs.sourceFontSize,
      selectedVisualFontFamily: prefs.selectedVisualFontFamily,
      editorPreferences: prefs.editorPreferences,
      limitPageWidth: prefs.limitPageWidth,
      pageWidthWritable: prefs.pageWidthWritable,
      setLimitPageWidth: prefs.setLimitPageWidth,
      workspaceLocked: prefs.workspaceLocked,
      pageLocked: prefs.pageLocked,
      togglePageLock: prefs.togglePageLock,
      toggleWorkspaceLock: prefs.toggleWorkspaceLock,
      resizingSidebar: prefs.resizingSidebar,
      moveSidebarResize: prefs.moveSidebarResize,
      finishSidebarResize: prefs.finishSidebarResize,
      sidebarWidth: prefs.sidebarWidth,
      defaultSidebarWidth: prefs.defaultSidebarWidth,
      SIDEBAR_MIN_WIDTH: prefs.SIDEBAR_MIN_WIDTH,
      sidebarWidthLimit: prefs.sidebarWidthLimit,
      startSidebarResize: prefs.startSidebarResize,
      resizeSidebarWithKeyboard: prefs.resizeSidebarWithKeyboard,
    },
    shell: {
      native,
      store,
      workspace,
      active,
      activeId,
      activities,
      busy,
      auxiliaryWindows,
      activeWindow,
      detachedTitle: modals.detachedTitle,
      compactPanes,
      touchLayout,
      isAuxiliaryWindow,
      localNative,
      sidebar,
      toggleSidebar,
      mainColumn,
      startupPending,
      filesPending,
      sessionPending,
      switchingWorkspace,
      attachments,
      documentationBaseUrl,
      appVersion,
      extensions,
      extensionActions,
      extensionViews,
      viewActions: views.viewActions,
      settingsTabView: views.settingsTabView,
      mailEnabled: views.mailEnabled,
      mailTabView: views.mailTabView,
      openMail: views.openMail,
      navigationContext,
      navigationModule,
      workspaceView,
      sidebarView,
      selectContext,
      selectWorkspaceView,
      selectModule,
      homeContent: views.homeContent,
      homeExtension: views.homeExtension,
      sidebarHeaderItems: views.sidebarHeaderItems,
      sidebarNavigationItems: views.sidebarNavigationItems,
      repositoryActionItems: views.repositoryActionItems,
      documentToolItems: views.documentToolItems,
      calendarToolItems: views.calendarToolItems,
      topbarVisibilityItems: views.topbarVisibilityItems,
      closeButtonVisibilityMenus,
      workspaceMenu,
      toggleWorkspaceMenu,
      workspaceStatusLabel,
      openEntry,
      openBreadcrumbDirectory,
      openReference,
      openSettings: settingsCtrl.openSettings,
      openImport,
      openTemplateLibrary,
      createNewDocument: modals.createNewDocument,
      createNewEntry: modals.createNewEntry,
      detachTab: modals.detachTab,
      createNewWorkspace: modals.createNewWorkspace,
      returnHome: modals.returnHome,
      canNavigatePage: history.canNavigatePage,
      navigatePage: history.navigatePage,
      updates,
      updateLock,
      butterfly,
      vButterflyPerch,
      paneButterflyScope,
      assistant,
      assistantPanelMounted,
      assistantHosts,
      assistantTab,
      setAssistantHost,
      inlineRunner,
      inlineAssistant: inlineAssist.inlineAssistant,
      inlineAssistantPrompt: inlineAssist.inlineAssistantPrompt,
      inlineAssistantState: inlineAssist.inlineAssistantState,
      inlineAssistantError: inlineAssist.inlineAssistantError,
      inlineAssistantMessage: inlineAssist.inlineAssistantMessage,
      submitInlineAssistant: inlineAssist.submitInlineAssistant,
      continueInlineConversation: inlineAssist.continueInlineConversation,
      undoInlineAssistant: inlineAssist.undoInlineAssistant,
      closeInlineAssistant: inlineAssist.closeInlineAssistant,
      plans,
      calendarScope: calendar.calendarScope,
      calendarPeriod: calendar.calendarPeriod,
      calendarDate: calendar.calendarDate,
      calendarMode: calendar.calendarMode,
      calendarModeOpen: calendar.calendarModeOpen,
      calendarModeLabel: calendar.calendarModeLabel,
      calendarModeOptions: calendar.calendarModeOptions,
      sidebarCalendarDate: calendar.sidebarCalendarDate,
      openCalendar: calendar.openCalendar,
      moveCalendarPeriod: calendar.moveCalendarPeriod,
      selectCalendarMode: calendar.selectCalendarMode,
      showCalendarDay: calendar.showCalendarDay,
      showCalendarMonth: calendar.showCalendarMonth,
      showPlanEvent,
      openPlanArchive,
      createPluginObject,
      templateLibraryOpen,
      templatePaneId,
      templateSource,
      templateInitialization,
      workbenchCommands,
      noteCount: help.noteCount,
      helpContext: help.helpContext,
      helpAvailability: help.helpAvailability,
      helpBlocked: help.helpBlocked,
    },
    documents: {
      menu,
      setDocumentMenuElement,
      toggleDocumentMenu: docs.toggleDocumentMenu,
      documentMenuTriggerKeydown: docs.documentMenuTriggerKeydown,
      documentMenuKeydown: docs.documentMenuKeydown,
      openPaneSearch: docs.openPaneSearch,
      editorReadonly: docs.editorReadonly,
      documentUndoAvailable: docs.documentUndoAvailable,
      undoDocument: docs.undoDocument,
      documentRedoAvailable: docs.documentRedoAvailable,
      redoDocument: docs.redoDocument,
      canAddDocumentProperty: docs.canAddDocumentProperty,
      addDocumentProperty: docs.addDocumentProperty,
      paneComments: docs.paneComments,
      openDocumentDiscussion: docs.openDocumentDiscussion,
      paneReadonly: docs.paneReadonly,
      showReferenceGraph: docs.showReferenceGraph,
      referenceGraphTarget: docs.referenceGraphTarget,
      referenceGraphOpened: docs.referenceGraphOpened,
      referenceGraphAnchor: docs.referenceGraphAnchor,
      togglePageOption: docs.togglePageOption,
      exportBusy: docs.exportBusy,
      exportDocument: docs.exportDocument,
      printBusy: docs.printBusy,
      printActiveDocument: docs.printActiveDocument,
      sessionBlocksFileMutation: docs.sessionBlocksFileMutation,
      paneSource: docs.paneSource,
      setPaneSource: docs.setPaneSource,
      paneDocumentStatus: docs.paneDocumentStatus,
      attachmentStatus,
      currentAttachmentStatus,
      receiveAttachmentStatus,
      documentSuggestions,
      editing,
      suggestionModeBusy,
      toggleSuggestionMode,
      setPaneSearch: docs.setPaneSearch,
      paneSourceEditors: docs.paneSourceEditors,
      paneEditors: docs.paneEditors,
      paneSearchRevisions: docs.paneSearchRevisions,
      setPaneElement: docs.setPaneElement,
      assistantTaskActive: inlineAssist.assistantTaskActive,
      beginSelectionTodo: inlineAssist.beginSelectionTodo,
      paneEditorScrolls: docs.paneEditorScrolls,
      paneSelections: docs.paneSelections,
      showSourceTodo: inlineAssist.showSourceTodo,
      openPageContextMenu: docs.openPageContextMenu,
      uploadFile: docs.uploadFile,
      resourceRevision: docs.resourceRevision,
      renameDocumentTitle: docs.renameDocumentTitle,
      insertBlockBelowTitle: docs.insertBlockBelowTitle,
      commentAnchors: docs.commentAnchors,
      paneEditorReady: docs.paneEditorReady,
      paneSourceSelections: docs.paneSourceSelections,
      insertSourceFiles: docs.insertSourceFiles,
      setPaneEditor: docs.setPaneEditor,
      openDocumentLink: docs.openDocumentLink,
      openWikiLink: docs.openWikiLink,
      openBlankBlockAssistant: inlineAssist.openBlankBlockAssistant,
      startDocumentDraft: inlineAssist.startDocumentDraft,
      quickInitialize: docs.quickInitialize,
      chooseInitialTemplate: docs.chooseInitialTemplate,
      setPaneComments: docs.setPaneComments,
      discussWithAssistant: inlineAssist.discussWithAssistant,
      capturePaneCommentSelection: docs.capturePaneCommentSelection,
      focusPaneComment: docs.focusPaneComment,
      paneCommentGeometry: docs.paneCommentGeometry,
      paneScrolls: docs.paneScrolls,
      revealAssistantSelection: docs.revealAssistantSelection,
      openAssistant: inlineAssist.openAssistant,
      showOutline: outlineCtrl.showOutline,
      touchOutlineOpen: outlineCtrl.touchOutlineOpen,
      outlineOnLeft: outlineCtrl.outlineOnLeft,
      hoverOutline: outlineCtrl.hoverOutline,
      outlinePinned: outlineCtrl.outlinePinned,
      outlinePosition: outlineCtrl.outlinePosition,
      openOutlineContextMenu: outlineCtrl.openOutlineContextMenu,
      releaseOutlinePointerFocus: outlineCtrl.releaseOutlinePointerFocus,
      outlineAutoCollapse: outlineCtrl.outlineAutoCollapse,
      outlineSearchOpen: outlineCtrl.outlineSearchOpen,
      setOutlineSearchInput,
      toggleOutlineSearch: outlineCtrl.toggleOutlineSearch,
      toggleOutlinePin: outlineCtrl.toggleOutlinePin,
      outlineSearch: outlineCtrl.outlineSearch,
      visibleOutline: outlineCtrl.visibleOutline,
      jumpToHeading: outlineCtrl.jumpToHeading,
      outline: outlineCtrl.outline,
      activeHeading: outlineCtrl.activeHeading,
      scheduleActiveHeading: outlineCtrl.scheduleActiveHeading,
      toggleOutlineSide: outlineCtrl.toggleOutlineSide,
    },
    treeMenus: {
      setFileTree,
      treeFiles: tree.treeFiles,
      revealedHomeId: tree.revealedHomeId,
      treeDocumentIcons: tree.treeDocumentIcons,
      loadTreeDocumentIcon: tree.loadTreeDocumentIcon,
      selectedEntryIds: tree.selectedEntryIds,
      canDragEntry: tree.canDragEntry,
      treeRename: tree.treeRename,
      renameTreeEntry: tree.renameTreeEntry,
      openTreeEntry: tree.openTreeEntry,
      selectFileTreeEntry: tree.selectFileTreeEntry,
      fileDragStart: tree.fileDragStart,
      fileDragEnd: tree.fileDragEnd,
      fileDragOver: tree.fileDragOver,
      fileDragLeave: tree.fileDragLeave,
      fileDrop: tree.fileDrop,
      draggedEntry: tree.draggedEntry,
      dropFolder: tree.dropFolder,
      dropPlaceholders: tree.dropPlaceholders,
      tabFileDrag: tree.tabFileDrag,
      finishTreeRename: tree.finishTreeRename,
      fileMetadataTarget: tree.fileMetadataTarget,
      openFileContextMenu: tree.openFileContextMenu,
      openDirectoryContextMenu: tree.openDirectoryContextMenu,
      openWorkspaceEntryContextMenu: tree.openWorkspaceEntryContextMenu,
      workspaceDropdownContextMenu: tree.workspaceDropdownContextMenu,
      fileContextMenu: tree.fileContextMenu,
      multipleContextEntries: tree.multipleContextEntries,
      contextEntries: tree.contextEntries,
      fileContextKeydown: tree.fileContextKeydown,
      selectionDeleteDisabled: tree.selectionDeleteDisabled,
      fileContextAction: tree.fileContextAction,
      contextFolderHome: tree.contextFolderHome,
      folderHomeContextAction: tree.folderHomeContextAction,
      fileMutationDisabled: tree.fileMutationDisabled,
      directoryHasManagedFile: tree.directoryHasManagedFile,
      canDuplicateEntry: tree.canDuplicateEntry,
      folderConversionIssue: tree.folderConversionIssue,
      convertDocumentStructure: tree.convertDocumentStructure,
      closeFileContextMenu: tree.closeFileContextMenu,
      fileDeleteDisabled: tree.fileDeleteDisabled,
      directoryContextMenu: tree.directoryContextMenu,
      directoryContextAction: tree.directoryContextAction,
      directoryContextDuplicateDisabled: tree.directoryContextDuplicateDisabled,
      directoryContextRenameDisabled: tree.directoryContextRenameDisabled,
      directoryContextDeleteDisabled: tree.directoryContextDeleteDisabled,
      workspaceEntryContextMenu: tree.workspaceEntryContextMenu,
      setWorkspaceEntryContextMenuElement,
      workspaceEntryContextKeydown: tree.workspaceEntryContextKeydown,
      workspaceEntryContextAction: tree.workspaceEntryContextAction,
      pageContextMenu: docs.pageContextMenu,
      setPageContextMenuElement,
      pageContextKeydown: docs.pageContextKeydown,
      outlineContextMenu: outlineCtrl.outlineContextMenu,
      setOutlineContextMenuElement,
      outlineContextKeydown: outlineCtrl.outlineContextKeydown,
    },
    modals: {
      modal: modals.modal,
      showModal: modals.showModal,
      modalBusy: modals.modalBusy,
      modalTitle: modals.modalTitle,
      input: modals.input,
      setModalInputElement: modals.setModalInputElement,
      searchResults: modals.searchResults,
      openSearchResult: modals.openSearchResult,
      searchHighlightParts: modals.searchHighlightParts,
      searchResultLocation: modals.searchResultLocation,
      searching: modals.searching,
      searchError: modals.searchError,
      submitModal: modals.submitModal,
      modalDeleteEntries: modals.modalDeleteEntries,
      modalTarget: modals.modalTarget,
      modalError: modals.modalError,
      removeDocument: modals.removeDocument,
      settingsPanel,
      openingSettingsWindow: settingsCtrl.openingSettingsWindow,
      openSettingsTab: settingsCtrl.openSettingsTab,
      openSettingsInNewWindow: settingsCtrl.openSettingsInNewWindow,
      settingsPage: settingsCtrl.settingsPage,
      settingsContext: settingsCtrl.settingsContext,
      settingsAction: settingsCtrl.settingsAction,
      workspaceExporting: modals.workspaceExporting,
      workspaceExportError: modals.workspaceExportError,
      workspaceDeletionError: modals.workspaceDeletionError,
      deleteWorkspace: modals.deleteWorkspace,
      exportWorkspace: modals.exportWorkspace,
      commandPaletteOpened,
      importPanel,
      importRecords,
      recyclePanel,
      agentPanel,
      selectedDiff,
      historyPanel,
      historyPage,
      objectDetail,
      openObjectReference,
      planArchiveOpen,
      planDetail,
      openPlanReference,
      selectionTodo: inlineAssist.selectionTodo,
      fatal,
    },
  };
}
