import { computed, onScopeDispose, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type {
  FileEntry,
  FileSnapshot,
  Workspace,
  WorkspaceSession,
  RecentWorkspace,
  WorkspaceBackupCatalog,
  WorkspaceRecoveryPreview,
  WorkspaceArchiveResult,
} from '@tano/protocol';
import { basename, isMarkdown, pathKey, objectDirectory } from '@tano/protocol';
import { mergeMarkdown } from '@tano/markdown';
import { useWorkbenchRuntime } from '../runtime';
import { planFileMove } from '../file-move';
import { topLevelEntries } from '../file-selection';
import { defaultCapabilities } from '@tano/editor/runtime';
import { loadCapabilities, saveCapabilityPatch } from '../workspace-capabilities';
import type { CapabilityPatch } from '../workspace-capabilities';
import { loadObjects, saveObject } from '../workspace-objects';
import type { ObjectRecord } from '../workspace-objects';
import { assetTargets, documentTargets, parseObject, objectTypeRegistry, validateObjectProperties } from '@tano/protocol';
import type { WorkspaceObject, ReferenceTarget } from '@tano/protocol';
import { coreRelationTypes, newShortId, RelationIndex, referenceKey, validateRelation } from '@tano/protocol';
import type { ReferenceIdentity, WorkspaceRelation } from '@tano/protocol';
import { PLUGINS_TAB_ID, WorkspacePluginHost } from '../workspace-plugins';
import type { InstalledObjectPlugin, PluginChange } from '../workspace-plugins';
import { loadRelations, saveRelationChange } from '../workspace-relations';
import type { RelationChange } from '../workspace-relations';
import { GRAPH_TAB_ID } from '../document-graph';

const isUtilityTab = (id: string) => id.startsWith('blank:') || id === GRAPH_TAB_ID || id === PLUGINS_TAB_ID;

export interface OpenDocument {
  id: string;
  path: string;
  content: string;
  base: FileSnapshot;
  saving: boolean;
  missing: boolean;
  conflict?: { copyPath: string; disk: FileSnapshot };
  error?: string;
}
export interface DocumentTab {
  id: string;
  path: string;
  blank: boolean;
  graph: boolean;
  plugins: boolean;
  document?: OpenDocument;
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
  const { adapter, mobile } = useWorkbenchRuntime();
  const workspace = ref<Workspace | null>(null);
  const objects = ref<ObjectRecord[]>([]);
  const objectErrors = ref<string[]>([]);
  const pluginHost = new WorkspacePluginHost();
  const pluginStorageChanged = (event: StorageEvent) => {
    if (event.key?.startsWith('tano.object-plugins.v1.')) scheduleRefresh();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', pluginStorageChanged);
  onScopeDispose(() => { if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged); });
  const installedPlugins = ref<InstalledObjectPlugin[]>([]);
  const pluginError = ref('');
  const relations = ref<WorkspaceRelation[]>([]);
  const relationError = ref('');
  let relationBase: FileSnapshot | null = null;
  onScopeDispose(() => pluginHost.dispose());
  const relationDefinitions = computed(() => [
    ...coreRelationTypes,
    ...installedPlugins.value.filter((item) => item.enabled).flatMap((item) => item.manifest.relationTypes),
  ]);
  const relationIndex = computed(() => new RelationIndex(relations.value));
  const objectDefinitions = ref(objectTypeRegistry.list());
  onScopeDispose(objectTypeRegistry.subscribe(() => { objectDefinitions.value = objectTypeRegistry.list(); }));
  const referenceTargets = computed<ReferenceTarget[]>(() => workspace.value ? [
    ...documentTargets(workspace.value.id, workspace.value.files),
    ...assetTargets(workspace.value.id, workspace.value.files),
    ...objects.value.filter(({ object }) => {
      if (!objectDefinitions.value.some((definition) => definition.type === object.type && definition.storage === 'record')) return false;
      try { validateObjectProperties(object.type, object.properties); return true; } catch { return false; }
    }).map(({ object, path }) => ({ workspace: workspace.value!.id, type: object.type, id: object.id, name: object.name, description: object.description, archived: object.archived, path, properties: object.properties })),
  ] : []);
  async function refreshObjects() {
    if (!workspace.value) return;
    try {
      installedPlugins.value = pluginHost.load(workspace.value.id);
      pluginError.value = '';
    } catch (error) {
      pluginHost.dispose(); installedPlugins.value = [];
      pluginError.value = `无法加载插件：${String(error)}。安装记录已保留。`;
    }
    const loaded = await loadObjects(adapter, workspace.value);
    objects.value = loaded.records; objectErrors.value = loaded.errors;
    try {
      const loadedRelations = await loadRelations(adapter, workspace.value);
      relationBase = loadedRelations.snapshot; relations.value = loadedRelations.file.relations;
      relationError.value = '';
    } catch (error) {
      relations.value = []; relationBase = null;
      relationError.value = `无法读取关系：${String(error)}。原文件已保留，请修复后重试。`;
    }
  }
  async function changePlugin(change: PluginChange, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换，请重试');
      installedPlugins.value = await pluginHost.change(expectedWorkspace, change);
      await refreshObjects();
    });
  }
  async function editRelation(change: RelationChange, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换，关系未写入其他工作区');
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('Level 2 已关闭');
      if (relationError.value) throw new Error(relationError.value);
      if ('add' in change) {
        validateRelation(change.add, relationDefinitions.value);
        for (const endpoint of [change.add.source, change.add.target])
          if (!referenceTargets.value.some((target) => referenceKey(target) === referenceKey(endpoint) && !target.archived))
            throw new Error('关系端点不存在、已归档或插件未启用');
      }
      const saved = await saveRelationChange(adapter, relationBase, change);
      relationBase = saved.snapshot; relations.value = saved.file.relations;
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity('关系已更新', 'add' in change ? change.add.type : change.remove.type, 'save');
    });
  }
  function createRelation(type: string, source: ReferenceIdentity, target: ReferenceIdentity) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    return editRelation({ add: { id: newShortId(new Set(relations.value.map((row) => row.id))), type, source, target } }, workspaceId);
  }
  function removeRelation(row: WorkspaceRelation) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    return editRelation({ remove: JSON.parse(JSON.stringify(row)) }, workspaceId);
  }
  async function createObject(draft: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>) {
    const workspaceId = workspace.value?.id;
    return serial(async () => {
      if (!workspaceId || workspace.value?.id !== workspaceId) throw new Error('工作区已切换');
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('Level 2 已关闭');
      validateObjectProperties(draft.type, draft.properties);
      workspace.value = await adapter.refresh();
      await refreshObjects();
      if (!adapter.reserveObjectId) throw new Error('此存储适配器尚未实现短 ID 分配');
      if (objectErrors.value.length) throw new Error('请先修复对象格式或重复 ID，再创建对象');
      const id = await adapter.reserveObjectId(objects.value.map(({ object }) => object.id));
      const object = parseObject(JSON.stringify({ ...draft, id, version: 1 }));
      const path = `${objectDirectory}/${object.id}.tano.json`;
      await adapter.create(path, JSON.stringify(object, null, 2) + '\n');
      workspace.value = await adapter.refresh(); await refreshObjects();
      activity('对象已创建', `${object.name} · ${object.type}`, 'file');
      return objects.value.find((record) => record.object.id === object.id)!;
    });
  }
  async function updateObject(record: ObjectRecord, draft: WorkspaceObject, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换，草稿未写入其他工作区');
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('Level 2 已关闭');
      const saved = await saveObject(adapter, record, draft);
      workspace.value = await adapter.refresh(); await refreshObjects();
      activity('对象已更新', `${saved.object.name} · ${saved.object.type}`, 'save');
      return saved;
    });
  }
  const capabilities = ref(structuredClone(defaultCapabilities));
  const capabilityError = ref('');
  const capabilitySaving = ref(false);
  let capabilityBase: FileSnapshot | null = null;
  async function refreshCapabilities() {
    if (!workspace.value) return;
    try {
      const loaded = await loadCapabilities(adapter, workspace.value);
      capabilityBase = loaded.snapshot;
      if (JSON.stringify(capabilities.value) !== JSON.stringify(loaded.capabilities))
        capabilities.value = loaded.capabilities;
      capabilityError.value = '';
    } catch (error) {
      capabilityError.value = `无法读取工作区规则：${String(error)}。原文件已保留，设置暂时不可修改。`;
    }
  }
  async function updateCapabilities(patch: CapabilityPatch) {
    if (!workspace.value || capabilitySaving.value || capabilityError.value) return;
    const workspaceId = workspace.value.id;
    const base = capabilityBase;
    capabilitySaving.value = true;
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重试');
        writable();
        const saved = await saveCapabilityPatch(adapter, base, patch);
        capabilityBase = saved.snapshot;
        capabilities.value = saved.capabilities;
        workspace.value = await adapter.refresh();
      });
    } catch (error) {
      report(error);
      await serial(refreshCapabilities);
    } finally {
      capabilitySaving.value = false;
    }
  }
  const documents = ref<OpenDocument[]>([]);
  const tabIds = ref<string[]>([]);
  const activeId = ref('');
  const busy = ref(false);
  const active = computed(() => documents.value.find((d) => d.id === activeId.value));
  const tabs = computed<DocumentTab[]>(() =>
    tabIds.value.map((id) => {
      const document = documents.value.find((doc) => doc.id === id);
      return { id, path: document?.path ?? '', blank: id.startsWith('blank:'), graph: id === GRAPH_TAB_ID, plugins: id === PLUGINS_TAB_ID, document };
    }),
  );
  type TabNavigation = { entries: string[]; index: number };
  const tabSlots = new Map<string, string>();
  const tabNavigations = new Map<string, TabNavigation>();
  const navigationRevision = ref(0);
  const navigationBusy = ref(false);
  function touchNavigation() {
    navigationRevision.value++;
  }
  function ensureTabNavigation(tabId: string, initialId = tabId) {
    let slot = tabSlots.get(tabId);
    if (!slot) {
      slot = crypto.randomUUID();
      tabSlots.set(tabId, slot);
    }
    if (!tabNavigations.has(slot))
      tabNavigations.set(slot, { entries: [initialId], index: 0 });
    return tabNavigations.get(slot)!;
  }
  function resetTabNavigation() {
    tabSlots.clear();
    tabNavigations.clear();
    touchNavigation();
  }
  function recordTabNavigation(fromId: string | undefined, toId: string, historyIndex?: number) {
    const history = ensureTabNavigation(fromId ?? toId, fromId ?? toId);
    const slot = tabSlots.get(fromId ?? toId)!;
    if (fromId && fromId !== toId) {
      tabSlots.delete(fromId);
      tabSlots.set(toId, slot);
    }
    if (historyIndex === undefined) {
      if (history.entries[history.index] !== toId)
        history.entries = [...history.entries.slice(0, history.index + 1), toId].slice(-100);
      history.index = history.entries.length - 1;
    } else {
      history.index = historyIndex;
    }
    touchNavigation();
  }
  function removeTabNavigation(tabId: string) {
    const slot = tabSlots.get(tabId);
    if (!slot) return;
    tabSlots.delete(tabId);
    tabNavigations.delete(slot);
    touchNavigation();
  }
  watch(() => workspace.value?.id, () => {
    resetTabNavigation();
  }, { flush: 'sync' });
  function activeNavigation() {
    void navigationRevision.value;
    return activeId.value ? ensureTabNavigation(activeId.value) : undefined;
  }
  function navigationDestination(direction: -1 | 1) {
    const history = activeNavigation();
    if (!history) return -1;
    for (let index = history.index + direction;
      index >= 0 && index < history.entries.length; index += direction) {
      const id = history.entries[index];
      if (tabIds.value.includes(id) || workspace.value?.files.some((file) =>
        file.id === id && file.kind === 'file' && isMarkdown(file.path))) return index;
    }
    return -1;
  }
  const canGoBack = computed(() => !busy.value && !navigationBusy.value && navigationDestination(-1) >= 0);
  const canGoForward = computed(() => !busy.value && !navigationBusy.value && navigationDestination(1) >= 0);
  async function navigateHistory(direction: -1 | 1) {
    if (busy.value || navigationBusy.value) return;
    const index = navigationDestination(direction);
    if (index < 0) return;
    const history = activeNavigation();
    if (!history) return;
    const id = history.entries[index];
    navigationBusy.value = true;
    try {
      const file = workspace.value?.files.find((entry) => entry.id === id);
      if (file) await openFile(file, { historyIndex: index });
    } finally {
      navigationBusy.value = false;
    }
  }
  const activities = ref<Activity[]>([]);
  const notice = ref('');
  const fatal = ref('');
  const recovery = ref<WorkspaceBackupCatalog | null>(null);
  const recoveryPreview = ref<WorkspaceRecoveryPreview | null>(null);
  const recoveryError = ref('');
  const recoveryBusy = ref(false);
  const recent = ref<RecentWorkspace[]>([]);
  const sessionError = ref('');
  const isDemo = adapter.mode === 'demo';
  const isWeb = adapter.mode === 'web';
  const detachedTabId = !isDemo && !isWeb && !mobile
    ? new URLSearchParams(window.location.search).get('detachedTab')
    : null;
  const detachedWorkspacePath = detachedTabId
    ? new URLSearchParams(window.location.search).get('workspacePath')
    : null;
  const dirty = (doc: OpenDocument) => doc.content !== doc.base.content;
  const pending = computed(() => documents.value.some((d) => dirty(d) && !d.conflict));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unwatch: (() => void) | undefined;
  let refreshRunning = false;
  let refreshPending = false;
  let chain: Promise<unknown> = Promise.resolve();
  let sessionReady = false;
  let sessionBlocked = false;
  let pendingSession: { id: string; payload: WorkspaceSession } | undefined;
  let journalTask: Promise<void> = Promise.resolve();
  let journalWriting = false;
  let beforeSwitch: (() => Promise<void>) | undefined;
  let afterSwitch: (() => Promise<void>) | undefined;
  let beforeCloseDocument: ((id: string) => Promise<void>) | undefined;
  function queueSession() {
    if (detachedTabId || !sessionReady || sessionBlocked || !workspace.value || !adapter.saveSession) return;
    pendingSession = {
      id: workspace.value.id,
      payload: {
        version: 1,
        activeId: activeId.value,
        tabs: [...tabIds.value],
        documents: documents.value.map((doc) => ({
          id: doc.id,
          path: doc.path,
          ...(dirty(doc) ? { draft: { content: doc.content, base: { ...doc.base } } } : {}),
        })),
      },
    };
    if (journalWriting) return;
    journalWriting = true;
    journalTask = (async () => {
      while (pendingSession) {
        const next = pendingSession;
        pendingSession = undefined;
        try {
          await adapter.saveSession!(next.id, next.payload);
          sessionError.value = '';
        } catch (error) {
          sessionError.value = `恢复草稿未写入：${String(error)}。文档仍会尝试正常保存。`;
        }
      }
      journalWriting = false;
    })();
  }
  const stopSessionWatch = watch([documents, tabIds, activeId], queueSession, {
    deep: true,
    flush: 'sync',
  });
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
  const isRecoveryError = (error: unknown) => /\.tano|身份清单|工作空间配置|工作区配置|恢复尚未完成|身份与本机登记/.test(String(error));
  async function openRecovery(path = workspace.value?.path ?? adapter.recoveryPath?.() ?? '', reportFailure = true) {
    if (!path || !adapter.backupCatalog) return;
    try {
      recovery.value = await adapter.backupCatalog(path);
      recoveryPreview.value = null;
      recoveryError.value = '';
      const first = recovery.value.pendingRestore ?? recovery.value.snapshots.find((item) => !item.error)?.snapshotId;
      if (first) await previewRecovery(first);
    } catch (error) {
      recoveryError.value = String(error);
      if (reportFailure) report(error);
    }
  }
  async function previewRecovery(snapshotId: string) {
    if (!recovery.value || !adapter.backupPreview) return;
    recoveryBusy.value = true;
    recoveryError.value = '';
    try {
      recoveryPreview.value = await adapter.backupPreview(recovery.value.path, snapshotId);
    } catch (error) {
      recoveryPreview.value = null;
      recoveryError.value = String(error);
    } finally {
      recoveryBusy.value = false;
    }
  }
  async function restoreRecovery(snapshotId: string) {
    if (!recovery.value || !adapter.restoreBackup) return;
    const catalog = recovery.value;
    if (catalog.pendingRestore !== snapshotId && recoveryPreview.value?.snapshot.snapshotId !== snapshotId) {
      recoveryError.value = '请先检查此备份的恢复预览';
      return;
    }
    recoveryBusy.value = true;
    busy.value = true;
    recoveryError.value = '';
    let restored = false;
    let restorationWarning = '';
    try {
      queueSession();
      await journalTask;
      const result = await adapter.restoreBackup(catalog.path, snapshotId, recoveryPreview.value?.currentFingerprint);
      restorationWarning = result.backupWarning ?? '';
      recovery.value = null;
      recoveryPreview.value = null;
      fatal.value = '';
      restored = true;
    } catch (error) {
      recoveryError.value = String(error);
      try { recovery.value = await adapter.backupCatalog?.(catalog.path) ?? catalog; }
      catch { /* The recovery journal remains available for a later retry. */ }
    } finally {
      busy.value = false;
      recoveryBusy.value = false;
    }
    if (restored) {
      if (workspace.value?.id === catalog.workspaceId && workspace.value.path === catalog.path) await refresh();
      else await openWorkspace(catalog.path);
      if (restorationWarning) report(restorationWarning);
    }
  }
  async function exportFullArchive(): Promise<WorkspaceArchiveResult | null> {
    if (!workspace.value || !adapter.exportWorkspace) return null;
    if (!(await flush())) throw new Error('还有未保存的修改，请先处理保存错误');
    return adapter.exportWorkspace();
  }
  async function importFullArchive(): Promise<WorkspaceArchiveResult | null> {
    if (!adapter.importWorkspace) return null;
    if (!(await flush())) throw new Error('还有未保存的修改，请先处理保存错误');
    const result = await adapter.importWorkspace();
    if (result) {
      await openWorkspace(result.path);
      if (workspace.value?.path !== result.path)
        throw new Error(`归档已导入到 ${result.path}，但未能自动打开；请检查通知后重新打开该目录`);
    }
    return result;
  }
  function scheduleRefresh() {
    if (!workspace.value) return;
    refreshPending = true;
    if (watchTimer || refreshRunning) return;
    watchTimer = setTimeout(() => {
      watchTimer = undefined;
      refreshPending = false;
      refreshRunning = true;
      void refresh().finally(() => {
        refreshRunning = false;
        if (refreshPending) scheduleRefresh();
      });
    }, 150);
  }
  function refreshWhenVisible() {
    if (document.visibilityState === 'visible') scheduleRefresh();
  }
  function stopWatching() {
    unwatch?.();
    unwatch = undefined;
    clearTimeout(watchTimer);
    watchTimer = undefined;
    clearInterval(pollTimer);
    pollTimer = undefined;
    refreshPending = false;
    if (!isDemo && !isWeb && !mobile) {
      window.removeEventListener('focus', scheduleRefresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    }
  }
  if (!isDemo && !isWeb && !mobile && typeof window !== 'undefined') {
    const refreshRecentOnFocus = () => { void refreshWorkspaces(); };
    window.addEventListener('focus', refreshRecentOnFocus);
    onScopeDispose(() => window.removeEventListener('focus', refreshRecentOnFocus));
  }
  async function initialize() {
    if (detachedTabId && detachedWorkspacePath) await openWorkspace(detachedWorkspacePath);
    else if (isDemo || isWeb) {
      await openWorkspace();
      if (isWeb) await refreshWorkspaces();
    } else if (adapter.recent) await refreshWorkspaces();
  }
  async function refreshWorkspaces() {
    if (!adapter.recent) return;
    try {
      recent.value = await adapter.recent();
    } catch (error) {
      report(error);
    }
  }
  function writable() {
    if (workspace.value?.readOnly) throw new Error('你在此工作区只有阅读权限');
  }
  async function openWorkspace(path?: string, newName?: string) {
    if (busy.value) return;
    busy.value = true;
    try {
      if (!(await flush())) {
        report('还有未保存的修改。请先处理保存错误，再切换工作空间。');
        return;
      }
      await beforeSwitch?.();
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
        stopWatching();
        fatal.value = '';
        recovery.value = null;
        workspace.value = next;
        if (next.backupWarning) report(next.backupWarning);
        objects.value = []; objectErrors.value = [];
        await refreshObjects();
        capabilityBase = null;
        capabilities.value = structuredClone(defaultCapabilities);
        await refreshCapabilities();
        documents.value = [];
        tabIds.value = [];
        activeId.value = '';
        resetTabNavigation();
        activities.value = [];
        sessionError.value = '';
        sessionBlocked = false;
        try {
          unwatch = await adapter.watch(scheduleRefresh);
        } catch (error) {
          report(`文件监听未能启动：${String(error)}。目录将继续自动检查。`);
        }
        if (!isDemo && !isWeb && !mobile) {
          pollTimer = setInterval(refreshWhenVisible, 5_000);
          window.addEventListener('focus', scheduleRefresh);
          document.addEventListener('visibilitychange', refreshWhenVisible);
        }
        let saved: WorkspaceSession | null = null;
        if (!detachedTabId && adapter.loadSession) {
          try {
            saved = await adapter.loadSession(next.id);
          } catch (error) {
            sessionBlocked = true;
            sessionError.value = `${String(error)}。本次不覆盖恢复记录。`;
          }
        }
        if (saved) await restoreSession(saved);
        const first =
          next.files.find((f) => f.path === '开始使用.md') ??
          next.files.find((f) => /^readme\.md$/i.test(f.path)) ??
          next.files.find((f) => f.kind === 'file' && isMarkdown(f.path));
        if (detachedTabId) {
          if (detachedTabId === GRAPH_TAB_ID) openGraphTab();
          else if (detachedTabId === PLUGINS_TAB_ID) openPluginsTab();
          else if (detachedTabId.startsWith('blank:')) createBlankTab();
          else {
            const detachedFile = next.files.find((file) => file.id === detachedTabId);
            if (!detachedFile) throw new Error('拖出的文档已不存在');
            await openInternal(detachedFile);
            if (activeId.value !== detachedFile.id) throw new Error('无法打开拖出的文档');
          }
        } else if (!saved && first) {
          try {
            await openInternal(first);
            ensureTabNavigation(activeId.value, activeId.value);
            touchNavigation();
          } catch (error) {
            report(error);
          }
        }
        sessionReady = true;
        queueSession();
        if (adapter.recent) recent.value = await adapter.recent();
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
      if (isRecoveryError(error)) await openRecovery(path ?? adapter.recoveryPath?.() ?? '', false);
    } finally {
      busy.value = false;
      try {
        await afterSwitch?.();
      } catch (error) {
        report(error);
      }
    }
  }
  async function leaveWorkspace(): Promise<boolean> {
    if (busy.value || !workspace.value) return false;
    busy.value = true;
    try {
      if (!(await flush())) {
        report('还有未保存的修改。请先处理保存错误，再退出工作区。');
        return false;
      }
      await beforeSwitch?.();
      await serial(async () => {
        const current = workspace.value;
        if (!current) return;
        queueSession();
        await journalTask;
        if (!detachedTabId) await adapter.close?.(current.id);
        sessionReady = false;
        stopWatching();
        pluginHost.dispose();
        workspace.value = null;
        documents.value = [];
        tabIds.value = [];
        activeId.value = '';
        resetTabNavigation();
        objects.value = []; objectErrors.value = [];
        installedPlugins.value = []; pluginError.value = '';
        relations.value = []; relationBase = null; relationError.value = '';
        capabilities.value = structuredClone(defaultCapabilities);
        capabilityBase = null; capabilityError.value = '';
        activities.value = [];
        recovery.value = null; recoveryPreview.value = null; recoveryError.value = '';
        sessionError.value = '';
        sessionBlocked = false;
        fatal.value = '';
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
  async function restoreSession(saved: WorkspaceSession) {
    const remapped = new Map<string, string>();
    for (const tab of saved.documents) {
      const file =
        workspace.value!.files.find((entry) => entry.id === tab.id) ??
        workspace.value!.files.find((entry) => entry.path === tab.path && entry.kind === 'file');
      if (!tab.draft) {
        if (file) {
          try {
            await openInternal(file);
            remapped.set(tab.id, file.id);
          } catch (error) {
            report(error);
          }
        }
        continue;
      }
      const doc: OpenDocument = {
        id: file?.id ?? tab.id,
        path: file?.path ?? tab.path,
        content: tab.draft.content,
        base: tab.draft.base,
        saving: false,
        missing: !file,
      };
      documents.value.push(doc);
      remapped.set(tab.id, doc.id);
      activity('已恢复未保存草稿', doc.path, 'file');
      if (file) {
        try {
          await reconcile(doc, await adapter.read(file.path));
          await saveInternal(doc);
        } catch (error) {
          doc.error = String(error);
          report(error);
        }
      } else doc.error = '原文件已不存在，恢复草稿已保留，请另存副本';
    }
    const restored = saved.tabs
      ?.map((id) => remapped.get(id) ?? id)
      .filter((id) => isUtilityTab(id) || documents.value.some((doc) => doc.id === id));
    tabIds.value = [...new Set([...(restored ?? []), ...documents.value.map((doc) => doc.id)])];
    const restoredActive = remapped.get(saved.activeId) ?? saved.activeId;
    activeId.value = tabIds.value.includes(restoredActive)
      ? restoredActive
      : (tabIds.value[0] ?? '');
    for (const tabId of tabIds.value) ensureTabNavigation(tabId, tabId);
    touchNavigation();
  }
  async function openInternal(file: FileEntry, replaceId?: string) {
    if (!isMarkdown(file.path) || file.kind !== 'file') return;
    let doc = documents.value.find((d) => d.id === file.id);
    if (doc) {
      const sourceIndex = tabIds.value.indexOf(doc.id);
      const targetIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
        const reordered = [...tabIds.value];
        if (replaceId?.startsWith('blank:')) {
          reordered[targetIndex] = doc.id;
          reordered.splice(sourceIndex, 1);
        } else {
          [reordered[targetIndex], reordered[sourceIndex]] = [
            reordered[sourceIndex],
            reordered[targetIndex],
          ];
        }
        const byId = new Map(documents.value.map((entry) => [entry.id, entry]));
        documents.value = reordered.flatMap((id) => byId.get(id) ?? []);
        tabIds.value = reordered;
      }
    } else {
      const snapshot = await adapter.read(file.path);
      doc = {
        id: file.id,
        path: file.path,
        content: snapshot.content,
        base: snapshot,
        saving: false,
        missing: false,
      };
      const replaceIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (replaceIndex >= 0) {
        const oldDocumentIndex = documents.value.findIndex((entry) => entry.id === replaceId);
        const oldDocument = documents.value[oldDocumentIndex];
        if (oldDocument && (dirty(oldDocument) || oldDocument.conflict || oldDocument.missing))
          throw new Error('当前文档仍有未保存的修改或冲突，标签页未被替换。');
        const insertIndex = tabIds.value.slice(0, replaceIndex).filter((id) => !isUtilityTab(id)).length;
        if (oldDocumentIndex >= 0) documents.value.splice(oldDocumentIndex, 1, doc);
        else documents.value.splice(insertIndex, 0, doc);
        tabIds.value.splice(replaceIndex, 1, doc.id);
      } else {
        documents.value.push(doc);
        tabIds.value.push(doc.id);
      }
    }
    activeId.value = doc.id;
  }
  async function openFile(file: FileEntry, options?: { historyIndex?: number }) {
    try {
      if (!isMarkdown(file.path) || file.kind !== 'file') return;
      const replaceId = isUtilityTab(activeId.value) && !activeId.value.startsWith('blank:') ? undefined : activeId.value;
      const wasOpen = documents.value.some((doc) => doc.id === file.id);
      const current = documents.value.find((doc) => doc.id === replaceId);
      if (!documents.value.some((doc) => doc.id === file.id) && current) {
        if (dirty(current) && !(await flush())) {
          report('此文档尚未保存，请先处理保存错误。');
          return;
        }
        if (current.conflict || current.missing) {
          report('请先处理当前文档的冲突或缺失，再替换标签页。');
          return;
        }
        await beforeCloseDocument?.(current.id);
        if (dirty(current) && !(await flush())) {
          report('此文档尚未保存，请先处理保存错误。');
          return;
        }
        if (current.conflict || current.missing) {
          report('请先处理当前文档的冲突或缺失，再替换标签页。');
          return;
        }
      }
      await serial(() => openInternal(file, activeId.value === replaceId ? replaceId : undefined));
      if (!wasOpen && replaceId && activeId.value === file.id)
        recordTabNavigation(replaceId, file.id, options?.historyIndex);
      else if (!replaceId && activeId.value === file.id)
        ensureTabNavigation(file.id, file.id);
    } catch (e) {
      report(e);
    }
  }
  async function openFileInNewTab(file: FileEntry) {
    try {
      await serial(() => openInternal(file));
      if (activeId.value === file.id) ensureTabNavigation(file.id, file.id);
    } catch (error) {
      report(error);
      if (isRecoveryError(error)) await openRecovery(workspace.value?.path ?? '', false);
    }
  }
  function createBlankTab() {
    if (!workspace.value) return;
    const id = `blank:${crypto.randomUUID()}`;
    tabIds.value.push(id);
    activeId.value = id;
    ensureTabNavigation(id, id);
    touchNavigation();
  }
  function openGraphTab() {
    if (!workspace.value) return;
    if (!tabIds.value.includes(GRAPH_TAB_ID)) tabIds.value.push(GRAPH_TAB_ID);
    activeId.value = GRAPH_TAB_ID;
    ensureTabNavigation(GRAPH_TAB_ID);
    touchNavigation();
  }
  function openPluginsTab() {
    if (!workspace.value) return;
    if (!tabIds.value.includes(PLUGINS_TAB_ID)) tabIds.value.push(PLUGINS_TAB_ID);
    activeId.value = PLUGINS_TAB_ID;
    ensureTabNavigation(PLUGINS_TAB_ID);
    touchNavigation();
  }
  // Serialize adapter reads with workspace switches. The graph never writes
  // content, and open drafts take precedence over the filesystem snapshot.
  function readGraphDocument(expectedWorkspace: Pick<Workspace, 'id' | 'path'>, file: Pick<FileEntry, 'id' | 'path'>) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace.id || workspace.value.path !== expectedWorkspace.path)
        throw new Error('工作区已切换');
      const entry = workspace.value.files.find(entry => entry.id === file.id && entry.path === file.path);
      if (!entry || entry.kind !== 'file' || !isMarkdown(entry.path)) throw new Error('文档已移动或删除');
      const draft = documents.value.find(doc => doc.id === file.id);
      if (draft) return draft.content;
      const snapshot = await adapter.read(entry.path);
      return documents.value.find(doc => doc.id === file.id)?.content ?? snapshot.content;
    });
  }
  function edit(content: string) {
    if (active.value) editDocument(active.value.id, content);
  }
  function editDocument(id: string, content: string) {
    const doc = documents.value.find((document) => document.id === id);
    if (!doc || doc.conflict || workspace.value?.readOnly) return;
    doc.content = content;
    doc.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
  }
  async function reconcile(doc: OpenDocument, disk: FileSnapshot) {
    if (doc.conflict) {
      doc.conflict.disk = disk;
      return;
    }
    if (disk.hash === doc.base.hash) return;
    const change = { before: doc.base.content, after: disk.content };
    const merge = mergeMarkdown(doc.base.content, doc.content, disk.content);
    if (merge.clean) {
      doc.content = merge.content;
      doc.base = disk;
      doc.missing = false;
      doc.error = undefined;
      activity('外部修改已载入', doc.path, 'external', change);
    } else {
      const copyPath = doc.path.replace(
        /\.(md|markdown)$/i,
        `.conflict-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}.md`,
      );
      // Freeze editing before the asynchronous copy so further keystrokes cannot be lost.
      doc.conflict = { copyPath, disk };
      try {
        await adapter.create(copyPath, doc.content);
      } catch (error) {
        doc.conflict = undefined;
        throw error;
      }
      workspace.value = await adapter.refresh();
      activity('修改发生冲突，已保留副本', copyPath, 'conflict', {
        before: disk.content,
        after: doc.content,
      });
    }
  }
  async function saveInternal(doc: OpenDocument) {
    if (!dirty(doc) || doc.conflict || doc.missing) return;
    doc.saving = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const content = doc.content;
        const result = await adapter.write(doc.path, content, doc.base.hash);
        if (result.status === 'saved') {
          const change = { before: doc.base.content, after: result.snapshot.content };
          doc.base = result.snapshot;
          doc.error = undefined;
          activity('文档已保存', doc.path, 'save', change);
          return;
        }
        if (result.status === 'missing') {
          doc.missing = true;
          doc.error = '文件已在外部删除，请另存副本';
          return;
        }
        await reconcile(doc, result.snapshot);
        if (doc.conflict || !dirty(doc)) return;
      }
      doc.error = '文件正在被频繁修改，自动保存已暂停。请稍后按 Ctrl + S 重试。';
    } catch (error) {
      doc.error = String(error);
      report(error);
    } finally {
      doc.saving = false;
    }
  }
  async function flush(): Promise<boolean> {
    clearTimeout(saveTimer);
    const saved = await serial(async () => {
      for (const doc of documents.value) await saveInternal(doc);
      return documents.value.every((doc) => !dirty(doc) || !!doc.conflict);
    });
    await journalTask;
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
        if (workspace.value.backupWarning) report(workspace.value.backupWarning);
        await refreshCapabilities();
        await refreshObjects();
        for (const doc of documents.value) {
          const entry = workspace.value.files.find((f) => f.id === doc.id);
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
        }
      });
    } catch (error) {
      report(error);
      if (isRecoveryError(error)) await openRecovery(workspace.value?.path ?? '', false);
    }
  }
  async function createInternal(
    path: string,
    folder = false,
    content?: string,
    expectedWorkspaceId?: string,
  ) {
    writable();
    if (expectedWorkspaceId && workspace.value?.id !== expectedWorkspaceId)
      throw new Error('工作空间已切换，请在原工作空间中恢复历史内容');
    if (folder) await adapter.createFolder(path);
    else await adapter.create(path, content ?? '');
    workspace.value = await adapter.refresh();
    activity(folder ? '文件夹已创建' : '文档已创建', path, 'file');
    const file = workspace.value.files.find((f) => f.path === path);
    if (file && !folder) {
      const replaceId = activeId.value.startsWith('blank:') ? activeId.value : undefined;
      await openInternal(file, replaceId);
      if (replaceId) recordTabNavigation(replaceId, file.id);
      else ensureTabNavigation(file.id, file.id);
    }
  }
  async function create(
    path: string,
    folder = false,
    content?: string,
    expectedWorkspaceId?: string,
  ) {
    await serial(() => createInternal(path, folder, content, expectedWorkspaceId));
  }
  async function createUntitledEntry(parent: string, folder: boolean) {
    await serial(async () => {
      writable();
      if (!workspace.value) throw new Error('请先打开一个工作空间');
      workspace.value = await adapter.refresh();
      if (parent && !workspace.value.files.some((file) => file.kind === 'directory' && file.path === parent))
        throw new Error('目标文件夹不存在，请重新选择后重试');
      const paths = new Set(workspace.value.files.map((file) => pathKey(file.path)));
      const prefix = `${parent ? `${parent}/` : ''}${folder ? '新建文件夹' : '新建文档'}`;
      const extension = folder ? '' : '.md';
      let path = `${prefix}${extension}`;
      for (let index = 2; paths.has(pathKey(path)); index++) path = `${prefix} ${index}${extension}`;
      await createInternal(path, folder);
    });
  }
  async function createUntitledDocument(parent = '') {
    await createUntitledEntry(parent, false);
  }
  async function createUntitledFolder(parent = '') {
    await createUntitledEntry(parent, true);
  }
  async function renameEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, path: string) {
    writable();
    if (isWeb && (file.kind !== 'file' || !isMarkdown(file.path)))
      throw new Error('在线工作区只能重命名 Markdown 文档');
    if (!(await flush())) throw new Error('请先处理未保存的修改');
    await serial(async () => {
      workspace.value = await adapter.refresh();
      if (!workspace.value?.files.some((entry) => entry.id === file.id && entry.path === file.path))
        throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      if (
        workspace.value.files.some(
          (entry) => entry.id !== file.id && pathKey(entry.path) === pathKey(path),
        )
      )
        throw new Error('已经存在一个同名文件');
      const withinSource = (entryPath: string) =>
        entryPath === file.path ||
        (file.kind === 'directory' && entryPath.startsWith(`${file.path}/`));
      const affected = workspace.value.files.filter(
        (entry) => entry.kind === 'file' && withinSource(entry.path),
      );
      const affectedIds = new Set(affected.map((entry) => entry.id));
      if (documents.value.some((doc) => affectedIds.has(doc.id) && (doc.conflict || doc.missing)))
        throw new Error('请先处理重命名范围内文档的冲突或缺失');
      if (file.kind === 'file' && isMarkdown(file.path)) await adapter.rename(file.path, path);
      else await adapter.move(file.path, path, file.kind);
      workspace.value = await adapter.refresh();
      for (const doc of documents.value.filter((entry) => affectedIds.has(entry.id))) {
        const current = workspace.value.files.find((entry) => entry.id === doc.id);
        if (!current) {
          doc.missing = true;
          continue;
        }
        doc.path = current.path;
        await reconcile(doc, await adapter.read(current.path));
      }
      activity('条目已重命名', `${file.path} → ${path}`, 'file');
    });
  }
  async function rename(doc: OpenDocument, path: string) {
    return renameEntry({ id: doc.id, path: doc.path, kind: 'file' }, path);
  }
  async function moveEntry(file: FileEntry, folder: string, expectedWorkspaceId?: string) {
    writable();
    if (!(await flush())) throw new Error('请先处理未保存的修改');
    await serial(async () => {
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新拖动');
      workspace.value = await adapter.refresh();
      const { destination, moved } = planFileMove(file, folder, workspace.value.files);
      const movedIds = new Set(
        moved.filter((item) => item.entry.kind === 'file').map((item) => item.entry.id),
      );
      if (documents.value.some((doc) => movedIds.has(doc.id) && (doc.conflict || doc.missing)))
        throw new Error('请先处理移动范围内文档的冲突或缺失');
      let moveError: unknown;
      try {
        await adapter.move(file.path, destination, file.kind);
      } catch (error) {
        moveError = error;
      }
      try {
        workspace.value = await adapter.refresh();
        for (const doc of documents.value.filter((entry) => movedIds.has(entry.id))) {
          const current = workspace.value.files.find((entry) => entry.id === doc.id);
          if (!current) {
            doc.missing = true;
            continue;
          }
          doc.path = current.path;
          doc.missing = false;
          await reconcile(doc, await adapter.read(current.path));
        }
      } catch (error) {
        if (!moveError) throw error;
        report(error);
      }
      if (moveError) throw moveError;
      activity(
        file.kind === 'directory' ? '文件夹已移动' : '文件已移动',
        `${file.path} → ${destination}`,
        'file',
      );
    });
  }
  async function duplicateEntry(file: FileEntry, expectedWorkspaceId?: string) {
    writable();
    if (!adapter.duplicate) throw new Error('当前工作区不支持创建副本');
    if (!(await flush())) throw new Error('请先处理未保存的修改');
    return serial(async () => {
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新创建副本');
      workspace.value = await adapter.refresh();
      if (!workspace.value.files.some((entry) => entry.id === file.id && entry.path === file.path))
        throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      const withinSource = (path: string) =>
        path === file.path || (file.kind === 'directory' && path.startsWith(`${file.path}/`));
      if (documents.value.some((doc) => withinSource(doc.path) && (doc.conflict || doc.missing)))
        throw new Error('请先处理复制范围内文档的冲突或缺失');
      let destination: string | undefined;
      let duplicateError: unknown;
      try {
        destination = await adapter.duplicate!(workspace.value.id, file.path);
      } catch (error) {
        duplicateError = error;
      }
      workspace.value = await adapter.refresh();
      if (duplicateError) throw duplicateError;
      if (!destination) throw new Error('创建副本没有返回目标路径');
      activity('已创建副本', `${file.path} → ${destination}`, 'file');
      return destination;
    });
  }
  async function saveCopy(doc: OpenDocument, path: string) {
    const content = doc.content;
    await create(path, false, content);
    if (doc.missing && doc.content === content) {
      documents.value = documents.value.filter((d) => d.id !== doc.id);
      tabIds.value = tabIds.value.filter((id) => id !== doc.id);
    }
  }
  async function removeEntries(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
    expectedContents?: FileEntry[],
  ) {
    writable();
    if (!files.length) return;
    if (files.some((file) => isWeb && (file.kind !== 'file' || !isMarkdown(file.path))))
      throw new Error('在线工作区只能移除 Markdown 文档');
    if (files.some((file) => mobile && file.kind === 'directory'))
      throw new Error('手机回收站暂不支持文件夹');
    const locallyModified = new Set(
      documents.value.filter((doc) => dirty(doc)).map((doc) => doc.id),
    );
    if (!(await flush())) throw new Error('请先处理未保存的修改');
    await serial(async () => {
      workspace.value = await adapter.refresh();
      if (!workspace.value || (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId))
        throw new Error('工作空间已切换，请重新选择文件');
      const roots = topLevelEntries(files);
      for (const file of roots) {
        if (!workspace.value.files.some((entry) => entry.id === file.id && entry.path === file.path))
          throw new Error('文件位置已变化，目录已自动更新，请重新选择后重试');
      }
      const withinRoots = (path: string) =>
        roots.some(
          (file) =>
            path === file.path || (file.kind === 'directory' && path.startsWith(`${file.path}/`)),
        );
      if (expectedContents) {
        const expected = expectedContents.filter((entry) => withinRoots(entry.path));
        const current = workspace.value.files.filter((entry) => withinRoots(entry.path));
        if (
          expected.length !== current.length ||
          current.some(
            (entry) =>
              !expected.some(
                (old) =>
                  old.id === entry.id &&
                  old.path === entry.path &&
                  (entry.kind === 'directory' ||
                    locallyModified.has(entry.id) ||
                    (old.modified === entry.modified && old.size === entry.size)),
              ),
          )
        )
          throw new Error('所选条目内容已变化，目录已自动更新，请核对后重试');
      }
      if (documents.value.some((doc) => withinRoots(doc.path) && (doc.conflict || doc.missing)))
        throw new Error('请先处理所选文档的冲突或缺失');
      let removed = 0;
      for (const file of roots) {
        try {
          await adapter.remove(file.path);
        } catch (error) {
          workspace.value = await adapter.refresh();
          throw new Error(
            `${removed ? `已移除 ${removed} 项；` : ''}处理「${file.path}」失败：${error instanceof Error ? error.message : String(error)}`,
          );
        }
        removed++;
        documents.value = documents.value.filter((doc) =>
          doc.path !== file.path && !(file.kind === 'directory' && doc.path.startsWith(`${file.path}/`)),
        );
        const previousTabIds = [...tabIds.value];
        const remainingIds = new Set(documents.value.map((doc) => doc.id));
        tabIds.value = tabIds.value.filter((id) => isUtilityTab(id) || remainingIds.has(id));
        for (const tabId of previousTabIds)
          if (!tabIds.value.includes(tabId)) removeTabNavigation(tabId);
        if (activeId.value && !tabIds.value.includes(activeId.value))
          activeId.value = tabIds.value.at(-1) ?? '';
        workspace.value = await adapter.refresh();
        activity(
          isDemo ? '演示条目已删除' : isWeb ? '在线文档已删除' : '条目已移入回收站',
          file.path,
          'file',
        );
      }
    });
  }
  async function removeEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>) {
    return removeEntries([file]);
  }
  async function remove(doc: OpenDocument) {
    return removeEntry({ id: doc.id, path: doc.path, kind: 'file' });
  }
  function moveDocument(id: string, targetId: string, side: 'before' | 'after') {
    if (id === targetId) return;
    if (!tabIds.value.includes(id) || !tabIds.value.includes(targetId)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    const targetIndex = reordered.indexOf(targetId);
    reordered.splice(targetIndex + (side === 'after' ? 1 : 0), 0, id);
    if (reordered.every((tabId, index) => tabId === tabIds.value[index])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    documents.value = reordered.flatMap((tabId) => byId.get(tabId) ?? []);
    tabIds.value = reordered;
  }
  function placeTab(id: string, index: number) {
    if (!tabIds.value.includes(id)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    reordered.splice(Math.max(0, Math.min(index, reordered.length)), 0, id);
    if (reordered.every((tabId, position) => tabId === tabIds.value[position])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    documents.value = reordered.flatMap((tabId) => byId.get(tabId) ?? []);
    tabIds.value = reordered;
  }
  async function close(id: string) {
    if (isUtilityTab(id)) {
      tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
      removeTabNavigation(id);
      if (activeId.value === id) activeId.value = tabIds.value.at(-1) ?? '';
      return;
    }
    await flush();
    try {
      await beforeCloseDocument?.(id);
    } catch (error) {
      report(error);
      return;
    }
    const doc = documents.value.find((d) => d.id === id);
    if (doc && dirty(doc) && !doc.conflict) {
      report('此文档尚未保存，请先另存副本或解决保存错误。');
      return;
    }
    documents.value = documents.value.filter((d) => d.id !== id);
    tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
    removeTabNavigation(id);
    if (activeId.value === id) activeId.value = tabIds.value.at(-1) ?? '';
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
        const file = workspace.value.files.find((f) => f.path === copy);
        if (file) {
          await openInternal(file);
          ensureTabNavigation(file.id, file.id);
          touchNavigation();
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
    pluginHost.dispose();
    if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged);
    stopSessionWatch();
    stopWatching();
    clearTimeout(saveTimer);
  }
  async function preserveDraft(id: string, content: string) {
    return serial(async () => {
      const doc = documents.value.find((document) => document.id === id);
      if (!doc || !workspace.value) throw new Error('原文档已关闭');
      const path = doc.path.replace(
        /\.(md|markdown)$/i,
        `.recovered-${Date.now()}-${crypto.randomUUID().slice(0, 8)}.md`,
      );
      await adapter.create(path, content);
      workspace.value = await adapter.refresh();
      activity('恢复副本已保留', path, 'conflict');
      return path;
    });
  }
  return {
    installedPlugins,
    pluginError,
    changePlugin,
    relations,
    relationError,
    relationDefinitions,
    relationIndex,
    createRelation,
    removeRelation,
    objects, objectErrors, objectDefinitions, referenceTargets, createObject, updateObject,
    capabilities,
    capabilityError,
    capabilitySaving,
    updateCapabilities,
    workspace,
    documents,
    tabs,
    activeId,
    active,
    canGoBack,
    canGoForward,
    navigateHistory,
    activities,
    notice,
    fatal,
    recovery,
    recoveryPreview,
    recoveryError,
    recoveryBusy,
    busy,
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
    createWorkspace: (name: string) => openWorkspace(undefined, name),
    openFile,
    openFileInNewTab,
    createBlankTab,
    openGraphTab,
    openPluginsTab,
    readGraphDocument,
    edit,
    editDocument,
    preserveDraft,
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
    search: (query: string) =>
      serial(() =>
        workspace.value && adapter.search
          ? adapter.search(workspace.value.id, query)
          : Promise.resolve([]),
      ),
    create,
    createUntitledDocument,
    createUntitledFolder,
    saveCopy,
    rename,
    renameEntry,
    moveEntry,
    duplicateEntry,
    remove,
    removeEntry,
    removeEntries,
    moveDocument,
    placeTab,
    close,
    resolveConflict,
    reveal,
    dispose,
    report,
    openRecovery,
    previewRecovery,
    restoreRecovery,
    exportFullArchive,
    importFullArchive,
    closeRecovery: () => { recovery.value = null; recoveryPreview.value = null; recoveryError.value = ''; },
  };
});
