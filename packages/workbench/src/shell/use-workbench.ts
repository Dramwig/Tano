import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  shallowReactive,
  shallowRef,
  watch,
} from 'vue';
import { storeToRefs } from 'pinia';
import { Bot, Settings2 } from 'lucide-vue-next';
import { version as appVersion } from '../../package.json';
import { defaultSelectionContext } from '@tano/editor/selection-context';
import {
  fileHandlers,
  isDataTableFilePath,
  isMarkdown,
  isObjectPath,
  isWorkspaceInternalPath,
  parentPath,
  relativeWorkspaceReference,
  resolveReference,
  safeRemoteImage,
  type FileEntry,
  type ReferenceIdentity,
  type ReferenceTarget,
} from '@tano/protocol';
import { native } from '../workspace/adapter';
import { agentInboxKey, useAgentInboxController } from '../assistant/agent-controller';
import { butterflyScope } from '../assistant/butterfly';
import { butterflyPerchDirective, provideButterflyController } from '../assistant/butterfly-vue';
import { ASSISTANT_TAB_ID, openAssistantPage } from '../assistant/navigation';
import { useAssistantStore, useInlineAssistantStore } from '../assistant/store';
import type { AttachmentStatusUpdate } from '../files/attachment-status';
import { nativeAttachments, openExternalUrl } from '../files/attachments';
import { CALENDAR_TAB_ID } from '../plans/calendar';
import type { ImportRecord } from '../workspace/components/ImportPanel.vue';
import { useDocumentActions } from '../composables/use-document-actions';
import { useFileTreeController } from '../composables/use-file-tree-controller';
import { useInlineAssistant } from '../composables/use-inline-assistant';
import { useWorkbenchCalendar } from '../composables/use-workbench-calendar';
import { useWorkbenchHistory } from '../composables/use-workbench-history';
import { useWorkbenchModals } from '../composables/use-workbench-modals';
import { useWorkbenchOutline } from '../composables/use-workbench-outline';
import { useWorkbenchPreferences } from '../composables/use-workbench-preferences';
import { useWorkbenchShortcuts } from '../composables/use-workbench-shortcuts';
import { isTableTab, tableFileId } from '../data-tables/data-tables';
import { appearanceText } from '../documents/document-appearance';
import { useDocumentFavicon } from '../documents/document-favicon';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import type { HelpAvailability, HelpContext } from '../help/help-content';
import { t, uiLocale } from '../i18n/i18n';
import { planKey } from '../plans/personal-plans';
import { mobile } from '../platform/platform';
import { nativeListen as listen } from '../platform/native-bridge';
import { pluginPreviewStatus, pluginViewHeader } from '../plugins/view-header';
import {
  createLocalExtensions,
  useWorkbenchRuntime,
  type WorkbenchActions,
  type WorkbenchViewTab,
} from '../runtime';
import { planDocumentSource } from '../plans/selection-todo';
import { readSettingsPage } from '../settings/settings-preference';
import type { SettingsPageId } from '../settings/settings-window';
import { shortcutAriaLabel, shortcutKeys } from './shortcuts';
import { usePlanSyncStore } from '../stores/plan-sync';
import { usePlanStore } from '../stores/plans';
import { useSuggestionStore } from '../stores/suggestions';
import { useUpdatesStore } from '../stores/updates';
import { useWorkspaceStore } from '../stores/workspace';
import { useViewport } from './viewport';
import { useWindowContext } from '../windows/context';
import { useAuxiliaryWindows } from '../windows/manager';
import {
  resolvePluginSidebar,
  useWorkbenchNavigation,
  type WorkspaceSidebarView,
} from './workbench-navigation';
import { retainWorkbenchSession } from './workbench-session';
import type { ObjectRecord } from '../objects/workspace-objects';
import { PLUGINS_TAB_ID } from '../plugins/workspace-plugins';
import { createWorkspaceSync, syncEvent } from '../workspace/workspace-sync';

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
  // Keep the panel mounted until its closing transition releases the layout space.
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
  // Document tabs belong to the desktop app. Mobile and web use page navigation.
  const tabsEnabled = native && !mobile;
  const { width: viewportWidth, touch: touchLayout, compact: compactPanes } = useViewport(mobile);
  const isAuxiliaryWindow = false;
  const localNative = native && !store.isWeb;
  const attachments =
    useWorkbenchRuntime().attachments ?? (localNative ? nativeAttachments : undefined);
  const workspaceAdapter = useWorkbenchRuntime().adapter;
  const documentationBaseUrl = useWorkbenchRuntime().documentationBaseUrl;
  const extensions = useWorkbenchRuntime().extensions?.() ?? createLocalExtensions();
  const extensionViews = extensions.views ?? [];
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
  const systemSyncPanel = ref(false);
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

  // Navigation & view tabs
  const SETTINGS_TAB_ID = 'view:settings';
  const settingsTabView: WorkbenchViewTab = {
    id: SETTINGS_TAB_ID,
    get label() {
      return t('设置');
    },
    icon: Settings2,
    scope: 'account',
    detachable: true,
  };
  store.registerViews([
    ...extensionViews,
    settingsTabView,
    { id: ASSISTANT_TAB_ID, label: t('助手'), icon: Bot },
  ]);
  store.setBeforeWorkspaceChange(async () => {
    if (!(await auxiliaryWindows.closeAll()))
      throw new Error(t('还有未保存的修改，请先处理保存错误。'));
    await assistant.settle();
    await inlineRunner.settle();
    await agentInbox.settle();
  });
  const activeExtensionView = computed(() =>
    extensionViews.find((view) => view.id === store.activeId),
  );
  watch(
    activeExtensionView,
    (view) => {
      if (view?.collapseSidebarOnOpen) sidebar.value = false;
    },
    { immediate: true },
  );

  const navigation = useWorkbenchNavigation(
    () => store.workspace?.id,
    isAuxiliaryWindow
      ? undefined
      : {
          getItem: (key) => localStorage.getItem(key),
          setItem: (key, value) => localStorage.setItem(key, value),
        },
  );
  const { context: navigationContext, module: navigationModule, workspaceView, sidebarView } =
    navigation;
  let personalPlanScope: typeof plans.view = 'all';
  // Migrate the former workspace plan mode to the workspace view switcher.
  watch(
    [navigationContext, navigationModule],
    ([context, module]) => {
      if (context === 'workspace' && module === 'plan') navigation.selectWorkspaceView('events');
    },
    { immediate: true },
  );

  const homeContent = ref<string>();
  const homeExtension = computed(() =>
    extensionViews.find((view) => view.id === homeContent.value),
  );

  const calendar = useWorkbenchCalendar({
    store,
    plans,
    navigationContext,
    navigationModule,
    sidebarView,
    homeContent,
    compactPanes,
    sidebar,
    selectModule: (id) => selectModule(id),
  });

  function selectContext(context: 'home' | 'workspace') {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    navigation.selectContext(context);
    plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
    calendar.restoreCalendar();
    workspaceMenu.value = false;
  }
  watch(navigationContext, (context) => {
    plans.view = context === 'home' ? personalPlanScope : 'workspace';
  });
  function selectWorkspaceView(id: string) {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    navigation.selectWorkspaceView(id as WorkspaceSidebarView);
    calendar.restoreCalendar();
    if (id === 'events') plans.view = 'workspace';
  }
  function selectModule(id: string) {
    calendar.rememberCalendar();
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    if (id === 'plan' && navigationContext.value === 'workspace')
      navigation.selectWorkspaceView('events');
    else navigation.selectModule(id);
    calendar.restoreCalendar();
    plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
    sidebar.value = true;
  }
  watch(
    () => store.activePluginSidebar,
    (key) => {
      if (key) {
        sidebarView.value = `plugin-sidebar:${key}`;
        sidebar.value = true;
      }
    },
  );
  watch(
    [
      () => store.workspaceLoading.plugins || store.installedPluginWorkspace !== store.workspace?.id,
      () => store.pluginViews,
      sidebarView,
    ],
    ([loading, views, current]) => {
      const resolved = resolvePluginSidebar(current, loading, views);
      if (resolved !== current) sidebarView.value = resolved;
    },
  );
  watch(sidebarView, (current) => {
    if (store.activePluginSidebar && current !== `plugin-sidebar:${store.activePluginSidebar}`)
      store.activePluginSidebar = '';
  });
  watch(
    () => store.pluginSettingsRequest,
    (request) => {
      if (request) openSettings(request.key);
    },
  );

  function openExtensionView(id: string) {
    if (navigationContext.value === 'home') personalPlanScope = plans.view;
    calendar.rememberCalendar();
    if (extensionViews.find((view) => view.id === id)?.sidebar) navigation.openInHome(id);
    else navigation.selectContext('home');
    calendar.restoreCalendar();
    if (!store.workspace) homeContent.value = id;
    else store.openViewTab(id);
    if (compactPanes.value) sidebar.value = false;
  }

  const viewActions = Object.fromEntries(
    extensionViews.map((view) => [
      view.id,
      {
        open: () => {
          openExtensionView(view.id);
          if (compactPanes.value) sidebar.value = false;
        },
        showSidebar: () => {
          selectModule(view.id);
          sidebar.value = true;
        },
      },
    ]),
  );

  // Header / toolbar visibility item descriptors
  const sidebarNavigationItems = computed(() => [
    {
      id: 'plan',
      get label() {
        return t('计划');
      },
    },
    ...extensionViews
      .filter((view) => view.sidebar)
      .map((view) => ({ id: view.id, label: view.label })),
  ]);
  const sidebarHeaderItems = computed(() => [
    ...(navigationModule.value === 'workspace'
      ? [
          {
            id: 'search',
            get label() {
              return t('查找文档');
            },
          },
          ...(store.workspaceSettings.showGraph
            ? [
                {
                  id: 'graph',
                  get label() {
                    return t('关系图谱');
                  },
                },
              ]
            : []),
        ]
      : []),
    ...extensionViews
      .filter((view) => view.header)
      .map((view) => ({ id: view.id, label: view.label })),
  ]);
  const repositoryActionItems = computed(() => [
    {
      id: 'create',
      get label() {
        return t('新建文档');
      },
    },
    {
      id: 'folder',
      get label() {
        return t('新建文件夹');
      },
    },
  ]);
  const documentToolItems = [
    {
      id: 'markdown-reveal',
      get label() {
        return t('光标展开源码');
      },
    },
    {
      id: 'source-mode',
      get label() {
        return t('源码模式');
      },
    },
  ];
  const topbarItems = [
    {
      id: 'breadcrumb',
      get label() {
        return t('面包屑');
      },
    },
  ];
  const calendarToolItems = [
    {
      id: 'calendar-period',
      get label() {
        return t('日历日期');
      },
    },
    {
      id: 'calendar-today',
      get label() {
        return t('今天');
      },
    },
    {
      id: 'calendar-previous',
      get label() {
        return t('上一时段');
      },
    },
    {
      id: 'calendar-next',
      get label() {
        return t('下一时段');
      },
    },
    {
      id: 'calendar-mode',
      get label() {
        return t('日历视图');
      },
    },
    {
      id: 'calendar-events',
      get label() {
        return t('管理事件');
      },
    },
  ];
  function topbarVisibilityItems(tabId: string, hasDocument: boolean, activePane: boolean) {
    return [
      ...topbarItems.filter(
        (item) => item.id !== 'breadcrumb' || (tabId !== CALENDAR_TAB_ID && tabId !== GRAPH_TAB_ID),
      ),
      ...(hasDocument || tabId.startsWith('attachment:')
        ? [
            {
              id: 'document-status',
              get label() {
                return t('文章状态');
              },
            },
          ]
        : []),
      ...(activePane && extensions.regions['editing-status']
        ? [
            {
              id: 'editing-status',
              get label() {
                return t('同步状态');
              },
            },
          ]
        : []),
      ...(tabId === CALENDAR_TAB_ID ? calendarToolItems : []),
      ...(tabId.startsWith('attachment:') && attachments
        ? [
            {
              id: 'attachment-export',
              get label() {
                return t('导出附件');
              },
            },
          ]
        : []),
      ...(hasDocument ? documentToolItems : []),
    ].map((item, index, items) => ({
      ...item,
      separatorBefore: items[index - 1]?.id === 'document-status',
    }));
  }

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

  // Workbench session & git/system sync
  const workbenchSession = retainWorkbenchSession(store, () => {
    void extensions.disconnect().catch(store.report);
    assistant.stop();
    inlineRunner.stop();
    void editing.dispose().catch(store.report);
    store.dispose();
  });
  let unmounted = false;
  assistant.setManaged((id) => editing.isManaging(id));
  inlineRunner.setManaged((id) => editing.isManaging(id));

  const workspaceSync = createWorkspaceSync(store, extensions);
  function openSystemSync(event?: Event) {
    const id = (event as CustomEvent | undefined)?.detail?.workspaceId;
    if (!native || mobile || !store.workspace || store.isWeb || (id && id !== store.workspace.id))
      return;
    workspaceMenu.value = false;
    systemSyncPanel.value = true;
    void workspaceSync.action('status');
  }
  let syncTimer: ReturnType<typeof setInterval> | undefined;
  onMounted(() => {
    window.addEventListener(syncEvent, openSystemSync);
    if (native && !mobile)
      syncTimer = setInterval(() => {
        void workspaceSync.tick();
      }, 30_000);
  });
  onBeforeUnmount(() => {
    window.removeEventListener(syncEvent, openSystemSync);
    clearInterval(syncTimer);
    workspaceSync.reset();
  });
  watch(
    () => store.workspace?.id,
    () => {
      systemSyncPanel.value = false;
      workspaceSync.reset();
    },
  );

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
    // Let the captured pane settle before showing the page; the editor stays mounted.
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
    workspaceSync,
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
    showFileObject,
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

  // Objects, plans & asset import
  const objectPanel = ref(false);
  // Keep drafts across close/reopen, but don't load the panel until it is first requested.
  const objectPanelMounted = ref(false);
  watch(
    objectPanel,
    (open) => {
      if (open) objectPanelMounted.value = true;
    },
    { flush: 'sync' },
  );
  const selectedObjectId = ref<string>();
  const selectedResourceIdentity = shallowRef<ReferenceIdentity>();
  const selectedPersonal = ref(false);
  const planDetail = shallowRef<ObjectRecord>();
  const assetInput = ref<HTMLInputElement>();
  const assetImportBusy = ref(false);

  function showObjects(id?: string) {
    selectedPersonal.value = false;
    selectedResourceIdentity.value = undefined;
    selectedObjectId.value = id;
    objectPanel.value = true;
    workspaceMenu.value = false;
  }
  function showFileObject(identity: ReferenceIdentity) {
    if (!['document', 'asset'].includes(identity.type)) return;
    selectedPersonal.value = false;
    selectedObjectId.value = undefined;
    selectedResourceIdentity.value = identity;
    objectPanel.value = true;
    workspaceMenu.value = false;
  }
  function showPlanEvent(key: string) {
    const personal = plans.personal.find((item) => planKey(item) === key);
    const local = store.objects.find(
      (item) => item.object.id === key && ['event', 'task'].includes(item.object.type),
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
    objectPanel.value = false;
    if (record.source?.scope === 'workspace') selectContext('workspace');
    planDetail.value = record;
    if (compactPanes.value) sidebar.value = false;
  }
  function managePlanEvents() {
    showObjects();
    selectedPersonal.value = plans.view === 'personal';
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
      if (record) showObjects(record.object.id);
      else store.report(t('对象文件不可用，请在工作区对象面板检查格式或重复 ID'));
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
      store.report(t('当前工作区中引用目标不可用，请检查对象是否被移除或 ID 是否重复'));
      return;
    }
    if (identity.type !== 'document') {
      if (['event', 'task'].includes(identity.type)) showPlanEvent(identity.id);
      else if (['document', 'asset'].includes(identity.type)) showFileObject(identity);
      else showObjects(identity.id);
      return;
    }
    const file = workspace.value?.files.find((file) => file.id === identity.id);
    if (file) await openEntry(file);
  }
  async function openObjectResource(identity: ReferenceIdentity) {
    const result = resolveReference(store.referenceTargets, identity);
    if (!result.target || !['document', 'asset'].includes(identity.type)) return;
    const file = workspace.value?.files.find(
      (file) => file.id === identity.id && file.path === result.target!.path,
    );
    if (!file) return;
    if (identity.type === 'document') objectPanel.value = false;
    await openEntry(file);
  }
  async function openObjectReference(identity: ReferenceIdentity) {
    if (identity.type === 'document') objectPanel.value = false;
    await openReference(identity);
  }
  async function openWorkspaceViewSourceFile(file: FileEntry) {
    if (isMarkdown(file.path) || isDataTableFilePath(file.path)) await openEntry(file);
    else store.openAttachmentInNewTab(file);
  }
  function openWorkspaceViewSourceObject(identity: ReferenceIdentity) {
    void openObjectReference(identity);
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
  async function importObjectAssets(event: Event) {
    const inputEl = event.target as HTMLInputElement;
    const files = Array.from(inputEl.files ?? []);
    inputEl.value = '';
    const selectedWorkspace = workspace.value;
    if (
      !attachments ||
      !selectedWorkspace ||
      selectedWorkspace.readOnly ||
      !store.capabilities.features.objectReferences ||
      assetImportBusy.value
    )
      return;
    assetImportBusy.value = true;
    try {
      for (const file of files) {
        if (workspace.value?.id !== selectedWorkspace.id)
          throw new Error(t('工作区已切换，已导入的资产保留在原工作区'));
        await attachments.importAttachment(selectedWorkspace.id, '', file, false);
      }
    } catch (error) {
      store.report(error);
    } finally {
      if (workspace.value?.id === selectedWorkspace.id) await store.refresh();
      assetImportBusy.value = false;
    }
  }
  function assetPreview(target: ReferenceTarget) {
    return attachments &&
      target.type === 'asset' &&
      ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(target.mime ?? '')
      ? attachments.imageUrl(workspace.value, '', relativeWorkspaceReference('', target.path))
      : null;
  }

  // Settings window / tab / modal
  const settingsPage = ref<SettingsPageId>(readSettingsPage());
  // A loaded workspace keeps its session, but only the workspace navigation owns its settings.
  const settingsWorkspace = computed(() =>
    navigationContext.value === 'workspace' ? workspace.value : null,
  );
  function openSettingsTab(page: SettingsPageId) {
    settingsPage.value = page;
    store.openViewTab(SETTINGS_TAB_ID);
    settingsPanel.value = false;
    if (compactPanes.value) sidebar.value = false;
  }
  const openingSettingsWindow = ref(false);
  async function openSettingsInNewWindow(page: SettingsPageId) {
    if (!native || mobile || !tabsEnabled) return;
    settingsPage.value = page;
    if (openingSettingsWindow.value) return;
    openingSettingsWindow.value = true;
    settingsPanel.value = false;
    try {
      activeWindow.value = (
        await auxiliaryWindows.open('settings', 'settings', t('设置') + ' — Tano / 同页')
      ).context;
    } catch (error) {
      settingsPanel.value = true;
      store.report(error);
    } finally {
      openingSettingsWindow.value = false;
    }
  }
  function openSettings(page: SettingsPageId = readSettingsPage(settingsPage.value)) {
    menu.value = false;
    workspaceMenu.value = false;
    settingsPage.value = page === 'preferences' ? 'appearance' : page;
    const pane = store.panes.find((pane) => pane.tabs.includes(SETTINGS_TAB_ID));
    if (pane) {
      store.focusPane(pane.id);
      openSettingsTab(settingsPage.value);
      return;
    }
    settingsPanel.value = true;
  }
  function settingsAction(
    action: 'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out',
  ) {
    if (!settingsWorkspace.value && ['reveal', 'agent', 'history', 'recycle'].includes(action))
      return;
    settingsPanel.value = false;
    if (action === 'open-folder') void store.openWorkspace();
    else if (action === 'reveal') void store.reveal();
    else if (action === 'agent') agentPanel.value = true;
    else if (action === 'history') extensions.showHistory?.();
    else if (action === 'recycle') recyclePanel.value = true;
  }
  const settingsContext = computed(() => ({
    pluginPages: settingsWorkspace.value ? store.pluginSettingsPages : [],
    workspace: settingsWorkspace.value
      ? {
          id: settingsWorkspace.value.id,
          name: settingsWorkspace.value.name,
          path: settingsWorkspace.value.path,
          readOnly: settingsWorkspace.value.readOnly,
          canDelete: settingsWorkspace.value.canDelete,
          canManageSettings: settingsWorkspace.value.canManageSettings,
        }
      : null,
    activeFile:
      settingsWorkspace.value && store.active
        ? { id: store.active.id, path: store.active.path }
        : null,
    workspaceSettings: store.workspaceSettings,
    workspacePages:
      settingsWorkspace.value?.files
        .filter(
          (file) =>
            file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path),
        )
        .map((file) => ({ id: file.id, path: file.path })) ?? [],
    workspaceSettingsError: store.workspaceSettingsError,
    workspaceSettingsSaving: store.workspaceSettingsSaving,
    workspaceExporting: modals.workspaceExporting.value,
    workspaceExportError: modals.workspaceExportError.value,
    workspaceDeletionSupported: !!workspaceAdapter.deleteWorkspace,
    workspaceDeleting: modals.workspaceDeleting.value || store.busy,
    workspaceDeletionError: modals.workspaceDeletionError.value,
    mode: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
    defaultSource: prefs.defaultSource.value,
    theme: prefs.theme.value,
    appearance: prefs.appearance.value,
    visualFontChoice: prefs.visualFontChoice.value,
    customFontName: prefs.customFontName.value,
    splitFontSettings: prefs.splitFontSettings.value,
    revealMarkdown: prefs.revealMarkdown.value,
    toolbarMode: prefs.toolbarMode.value,
    shortcuts: prefs.shortcuts.value,
    showPageTitle: prefs.showPageTitle.value,
    showDocumentProperties: prefs.showDocumentProperties.value,
    showDocumentDiscussion: prefs.showDocumentDiscussion.value,
    showOutline: outlineCtrl.showOutline.value,
    outlineOnLeft: outlineCtrl.outlineOnLeft.value,
    visualFontSize: prefs.visualFontSize.value,
    sourceFontSize: prefs.sourceFontSize.value,
    editorPreferences: prefs.editorPreferences.value,
    historyEnabled: !!extensions.historyEnabled,
    capabilities: store.capabilities,
    capabilityError: store.capabilityError,
    capabilitySaving: store.capabilitySaving,
    version: updates.state.status?.currentVersion ?? appVersion,
    updates: updates.state,
  }));

  const extensionActions: WorkbenchActions = {
    closeMenus: () => {
      workspaceMenu.value = false;
      menu.value = false;
    },
    createWorkspace: () => {
      void modals.createNewWorkspace();
    },
    openSettings,
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
  async function dragPaneWindow(event: MouseEvent) {
    if (event.button !== 0 || event.detail !== 1) return;
    await activeWindow.value.native?.startDragging();
  }
  async function maximizePaneWindow() {
    await activeWindow.value.native?.toggleMaximize();
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
    objectPanel,
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
    openSystemSync,
    openSettings,
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

  // Cross-domain watchers & lifecycle
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

  const noteCount = computed(
    () =>
      workspace.value?.files.filter(
        (f) =>
          f.kind === 'file' &&
          !isWorkspaceInternalPath(f.path) &&
          (isMarkdown(f.path) || isDataTableFilePath(f.path)),
      ).length ?? 0,
  );

  // Help guidance state
  const helpContext = computed<HelpContext>(() => {
    if (activeId.value === ASSISTANT_TAB_ID || sidebarView.value === 'assistant')
      return 'assistant';
    if (isTableTab(activeId.value)) return 'tables';
    if (activeId.value === GRAPH_TAB_ID) return 'graph';
    if (activeId.value === PLUGINS_TAB_ID) return 'plugins';
    if (activeId.value === CALENDAR_TAB_ID || sidebarView.value === 'plan') return 'plan';
    if (!active.value) return 'welcome';
    if (docs.editorReadonly.value) return 'reading';
    if (docs.source.value) return 'source';
    return active.value.content.trim() ? 'document' : 'empty-document';
  });
  const helpAvailability = computed<HelpAvailability>(() => ({
    'document-write': !!active.value && !docs.editorReadonly.value,
    'workspace-write': !!workspace.value && !workspace.value.readOnly,
    plans: plans.personalWritable || plans.workspaceWritable,
    comments: !!active.value && !docs.editorReadonly.value,
    templates: !!workspace.value && !workspace.value.readOnly,
    import: !!workspace.value && !workspace.value.readOnly,
    duplicate: !!workspace.value && !workspace.value.readOnly && !!workspaceAdapter.duplicate,
    'folder-home': !!workspace.value && !!store.workspaceSettings.folderHomeFileName,
    'folder-conversion':
      !!workspace.value &&
      !workspace.value.readOnly &&
      store.canConvertFolderDocuments &&
      !!store.workspaceSettings.folderHomeFileName,
    panes: !!workspace.value && !compactPanes.value,
    assistant: !!workspace.value && assistant.available,
    'assistant-configure':
      !!workspace.value && assistant.available && assistant.canConfigure && !assistant.demo,
    suggestions:
      !!active.value && !docs.editorReadonly.value && !editing.isManaging(active.value.id),
    math: !!active.value && !docs.editorReadonly.value && store.capabilities.features.math,
    mermaid: !!active.value && !docs.editorReadonly.value && store.capabilities.features.mermaid,
  }));
  const helpBlocked = computed(
    () =>
      !!(
        activeExtensionView.value ||
        activeId.value === SETTINGS_TAB_ID ||
        activeId.value.startsWith('attachment:') ||
        (assistant.opened && assistant.displayMode === 'fullscreen') ||
        busy.value ||
        fatal.value ||
        store.pending ||
        active.value?.conflict ||
        active.value?.error ||
        workspaceMenu.value ||
        menu.value ||
        modals.modal.value ||
        settingsPanel.value ||
        importPanel.value ||
        templateLibraryOpen.value ||
        agentPanel.value ||
        objectPanel.value ||
        selectedDiff.value ||
        inlineAssist.selectionTodo.value ||
        recyclePanel.value ||
        docs.referenceGraphOpened.value ||
        tree.fileContextMenu.value ||
        tree.directoryContextMenu.value ||
        docs.pageContextMenu.value ||
        outlineCtrl.outlineContextMenu.value ||
        prefs.resizingSidebar.value ||
        tree.draggedEntry.value ||
        updateLock.value
      ),
  );

  // Startup & native window lifecycle
  let unlistenClose: (() => void) | undefined;
  let unlistenWatchError: (() => void) | undefined;

  onMounted(async () => {
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
      navigation.restore();
      if (
        navigation.homeModule.value !== 'plan' &&
        !extensionViews.some(
          (view) => view.id === navigation.homeModule.value && view.sidebar,
        )
      )
        navigation.homeModule.value = 'plan';
      plans.view = navigationContext.value === 'home' ? personalPlanScope : 'workspace';
      startupPending.value = false;
    }
    if (unmounted) return;
    emit('ready');
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
    document.documentElement.style.removeProperty('--sidebar-width');
    workbenchSession.release();
    window.removeEventListener('popstate', history.handlePagePopState);
    unlistenClose?.();
    unlistenWatchError?.();
  });

  return {
    auxiliaryWindows,
    activeWindow,
    detachedTitle: modals.detachedTitle,
    native,
    mobile,
    workspace,
    compactPanes,
    isAuxiliaryWindow,
    sidebar,
    t,
    shortcuts: prefs.shortcuts,
    toggleSidebar,
    sessionPending,
    tabFileDrag: tree.tabFileDrag,
    fileDragEnd: tree.fileDragEnd,
    store,
    createNewDocument: modals.createNewDocument,
    detachTab: modals.detachTab,
    resizingSidebar: prefs.resizingSidebar,
    moveSidebarResize: prefs.moveSidebarResize,
    finishSidebarResize: prefs.finishSidebarResize,
    butterfly,
    fileMetadataTarget: tree.fileMetadataTarget,
    switchingWorkspace,
    mainColumn,
    returnHome: modals.returnHome,
    sidebarHeaderItems,
    closeButtonVisibilityMenus,
    extensionViews,
    viewActions,
    navigationContext,
    sidebarNavigationItems,
    navigationModule,
    selectModule,
    sidebarView,
    draggedEntry: tree.draggedEntry,
    dropFolder: tree.dropFolder,
    dropPlaceholders: tree.dropPlaceholders,
    fileDragOver: tree.fileDragOver,
    fileDragLeave: tree.fileDragLeave,
    fileDrop: tree.fileDrop,
    workspaceView,
    selectWorkspaceView,
    workspaceMenu,
    modal: modals.modal,
    settingsPanel,
    repositoryActionItems,
    showModal: modals.showModal,
    activeId,
    GRAPH_TAB_ID,
    busy,
    openDirectoryContextMenu: tree.openDirectoryContextMenu,
    startupPending,
    filesPending,
    treeFiles: tree.treeFiles,
    fileTree: tree.fileTree,
    revealedHomeId: tree.revealedHomeId,
    treeDocumentIcons: tree.treeDocumentIcons,
    loadTreeDocumentIcon: tree.loadTreeDocumentIcon,
    selectedEntryIds: tree.selectedEntryIds,
    fileContextMenu: tree.fileContextMenu,
    canDragEntry: tree.canDragEntry,
    treeRename: tree.treeRename,
    renameTreeEntry: tree.renameTreeEntry,
    openTreeEntry: tree.openTreeEntry,
    selectFileTreeEntry: tree.selectFileTreeEntry,
    openFileContextMenu: tree.openFileContextMenu,
    fileDragStart: tree.fileDragStart,
    finishTreeRename: tree.finishTreeRename,
    noteCount,
    showObjects,
    sidebarCalendarDate: calendar.sidebarCalendarDate,
    openCalendar: calendar.openCalendar,
    showPlanEvent,
    multipleContextEntries: tree.multipleContextEntries,
    contextEntries: tree.contextEntries,
    fileContextKeydown: tree.fileContextKeydown,
    localNative,
    selectionDeleteDisabled: tree.selectionDeleteDisabled,
    fileContextAction: tree.fileContextAction,
    shortcutHint: prefs.shortcutHint,
    contextFolderHome: tree.contextFolderHome,
    folderHomeContextAction: tree.folderHomeContextAction,
    fileMutationDisabled: tree.fileMutationDisabled,
    directoryHasManagedFile: tree.directoryHasManagedFile,
    isMarkdown,
    isDataTableFilePath,
    attachments,
    tabsEnabled,
    canDuplicateEntry: tree.canDuplicateEntry,
    isWorkspaceInternalPath,
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
    workspaceEntryContextMenuElement: tree.workspaceEntryContextMenuElement,
    workspaceEntryContextKeydown: tree.workspaceEntryContextKeydown,
    workspaceEntryContextAction: tree.workspaceEntryContextAction,
    toggleWorkspaceMenu,
    workspaceDropdownContextMenu: tree.workspaceDropdownContextMenu,
    selectContext,
    extensions,
    extensionActions,
    commandPaletteOpened,
    openSystemSync,
    openImport,
    openTemplateLibrary,
    openSettings,
    updates,
    recyclePanel,
    agentPanel,
    createNewWorkspace: modals.createNewWorkspace,
    openWorkspaceEntryContextMenu: tree.openWorkspaceEntryContextMenu,
    helpContext,
    helpAvailability,
    helpBlocked,
    documentationBaseUrl,
    menu,
    openExternalUrl,
    sidebarWidth: prefs.sidebarWidth,
    defaultSidebarWidth: prefs.defaultSidebarWidth,
    SIDEBAR_MIN_WIDTH: prefs.SIDEBAR_MIN_WIDTH,
    sidebarWidthLimit: prefs.sidebarWidthLimit,
    startSidebarResize: prefs.startSidebarResize,
    resizeSidebarWithKeyboard: prefs.resizeSidebarWithKeyboard,
    referenceGraphTarget: docs.referenceGraphTarget,
    referenceGraphOpened: docs.referenceGraphOpened,
    referenceGraphAnchor: docs.referenceGraphAnchor,
    openReference,
    assistantTab,
    dragPaneWindow,
    maximizePaneWindow,
    assistant,
    assistantPanelMounted,
    assistantHosts,
    ASSISTANT_TAB_ID,
    revealAssistantSelection: docs.revealAssistantSelection,
    templateLibraryOpen,
    templatePaneId,
    templateSource,
    templateInitialization,
    workspaceStatusLabel,
    openEntry,
    openBreadcrumbDirectory,
    setAssistantHost,
    topbarVisibilityItems,
    canNavigatePage: history.canNavigatePage,
    navigatePage: history.navigatePage,
    CALENDAR_TAB_ID,
    paneButterflyScope,
    pluginViewHeader,
    pluginPreviewStatus,
    paneDocumentStatus: docs.paneDocumentStatus,
    attachmentStatus,
    currentAttachmentStatus,
    PLUGINS_TAB_ID,
    settingsTabView,
    touchLayout,
    showOutline: outlineCtrl.showOutline,
    touchOutlineOpen: outlineCtrl.touchOutlineOpen,
    panel: outlineCtrl.panel,
    isTableTab,
    calendarToolItems,
    calendarPeriod: calendar.calendarPeriod,
    calendarDate: calendar.calendarDate,
    moveCalendarPeriod: calendar.moveCalendarPeriod,
    calendarModeOpen: calendar.calendarModeOpen,
    calendarModeLabel: calendar.calendarModeLabel,
    calendarModeOptions: calendar.calendarModeOptions,
    calendarMode: calendar.calendarMode,
    selectCalendarMode: calendar.selectCalendarMode,
    managePlanEvents,
    documentSuggestions,
    editing,
    suggestionModeBusy,
    toggleSuggestionMode,
    documentToolItems,
    revealMarkdown: prefs.revealMarkdown,
    paneSource: docs.paneSource,
    shortcutAriaLabel,
    shortcutKeys,
    setPaneSource: docs.setPaneSource,
    documentMenuElement: docs.documentMenuElement,
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
    limitPageWidth: prefs.limitPageWidth,
    pageWidthWritable: prefs.pageWidthWritable,
    setLimitPageWidth: prefs.setLimitPageWidth,
    workspaceLocked: prefs.workspaceLocked,
    pageLocked: prefs.pageLocked,
    togglePageLock: prefs.togglePageLock,
    historyPage,
    historyPanel,
    editorPreferences: prefs.editorPreferences,
    showPageTitle: prefs.showPageTitle,
    showDocumentProperties: prefs.showDocumentProperties,
    showAllLineNumbers: prefs.showAllLineNumbers,
    togglePageOption: docs.togglePageOption,
    toggleWorkspaceLock: prefs.toggleWorkspaceLock,
    exportBusy: docs.exportBusy,
    exportDocument: docs.exportDocument,
    printBusy: docs.printBusy,
    printActiveDocument: docs.printActiveDocument,
    sessionBlocksFileMutation: docs.sessionBlocksFileMutation,
    removeDocument: modals.removeDocument,
    tableFileId,
    openAssistant: inlineAssist.openAssistant,
    parentPath,
    openWorkspaceViewSourceFile,
    openWorkspaceViewSourceObject,
    calendarScope: calendar.calendarScope,
    plans,
    showCalendarDay: calendar.showCalendarDay,
    showCalendarMonth: calendar.showCalendarMonth,
    openAssistantPage,
    SETTINGS_TAB_ID,
    selectedVisualFontFamily: prefs.selectedVisualFontFamily,
    visualFontSize: prefs.visualFontSize,
    setPaneSearch: docs.setPaneSearch,
    paneSourceEditors: docs.paneSourceEditors,
    paneEditors: docs.paneEditors,
    paneSearchRevisions: docs.paneSearchRevisions,
    setPaneElement: docs.setPaneElement,
    toolbarMode: prefs.toolbarMode,
    scheduleActiveHeading: outlineCtrl.scheduleActiveHeading,
    appearance: prefs.appearance,
    assistantTaskActive: inlineAssist.assistantTaskActive,
    beginSelectionTodo: inlineAssist.beginSelectionTodo,
    paneEditorScrolls: docs.paneEditorScrolls,
    paneSelections: docs.paneSelections,
    defaultSelectionContext,
    showSourceTodo: inlineAssist.showSourceTodo,
    selectedDiff,
    sourceFontSize: prefs.sourceFontSize,
    openPageContextMenu: docs.openPageContextMenu,
    safeRemoteImage,
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
    showDocumentDiscussion: prefs.showDocumentDiscussion,
    setPaneComments: docs.setPaneComments,
    discussWithAssistant: inlineAssist.discussWithAssistant,
    capturePaneCommentSelection: docs.capturePaneCommentSelection,
    focusPaneComment: docs.focusPaneComment,
    paneCommentGeometry: docs.paneCommentGeometry,
    paneScrolls: docs.paneScrolls,
    receiveAttachmentStatus,
    updateLock,
    fileHandlers,
    relativeWorkspaceReference,
    outlineOnLeft: outlineCtrl.outlineOnLeft,
    hoverOutline: outlineCtrl.hoverOutline,
    outlinePinned: outlineCtrl.outlinePinned,
    outlinePosition: outlineCtrl.outlinePosition,
    openOutlineContextMenu: outlineCtrl.openOutlineContextMenu,
    releaseOutlinePointerFocus: outlineCtrl.releaseOutlinePointerFocus,
    outlineAutoCollapse: outlineCtrl.outlineAutoCollapse,
    outlineSearchOpen: outlineCtrl.outlineSearchOpen,
    outlineSearchInput: outlineCtrl.outlineSearchInput,
    toggleOutlineSearch: outlineCtrl.toggleOutlineSearch,
    toggleOutlinePin: outlineCtrl.toggleOutlinePin,
    outlineSearch: outlineCtrl.outlineSearch,
    visibleOutline: outlineCtrl.visibleOutline,
    jumpToHeading: outlineCtrl.jumpToHeading,
    outline: outlineCtrl.outline,
    activeHeading: outlineCtrl.activeHeading,
    activities,
    uiLocale,
    homeContent,
    homeExtension,
    inlineAssistant: inlineAssist.inlineAssistant,
    inlineAssistantPrompt: inlineAssist.inlineAssistantPrompt,
    inlineAssistantState: inlineAssist.inlineAssistantState,
    inlineRunner,
    inlineAssistantError: inlineAssist.inlineAssistantError,
    inlineAssistantMessage: inlineAssist.inlineAssistantMessage,
    submitInlineAssistant: inlineAssist.submitInlineAssistant,
    continueInlineConversation: inlineAssist.continueInlineConversation,
    undoInlineAssistant: inlineAssist.undoInlineAssistant,
    closeInlineAssistant: inlineAssist.closeInlineAssistant,
    pageContextMenu: docs.pageContextMenu,
    pageContextMenuElement: docs.pageContextMenuElement,
    pageContextKeydown: docs.pageContextKeydown,
    outlineContextMenu: outlineCtrl.outlineContextMenu,
    outlineContextMenuElement: outlineCtrl.outlineContextMenuElement,
    outlineContextKeydown: outlineCtrl.outlineContextKeydown,
    toggleOutlineSide: outlineCtrl.toggleOutlineSide,
    importPanel,
    importRecords,
    systemSyncPanel,
    workspaceSync,
    active,
    importObjectAssets,
    objectPanelMounted,
    objectPanel,
    selectedObjectId,
    selectedResourceIdentity,
    selectedPersonal,
    assetImportBusy,
    assetPreview,
    openObjectResource,
    openObjectReference,
    assetInput,
    planDetail,
    openPlanReference,
    selectionTodo: inlineAssist.selectionTodo,
    workbenchCommands,
    settingsWorkspace,
    openingSettingsWindow,
    openSettingsTab,
    openSettingsInNewWindow,
    settingsPage,
    settingsContext,
    developerMode: prefs.developerMode,
    workspaceExporting: modals.workspaceExporting,
    workspaceExportError: modals.workspaceExportError,
    workspaceDeletionError: modals.workspaceDeletionError,
    deleteWorkspace: modals.deleteWorkspace,
    exportWorkspace: modals.exportWorkspace,
    defaultSource: prefs.defaultSource,
    theme: prefs.theme,
    appearanceController: prefs.appearanceController,
    visualFontChoice: prefs.visualFontChoice,
    customFontName: prefs.customFontName,
    splitFontSettings: prefs.splitFontSettings,
    appVersion,
    settingsAction,
    fatal,
    createNewEntry: modals.createNewEntry,
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
    vButterflyPerch,
  };
}
