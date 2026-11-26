import type { Ref } from 'vue';
import {
  basename,
  isMarkdown,
  isRemoteWorkspacePath,
  isWorkspaceInternalPath,
  type FileRegistry,
  type FileSnapshot,
  type RecentWorkspace,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceSession,
} from '@tano/protocol';
import { isFeatureEnabled } from '../features';
import type { createWorkspaceAssistantBridge } from '../assistant/workspace-bridge';
import type { createDataTableController } from '../data-tables/data-table-controller';
import type { OpenDocument } from '../documents/document-session';
import type { InstalledObjectPlugin } from '../plugins/workspace-plugins';
import { layoutDirty } from '../workspace/workspace-document-layout';
import type { WorkspaceLifecycle } from '../workspace/workspace-lifecycle';
import { readStartupWorkspace, rememberStartupWorkspace } from '../workspace/workspace-startup';
import { addWorkspaceWelcome, workspaceWelcomePath } from '../workspace/workspace-welcome';
import type { createWorkspaceKnowledge } from './workspace-knowledge';
import type { createWorkspacePluginsState } from './workspace-plugins-state';
import type { createWorkspacePolicy } from './workspace-policy';
import type { createWorkspaceSession } from './workspace-session';
import type { createWorkspaceTabsLayout } from './workspace-tabs-layout';
import type { Activity, WorkspaceLifecycleHooks, WorkspaceLoadingState } from './workspace-types';

export interface WorkspaceLifecycleDeps {
  adapter: WorkspaceAdapter;
  isDemo: boolean;
  isWeb: boolean;
  remembersStartupWorkspace: boolean;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  tabIds: Ref<string[]>;
  tabAliases: Ref<Map<string, string>>;
  activeId: Ref<string>;
  installedPlugins: Ref<InstalledObjectPlugin[]>;
  busy: Ref<boolean>;
  openingWorkspace: Ref<boolean>;
  workspaceLoading: Ref<WorkspaceLoadingState>;
  restoringDocuments: Ref<Record<string, string>>;
  openingDocuments: Ref<Record<string, { request: number; tabId: string }>>;
  activities: Ref<Activity[]>;
  fatal: Ref<string>;
  recent: Ref<RecentWorkspace[]>;
  sessionError: Ref<string>;
  workspaceLifecycle: WorkspaceLifecycle;
  stopWatching: () => void;
  dataTables: ReturnType<typeof createDataTableController>;
  policy: ReturnType<typeof createWorkspacePolicy>;
  knowledge: ReturnType<typeof createWorkspaceKnowledge>;
  plugins: ReturnType<typeof createWorkspacePluginsState>;
  tabsLayout: ReturnType<typeof createWorkspaceTabsLayout>;
  assistantBridge: ReturnType<typeof createWorkspaceAssistantBridge>;
  session: ReturnType<typeof createWorkspaceSession>;
  hooks: WorkspaceLifecycleHooks;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  activity: (label: string, detail: string, kind: Activity['kind'], change?: Activity['change']) => void;
  report: (error: unknown) => void;
  loadWorkspacePart: (part: keyof WorkspaceLoadingState, load: () => Promise<unknown>) => Promise<void>;
  flush: () => Promise<boolean>;
  reconcile: (doc: OpenDocument, snapshot: FileSnapshot) => Promise<void>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  hydrateDocumentLayout: (doc: OpenDocument) => Promise<void>;
  saveTableLayout: (doc: OpenDocument) => Promise<void>;
}

