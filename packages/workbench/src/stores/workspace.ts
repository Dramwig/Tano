import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import {
  FileRegistry,
  type DataTable,
  type FileEntry,
  type RecentWorkspace,
  type Workspace,
} from '@tano/protocol';
import { createWorkspaceAssistantBridge } from '../assistant/workspace-bridge';
import { createDataTableController } from '../data-tables/data-table-controller';
import { useDocumentIndex } from '../documents/document-index';
import { createDocumentSession, documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { optimisticFiles } from '../files/optimistic-files';
import { createHelpEditQueue } from '../help/help-edit-queue';
import type { InstalledObjectPlugin } from '../plugins/workspace-plugins';
import { useWorkbenchRuntime } from '../runtime';
import { layoutDirty } from '../workspace/workspace-document-layout';
import { WorkspaceLifecycle } from '../workspace/workspace-lifecycle';
import { createWorkspaceDocumentIO } from './workspace-document-io';
import { createWorkspaceFileOps } from './workspace-file-ops';
import { createWorkspaceKnowledge } from './workspace-knowledge';
import { createWorkspaceLifecycle } from './workspace-lifecycle';
import { createWorkspacePluginsState } from './workspace-plugins-state';
import { createWorkspacePolicy } from './workspace-policy';
import { createWorkspaceSession } from './workspace-session';
import { createWorkspaceTabsLayout } from './workspace-tabs-layout';
import type {
  Activity,
  DocumentTab,
  WorkspaceLifecycleHooks,
  WorkspaceLoadingState,
} from './workspace-types';

export type { Activity, DocumentTab, OpenDocument };

export const useWorkspaceStore = defineStore('workspace', () => {
  const helpEdits = createHelpEditQueue();
  onScopeDispose(helpEdits.dispose);
  const runtime = useWorkbenchRuntime();
  const { adapter, mobile } = runtime;
  const isDemo = adapter.mode === 'demo';
  const isWeb = adapter.mode === 'web';
  const remembersStartupWorkspace = !isDemo && !isWeb;

  // Core reactive workspace & session state
  const workspace = ref<Workspace | null>(null);
  const fileRegistry = computed(() => (workspace.value ? FileRegistry.from(workspace.value) : null));
  const documents = ref<OpenDocument[]>([]);
  const documentIndex = useDocumentIndex(documents);
  const tabIds = ref<string[]>([]);
  const tabAliases = ref(new Map<string, string>());
  const activeId = ref('');
  const installedPlugins = ref<InstalledObjectPlugin[]>([]);
  const activePluginSidebar = ref('');

  const busy = ref(false);
  const openingWorkspace = ref(false);
  const workspaceLoading = ref<WorkspaceLoadingState>({
    files: false,
    session: false,
    settings: false,
    tables: false,
    plugins: false,
    objects: false,
    relations: false,
    capabilities: false,
  });
  const restoringDocuments = ref<Record<string, string>>({});
  const openingDocuments = ref<Record<string, { request: number; tabId: string }>>({});
  const activities = ref<Activity[]>([]);
  const notice = ref('');
  const fatal = ref('');
  const recent = ref<RecentWorkspace[]>([]);
  const sessionError = ref('');

  let chain: Promise<unknown> = Promise.resolve();
  let disposed = false;
  const hooks: WorkspaceLifecycleHooks = {};

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const next = chain.then(task, task);
    chain = next.catch(() => {});
    return next;
  }

  function activity(
    label: string,
    detail: string,
    kind: Activity['kind'],
    change?: Activity['change'],
  ) {
    const preview =
      change && change.before.length + change.after.length <= 256 * 1024 ? change : undefined;
    activities.value.unshift({
      id: crypto.randomUUID(),
      label,
      detail,
      kind,
      time: Date.now(),
      change: preview,
    });
    activities.value = activities.value.slice(0, 60);
  }

  function report(error: unknown) {
    fatal.value = error instanceof Error ? error.message : String(error);
  }

  function writable() {
    if (workspace.value?.readOnly) throw new Error('你在此工作区只有阅读权限');
  }

  async function loadWorkspacePart(
    part: keyof WorkspaceLoadingState,
    load: () => Promise<unknown>,
  ) {
    try {
      await load();
    } catch (error) {
      report(error);
    } finally {
      workspaceLoading.value[part] = false;
    }
  }

  const fileMutations = optimisticFiles(() => workspace.value, report);
  const visibleWorkspace = computed({
    get: () => fileMutations.workspace.value,
    set: (value) => {
      workspace.value = value;
    },
  });
  function displayPath(file: Pick<FileEntry, 'id' | 'path'>) {
    return visibleWorkspace.value?.files.find((entry) => entry.id === file.id)?.path ?? file.path;
  }

  const dataTables = createDataTableController({
    adapter,
    workspace: () => workspace.value,
    serial,
    refresh: async () => {
      workspace.value = await adapter.refresh();
    },
  });

  const workspaceLifecycle = new WorkspaceLifecycle(
    {
      watch: (changed) => adapter.watch(changed),
      refresh: () => lifecycle.refresh(),
      report,
      available: () => !!workspace.value && !disposed,
    },
    !isDemo && !isWeb && !mobile,
  );
  onScopeDispose(() => workspaceLifecycle.stop());
  function scheduleRefresh() {
    workspaceLifecycle.schedule();
  }
  function enableWorkspacePolling() {
    workspaceLifecycle.enablePolling();
  }
  function stopWatching() {
    workspaceLifecycle.stop();
  }
  if (!isDemo && !isWeb && !mobile && typeof window !== 'undefined') {
    const refreshRecentOnFocus = () => {
      void lifecycle.refreshWorkspaces();
    };
    window.addEventListener('focus', refreshRecentOnFocus);
    onScopeDispose(() => window.removeEventListener('focus', refreshRecentOnFocus));
  }

  const layoutPending = (doc: OpenDocument) =>
    !!doc.tableLayout &&
    layoutDirty(doc.tableLayout) &&
    doc.tableLayout.conflict?.draft !== JSON.stringify(doc.tableLayout.file);

  // Domain modules composed in acyclic order:
  const policy = createWorkspacePolicy({
    adapter,
    workspace,
    recent,
    serial,
    writable,
    report,
  });

  const knowledge = createWorkspaceKnowledge({
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    capabilities: policy.capabilities,
    installedPlugins,
    serial,
    writable,
    activity,
    loadWorkspacePart,
    refreshPlugins: (current) => plugins.refreshPlugins(current),
    disposePluginExecutor: () => plugins.pluginExecutor.dispose(),
  });

  const plugins = createWorkspacePluginsState({
    adapter,
    runtime,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    capabilities: policy.capabilities,
    objects: knowledge.objects,
    relations: knowledge.relations,
    relationError: knowledge.relationError,
    getRelationBase: knowledge.getRelationBase,
    relationDefinitions: knowledge.relationDefinitions,
    referenceTargets: knowledge.referenceTargets,
    tabIds,
    activeId,
    installedPlugins,
    activePluginSidebar,
    serial,
    writable,
    scheduleRefresh,
    refreshObjects: knowledge.refreshObjects,
    openInternal: (file, replaceId, current) => docIO.openInternal(file, replaceId, current),
    saveInternal: (doc) => saveInternal(doc),
    ensureTabNavigation: (tabId, targetId) => tabsLayout.ensureTabNavigation(tabId, targetId),
    touchNavigation: () => tabsLayout.touchNavigation(),
  });

  const tabsLayout = createWorkspaceTabsLayout({
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    installedPlugins,
    pluginViews: plugins.pluginViews,
    activePluginSidebar,
    workspaceLoading,
    restoringDocuments,
    tabIds,
    tabAliases,
    activeId,
    busy,
    displayPath,
    layoutPending,
    flush: () => docIO.flush(),
    close: (id) => docIO.close(id),
    openAttachment: (file, options) => docIO.openAttachment(file, options),
    openPageTab: (id, options) => docIO.openPageTab(id, options),
    openFile: (file, options) => docIO.openFile(file, options),
  });

  const assistantBridge = createWorkspaceAssistantBridge({
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    capabilities: policy.capabilities,
    objects: knowledge.objects,
    objectErrors: knowledge.objectErrors,
    relations: knowledge.relations,
    relationError: knowledge.relationError,
    getRelationBase: knowledge.getRelationBase,
    relationDefinitions: knowledge.relationDefinitions,
    referenceTargets: knowledge.referenceTargets,
    tabIds,
    tabAliases,
    activeId,
    tabTarget: tabsLayout.tabTarget,
    removeTabAlias: tabsLayout.removeTabAlias,
    removeTabNavigation: tabsLayout.removeTabNavigation,
    layoutPending,
    serial,
    writable,
    refreshObjects: knowledge.refreshObjects,
    getReferenceContext: knowledge.getReferenceContext,
    activity,
  });

  const { reconcile, save: saveInternal } = createDocumentSession({
    adapter,
    confirmCreation: (doc) => fileOps.confirmCreation(doc),
    activity,
    report,
    invalidate: (id) => {
      knowledge.referenceDocumentCache.delete(id);
    },
    refreshed: (current) => {
      workspace.value = current;
    },
  });

  const fileOps = createWorkspaceFileOps({
    adapter,
    mobile,
    isDemo,
    isWeb,
    workspace,
    visibleWorkspace,
    fileRegistry,
    fileMutations,
    documents,
    documentIndex,
    dataTables,
    workspaceSettings: policy.workspaceSettings,
    tabIds,
    tabAliases,
    activeId,
    active: tabsLayout.active,
    busy,
    isDisposed: () => disposed,
    getActivationRevision: tabsLayout.getActivationRevision,
    tabTarget: tabsLayout.tabTarget,
    isUtilityTab: tabsLayout.isUtilityTab,
    removeTabAlias: tabsLayout.removeTabAlias,
    removeTabNavigation: tabsLayout.removeTabNavigation,
    ensureTabNavigation: tabsLayout.ensureTabNavigation,
    recordTabNavigation: tabsLayout.recordTabNavigation,
    displayPath,
    serial,
    writable,
    report,
    activity,
    flush: () => docIO.flush(),
    flushDocuments: () => docIO.flushDocuments(),
    openInternal: (file, replaceId, current) => docIO.openInternal(file, replaceId, current),
    reconcile,
    hydrateDocumentLayout: (doc) => docIO.hydrateDocumentLayout(doc),
  });

  const session = createWorkspaceSession({
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    tabsLayout,
    tabIds,
    tabAliases,
    activeId,
    workspaceLoading,
    restoringDocuments,
    sessionError,
    dataTableFileId: (id) => docIO.dataTableFileId(id),
    loadWorkspacePart,
    readOpenDocument: (file) => docIO.readOpenDocument(file),
    openInternal: (file, replaceId, current) => docIO.openInternal(file, replaceId, current),
    hydrateDocumentLayout: (doc) => docIO.hydrateDocumentLayout(doc),
    reconcile,
    saveInternal,
    activity,
    report,
  });

  const docIO = createWorkspaceDocumentIO({
    adapter,
    workspace,
    fileRegistry,
    fileMutations,
    documents,
    documentIndex,
    dataTables,
    workspaceSettings: policy.workspaceSettings,
    referenceTargets: knowledge.referenceTargets,
    tabIds,
    activeId,
    busy,
    openingDocuments,
    plugins,
    tabsLayout,
    assistantBridge,
    fileOps,
    helpEdits,
    journal: session.journal,
    hooks,
    isDisposed: () => disposed,
    layoutPending,
    serial,
    saveInternal,
    report,
  });

  const lifecycle = createWorkspaceLifecycle({
    adapter,
    isDemo,
    isWeb,
    remembersStartupWorkspace,
    workspace,
    fileRegistry,
    documents,
    tabIds,
    tabAliases,
    activeId,
    installedPlugins,
    busy,
    openingWorkspace,
    workspaceLoading,
    restoringDocuments,
    openingDocuments,
    activities,
    fatal,
    recent,
    sessionError,
    workspaceLifecycle,
    stopWatching,
    dataTables,
    policy,
    knowledge,
    plugins,
    tabsLayout,
    assistantBridge,
    session,
    hooks,
    serial,
    activity,
    report,
    loadWorkspacePart,
    flush: docIO.flush,
    reconcile,
    saveInternal,
    hydrateDocumentLayout: docIO.hydrateDocumentLayout,
    saveTableLayout: docIO.saveTableLayout,
  });

  const pending = computed(
    () =>
      fileMutations.pending.value ||
      dataTables.records.value.some(dataTables.dirty) ||
      !!assistantBridge.suggestionPersistence.value?.pending() ||
      documents.value.some((d) => (dirty(d) || layoutPending(d)) && !d.conflict),
  );

  function dispose() {
    disposed = true;
    helpEdits.dispose();
    plugins.disposePlugins();
    session.stopSessionWatch();
    stopWatching();
    docIO.clearSaveTimer();
  }

  return {
    dataTableRecords: dataTables.records,
    dataTableErrors: dataTables.errors,
    editDataTable: dataTables.edit,
    undoDataTable: dataTables.undo,
    retryDataTable: dataTables.retry,
    discardDataTable: dataTables.discard,
    copyDataTable: async (source: DataTable, parent = '') => {
      const id = await dataTables.create('blank', source, parent);
      await docIO.openDataTable(id);
    },
    createDataTable: docIO.createDataTable,
    renameDataTable: docIO.renameDataTable,
    openDataTable: docIO.openDataTable,
    layout: tabsLayout.layout,
    windowLayouts: tabsLayout.windowLayouts,
    moveTabToWindow: tabsLayout.moveTabToWindow,
    moveTabToAuxiliaryWindow: tabsLayout.moveTabToAuxiliaryWindow,
    closeAuxiliaryWindow: tabsLayout.closeAuxiliaryWindow,
    panes: tabsLayout.panes,
    activePaneId: tabsLayout.activePaneId,
    paneDrop: tabsLayout.paneDrop,
    detachingTabId: tabsLayout.detachingTabId,
    focusPane: tabsLayout.focusPane,
    dockTab: tabsLayout.dockTab,
    resizeSplit: tabsLayout.resizeSplit,
    installedPlugins,
    installedPluginWorkspace: plugins.installedPluginWorkspace,
    personalCodePluginPolicy: plugins.personalCodePluginPolicy,
    pluginRuntime: plugins.pluginRuntime,
    pluginHostEnvironment: plugins.pluginHostEnvironment,
    userPluginIntegrities: plugins.userPluginIntegrities,
    canManagePlugins: plugins.canManagePlugins,
    canManageSettings: policy.canManageSettings,
    authorizePlugin: plugins.pluginServices.authorizePlugin,
    restartPlugin: plugins.pluginServices.restartPlugin,
    rollbackPlugin: plugins.pluginServices.rollbackPlugin,
    pluginDevelopment: plugins.pluginDevelopment,
    startPluginDevelopment: (id: string, url: string) => plugins.pluginDeveloper.start(id, url),
    stopPluginDevelopment: () => plugins.pluginDeveloper.stop(),
    pluginStorageUsage: (id: string) =>
      plugins.pluginExecutor.storageUsage(workspace.value?.id ?? '', id),
    pluginRepositoryAvailable: !!runtime.plugins?.repository?.usage,
    pluginCatalogSource: runtime.plugins?.catalog?.source ?? '',
    pluginConnectionStorageLabel: runtime.plugins?.connections?.storageLabel ?? '',
    startPluginOAuth: plugins.startPluginOAuth,
    loadPluginConnections: plugins.loadPluginConnections,
    savePluginConnection: plugins.savePluginConnection,
    removePluginConnection: plugins.removePluginConnection,
    loadPluginCatalog: plugins.pluginServices.loadPluginCatalog,
    installCatalogRelease: plugins.pluginServices.installCatalogRelease,
    canRemovePluginPackage: !!runtime.plugins?.repository?.remove,
    removePluginPackage: plugins.removePluginPackage,
    loadPluginPackageUsage: plugins.loadPluginPackageUsage,
    clearPluginLogs: plugins.clearPluginLogs,
    cachePluginPackage: plugins.pluginServices.cachePluginPackage,
    setPluginEditor: plugins.setPluginEditor,
    pluginError: plugins.pluginError,
    changePlugin: plugins.pluginServices.changePlugin,
    relations: knowledge.relations,
    relationError: knowledge.relationError,
    relationDefinitions: knowledge.relationDefinitions,
    createRelation: knowledge.createRelation,
    removeRelation: knowledge.removeRelation,
    setRelationSource: knowledge.setRelationSource,
    objects: knowledge.objects,
    objectErrors: knowledge.objectErrors,
    objectDefinitions: knowledge.objectDefinitions,
    referenceTargets: knowledge.referenceTargets,
    referenceRevision: knowledge.referenceRevision,
    getReferenceContext: knowledge.getReferenceContext,
    assistantReferenceContext: assistantBridge.assistantReferenceContext,
    createObject: knowledge.createObject,
    updateObject: knowledge.updateObject,
    templates: knowledge.templates,
    writeTemplate: knowledge.writeTemplate,
    repeatPreview: knowledge.repeatPreview,
    createRepeat: knowledge.createRepeat,
    capabilities: policy.capabilities,
    capabilityError: policy.capabilityError,
    capabilitySaving: policy.capabilitySaving,
    updateCapabilities: policy.updateCapabilities,
    workspaceSettings: policy.visibleWorkspaceSettings,
    workspaceSettingsError: policy.workspaceSettingsError,
    workspaceSettingsSaving: policy.workspaceSettingsSaving,
    updateWorkspaceSettings: policy.updateWorkspaceSettings,
    reloadWorkspaceSettings: policy.reloadWorkspaceSettings,
    workspace: visibleWorkspace,
    fileRegistry,
    readFileMetadata: knowledge.readFileMetadata,
    updateFileMetadata: knowledge.updateFileMetadata,
    deleteObject: knowledge.deleteObject,
    displayPath,
    fileMutationPending: fileMutations.pending,
    documents,
    documentForTab: (id: string) => documentIndex.byId.value.get(tabsLayout.tabTarget(id)),
    tabs: tabsLayout.tabs,
    activeId,
    active: tabsLayout.active,
    canGoBack: tabsLayout.canGoBack,
    canNavigateHistory: tabsLayout.canNavigateHistory,
    canGoForward: tabsLayout.canGoForward,
    navigateHistory: tabsLayout.navigateHistory,
    activities,
    notice,
    fatal,
    busy,
    openingWorkspace,
    workspaceLoading,
    restoringDocuments,
    openingDocuments,
    recent,
    sessionError,
    isDemo,
    isWeb,
    pending,
    dirty,
    initialize: lifecycle.initialize,
    refreshWorkspaces: lifecycle.refreshWorkspaces,
    openWorkspace: lifecycle.openWorkspace,
    leaveWorkspace: lifecycle.leaveWorkspace,
    deleteWorkspace: lifecycle.deleteWorkspace,
    createWorkspace: lifecycle.createWorkspace,
    openFile: docIO.openFile,
    prefetchFile: docIO.prefetchFile,
    openFileInNewTab: docIO.openFileInNewTab,
    openAttachment: docIO.openAttachment,
    openAttachmentInNewTab: docIO.openAttachmentInNewTab,
    openDirectory: docIO.openDirectory,
    openFilesInNewTabsAt: docIO.openFilesInNewTabsAt,
    createBlankTab: tabsLayout.createBlankTab,
    openGraphTab: docIO.openGraphTab,
    openPluginsTab: docIO.openPluginsTab,
    openPluginDetail: docIO.openPluginDetail,
    openCalendarTab: tabsLayout.openCalendarTab,
    registerViews: tabsLayout.registerViews,
    pluginViews: plugins.pluginViews,
    pluginCommands: plugins.pluginCommands,
    pluginFileHandlers: plugins.pluginFileHandlers,
    pluginSlashCommands: plugins.pluginSlashCommands,
    pluginCodeBlockRenderers: plugins.pluginCodeBlockRenderers,
    pluginDecorationsFor: plugins.pluginDecorationsFor,
    pluginStatusBarItems: plugins.pluginStatusBarItems,
    hasMarkdownFileHandler: docIO.hasMarkdownFileHandler,
    activePluginSidebar,
    activeDocumentPluginSidebar: plugins.activeDocumentPluginSidebar,
    activePluginDialog: plugins.activePluginDialog,
    resolvePluginDialog: plugins.resolvePluginDialog,
    pluginToasts: plugins.pluginToasts,
    dismissPluginToast: plugins.dismissPluginToast,
    pluginSettingsRequest: plugins.pluginSettingsRequest,
    pluginSettingsPages: plugins.pluginSettingsPages,
    openPluginView: plugins.openPluginView,
    interactWithPlugin: plugins.interactWithPlugin,
    pluginContextProviders: plugins.pluginContextProviders,
    invokePluginAssistantTool: plugins.invokePluginAssistantTool,
    queryPluginAssistantContext: plugins.queryPluginAssistantContext,
    setPluginAiRunner: plugins.setPluginAiRunner,
    overlaySnapshot: plugins.overlaySnapshot,
    setSafeMode: plugins.setSafeMode,
    pluginHomeTabView: plugins.pluginHomeTabView,
    pluginNewTabView: plugins.pluginNewTabView,
    openViewTab: tabsLayout.openViewTab,
    readGraphDocument: docIO.readGraphDocument,
    assistantSnapshot: assistantBridge.assistantSnapshot,
    assistantSearch: assistantBridge.assistantSearch,
    assistantRules: assistantBridge.assistantRules,
    assistantStructures: assistantBridge.assistantStructures,
    proposeAssistantStructure: assistantBridge.proposeAssistantStructure,
    assistantTaskQuery: assistantBridge.assistantTaskQuery,
    assistantEpoch: assistantBridge.assistantEpoch,
    reviewAssistantProposal: assistantBridge.reviewAssistantProposal,
    readDocumentSuggestions: assistantBridge.readDocumentSuggestions,
    writeDocumentSuggestions: assistantBridge.writeDocumentSuggestions,
    acceptDocumentSuggestion: assistantBridge.acceptDocumentSuggestion,
    setSuggestionPersistence: assistantBridge.setSuggestionPersistence,
    edit: docIO.edit,
    editDocument: docIO.editDocument,
    editTableLayout: docIO.editTableLayout,
    preserveDraft: fileOps.preserveDraft,
    receiveDocument: docIO.receiveDocument,
    setBeforeWorkspaceChange: (hook?: () => Promise<void>) => {
      hooks.beforeWorkspaceChange = hook;
    },
    setDocumentLifecycle: (nextHooks: {
      beforeSwitch: () => Promise<void>;
      afterSwitch?: () => Promise<void>;
      beforeCloseDocument: (id: string) => Promise<void>;
    }) => {
      hooks.beforeSwitch = nextHooks.beforeSwitch;
      hooks.afterSwitch = nextHooks.afterSwitch;
      hooks.beforeCloseDocument = nextHooks.beforeCloseDocument;
    },
    flush: docIO.flush,
    refresh: lifecycle.refresh,
    enableWorkspacePolling,
    search: async (query: string, signal?: AbortSignal) => {
      const scope = workspace.value?.id;
      if (!scope || !adapter.search || signal?.aborted) return [];
      const results = await adapter.search(scope, query, signal);
      return workspace.value?.id === scope && !signal?.aborted ? results : [];
    },
    create: fileOps.create,
    importDocuments: fileOps.importDocuments,
    createUntitledDocument: fileOps.createUntitledDocument,
    createUntitledFolder: fileOps.createUntitledFolder,
    saveCopy: fileOps.saveCopy,
    rename: fileOps.rename,
    renameEntry: fileOps.renameEntry,
    canConvertFolderDocuments: fileOps.canConvertFolderDocuments,
    folderConversionBusy: fileOps.folderConversionBusy,
    convertDocumentStructure: fileOps.convertDocumentStructure,
    moveEntry: fileOps.moveEntry,
    duplicateEntry: fileOps.duplicateEntry,
    remove: fileOps.remove,
    removeEntry: fileOps.removeEntry,
    removeEntries: fileOps.removeEntries,
    moveDocument: tabsLayout.moveDocument,
    placeTab: tabsLayout.placeTab,
    close: docIO.close,
    resolveConflict: docIO.resolveConflict,
    reveal: lifecycle.reveal,
    dispose,
    report,
  };
});
