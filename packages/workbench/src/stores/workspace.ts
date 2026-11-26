import { computed, onScopeDispose, ref, watch, type ComputedRef } from 'vue';
import { defineStore } from 'pinia';
import {
  basename,
  documentLayoutPath,
  FileRegistry,
  isDataTableFilePath,
  isMarkdown,
  isWorkspaceInternalPath,
  parentPath,
  parseDocumentLayout,
  validatePath,
  type DataTable,
  type FileEntry,
  type PluginManifest,
  type RecentWorkspace,
  type TableLayout,
  type Workspace,
  type WorkspaceLayout,
  type WorkspaceSession,
} from '@tano/protocol';
import { createWorkspaceAssistantBridge } from '../assistant/workspace-bridge';
import { createDataTableController } from '../data-tables/data-table-controller';
import { isTableTab, tableFileId, tableTabId } from '../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import { useDocumentIndex } from '../documents/document-index';
import { createDocumentSession, documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { indexFolderHomes } from '../files/folder-home';
import { recordHelpCompleted } from '../help/help-checklist';
import { createHelpEditQueue } from '../help/help-edit-queue';
import { optimisticFiles } from '../files/optimistic-files';
import { layoutPanes, restoreLayout } from '../shell/pane-layout';
import {
  resolvePluginFileHandler,
  type PluginWorkbenchFileHandler,
  type PluginWorkbenchView,
} from '../plugins/workbench';
import { useWorkbenchRuntime, type WorkbenchViewTab } from '../runtime';
import { SessionJournal } from '../shell/session-journal';
import {
  DocumentLayoutConflict,
  layoutDirty,
  loadDocumentLayout,
  saveDocumentLayout,
} from '../workspace/workspace-document-layout';
import { WorkspaceLifecycle } from '../workspace/workspace-lifecycle';
import { PLUGINS_TAB_ID, type InstalledObjectPlugin } from '../plugins/workspace-plugins';
import { readStartupWorkspace, rememberStartupWorkspace } from '../workspace/workspace-startup';
import { addWorkspaceWelcome, workspaceWelcomePath } from '../workspace/workspace-welcome';
import { createWorkspaceFileOps } from './workspace-file-ops';
import { createWorkspaceKnowledge } from './workspace-knowledge';
import { createWorkspacePluginsState } from './workspace-plugins-state';
import { createWorkspacePolicy } from './workspace-policy';
import { createWorkspaceTabsLayout } from './workspace-tabs-layout';

export type { OpenDocument } from '../documents/document-session';

export interface DocumentTab {
  id: string;
  path: string;
  blank: boolean;
  graph: boolean;
  plugins: boolean;
  calendar: boolean;
  view?: WorkbenchViewTab;
  directory?: { path: string; name: string; missing: boolean };
  pluginView?: PluginWorkbenchView;
  pluginDetail?: PluginManifest;
  document?: OpenDocument;
  attachmentPreview: boolean;
  attachment?: FileEntry;
  dataTable?: { name: string; dirty: boolean; icon?: string };
}

export interface Activity {
  id: string;
  label: string;
  detail: string;
  time: number;
  kind: 'external' | 'save' | 'conflict' | 'file';
  change?: { before: string; after: string };
}

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
  // Most tabs use the file/page id directly. A context-menu "open in new tab"
  // request can target an already open file, though, so those additional tab
  // instances need an id of their own while continuing to share the open
  // document and its draft.
  const tabAliases = ref(new Map<string, string>());
  const activeId = ref('');
  const installedPlugins = ref<InstalledObjectPlugin[]>([]);
  const activePluginSidebar = ref('');

  const busy = ref(false);
  // Folder selection keeps the current page visible. Presentation switches only
  // once a target is confirmed, retaining the old session for flush/recovery.
  const openingWorkspace = ref(false);
  const workspaceLoading = ref({
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

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let chain: Promise<unknown> = Promise.resolve();
  let disposed = false;
  let sessionReady = false;
  let sessionBlocked = false;
  let beforeSwitch: (() => Promise<void>) | undefined;
  let beforeWorkspaceChange: (() => Promise<void>) | undefined;
  let afterSwitch: (() => Promise<void>) | undefined;
  let beforeCloseDocument: ((id: string) => Promise<void>) | undefined;
  let fileOpenRevision = 0;

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
    // Session history is bounded; larger versions remain in files/server history.
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
    part: keyof typeof workspaceLoading.value,
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
      refresh,
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
      void refreshWorkspaces();
    };
    window.addEventListener('focus', refreshRecentOnFocus);
    onScopeDispose(() => window.removeEventListener('focus', refreshRecentOnFocus));
  }

  const layoutPending = (doc: OpenDocument) =>
    !!doc.tableLayout &&
    layoutDirty(doc.tableLayout) &&
    doc.tableLayout.conflict?.draft !== JSON.stringify(doc.tableLayout.file);

  // Domain modules composed cleanly in acyclic setup order:
  // 1. Policy (workspace settings & capability rules)
  const policy = createWorkspacePolicy({
    adapter,
    workspace,
    recent,
    serial,
    writable,
    report,
  });

  // 2. Knowledge (objects, relations, metadata, templates, repeats, references)
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

  // 3. Plugins state (plugin runtime, host/executor/developer, pluginCall, OAuth/connections/packages)
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
    openInternal: (file, replaceId, current) => openInternal(file, replaceId, current),
    saveInternal: (doc) => saveInternal(doc),
    ensureTabNavigation: (tabId, targetId) => tabsLayout.ensureTabNavigation(tabId, targetId),
    touchNavigation: () => tabsLayout.touchNavigation(),
  });

  // 4. Tabs, split/multi-window layouts & tab navigation history
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
    flush,
    close,
    openAttachment,
    openPageTab,
    openFile,
  });

  // 5. Assistant bridge & document suggestions
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

  // 6. Document session reconciliation/save
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

  // 7. File & folder mutation operations
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
    flush,
    flushDocuments,
    openInternal,
    reconcile,
    hydrateDocumentLayout,
  });

  // Data table tab helpers
  function dataTableFileId(id: string) {
    if (workspace.value?.files.some((file) => file.id === id && isDataTableFilePath(file.path)))
      return id;
    // Resolve previously shared links, whose suffix was the table's embedded identity.
    return dataTables.records.value.find((record) => record.table.id === id)?.fileId ?? id;
  }
  async function openDataTable(
    id?: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (!id) {
      tabsLayout.createBlankTab();
      return;
    }
    await openPageTab(tableTabId(dataTableFileId(id)), options);
  }
  async function createDataTable(template: 'blank' | 'parts' = 'blank', parent = '') {
    const id = await dataTables.create(template, undefined, parent);
    recordHelpCompleted('data-table');
    await openDataTable(id);
    return id;
  }
  async function renameDataTable(id: string, name: string) {
    const file = workspace.value?.files.find(
      (file) => file.id === id && isDataTableFilePath(file.path),
    );
    if (!file) throw new Error('数据表文件已不存在');
    const path = `${parentPath(file.path) ? `${parentPath(file.path)}/` : ''}${name.trim().normalize('NFC')}.table.json`;
    if (!name.trim() || /[\\/]/.test(name)) throw new Error('请输入有效的文件名称');
    const error = validatePath(path);
    if (error) throw new Error(error);
    if (path !== file.path) await fileOps.renameEntry(file, path);
  }

  // Session journal & pending state
  const pending = computed(
    () =>
      fileMutations.pending.value ||
      dataTables.records.value.some(dataTables.dirty) ||
      !!assistantBridge.suggestionPersistence.value?.pending() ||
      documents.value.some((d) => (dirty(d) || layoutPending(d)) && !d.conflict),
  );
  const journal = new SessionJournal(
    (id, session) => adapter.saveSession!(id, session),
    (error) => {
      sessionError.value =
        error === undefined
          ? ''
          : `恢复草稿未写入：${String(error)}。文档仍会尝试正常保存。`;
    },
  );
  // Track only recoverable fields. Saving/error flags, undo stacks and plugin
  // state must not traverse/rewrite every open document on the input path.
  const recoveryDocuments = new WeakMap<
    OpenDocument,
    ComputedRef<WorkspaceSession['documents'][number]>
  >();
  const mainTabIds = computed(() => layoutPanes(tabsLayout.layout.value).flatMap((pane) => pane.tabs));
  const sessionDocuments = computed(() =>
    documents.value
      .filter((doc) => mainTabIds.value.some((id) => tabsLayout.tabTarget(id) === doc.id))
      .map((doc) => {
        let snapshot = recoveryDocuments.get(doc);
        if (!snapshot) {
          snapshot = computed(() => ({
            id: doc.id,
            path: doc.path,
            ...(dirty(doc) ? { draft: { content: doc.content, base: { ...doc.base } } } : {}),
          }));
          recoveryDocuments.set(doc, snapshot);
        }
        return snapshot.value;
      }),
  );
  const sessionTables = computed(() =>
    dataTables
      .drafts()
      .filter((draft) =>
        mainTabIds.value.some(
          (id) => tableFileId(tabsLayout.tabTarget(id)) === (draft.fileId ?? draft.id),
        ),
      ),
  );
  const sessionLayout = computed(
    () => JSON.parse(JSON.stringify(tabsLayout.layout.value)) as WorkspaceLayout,
  );
  const sessionPayload = computed<WorkspaceSession>(() => ({
    version: 1,
    activeId:
      layoutPanes(tabsLayout.layout.value).find(
        (pane) => pane.id === tabsLayout.windowLayouts.value.main.activePaneId,
      )?.activeId ?? '',
    tabs: [...new Set(mainTabIds.value.map(tabsLayout.tabTarget))],
    layout: sessionLayout.value,
    dataTables: sessionTables.value,
    documents: sessionDocuments.value,
  }));
  function queueSession() {
    if (!sessionReady || sessionBlocked || !workspace.value || !adapter.saveSession) return;
    journal.enqueue(workspace.value.id, sessionPayload.value);
  }
  const stopSessionWatch = watch(sessionPayload, queueSession, {
    flush: 'sync',
  });

  // Workspace initialization, open, exit & session restoration
  async function initialize(requestedWorkspace?: string) {
    if (isDemo || isWeb) {
      await openWorkspace(requestedWorkspace);
      if (!workspace.value && requestedWorkspace) await openWorkspace();
      if (isWeb) await refreshWorkspaces();
    } else if (requestedWorkspace) {
      await openWorkspace(requestedWorkspace);
    } else if (adapter.recent && (await refreshWorkspaces())) {
      const savedId = readStartupWorkspace();
      const previous =
        savedId === undefined
          ? recent.value.reduce<RecentWorkspace | undefined>(
              (latest, item) => (!latest || item.openedAt > latest.openedAt ? item : latest),
              undefined,
            )
          : recent.value.find((item) => item.id === savedId);
      if (previous) await openWorkspace(previous.path);
      else if (savedId) rememberStartupWorkspace(null);
    }
  }

  async function refreshWorkspaces() {
    if (!adapter.recent) return false;
    try {
      recent.value = policy.decorateRecent(await adapter.recent());
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }

  async function openWorkspace(path?: string, newName?: string) {
    if (busy.value) return;
    busy.value = true;
    let switching = false;
    let pendingWorkspaceLoads: Promise<unknown>[] = [];
    try {
      if (path === undefined && newName === undefined && adapter.selectWorkspacePath) {
        const selected = await adapter.selectWorkspacePath();
        if (selected === null) return;
        path = selected;
      }
      openingWorkspace.value = true;
      for (const part of Object.keys(
        workspaceLoading.value,
      ) as (keyof typeof workspaceLoading.value)[])
        workspaceLoading.value[part] = true;
      switching = true;
      // Cancel queued old-workspace refreshes before flushing. Keep the watcher
      // so failure can replay changes without losing external edits.
      workspaceLifecycle.pause();
      if (!(await flush())) {
        report('还有未保存的修改。请先处理保存错误，再切换工作空间。');
        return;
      }
      await beforeSwitch?.();
      await beforeWorkspaceChange?.();
      await serial(async () => {
        const previousReady = sessionReady;
        sessionReady = false;
        let next: Workspace | null;
        try {
          if (newName !== undefined && !adapter.createWorkspace)
            throw new Error('此平台不能直接创建工作空间');
          next =
            newName === undefined
              ? await adapter.open(path)
              : await adapter.createWorkspace!(newName);
        } catch (error) {
          sessionReady = previousReady;
          throw error;
        }
        if (!next) {
          sessionReady = previousReady;
          return;
        }
        const accountTabs = tabIds.value.filter(
          (id) => tabsLayout.views.value.get(id)?.scope === 'account',
        );
        const accountActive = accountTabs.includes(activeId.value) ? activeId.value : undefined;
        stopWatching();
        plugins.pluginExecutor.dispose();
        fatal.value = '';
        if (next.reinitialized) {
          report('.tano 已删除，工作区已重新初始化。旧对象已丢失，文档和附件保留。');
        }
        if (newName !== undefined || next.newlyCreated) {
          try {
            next = await addWorkspaceWelcome(adapter, next);
          } catch (error) {
            report(`工作区已创建，但入门文档未能添加：${String(error)}。可以继续新建文档。`);
          }
        }
        policy.resetPolicy(false);
        workspace.value = next;
        // The new file tree can render immediately; old documents must not
        // appear under it while this workspace's metadata/session is loading.
        documents.value = [];
        tabIds.value = [];
        activeId.value = '';
        openingDocuments.value = {};
        restoringDocuments.value = {};
        tabsLayout.resetTabNavigation();
        if (remembersStartupWorkspace) rememberStartupWorkspace(next.id);
        knowledge.resetKnowledge(false);
        dataTables.reset();
        installedPlugins.value = [];
        workspaceLoading.value.files = false;
        // Publish the tree now. Session and document reads do not depend on
        // plugin installation, object indexes, rules, or unrelated tables.
        const settingsReady = loadWorkspacePart('settings', policy.refreshWorkspaceSettings);
        const tablesReady = loadWorkspacePart('tables', () => dataTables.reload());
        const objectsReady = knowledge.refreshObjects().catch(report);
        const capabilitiesReady = loadWorkspacePart('capabilities', policy.refreshCapabilities);
        pendingWorkspaceLoads = [settingsReady, tablesReady, objectsReady, capabilitiesReady];
        assistantBridge.resetForWorkspaceChange();
        activities.value = [];
        sessionError.value = '';
        sessionBlocked = false;
        const watcherReady = workspaceLifecycle.start().catch(report);
        pendingWorkspaceLoads.push(watcherReady);
        let saved: WorkspaceSession | null = null;
        if (adapter.loadSession) {
          try {
            saved = await adapter.loadSession(next.id);
          } catch (error) {
            sessionBlocked = true;
            sessionError.value = `${String(error)}。本次不覆盖恢复记录。`;
          }
        }
        if (saved) await restoreSession(saved, tablesReady, objectsReady);
        else await settingsReady; // Only the default page depends on settings.
        const first =
          next.files.find(
            (f) =>
              f.id === policy.workspaceSettings.value.homePageId &&
              f.kind === 'file' &&
              isMarkdown(f.path),
          ) ??
          next.files.find((f) => f.path === workspaceWelcomePath) ??
          next.files.find((f) => /^readme\.md$/i.test(f.path)) ??
          next.files.find(
            (f) => f.kind === 'file' && isMarkdown(f.path) && !isWorkspaceInternalPath(f.path),
          );
        if (!saved && first) {
          try {
            await openInitialDocument(first);
            tabsLayout.ensureTabNavigation(activeId.value, activeId.value);
            tabsLayout.touchNavigation();
          } catch (error) {
            report(error);
          }
        }
        workspaceLoading.value.session = false;
        {
          for (const id of accountTabs) {
            if (!tabIds.value.includes(id)) tabIds.value.push(id);
            tabsLayout.ensureTabNavigation(id);
          }
          if (accountActive) activeId.value = accountActive;
          tabsLayout.touchNavigation();
        }
        // These completions protect persistence and adapter ownership, but each
        // component has already revealed its own ready data independently.
        await Promise.all([
          settingsReady,
          tablesReady,
          objectsReady,
          capabilitiesReady,
          watcherReady,
        ]);
        sessionReady = true;
        queueSession();
        if (adapter.recent) recent.value = policy.decorateRecentNames(await adapter.recent());
        activity(isDemo ? '演示工作空间已就绪' : '工作空间已打开', next.name, 'file');
      });
    } catch (error) {
      if (path && recent.value.some((item) => item.path === path)) {
        await refreshWorkspaces();
        if (!recent.value.some((item) => item.path === path)) {
          fatal.value = '';
          return;
        }
      }
      report(error);
    } finally {
      await Promise.allSettled(pendingWorkspaceLoads);
      openingWorkspace.value = false;
      for (const part of Object.keys(
        workspaceLoading.value,
      ) as (keyof typeof workspaceLoading.value)[])
        workspaceLoading.value[part] = false;
      busy.value = false;
      if (switching) {
        workspaceLifecycle.resume();
        try {
          await afterSwitch?.();
        } catch (error) {
          report(error);
        }
      }
    }
  }

  function createWorkspace(name?: string) {
    if (name === undefined) {
      const spaces = [...recent.value, ...(workspace.value ? [workspace.value] : [])];
      // Local display names can change independently of their backing folder names.
      const occupied = new Set(
        spaces.flatMap((space) => [space.name, basename(space.path.replace(/\\/g, '/'))]),
      );
      name = '新工作区';
      for (let suffix = 2; occupied.has(name); suffix++) name = `新工作区 ${suffix}`;
    }
    return openWorkspace(undefined, name);
  }

  function leaveWorkspace(): Promise<boolean> {
    return exitWorkspace();
  }

  function deleteWorkspace(workspaceId: string): Promise<boolean> {
    return exitWorkspace(workspaceId);
  }

  async function exitWorkspace(deleteId?: string): Promise<boolean> {
    if (busy.value || !workspace.value) return false;
    busy.value = true;
    try {
      const assertDeletion = () => {
        if (deleteId === undefined) return;
        if (workspace.value?.id !== deleteId) throw new Error('工作区已切换，请重新确认删除');
        if (!adapter.deleteWorkspace || !workspace.value.canDelete)
          throw new Error(
            isWeb ? '仅工作区所有者可以删除工作区' : '此平台暂不支持删除本地工作区注册',
          );
      };
      assertDeletion();
      if (!(await flush())) {
        report(
          `还有未保存的修改。请先处理保存错误，再${deleteId === undefined ? '退出' : '删除'}工作区。`,
        );
        return false;
      }
      await beforeSwitch?.();
      await beforeWorkspaceChange?.();
      await serial(async () => {
        assertDeletion();
        const current = workspace.value;
        if (!current) return;
        queueSession();
        await journal.flush();
        if (deleteId !== undefined) await adapter.deleteWorkspace!(deleteId);
        else await adapter.close?.(current.id);
        if (remembersStartupWorkspace) rememberStartupWorkspace(null);
        sessionReady = false;
        stopWatching();
        plugins.pluginHost.dispose();
        plugins.pluginExecutor.dispose();
        workspace.value = null;
        dataTables.reset();
        policy.resetPolicy(true);
        assistantBridge.resetForWorkspaceChange();
        documents.value = [];
        tabIds.value = [];
        tabAliases.value = new Map();
        activeId.value = '';
        tabsLayout.resetTabNavigation();
        knowledge.resetKnowledge(true);
        installedPlugins.value = [];
        plugins.pluginError.value = '';
        activities.value = [];
        sessionError.value = '';
        sessionBlocked = false;
        fatal.value = '';
        if (deleteId !== undefined) {
          policy.forgetWorkspaceName(deleteId);
          recent.value = recent.value.filter((item) => item.id !== deleteId);
          knowledge.referenceDocumentCache.clear();
        }
      });
      await refreshWorkspaces();
      return true;
    } catch (error) {
      report(error);
      return false;
    } finally {
      busy.value = false;
      try {
        await afterSwitch?.();
      } catch (error) {
        report(error);
      }
    }
  }

  async function openInitialDocument(file: FileEntry) {
    restoringDocuments.value = { ...restoringDocuments.value, [file.id]: file.path };
    tabIds.value = [file.id];
    activeId.value = file.id;
    workspaceLoading.value.session = false;
    try {
      await openInternal(file);
    } finally {
      delete restoringDocuments.value[file.id];
    }
  }

  async function restoreSession(
    saved: WorkspaceSession,
    tablesReady: Promise<void>,
    objectsReady: Promise<void>,
  ) {
    tabAliases.value = new Map();
    const remapped = new Map<string, string>();
    const pendingDocs = saved.documents.flatMap((tab) => {
      const file = fileRegistry.value?.get(tab.id) ?? fileRegistry.value?.at(tab.path);
      if (!file && !tab.draft) return [];
      const id = file?.id ?? tab.id;
      remapped.set(tab.id, id);
      return [{ tab, file, id }];
    });
    restoringDocuments.value = Object.fromEntries(
      pendingDocs.map(({ tab, file, id }) => [id, file?.path ?? tab.path]),
    );
    const planned = new Set(pendingDocs.map(({ id }) => id));
    const requested = (saved.tabs ?? []).map((id) => remapped.get(id) ?? id);
    tabIds.value = [
      ...new Set([
        ...requested.filter(
          (id) =>
            planned.has(id) ||
            tabsLayout.isUtilityTab(id) ||
            id.startsWith('plugin:'),
        ),
        ...planned,
      ]),
    ];
    const restoredActive = remapped.get(saved.activeId) ?? saved.activeId;
    tabsLayout.layout.value = restoreLayout(saved.layout, tabIds.value, remapped);
    tabsLayout.activePaneId.value =
      tabsLayout.panes.value.find((pane) => pane.tabs.includes(restoredActive))?.id ??
      tabsLayout.panes.value[0].id;
    activeId.value = tabIds.value.includes(restoredActive)
      ? restoredActive
      : (tabIds.value[0] ?? '');
    workspaceLoading.value.session = false;
    // Visible documents get the first read slots. Background tabs cannot hold
    // up either their labels or another pane whose document has already arrived.
    const visible = new Set(tabsLayout.panes.value.map((pane) => pane.activeId));
    const tableRecovery = (async () => {
      await tablesReady;
      if (saved.dataTables?.length) {
        workspaceLoading.value.tables = true;
        await loadWorkspacePart('tables', () => dataTables.restore(saved.dataTables!));
      }
    })();
    const restoreDocument = async ({ tab, file, id }: (typeof pendingDocs)[number]) => {
      try {
        if (!tab.draft) {
          if (file) {
            const doc = await readOpenDocument(file);
            if (!documentIndex.byId.value.has(id)) documents.value.push(doc);
          }
          return;
        }
        const doc: OpenDocument = {
          id: file?.id ?? tab.id,
          path: file?.path ?? tab.path,
          content: tab.draft.content,
          base: tab.draft.base,
          saving: false,
          creating: file?.pendingCreation,
          missing: !file,
        };
        if (!doc.creating) await hydrateDocumentLayout(doc);
        documents.value.push(doc);
        activity('已恢复未保存草稿', doc.path, 'file');
        if (file) {
          try {
            if (!doc.creating) await reconcile(doc, await adapter.read(file.path));
            await saveInternal(documentIndex.byId.value.get(doc.id)!);
          } catch (error) {
            doc.error = String(error);
            report(error);
          }
        } else doc.error = '原文件已不存在，恢复草稿已保留，请另存副本';
      } catch (error) {
        report(error);
      } finally {
        delete restoringDocuments.value[id];
      }
    };
    const priority = (id: string) => (id === restoredActive ? 2 : Number(visible.has(id)));
    const queue = [...pendingDocs].sort((a, b) => priority(b.id) - priority(a.id));
    const worker = async () => {
      for (let next = queue.shift(); next; next = queue.shift()) await restoreDocument(next);
    };
    await Promise.all([
      tableRecovery,
      objectsReady,
      ...Array.from({ length: Math.min(4, queue.length) }, worker),
    ]);
    // Resolve legacy table identities only after table records are available.
    for (const id of saved.tabs ?? [])
      if (isTableTab(id))
        remapped.set(id, tableTabId(dataTableFileId(tableFileId(id))));
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    documents.value = pendingDocs
      .map(({ id }) => byId.get(id))
      .filter((doc): doc is OpenDocument => !!doc);
    const restored = saved.tabs
      ?.map((id) => remapped.get(id) ?? id)
      .filter(
        (id) =>
          tabsLayout.isUtilityTab(id) || documents.value.some((doc) => doc.id === id),
      );
    tabIds.value = [...new Set([...(restored ?? []), ...documents.value.map((doc) => doc.id)])];
    const currentActive = remapped.get(activeId.value) ?? activeId.value;
    tabsLayout.layout.value = restoreLayout(tabsLayout.layout.value, tabIds.value, remapped);
    tabsLayout.activePaneId.value =
      tabsLayout.panes.value.find((pane) => pane.tabs.includes(currentActive))?.id ??
      tabsLayout.panes.value[0].id;
    activeId.value = tabIds.value.includes(currentActive)
      ? currentActive
      : (tabIds.value[0] ?? '');
    for (const tabId of tabIds.value) tabsLayout.ensureTabNavigation(tabId, tabId);
    tabsLayout.touchNavigation();
  }

  // Document opening, editing, saving, closing & conflict resolution
  async function readOpenDocument(file: FileEntry): Promise<OpenDocument> {
    const snapshot = await adapter.read(file.path);
    const doc: OpenDocument = {
      id: file.id,
      path: file.path,
      content: snapshot.content,
      base: snapshot,
      saving: false,
      creating: file.pendingCreation,
      missing: false,
    };
    if (!doc.creating) await hydrateDocumentLayout(doc);
    return doc;
  }

  async function openInternal(file: FileEntry, replaceId?: string, current = () => true) {
    // The tree may already show a pending rename; storage still uses its
    // confirmed path until the background mutation completes.
    file = workspace.value?.files.find((entry) => entry.id === file.id) ?? file;
    if (file.kind === 'file' && isDataTableFilePath(file.path)) {
      tabsLayout.activateTab(tableTabId(file.id), replaceId);
      return;
    }
    if (!isMarkdown(file.path) || file.kind !== 'file') return;
    let doc = documentIndex.byId.value.get(file.id);
    if (!doc) doc = await readOpenDocument(file);
    if (!current()) return;
    if (tabIds.value.includes(doc.id) && !documentIndex.byId.value.has(doc.id))
      documents.value.push(doc);
    tabsLayout.activateTab(doc.id, replaceId, doc);
    const opened = documentIndex.byId.value.get(doc!.id)!;
    if (opened.creating)
      void fileOps.confirmCreation(opened).then((confirmed) => {
        if (confirmed && !disposed && dirty(opened)) void flush();
      });
  }

  async function prepareTabReplacement(id?: string) {
    if (id && isTableTab(id) && !(await flush())) {
      report('此数据表尚未保存，请先处理保存错误。');
      return false;
    }
    if (assistantBridge.suggestionPersistence.value?.pending() && !(await flush())) return false;
    const current = documentIndex.byId.value.get(tabsLayout.tabTarget(id ?? ''));
    if (!current) return true;
    if ((dirty(current) || layoutPending(current)) && !(await flush())) {
      report('此文档尚未保存，请先处理保存错误。');
      return false;
    }
    if (current.conflict || current.missing) {
      report('请先处理当前文档的冲突或缺失，再替换标签页。');
      return false;
    }
    await beforeCloseDocument?.(current.id);
    if ((dirty(current) || layoutPending(current)) && !(await flush())) {
      report('此文档尚未保存，请先处理保存错误。');
      return false;
    }
    if (current.conflict || current.missing) {
      report('请先处理当前文档的冲突或缺失，再替换标签页。');
      return false;
    }
    return true;
  }

  function prefetchFile(file: FileEntry) {
    if (!adapter.prefetch || busy.value || disposed || file.kind !== 'file' || !isMarkdown(file.path))
      return;
    const entry = fileRegistry.value?.get(file.id);
    if (!entry || entry.pendingCreation) return;
    // This is only a hint. Opening still reports real read errors and validates
    // the current version; hovering must never surface an error banner.
    void adapter.prefetch(entry.path).catch(() => {});
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      if (fileRegistry.value?.at(path)) void adapter.prefetch(path).catch(() => {});
    }
  }

  function openCached(file: FileEntry, replaceId?: string) {
    if (fileMutations.pending.value) return false;
    const existing = documentIndex.byId.value.get(file.id);
    if (existing) {
      tabsLayout.activateTab(existing.id, replaceId, existing);
      return true;
    }
    const entry = fileRegistry.value?.get(file.id);
    if (!entry || entry.pendingCreation) return false;
    const snapshot = adapter.readCached?.(entry.path);
    if (!snapshot) return false;
    const doc: OpenDocument = {
      id: entry.id,
      path: entry.path,
      content: snapshot.content,
      base: snapshot,
      saving: false,
      missing: false,
    };
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      const exists = !!fileRegistry.value?.at(path);
      const base = exists ? adapter.readCached?.(path) : null;
      if (exists && !base) return false;
      try {
        doc.tableLayout = {
          base: base ?? null,
          file: base
            ? parseDocumentLayout(base.content, entry.id)
            : { version: 1, fileId: entry.id, tables: [] },
        };
      } catch {
        return false;
      } // The ordinary loader reports malformed layouts.
    }
    // Cache lookup and activation are synchronous. A background workspace scan
    // can reconcile later; it must not make displaying known bytes wait on I/O.
    tabsLayout.activateTab(doc.id, replaceId, doc);
    return true;
  }

  function recordOpenedDocument(file: FileEntry) {
    recordHelpCompleted('welcome');
    if (
      workspace.value &&
      indexFolderHomes(
        workspace.value.files,
        policy.workspaceSettings.value.folderHomeFileName,
      ).get(parentPath(file.path))?.id === file.id
    )
      recordHelpCompleted('folder-home');
  }

  /** Running plugins that declare fileHandlers can handle compound-suffix Markdown or attachments. */
  function fileEditorHandler(file: FileEntry) {
    if (file.kind !== 'file' || !workspace.value || !isMarkdown(file.path)) return undefined;
    return resolvePluginFileHandler(file.path, 'editor', plugins.pluginFileHandlers.value);
  }
  function filePreviewHandler(file: FileEntry) {
    if (
      file.kind !== 'file' ||
      !workspace.value ||
      isMarkdown(file.path) ||
      isDataTableFilePath(file.path)
    )
      return undefined;
    return resolvePluginFileHandler(file.path, 'preview', plugins.pluginFileHandlers.value);
  }
  async function openFileWithEditorHandler(file: FileEntry, handler: PluginWorkbenchFileHandler) {
    const currentWorkspace = workspace.value;
    if (!currentWorkspace) return false;
    try {
      await plugins.pluginExecutor.invoke(handler.pluginId, 'command', handler.command, {
        workspaceId: currentWorkspace.id,
        fileId: file.id,
      });
      return true;
    } catch (error) {
      report(error);
      return false;
    }
  }
  function hasMarkdownFileHandler(file: FileEntry) {
    return !!fileEditorHandler(file);
  }

  async function openFile(
    file: FileEntry,
    options?: { historyIndex?: number; rawSource?: boolean },
  ) {
    if (filePreviewHandler(file)) return openAttachment(file, options);
    const editorHandler = options?.rawSource ? undefined : fileEditorHandler(file);
    if (editorHandler && (await openFileWithEditorHandler(file, editorHandler))) return;
    const creationAtRequest = fileOps.getCreationRevision();
    const request = ++fileOpenRevision;
    const paneId = tabsLayout.activePaneId.value;
    const epoch = assistantBridge.assistantEpoch.value;
    const activation = tabsLayout.getActivationRevision();
    const workspaceId = workspace.value?.id;
    const current = () =>
      !disposed &&
      !busy.value &&
      request === fileOpenRevision &&
      creationAtRequest === fileOps.getCreationRevision() &&
      epoch === assistantBridge.assistantEpoch.value &&
      workspaceId === workspace.value?.id &&
      activation === tabsLayout.getActivationRevision();
    try {
      if (file.kind === 'file' && isDataTableFilePath(file.path))
        return openDataTable(file.id, options);
      if (!isMarkdown(file.path) || file.kind !== 'file') return;
      const replaceId =
        tabsLayout.isUtilityTab(activeId.value) &&
        !activeId.value.startsWith('blank:') &&
        !tabsLayout.isNavigationPage(activeId.value)
          ? undefined
          : activeId.value;
      const wasOpen = documents.value.some((doc) => doc.id === file.id);
      prefetchFile(file);
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return;
      if (!current()) return;
      if (!wasOpen) openingDocuments.value[paneId] = { request, tabId: activeId.value };
      if (!openCached(file, replaceId))
        await serial(async () => {
          if (!current()) return;
          await openInternal(file, replaceId, current);
        });
      if (!wasOpen && replaceId && activeId.value === file.id)
        tabsLayout.recordTabNavigation(replaceId, file.id, options?.historyIndex);
      else if (!replaceId && activeId.value === file.id)
        tabsLayout.ensureTabNavigation(file.id, file.id);
      if (tabsLayout.active.value?.id === file.id) recordOpenedDocument(file);
    } catch (e) {
      if (current()) report(e);
    } finally {
      if (openingDocuments.value[paneId]?.request === request) delete openingDocuments.value[paneId];
    }
  }

  async function openFileInNewTab(file: FileEntry, options?: { rawSource?: boolean }) {
    try {
      if (filePreviewHandler(file)) return openAttachmentInNewTab(file);
      const editorHandler = options?.rawSource ? undefined : fileEditorHandler(file);
      if (editorHandler && (await openFileWithEditorHandler(file, editorHandler))) return;
      await serial(async () => {
        if (file.kind === 'file' && isDataTableFilePath(file.path)) {
          const target = tableTabId(dataTableFileId(file.id));
          if (tabIds.value.includes(target)) {
            const alias = tabsLayout.newTabAlias(target);
            tabIds.value.push(alias);
            activeId.value = alias;
            tabsLayout.ensureTabNavigation(alias, target);
            tabsLayout.touchNavigation();
          } else await openDataTable(file.id, { newTab: true });
          return;
        }
        const target = file.id;
        if (tabIds.value.includes(target)) {
          const alias = tabsLayout.newTabAlias(target);
          tabIds.value.push(alias);
          activeId.value = alias;
          tabsLayout.ensureTabNavigation(alias, target);
          tabsLayout.touchNavigation();
          return;
        }
        await openInternal(file);
        if (activeId.value === file.id) tabsLayout.ensureTabNavigation(file.id, file.id);
      });
      if (tabsLayout.active.value?.id === file.id) recordOpenedDocument(file);
    } catch (error) {
      report(error);
    }
  }

  async function openAttachment(
    file: FileEntry,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    const currentWorkspace = workspace.value;
    if (
      !currentWorkspace ||
      file.kind !== 'file' ||
      isMarkdown(file.path) ||
      isDataTableFilePath(file.path) ||
      !currentWorkspace.files.some((entry) => entry.id === file.id && entry.path === file.path)
    )
      return;
    const workspaceId = currentWorkspace.id;
    const request = ++fileOpenRevision;
    const activation = tabsLayout.getActivationRevision();
    const current = () => request === fileOpenRevision && !busy.value && !disposed;
    const target = `attachment:${file.id}`;
    const handler = filePreviewHandler(file);
    const usePlugin =
      !!handler && plugins.pluginViews.value.some((view) => view.key === handler.viewKey);
    const id = usePlugin && handler ? handler.viewKey : target;
    // Preview plugins share one tab per view while navigation history follows individual files.
    const opened = await openPageTab(id, {
      ...options,
      target,
      current: () => current() && tabsLayout.getActivationRevision() === activation,
    });
    if (
      !opened ||
      !usePlugin ||
      !handler ||
      !current() ||
      activeId.value !== id ||
      workspace.value?.id !== workspaceId
    )
      return;
    const previewActivation = tabsLayout.getActivationRevision();
    try {
      await plugins.pluginExecutor.invoke(handler.pluginId, 'command', handler.command, {
        workspaceId,
        fileId: file.id,
        viewAlreadyOpen: true,
      });
    } catch (error) {
      if (
        !current() ||
        tabsLayout.getActivationRevision() !== previewActivation ||
        workspace.value?.id !== workspaceId
      )
        return;
      report(error);
      await openPageTab(target, {
        target,
        current: () => current() && tabsLayout.getActivationRevision() === previewActivation,
      });
    }
  }

  function openAttachmentInNewTab(file: FileEntry) {
    return openAttachment(file, { newTab: true });
  }

  async function openFilesInNewTabsAt(
    ids: readonly string[],
    index: number,
    workspaceId: string,
  ) {
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) return;
        const files = [...new Set(ids)].map((id) =>
          workspace.value!.files.find((file) => file.id === id),
        );
        if (
          !files.length ||
          files.some(
            (file) =>
              !file ||
              file.kind !== 'file' ||
              !(isMarkdown(file.path) || isDataTableFilePath(file.path)),
          )
        )
          return;
        // Keep a stable neighbor while reads are pending and already-open tabs move.
        const moving = new Set(
          files.map((file) => (isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id)),
        );
        const following = tabIds.value.slice(Math.max(0, index)).filter((id) => !moving.has(id));
        for (const file of files) {
          await openInternal(file!);
          if (tabsLayout.active.value?.id === file!.id) recordHelpCompleted('welcome');
          const id = isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id;
          tabsLayout.ensureTabNavigation(id, id);
          const target = following.find((tabId) => tabIds.value.includes(tabId));
          if (target) tabsLayout.moveDocument(id, target, 'before');
          else tabsLayout.placeTab(id, tabIds.value.length);
        }
      });
    } catch (error) {
      report(error);
    }
  }

  async function openPageTab(
    id: string,
    options?: { newTab?: boolean; historyIndex?: number; target?: string; current?: () => boolean },
  ) {
    if (!workspace.value) return false;
    if (options?.newTab) {
      tabsLayout.activateTab(id);
      tabsLayout.ensureTabNavigation(id, options.target);
      if (options.target) tabsLayout.recordTabNavigation(id, id, undefined, options.target);
      else tabsLayout.touchNavigation();
      return true;
    }
    const workspaceId = workspace.value.id;
    const epoch = assistantBridge.assistantEpoch.value;
    const replaceId = activeId.value;
    const wasOpen = tabIds.value.includes(id);
    try {
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return false;
      return await serial(async () => {
        if (
          workspace.value?.id !== workspaceId ||
          assistantBridge.assistantEpoch.value !== epoch ||
          (options?.current && (!options.current() || activeId.value !== replaceId))
        )
          return false;
        const targetId = activeId.value === replaceId ? replaceId : undefined;
        tabsLayout.activateTab(id, targetId);
        if (!wasOpen && targetId)
          tabsLayout.recordTabNavigation(targetId, id, options?.historyIndex, options?.target);
        else if (options?.target) {
          tabsLayout.ensureTabNavigation(id, options.target);
          tabsLayout.recordTabNavigation(
            id,
            id,
            targetId === id ? options.historyIndex : undefined,
            options.target,
          );
        } else {
          tabsLayout.ensureTabNavigation(id);
          tabsLayout.touchNavigation();
        }
        return true;
      });
    } catch (error) {
      report(error);
      return false;
    }
  }

  async function openGraphTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(GRAPH_TAB_ID, options);
    if (workspace.value && activeId.value === GRAPH_TAB_ID) recordHelpCompleted('graph');
  }
  async function openDirectory(
    path: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (!workspace.value) return;
    const entry = workspace.value.files.find(
      (file) => file.kind === 'directory' && file.path === path,
    );
    if (path && !entry) return;
    await openPageTab(path ? `directory:${entry!.id}` : 'directory:/', options);
  }
  async function openPluginDetail(
    pluginId: string,
    options?: { newTab?: boolean; historyIndex?: number },
  ) {
    if (tabsLayout.pluginDetailManifest(`plugin:${pluginId}`))
      await openPageTab(`plugin:${pluginId}`, options);
  }
  async function openPluginsTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(PLUGINS_TAB_ID, options);
    if (workspace.value && activeId.value === PLUGINS_TAB_ID) recordHelpCompleted('plugins');
  }

  // Serialize adapter reads with workspace switches. The graph never writes
  // content, and open drafts take precedence over the filesystem snapshot.
  function readGraphDocument(
    expectedWorkspace: Pick<Workspace, 'id' | 'path'>,
    file: Pick<FileEntry, 'id'> & Partial<Pick<FileEntry, 'path'>>,
  ) {
    return serial(async () => {
      if (
        workspace.value?.id !== expectedWorkspace.id ||
        workspace.value.path !== expectedWorkspace.path
      )
        throw new Error('工作区已切换');
      const entry = fileRegistry.value?.get(file.id);
      if (
        !entry ||
        (file.path !== undefined && entry.path !== file.path) ||
        entry.kind !== 'file' ||
        !isMarkdown(entry.path)
      )
        throw new Error('文档已移动或删除');
      const draft = documentIndex.byId.value.get(file.id);
      if (draft) return draft.content;
      const snapshot = await adapter.read(entry.path);
      return documentIndex.byId.value.get(file.id)?.content ?? snapshot.content;
    });
  }

  function edit(content: string) {
    if (tabsLayout.active.value) editDocument(tabsLayout.active.value.id, content);
  }

  function editDocument(id: string, content: string, options: { origin?: 'local' | 'remote' } = {}) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc || doc.conflict || workspace.value?.readOnly || fileRegistry.value?.get(id)?.readOnly)
      return;
    const before = doc.content;
    doc.content = content;
    if (!doc.creating) doc.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
    if (options.origin !== 'remote')
      helpEdits.record(id, before, content, knowledge.referenceTargets.value);
  }

  function receiveDocument(
    id: string,
    content: string,
    options: { origin?: 'local' | 'remote' } = {},
  ) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc || doc.conflict || doc.missing) return;
    const before = doc.content;
    doc.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
    if (options.origin === 'local')
      helpEdits.record(id, before, content, knowledge.referenceTargets.value);
  }

  async function hydrateDocumentLayout(doc: OpenDocument) {
    if (!workspace.value || !/^[0-9a-f]{6}$/.test(doc.id)) return;
    try {
      doc.tableLayout = await loadDocumentLayout(adapter, workspace.value, doc.id);
    } catch (error) {
      report(`无法读取表格布局，原文件已保留：${String(error)}`);
    }
  }

  function editTableLayout(id: string, tables: TableLayout[]) {
    const doc = documentIndex.byId.value.get(id);
    if (!doc?.tableLayout || doc.conflict || doc.missing || workspace.value?.readOnly) return;
    doc.tableLayout.file = {
      ...doc.tableLayout.file,
      tables: JSON.parse(JSON.stringify(tables)),
    };
    doc.tableLayout.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 300);
  }

  async function saveTableLayout(doc: OpenDocument) {
    const state = doc.tableLayout;
    if (!state || !layoutDirty(state) || doc.missing || doc.conflict) return;
    const draft = JSON.stringify(state.file);
    if (state.conflict?.draft === draft) return;
    try {
      const saved = await saveDocumentLayout(adapter, state);
      state.base = saved.base;
      if (JSON.stringify(state.file) === draft) state.file = saved.file;
      state.error = undefined;
      state.conflict = undefined;
    } catch (error) {
      if (error instanceof DocumentLayoutConflict) state.conflict = { path: error.path, draft };
      state.error = String(error);
      report(error);
    }
  }

  async function flush(): Promise<boolean> {
    await fileMutations.flush();
    return flushDocuments();
  }

  async function flushDocuments(): Promise<boolean> {
    await fileOps.awaitCreationChain();
    try {
      await assistantBridge.suggestionPersistence.value?.flush();
    } catch (error) {
      report(error);
      return false;
    }
    clearTimeout(saveTimer);
    const saved = await serial(async () => {
      const tablesSaved = await dataTables.persistAll();
      for (const doc of documents.value) {
        await saveInternal(doc);
        await saveTableLayout(doc);
      }
      return (
        tablesSaved &&
        documents.value.every((doc) => (!dirty(doc) || !!doc.conflict) && !layoutPending(doc))
      );
    });
    await journal.flush();
    return saved;
  }

  async function refresh() {
    if (!workspace.value) return;
    const expectedId = workspace.value.id;
    const expectedPath = workspace.value.path;
    try {
      await serial(async () => {
        if (workspace.value?.id !== expectedId || workspace.value.path !== expectedPath) return;
        workspace.value = await adapter.refresh();
        await policy.refreshCapabilities();
        await policy.refreshWorkspaceSettings();
        await knowledge.refreshObjects();
        await dataTables.reload();
        for (const doc of documents.value) {
          if (doc.creating) continue;
          const entry = fileRegistry.value?.get(doc.id);
          if (!entry) {
            if (!doc.missing) activity('文件已在外部移除', doc.path, 'external');
            doc.missing = true;
            continue;
          }
          if (doc.path !== entry.path) {
            activity('文件已在外部重命名', `${doc.path} → ${entry.path}`, 'external');
            doc.path = entry.path;
          }
          doc.missing = false;
          await reconcile(doc, await adapter.read(doc.path));
          await saveInternal(doc);
          if (doc.tableLayout && !layoutDirty(doc.tableLayout)) await hydrateDocumentLayout(doc);
          await saveTableLayout(doc);
        }
      });
    } catch (error) {
      knowledge.clearRevokedReferences(error);
      report(error);
    }
  }

  async function close(id: string) {
    if (isTableTab(id) && !(await flush())) {
      report('数据表尚有未保存的修改，请先处理保存错误。');
      return;
    }
    const pane = tabsLayout.panes.value.find((pane) => pane.tabs.includes(id));
    const nextTab = () => {
      const candidate = tabsLayout.panes.value
        .find((item) => item.id === pane?.id)
        ?.tabs.find((tabId) => tabId !== id && tabIds.value.includes(tabId));
      return candidate ?? tabIds.value.find((tabId) => tabId !== id) ?? '';
    };
    if (tabsLayout.isUtilityTab(id)) {
      tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
      tabsLayout.removeTabAlias(id);
      tabsLayout.removeTabNavigation(id);
      if (activeId.value === id) activeId.value = nextTab();
      return;
    }
    if (!(await flush())) {
      report('此文档尚有未保存的修改或建议，请先处理保存错误。');
      return;
    }
    try {
      await beforeCloseDocument?.(tabsLayout.tabTarget(id));
    } catch (error) {
      report(error);
      return;
    }
    const target = tabsLayout.tabTarget(id);
    const doc = documentIndex.byId.value.get(target);
    if (doc && ((dirty(doc) && !doc.conflict) || layoutPending(doc))) {
      report('此文档尚未保存，请先另存副本或解决保存错误。');
      return;
    }
    tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
    tabsLayout.removeTabAlias(id);
    tabsLayout.removeTabNavigation(id);
    if (!tabIds.value.some((tabId) => tabsLayout.tabTarget(tabId) === target))
      documents.value = documents.value.filter((d) => d.id !== target);
    if (activeId.value === id) activeId.value = nextTab();
  }

  async function resolveConflict(doc: OpenDocument, openCopy: boolean) {
    await serial(async () => {
      if (!doc.conflict) return;
      const copy = doc.conflict.copyPath;
      // Read again: the external writer may have changed the original since the conflict.
      const latest = await adapter.read(doc.path);
      doc.base = latest;
      doc.content = latest.content;
      doc.conflict = undefined;
      doc.missing = false;
      doc.error = undefined;
      if (openCopy) {
        workspace.value = await adapter.refresh();
        const file = fileRegistry.value?.at(copy);
        if (file) {
          await openInternal(file);
          tabsLayout.ensureTabNavigation(file.id, file.id);
          tabsLayout.touchNavigation();
        }
      }
    }).catch(report);
  }

  async function reveal() {
    try {
      await adapter.reveal();
    } catch (e) {
      report(e);
    }
  }

  function dispose() {
    disposed = true;
    helpEdits.dispose();
    plugins.disposePlugins();
    stopSessionWatch();
    stopWatching();
    clearTimeout(saveTimer);
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
      await openDataTable(id);
    },
    createDataTable,
    renameDataTable,
    openDataTable,
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
    initialize,
    refreshWorkspaces,
    openWorkspace,
    leaveWorkspace,
    deleteWorkspace,
    createWorkspace,
    openFile,
    prefetchFile,
    openFileInNewTab,
    openAttachment,
    openAttachmentInNewTab,
    openDirectory,
    openFilesInNewTabsAt,
    createBlankTab: tabsLayout.createBlankTab,
    openGraphTab,
    openPluginsTab,
    openPluginDetail,
    openCalendarTab: tabsLayout.openCalendarTab,
    registerViews: tabsLayout.registerViews,
    pluginViews: plugins.pluginViews,
    pluginCommands: plugins.pluginCommands,
    pluginFileHandlers: plugins.pluginFileHandlers,
    pluginSlashCommands: plugins.pluginSlashCommands,
    pluginCodeBlockRenderers: plugins.pluginCodeBlockRenderers,
    pluginDecorationsFor: plugins.pluginDecorationsFor,
    pluginStatusBarItems: plugins.pluginStatusBarItems,
    hasMarkdownFileHandler,
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
    readGraphDocument,
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
    edit,
    editDocument,
    editTableLayout,
    preserveDraft: fileOps.preserveDraft,
    receiveDocument,
    setBeforeWorkspaceChange: (hook?: () => Promise<void>) => {
      beforeWorkspaceChange = hook;
    },
    setDocumentLifecycle: (hooks: {
      beforeSwitch: () => Promise<void>;
      afterSwitch?: () => Promise<void>;
      beforeCloseDocument: (id: string) => Promise<void>;
    }) => {
      beforeSwitch = hooks.beforeSwitch;
      afterSwitch = hooks.afterSwitch;
      beforeCloseDocument = hooks.beforeCloseDocument;
    },
    flush,
    refresh,
    enableWorkspacePolling,
    search: async (query: string, signal?: AbortSignal) => {
      const scope = workspace.value?.id;
      if (!scope || !adapter.search || signal?.aborted) return [];
      // Read-only search must not hold the mutation queue while remote files load.
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
    close,
    resolveConflict,
    reveal,
    dispose,
    report,
  };
});