export function createWorkspaceLifecycle(deps: WorkspaceLifecycleDeps) {
  const {
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
    flush,
    reconcile,
    saveInternal,
    hydrateDocumentLayout,
    saveTableLayout,
  } = deps;

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

  async function initialize(requestedWorkspace?: string) {
    if (isDemo || isWeb) {
      await openWorkspace(requestedWorkspace);
      if (!workspace.value && requestedWorkspace) await openWorkspace();
      if (isWeb) await refreshWorkspaces();
    } else if (requestedWorkspace) {
      await openWorkspace(requestedWorkspace);
    } else if (adapter.recent && (await refreshWorkspaces())) {
      const savedId = readStartupWorkspace();
      const candidates = isFeatureEnabled('sshRemoteWorkspace')
        ? recent.value
        : recent.value.filter((item) => !isRemoteWorkspacePath(item.path) && item.remote?.kind !== 'ssh');
      const previous =
        savedId === undefined
          ? candidates.reduce<RecentWorkspace | undefined>(
              (latest, item) => (!latest || item.openedAt > latest.openedAt ? item : latest),
              undefined,
            )
          : candidates.find((item) => item.id === savedId);
      if (previous) await openWorkspace(previous.path);
      else if (savedId) rememberStartupWorkspace(null);
    }
  }

  async function openWorkspace(path?: string, newName?: string) {
    if (path && isRemoteWorkspacePath(path) && !isFeatureEnabled('sshRemoteWorkspace')) {
      throw new Error('SSH 远端工作区功能在当前版本未启用');
    }
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
      ) as (keyof WorkspaceLoadingState)[])
        workspaceLoading.value[part] = true;
      switching = true;
      workspaceLifecycle.pause();
      if (!(await flush())) {
        report('还有未保存的修改。请先处理保存错误，再切换工作空间。');
        return;
      }
      await hooks.beforeSwitch?.();
      await hooks.beforeWorkspaceChange?.();
      await serial(async () => {
        const previousReady = session.isReady();
        session.setReady(false);
        let next: Workspace | null;
        try {
          if (newName !== undefined && !adapter.createWorkspace)
            throw new Error('此平台不能直接创建工作空间');
          next =
            newName === undefined
              ? await adapter.open(path)
              : await adapter.createWorkspace!(newName);
        } catch (error) {
          session.setReady(previousReady);
          throw error;
        }
        if (!next) {
          session.setReady(previousReady);
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

        const settingsReady = loadWorkspacePart('settings', policy.refreshWorkspaceSettings);
        const tablesReady = loadWorkspacePart('tables', () => dataTables.reload());
        const objectsReady = knowledge.refreshObjects().catch(report);
        const capabilitiesReady = loadWorkspacePart('capabilities', policy.refreshCapabilities);
        pendingWorkspaceLoads = [settingsReady, tablesReady, objectsReady, capabilitiesReady];
        assistantBridge.resetForWorkspaceChange();
        activities.value = [];
        sessionError.value = '';
        session.setBlocked(false);
        const watcherReady = workspaceLifecycle.start().catch(report);
        pendingWorkspaceLoads.push(watcherReady);

        let saved: WorkspaceSession | null = null;
        if (adapter.loadSession) {
          try {
            saved = await adapter.loadSession(next.id);
          } catch (error) {
            session.setBlocked(true);
            sessionError.value = `${String(error)}。本次不覆盖恢复记录。`;
          }
        }
        if (saved) await session.restoreSession(saved, tablesReady, objectsReady);
        else await settingsReady;

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
            await session.openInitialDocument(first);
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
        await Promise.all([
          settingsReady,
          tablesReady,
          objectsReady,
          capabilitiesReady,
          watcherReady,
        ]);
        session.setReady(true);
        session.queueSession();
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
      ) as (keyof WorkspaceLoadingState)[])
        workspaceLoading.value[part] = false;
      busy.value = false;
      if (switching) {
        workspaceLifecycle.resume();
        try {
          await hooks.afterSwitch?.();
        } catch (error) {
          report(error);
        }
      }
    }
  }

  function createWorkspace(name?: string) {
    if (name === undefined) {
      const spaces = [...recent.value, ...(workspace.value ? [workspace.value] : [])];
      const occupied = new Set(
        spaces.flatMap((space) => [space.name, basename(space.path.replace(/\\/g, '/'))]),
      );
      name = '新工作区';
      for (let suffix = 2; occupied.has(name); suffix++) name = `新工作区 ${suffix}`;
    }
    return openWorkspace(undefined, name);
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
      await hooks.beforeSwitch?.();
      await hooks.beforeWorkspaceChange?.();
      await serial(async () => {
        assertDeletion();
        const current = workspace.value;
        if (!current) return;
        session.queueSession();
        await session.journal.flush();
        if (deleteId !== undefined) await adapter.deleteWorkspace!(deleteId);
        else await adapter.close?.(current.id);
        if (remembersStartupWorkspace) rememberStartupWorkspace(null);
        session.setReady(false);
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
        session.setBlocked(false);
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
        await hooks.afterSwitch?.();
      } catch (error) {
        report(error);
      }
    }
  }

  function leaveWorkspace(): Promise<boolean> {
    return exitWorkspace();
  }

  function deleteWorkspace(workspaceId: string): Promise<boolean> {
    return exitWorkspace(workspaceId);
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

  async function reveal() {
    try {
      await adapter.reveal();
    } catch (e) {
      report(e);
    }
  }

  return {
    initialize,
    refreshWorkspaces,
    openWorkspace,
    createWorkspace,
    leaveWorkspace,
    deleteWorkspace,
    refresh,
    reveal,
  };
}
