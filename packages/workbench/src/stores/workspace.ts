import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import type {
  FileEntry,
  FileSnapshot,
  Workspace,
  WorkspaceSession,
  WorkspaceLayout,
  RecentWorkspace,
} from '@tano/protocol';
import { basename, isMarkdown, pathKey, objectDirectory, validatePath, assistantRulesPath, isWorkspaceInternalPath } from '@tano/protocol';
import { mergeMarkdown } from '@tano/markdown';
import { useWorkbenchRuntime } from '../runtime';
import type { WorkbenchViewTab } from '../runtime';
import { planFileMove } from '../file-move';
import { topLevelEntries } from '../file-selection';
import { defaultCapabilities } from '@tano/editor/runtime';
import { loadCapabilities, saveCapabilityPatch } from '../workspace-capabilities';
import type { CapabilityPatch } from '../workspace-capabilities';
import { loadObjects, saveObject, mergeObject } from '../workspace-objects';
import type { ObjectRecord } from '../workspace-objects';
import { assetTargets, documentTargets, parseObject, objectTypeRegistry, validateObjectProperties } from '@tano/protocol';
import type { WorkspaceObject, ReferenceTarget } from '@tano/protocol';
import { coreRelationTypes, newShortId, RelationIndex, referenceKey, relationKey, validateRelation, parseRelations, workspaceRelationPath, WorkspaceAccessRevokedError } from '@tano/protocol';
import type { ReferenceIdentity, WorkspaceRelation } from '@tano/protocol';
import { PLUGINS_TAB_ID, WorkspacePluginHost } from '../workspace-plugins';
import type { InstalledObjectPlugin, PluginChange } from '../workspace-plugins';
import { loadRelations, saveRelationChange } from '../workspace-relations';
import type { RelationChange } from '../workspace-relations';
import { contentReferences, referenceContext } from '../content-references';
import { GRAPH_TAB_ID } from '../document-graph';
import { CALENDAR_TAB_ID } from '../calendar';
import { dockLayout, layoutPanes, newPane, reconcileLayout, restoreLayout } from '../pane-layout';
import type { PaneDrop } from '../pane-layout';
import { DocumentLayoutConflict, loadDocumentLayout, layoutDirty, saveDocumentLayout } from '../workspace-document-layout';
import type { DocumentLayoutState } from '../workspace-document-layout';
import type { TableLayout } from '@tano/protocol';
import type { AssistantProposal, AssistantPreview, AssistantSource, AssistantToolCall } from '@tano/protocol';
import { assistantHash } from '../assistant/hash';
import { structureProposal, mergeStructureRelations, validateTaskUpdate } from '../assistant/structures';
import { parseTaskQuery, queryTasks } from '../assistant/tasks';
import type { TaskQuery } from '../assistant/tasks';
import type { StructureSnapshot } from '../assistant/structures';
import { writeWorkspaceImport } from '../workspace-import';
import type { PreparedImport } from '../document-import';
import { loadTemplates, saveTemplate } from '../workspace-templates';
import type { DocumentTemplate } from '../workspace-templates';
import { previewTaskRepeat, repeatRelations } from '../task-repeat';
import type { RepeatPreview } from '../task-repeat';
import { loadSuggestions, saveSuggestions } from '../workspace-suggestions';
import type { SuggestionState } from '../workspace-suggestions';
import type { DocumentSuggestion } from '@tano/protocol';
import { locateSuggestion } from '../document-suggestions';

export interface OpenDocument {
  id: string;
  path: string;
  content: string;
  base: FileSnapshot;
  saving: boolean;
  missing: boolean;
  conflict?: { copyPath: string; disk: FileSnapshot };
  error?: string;
  tableLayout?: DocumentLayoutState;
}
export interface DocumentTab {
  id: string;
  path: string;
  blank: boolean;
  graph: boolean;
  plugins: boolean;
  calendar: boolean;
  view?: WorkbenchViewTab;
  document?: OpenDocument;
  attachmentPreview: boolean;
  attachment?: FileEntry;
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
  const views = shallowRef<ReadonlyMap<string, WorkbenchViewTab>>(new Map());
  const isNavigationPage = (id: string) => id === GRAPH_TAB_ID || id === PLUGINS_TAB_ID;
  const isBuiltinTab = (id: string) => id.startsWith('blank:') || id.startsWith('attachment:') || id === GRAPH_TAB_ID || id === PLUGINS_TAB_ID || id === CALENDAR_TAB_ID;
  const isUtilityTab = (id: string) => isBuiltinTab(id) || views.value.has(id);
  function registerViews(definitions: readonly WorkbenchViewTab[]) {
    const next = new Map<string, WorkbenchViewTab>();
    for (const { id, label, icon, detachable, detachBlockedMessage } of definitions) {
      if (!/^view:[a-z][a-z0-9-]*$/.test(id) || isBuiltinTab(id) || next.has(id) || !label.trim())
        throw new Error(`无效或重复的扩展视图：${id}`);
      next.set(id, { id, label, icon, detachable, detachBlockedMessage });
    }
    // Register before session restoration. Refuse to strand an already open view.
    if (tabIds.value.some(id => views.value.has(id) && !next.has(id)))
      throw new Error('请先关闭扩展标签页，再移除视图');
    views.value = next;
  }
  const workspace = ref<Workspace | null>(null);
  const assistantEpoch = ref(0);
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
      const definition = objectDefinitions.value.find((entry) => entry.type === object.type)
        ?? objectTypeRegistry.get(object.type);
      if (definition?.storage !== 'record') return false;
      if (definition.retired) return true;
      try { validateObjectProperties(object.type, object.properties); return true; } catch { return false; }
    }).map(({ object, path }) => ({ workspace: workspace.value!.id, type: object.type, id: object.id, name: object.name, description: object.description, archived: object.archived, path, properties: object.properties })),
  ] : []);
  const referenceRevision = computed(() => JSON.stringify([workspace.value?.id, workspace.value?.path,
    workspace.value?.files.map(file => [file.id, file.path, file.modified, file.size]),
    documents.value.map(doc => [doc.id, doc.content]), objects.value.map(record => [record.object.id, record.object.description, record.object.name, record.object.archived])]));
  const referenceDocumentCache = new Map<string, { stamp: string; content: string }>();
  function clearRevokedReferences(error: unknown) {
    if (!(error instanceof WorkspaceAccessRevokedError)) return;
    if (workspace.value) workspace.value = { ...workspace.value, files: [], readOnly: true };
    objects.value = []; relations.value = []; relationBase = null;
    referenceDocumentCache.clear();
  }
  async function refreshObjects() {
    if (!workspace.value) return;
    referenceDocumentCache.clear();
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
      const added = 'add' in change ? [change.add] : 'replace' in change ? change.replace.next : [];
      for (const row of added) {
        validateRelation(row, relationDefinitions.value);
        for (const endpoint of [row.source, row.target])
          if (!referenceTargets.value.some((target) => referenceKey(target) === referenceKey(endpoint) && !target.archived))
            throw new Error('关系端点不存在、已归档或插件未启用');
      }
      const saved = await saveRelationChange(adapter, relationBase, change);
      relationBase = saved.snapshot; relations.value = saved.file.relations;
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity('关系已更新', 'add' in change ? change.add.type : 'remove' in change ? change.remove.type : change.replace.type, 'save');
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
  function setRelationSource(type: string, target: ReferenceIdentity, source: ReferenceIdentity | null) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    const previous: WorkspaceRelation[] = JSON.parse(JSON.stringify(relations.value.filter(row =>
      row.type === type && referenceKey(row.target) === referenceKey(target))));
    const existing = source && previous.find(row => referenceKey(row.source) === referenceKey(source));
    const next = source ? [existing ?? {
      id: newShortId(new Set(relations.value.map(row => row.id))), type, source, target,
    }] : [];
    return editRelation({ replace: { type, target, previous, next } }, workspaceId);
  }
  async function createObject(draft: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>) {
    // New tasks use the event model. Existing task files retain their identity and references.
    if (draft.type === 'task') draft = {
      ...draft,
      type: 'event',
      properties: { ...draft.properties, checkable: true, completed: draft.properties.completed === true || ['done', 'completed'].includes(String(draft.properties.status)) },
    };
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
  async function templates(expectedWorkspace: string) {
    if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
    const current = await adapter.refresh();
    const loaded = await loadTemplates(adapter, current);
    if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
    return loaded;
  }
  async function writeTemplate(content: string, expectedWorkspace: string, base?: DocumentTemplate) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换，模板草稿已保留');
      writable();
      workspace.value = await adapter.refresh();
      const path = await saveTemplate(adapter, content, base, new Set(workspace.value.files.map(file => file.path.split('/').at(-1)!.slice(0, 6))));
      workspace.value = await adapter.refresh(); return path;
    });
  }
  async function repeatPreview(record: ObjectRecord, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
      writable(); workspace.value = await adapter.refresh(); await refreshObjects();
      const current = objects.value.find(item => item.object.id === record.object.id);
      if (!current || current.snapshot.hash !== record.snapshot.hash) throw new Error('任务已变化，请重新读取再创建下一次');
      const series = objects.value.find(item => item.object.id === (current.object.properties.repeatSourceId ?? current.object.id));
      if (!series) throw new Error('重复任务来源已不可用');
      return previewTaskRepeat(current, relations.value, series);
    });
  }
  async function createRepeat(preview: RepeatPreview, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
      writable(); workspace.value = await adapter.refresh(); await refreshObjects();
      if (objectErrors.value.length || relationError.value) throw new Error('请先处理对象或关系读取错误');
      const source = objects.value.find(item => item.object.id === preview.sourceId);
      if (!source || source.snapshot.hash !== preview.sourceHash || JSON.stringify(repeatRelations(source.object, relations.value)) !== preview.relationBase)
        throw new Error('任务或关联已变化，请重新预览');
      const series = objects.value.find(item => item.object.id === preview.seriesId);
      if (!series || series.snapshot.hash !== preview.seriesHash) throw new Error('重复规则已变化，请重新预览');
      const recomputed = await previewTaskRepeat(source, relations.value, series);
      if (JSON.stringify(recomputed) !== JSON.stringify(preview)) throw new Error('重复任务预览已失效');
      const content = JSON.stringify(preview.object, null, 2) + '\n';
      let saved = objects.value.find(item => item.object.id === preview.object.id);
      if (saved && (saved.object.properties.repeatSourceId !== preview.object.properties.repeatSourceId || saved.object.properties.repeatOccurrence !== preview.object.properties.repeatOccurrence))
        throw new Error('下一次任务身份发生冲突，已有文件未改动');
      if (saved && JSON.stringify(saved.object) !== JSON.stringify(preview.object)) return saved;
      for (const row of preview.relations) for (const endpoint of [row.source, row.target]) {
        if (referenceKey(endpoint) === referenceKey(preview.object)) continue;
        if (!referenceTargets.value.some(target => !target.archived && referenceKey(target) === referenceKey(endpoint))) throw new Error('关联目标已不可用');
      }
      try {
        if (!saved) {
          if (workspace.value.files.some(file => file.id === preview.object.id)) throw new Error('下一次任务身份与文件冲突');
          await adapter.create(`${objectDirectory}/${preview.object.id}.tano.json`, content);
        }
        for (const row of preview.relations) {
          if (relations.value.some(existing => relationKey(existing) === relationKey(row))) continue;
          if (row.type === 'assigned' && relations.value.some(existing => existing.type === 'assigned' && referenceKey(existing.target) === referenceKey(row.target)))
            throw new Error('下一次任务负责人已变化，请检查已有任务');
          const result = await saveRelationChange(adapter, relationBase, { add: row });
          relationBase = result.snapshot; relations.value = result.file.relations;
        }
      } finally { workspace.value = await adapter.refresh(); await refreshObjects(); }
      saved = objects.value.find(item => item.object.id === preview.object.id);
      if (!saved) throw new Error('下一次任务已被移除，请刷新');
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
  const layout = ref<WorkspaceLayout>(newPane());
  const panes = computed(() => layoutPanes(layout.value));
  const activePaneId = ref(layout.value.id);
  const paneDrop = ref<PaneDrop>();
  // Presentation only: keep the real tab/session until its new window is ready.
  const detachingTabId = ref('');
  let changingLayout = false;
  watch(() => [...tabIds.value], (ids, previous) => {
    if (changingLayout) return;
    layout.value = reconcileLayout(layout.value, ids, previous, activePaneId.value);
    if (!panes.value.some(pane => pane.id === activePaneId.value)) activePaneId.value = panes.value[0].id;
  }, { flush: 'sync' });
  watch(activeId, id => {
    const pane = panes.value.find(pane => pane.tabs.includes(id));
    if (pane) { pane.activeId = id; activePaneId.value = pane.id; }
  }, { flush: 'sync' });
  function focusPane(id: string) {
    const pane = panes.value.find(pane => pane.id === id);
    if (!pane) return;
    activePaneId.value = pane.id;
    activeId.value = pane.activeId;
  }
  function dockTab(id: string, drop: PaneDrop) {
    const before = layout.value;
    const priorActive = activeId.value;
    const origin = panes.value.find(pane => pane.tabs.includes(id));
    const next = dockLayout(layout.value, id, drop);
    paneDrop.value = undefined;
    if (next === layout.value) return;
    changingLayout = true;
    layout.value = next;
    tabIds.value = panes.value.flatMap(pane => pane.tabs);
    const pane = panes.value.find(pane => pane.tabs.includes(id))!;
    activePaneId.value = pane.id;
    activeId.value = id;
    changingLayout = false;
    const applied = JSON.stringify(layout.value);
    // A receiving window can undo a move if the source fails to close. Never
    // overwrite layout changes made by the user while that acknowledgement ran.
    return () => {
      if (JSON.stringify(layout.value) !== applied) {
        if (origin && panes.value.some(pane => pane.id === origin.id))
          dockTab(id, { paneId: origin.id, side: 'center', index: origin.tabs.indexOf(id) });
        return;
      }
      changingLayout = true;
      layout.value = before;
      tabIds.value = panes.value.flatMap(pane => pane.tabs);
      activeId.value = priorActive;
      activePaneId.value = panes.value.find(pane => pane.tabs.includes(priorActive))?.id ?? panes.value[0].id;
      changingLayout = false;
    };
  }
  function resizeSplit(id: string, ratio: number) {
    if (!Number.isFinite(ratio)) return;
    function resize(node: WorkspaceLayout): void {
      if (node.kind !== 'split') return;
      if (node.id === id) node.ratio = Math.max(.1, Math.min(.9, ratio));
      else { resize(node.first); resize(node.second); }
    }
    resize(layout.value);
  }
  const busy = ref(false);
  const active = computed(() => documents.value.find((d) => d.id === activeId.value));
  const tabs = computed<DocumentTab[]>(() =>
    tabIds.value.map((id) => {
      const document = documents.value.find((doc) => doc.id === id);
      const attachmentPreview = id.startsWith('attachment:');
      const attachment = attachmentPreview ? workspace.value?.files.find(file => file.id === id.slice('attachment:'.length) && file.kind === 'file') : undefined;
      return { id, path: document?.path ?? attachment?.path ?? (attachmentPreview ? '附件不可用' : ''), blank: id.startsWith('blank:'), graph: id === GRAPH_TAB_ID, plugins: id === PLUGINS_TAB_ID, calendar: id === CALENDAR_TAB_ID, view: views.value.get(id), document, attachmentPreview, attachment };
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
  function activeNavigation(tabId = activeId.value) {
    void navigationRevision.value;
    return tabId ? ensureTabNavigation(tabId) : undefined;
  }
  function navigationDestination(direction: -1 | 1, tabId = activeId.value) {
    const history = activeNavigation(tabId);
    if (!history) return -1;
    for (let index = history.index + direction;
      index >= 0 && index < history.entries.length; index += direction) {
      const id = history.entries[index];
      if (isNavigationPage(id) || tabIds.value.includes(id) || workspace.value?.files.some((file) =>
        file.id === id && file.kind === 'file' && isMarkdown(file.path))) return index;
    }
    return -1;
  }
  function canNavigateHistory(direction: -1 | 1, tabId = activeId.value) {
    return !busy.value && !navigationBusy.value && navigationDestination(direction, tabId) >= 0;
  }
  const canGoBack = computed(() => canNavigateHistory(-1));
  const canGoForward = computed(() => canNavigateHistory(1));
  async function navigateHistory(direction: -1 | 1, paneId?: string) {
    if (busy.value || navigationBusy.value) return;
    if (paneId) {
      if (!panes.value.some(pane => pane.id === paneId)) return;
      focusPane(paneId);
    }
    const index = navigationDestination(direction);
    if (index < 0) return;
    const history = activeNavigation();
    if (!history) return;
    const id = history.entries[index];
    navigationBusy.value = true;
    try {
      if (isNavigationPage(id)) await openPageTab(id, { historyIndex: index });
      else {
        const file = workspace.value?.files.find((entry) => entry.id === id);
        if (file) await openFile(file, { historyIndex: index });
      }
    } finally {
      navigationBusy.value = false;
    }
  }
  const activities = ref<Activity[]>([]);
  const notice = ref('');
  const fatal = ref('');
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
  const layoutPending = (doc: OpenDocument) => !!doc.tableLayout && layoutDirty(doc.tableLayout) &&
    doc.tableLayout.conflict?.draft !== JSON.stringify(doc.tableLayout.file);
  const suggestionPersistence = shallowRef<{ flush: () => Promise<void>; pending: () => boolean }>();
  const pending = computed(() => !!suggestionPersistence.value?.pending() || documents.value.some((d) => (dirty(d) || layoutPending(d)) && !d.conflict));
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
        layout: JSON.parse(JSON.stringify(layout.value)) as WorkspaceLayout,
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
  const stopSessionWatch = watch([documents, tabIds, activeId, layout], queueSession, {
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
  async function initialize(requestedWorkspaceId?: string) {
    if (detachedTabId && detachedWorkspacePath) await openWorkspace(detachedWorkspacePath);
    else if (isDemo || isWeb) {
      await openWorkspace(requestedWorkspaceId);
      if (!workspace.value && requestedWorkspaceId) await openWorkspace();
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
        workspace.value = next;
        assistantEpoch.value++;
        assistantApplied.clear();
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
          if (detachedTabId === GRAPH_TAB_ID) await openGraphTab({ newTab: true });
          else if (detachedTabId === PLUGINS_TAB_ID) await openPluginsTab({ newTab: true });
          else if (detachedTabId === CALENDAR_TAB_ID) openCalendarTab();
          else if (views.value.has(detachedTabId)) {
            if (!views.value.get(detachedTabId)?.detachable) throw new Error('此扩展视图不支持移到其他窗口');
            openViewTab(detachedTabId);
          }
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
        assistantEpoch.value++;
        assistantApplied.clear();
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
      await hydrateDocumentLayout(doc);
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
    layout.value = restoreLayout(saved.layout, tabIds.value, remapped);
    activePaneId.value = panes.value.find(pane => pane.tabs.includes(restoredActive))?.id ?? panes.value[0].id;
    activeId.value = tabIds.value.includes(restoredActive)
      ? restoredActive
      : (tabIds.value[0] ?? '');
    for (const tabId of tabIds.value) ensureTabNavigation(tabId, tabId);
    touchNavigation();
  }
  function activateTab(id: string, replaceId?: string, doc?: OpenDocument) {
    if (tabIds.value.includes(id)) {
      const sourcePane = panes.value.find(pane => pane.tabs.includes(id));
      const targetPane = panes.value.find(pane => pane.tabs.includes(replaceId ?? ''));
      if (sourcePane && targetPane && sourcePane.id !== targetPane.id) {
        activeId.value = id;
        return;
      }
      const sourceIndex = tabIds.value.indexOf(id);
      const targetIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (sourceIndex >= 0 && targetIndex >= 0 && sourceIndex !== targetIndex) {
        const reordered = [...tabIds.value];
        if (replaceId?.startsWith('blank:')) {
          reordered[targetIndex] = id;
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
      const replaceIndex = replaceId ? tabIds.value.indexOf(replaceId) : -1;
      if (replaceIndex >= 0) {
        const oldDocumentIndex = documents.value.findIndex((entry) => entry.id === replaceId);
        const oldDocument = documents.value[oldDocumentIndex];
        if (oldDocument && (dirty(oldDocument) || layoutPending(oldDocument) || oldDocument.conflict || oldDocument.missing))
          throw new Error('当前文档仍有未保存的修改或冲突，标签页未被替换。');
        if (doc) {
          const insertIndex = tabIds.value.slice(0, replaceIndex).filter((id) => !isUtilityTab(id)).length;
          if (oldDocumentIndex >= 0) documents.value.splice(oldDocumentIndex, 1, doc);
          else documents.value.splice(insertIndex, 0, doc);
        } else if (oldDocumentIndex >= 0) documents.value.splice(oldDocumentIndex, 1);
        tabIds.value.splice(replaceIndex, 1, id);
      } else {
        if (doc) documents.value.push(doc);
        tabIds.value.push(id);
      }
    }
    activeId.value = id;
  }
  async function openInternal(file: FileEntry, replaceId?: string) {
    if (!isMarkdown(file.path) || file.kind !== 'file') return;
    let doc = documents.value.find((d) => d.id === file.id);
    if (!doc) {
      const snapshot = await adapter.read(file.path);
      doc = {
        id: file.id,
        path: file.path,
        content: snapshot.content,
        base: snapshot,
        saving: false,
        missing: false,
      };
      await hydrateDocumentLayout(doc);
    }
    activateTab(doc.id, replaceId, doc);
  }
  async function prepareTabReplacement(id?: string) {
    if (suggestionPersistence.value?.pending() && !(await flush())) return false;
    const current = documents.value.find((doc) => doc.id === id);
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
  async function openFile(file: FileEntry, options?: { historyIndex?: number }) {
    try {
      if (!isMarkdown(file.path) || file.kind !== 'file') return;
      const replaceId = isUtilityTab(activeId.value) && !activeId.value.startsWith('blank:') && !isNavigationPage(activeId.value)
        ? undefined : activeId.value;
      const wasOpen = documents.value.some((doc) => doc.id === file.id);
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return;
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
    }
  }
  function openAttachmentInNewTab(file: FileEntry) {
    if (!workspace.value || file.kind !== 'file' || isMarkdown(file.path) ||
        !workspace.value.files.some(entry => entry.id === file.id && entry.path === file.path)) return;
    const id = `attachment:${file.id}`;
    if (!tabIds.value.includes(id)) tabIds.value.push(id);
    activeId.value = id;
    ensureTabNavigation(id);
    touchNavigation();
  }
  async function openFilesInNewTabsAt(ids: readonly string[], index: number, workspaceId: string) {
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) return;
        const files = [...new Set(ids)].map((id) => workspace.value!.files.find((file) => file.id === id));
        if (!files.length || files.some((file) => !file || file.kind !== 'file' || !isMarkdown(file.path))) return;
        // Keep a stable neighbor while reads are pending and already-open tabs move.
        const moving = new Set(ids);
        const following = tabIds.value.slice(Math.max(0, index)).filter((id) => !moving.has(id));
        for (const file of files) {
          await openInternal(file!);
          ensureTabNavigation(file!.id, file!.id);
          const target = following.find((id) => tabIds.value.includes(id));
          if (target) moveDocument(file!.id, target, 'before');
          else placeTab(file!.id, tabIds.value.length);
        }
      });
    } catch (error) {
      report(error);
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
  async function openPageTab(id: string, options?: { newTab?: boolean; historyIndex?: number }) {
    if (!workspace.value) return;
    if (options?.newTab) {
      activateTab(id);
      ensureTabNavigation(id);
      touchNavigation();
      return;
    }
    const workspaceId = workspace.value.id, epoch = assistantEpoch.value;
    const replaceId = activeId.value;
    const wasOpen = tabIds.value.includes(id);
    try {
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return;
      await serial(async () => {
        if (workspace.value?.id !== workspaceId || assistantEpoch.value !== epoch) return;
        const targetId = activeId.value === replaceId ? replaceId : undefined;
        activateTab(id, targetId);
        if (!wasOpen && targetId) recordTabNavigation(targetId, id, options?.historyIndex);
        else {
          ensureTabNavigation(id);
          touchNavigation();
        }
      });
    } catch (error) {
      report(error);
    }
  }
  function openGraphTab(options?: { newTab?: boolean; historyIndex?: number }) {
    return openPageTab(GRAPH_TAB_ID, options);
  }
  function openPluginsTab(options?: { newTab?: boolean; historyIndex?: number }) {
    return openPageTab(PLUGINS_TAB_ID, options);
  }
  function openCalendarTab() {
    if (!workspace.value) return;
    if (!tabIds.value.includes(CALENDAR_TAB_ID)) tabIds.value.push(CALENDAR_TAB_ID);
    activeId.value = CALENDAR_TAB_ID;
    ensureTabNavigation(CALENDAR_TAB_ID);
    touchNavigation();
  }
  function openViewTab(id: string) {
    if (!views.value.has(id)) throw new Error(`扩展视图未注册：${id}`);
    if (!workspace.value) return;
    if (!tabIds.value.includes(id)) tabIds.value.push(id);
    activeId.value = id;
    ensureTabNavigation(id);
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
  function getReferenceContext(identity: ReferenceIdentity, draft?: string,
    expected = workspace.value ? { id: workspace.value.id, path: workspace.value.path } : undefined) {
    return serial(async () => {
      if (!expected || workspace.value?.id !== expected.id || workspace.value.path !== expected.path)
        throw new Error('工作区已切换');
      if (adapter.mode === 'web') {
        try { workspace.value = await adapter.refresh(); await refreshObjects(); }
        catch (error) { clearRevokedReferences(error); throw error; }
      }
      const targets = referenceTargets.value.filter(target => target.type !== 'document' || !isWorkspaceInternalPath(target.path));
      if (draft !== undefined && !targets.some(target => referenceKey(target) === referenceKey(identity)))
        targets.push({ ...identity, workspace: expected.id, name: '未保存对象', path: '', description: draft });
      const contents = new Map<string, string>();
      const errors: string[] = [...objectErrors.value];
      for (const target of targets) {
        const key = referenceKey(target);
        if (target.type !== 'document') { contents.set(key, target.description ?? ''); continue; }
        try {
          const open = documents.value.find(doc => doc.id === target.id);
          const stamp = JSON.stringify([expected.id, expected.path, target.path, target.modified, target.size]);
          const cached = referenceDocumentCache.get(target.id);
          const content = open?.content ?? (cached?.stamp === stamp ? cached.content : (await adapter.read(target.path)).content);
          if (!open) referenceDocumentCache.set(target.id, { stamp, content });
          contents.set(key, content);
        } catch (error) { errors.push(`${target.path}：${String(error)}`); }
      }
      if (draft !== undefined) contents.set(referenceKey(identity), draft);
      return referenceContext(contentReferences(targets, contents), identity, errors);
    });
  }
  async function assistantReferenceContext(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, identity: ReferenceIdentity) {
    requireAssistantWorkspace(scope);
    if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
    const result = await getReferenceContext(identity, undefined, scope);
    requireAssistantWorkspace(scope);
    return result;
  }
  function edit(content: string) {
    if (active.value) editDocument(active.value.id, content);
  }
  const assistantApplied = new Map<string, { signature: string; before: string; after: string; hash: string; fileId: string }>();
  function requireAssistantWorkspace(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }) {
    if (workspace.value?.id !== scope.id || workspace.value.path !== scope.path)
      throw new Error('工作区已切换，请在原工作区恢复助手会话');
    if (scope.epoch !== undefined && scope.epoch !== assistantEpoch.value) throw new Error('工作区打开会话已变化');
  }
  async function assistantRules(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path) throw new Error('工作区身份已变化');
      const rules: { path: string; content: string }[] = [];
      for (const path of ['AGENTS.md', assistantRulesPath]) {
        if (!current.files.some(file => file.path === path && file.kind === 'file')) continue;
        const disk = await adapter.read(path);
        const content = documents.value.find(doc => doc.path === path)?.content ?? disk.content;
        if (new TextEncoder().encode(content).length > 32_000) throw new Error(`${path} 超过 32 KB，请缩短工作区助手规则`);
        rules.push({ path, content });
      }
      return rules;
    });
  }
  async function assistantStructures(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path) throw new Error('工作区身份已变化');
      workspace.value = current; await refreshObjects();
      if (objectErrors.value.length || relationError.value) throw new Error('请先处理工作区对象或关系记录错误');
      return JSON.parse(JSON.stringify({ targets: referenceTargets.value.filter(target => !isWorkspaceInternalPath(target.path) || target.type !== 'document'),
        relationTypes: relationDefinitions.value, relations: relations.value, relationContent: relationBase?.content ?? '',
        objects: objects.value.map(record => ({ object: record.object, path: record.path, content: record.snapshot.content,
          fileId: current.files.find(file => file.path === record.path)!.id })),
      })) as StructureSnapshot & { relations: WorkspaceRelation[] };
    });
  }
  async function proposeAssistantStructure(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, runId: string, call: AssistantToolCall, snapshot?: StructureSnapshot) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path) throw new Error('工作区身份已变化');
      workspace.value = current; await refreshObjects();
      if (objectErrors.value.length || relationError.value) throw new Error('请先处理工作区对象或关系记录错误');
      if (!snapshot && (call.function.name !== 'propose_event' || JSON.parse(call.function.arguments)?.properties?.checkable === true))
        throw new Error('必须先读取工作区对象快照，检查已有任务');
      const id = call.function.name === 'propose_event'
        ? await adapter.reserveObjectId?.(objects.value.map(record => record.object.id))
        : newShortId(new Set(relations.value.map(row => row.id)));
      if (!id) throw new Error('此存储适配器无法分配工作区对象身份');
      return structureProposal(call, { workspaceId: scope.id, runId, id, relationContent: relationBase?.content ?? '',
        targets: referenceTargets.value.filter(target => target.type !== 'document' || !isWorkspaceInternalPath(target.path)),
        relationTypes: relationDefinitions.value, ...snapshot });
    });
  }
  async function assistantTaskQuery(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, input: TaskQuery, snapshot: StructureSnapshot) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path) throw new Error('工作区身份已变化');
      workspace.value = current; await refreshObjects();
      const accessible = new Map(referenceTargets.value.map(target => [referenceKey(target), target]));
      const targets = snapshot.targets.filter(target => accessible.has(referenceKey(target)))
        .map(target => target.type === 'document' ? accessible.get(referenceKey(target))! : target);
      const contents = new Map<string, string>();
      const errors: string[] = [];
      for (const target of targets) {
        if (target.type !== 'document') { contents.set(referenceKey(target), target.description ?? ''); continue; }
        try {
          const content = documents.value.find(doc => doc.id === target.id)?.content ?? (await adapter.read(target.path)).content;
          contents.set(referenceKey(target), content);
        } catch (error) { errors.push(`${target.path}：${String(error)}`); }
      }
      const relations = snapshot.relationContent ? parseRelations(snapshot.relationContent).relations : [];
      return { ...queryTasks(targets, relations, contentReferences(targets, contents), parseTaskQuery(input)),
        complete: errors.length === 0, errors };
    });
  }
  async function reviewAssistantStructure(proposal: AssistantProposal, accepted?: AssistantPreview) {
    if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
    await refreshObjects();
    if (objectErrors.value.length || relationError.value) throw new Error('请先处理工作区对象或关系记录错误');
    let disk: FileSnapshot | null = null;
    let content = proposal.content;
    if (proposal.kind === 'object') {
      const object = parseObject(content);
      if (proposal.base) {
        const base = parseObject(proposal.base);
        validateTaskUpdate(base, object);
        const file = workspace.value!.files.find(file => file.id === proposal.fileId && file.path === proposal.path);
        const record = objects.value.find(record => record.object.id === base.id && record.path === file?.path);
        if (!file || !record) throw new Error('任务已删除、移动或身份变化');
        disk = record.snapshot;
        const merged = mergeObject(base, object, record.object);
        if (!merged) return { status: 'conflict' as const, preview: { before: disk.content, after: content, diskHash: disk.hash, path: proposal.path } };
        validateTaskUpdate(record.object, merged);
        content = JSON.stringify(merged, null, 2) + '\n';
      } else {
        if (object.type !== 'event' || proposal.path !== `${objectDirectory}/${object.id}.tano.json` || object.archived)
          throw new Error('助手只能建议新增工作区事件');
        validateObjectProperties('event', object.properties);
        if (referenceTargets.value.some(target => target.id === object.id) || workspace.value!.files.some(file => file.path === proposal.path))
          throw new Error('对象身份或路径已被使用，请保留建议并重新生成');
      }
    } else {
      if (proposal.path !== workspaceRelationPath) throw new Error('关系建议路径无效');
      const base = proposal.base ? parseRelations(proposal.base) : { version: 1 as const, relations: [] };
      const proposed = parseRelations(proposal.content);
      disk = relationBase;
      const current = disk ? parseRelations(disk.content) : { version: 1 as const, relations: [] };
      const merged = mergeStructureRelations(base, proposed, current,
        referenceTargets.value.filter(target => target.type !== 'document' || !isWorkspaceInternalPath(target.path)), relationDefinitions.value);
      if (!merged) return { status: 'conflict' as const, preview: { before: disk?.content ?? '', after: content, diskHash: disk?.hash ?? null, path: proposal.path } };
      content = JSON.stringify(merged, null, 2) + '\n';
    }
    const preview: AssistantPreview = { before: disk?.content ?? '', after: content, diskHash: disk?.hash ?? null, path: proposal.path };
    if (!accepted) return { status: 'preview' as const, preview };
    if (JSON.stringify(accepted) !== JSON.stringify(preview)) return { status: 'stale' as const, preview };
    writable();
    if (disk) {
      const written = await adapter.write(proposal.path, preview.after, disk.hash);
      if (written.status === 'missing') throw new Error('关系文件在保存前移除，请重新审阅');
      if (written.status !== 'saved') return { status: 'stale' as const, preview: undefined };
    } else await adapter.create(proposal.path, preview.after);
    workspace.value = await adapter.refresh();
    const file = workspace.value.files.find(file => file.path === proposal.path);
    if (!file) throw new Error('工作区记录可能已保存，请刷新核对');
    const result = await adapter.read(proposal.path);
    await refreshObjects();
    return { status: 'saved' as const, applied: { before: preview.before, after: result.content, hash: result.hash, fileId: file.id } };
  }
  async function assistantSnapshot(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, fileId: string): Promise<AssistantSource> {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const refreshed = await adapter.refresh();
      if (refreshed.id !== scope.id || refreshed.path !== scope.path) throw new Error('工作区身份已变化');
      const file = refreshed.files.find(file => file.id === fileId && file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path));
      if (!file) throw new Error('参考文档已移除');
      const disk = await adapter.read(file.path);
      const doc = documents.value.find(doc => doc.id === fileId);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理参考文档的冲突或缺失');
      const content = doc?.content ?? disk.content;
      if (content.length > 512_000) throw new Error('参考文档过大，请使用较小文档');
      return { id: '', workspaceId: scope.id, fileId, path: file.path, content,
        hash: await assistantHash(content), origin: doc && content !== disk.content ? 'draft' : 'disk' };
    });
  }
  async function reviewAssistantProposal(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, proposal: AssistantProposal,
    accepted?: AssistantPreview) {
    return serial(() => reviewAssistantProposalNow(scope, proposal, accepted));
  }
  async function reviewAssistantProposalNow(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, proposal: AssistantProposal,
    accepted?: AssistantPreview) {
      requireAssistantWorkspace(scope);
      if (proposal.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const signature = JSON.stringify([scope, proposal.kind, proposal.fileId, proposal.path, proposal.base, proposal.content]);
      const applied = assistantApplied.get(proposal.id);
      if (applied) {
        if (applied.signature !== signature) throw new Error('同一操作标识不能对应不同建议');
        return { status: 'saved' as const, applied };
      }
      const refreshed = await adapter.refresh();
      if (refreshed.id !== scope.id || refreshed.path !== scope.path) throw new Error('工作区身份已变化');
      workspace.value = refreshed;
      if (proposal.kind === 'edit' && proposal.fileId && /^[0-9a-f]{6}$/.test(proposal.fileId)) {
        const published = await loadSuggestions(adapter, scope.id, proposal.fileId);
        if (published.file.suggestions.some(item => item.groupId === proposal.id))
          throw new Error('此提案已转为文档建议，请在文档中逐项审阅，不能再次整篇应用');
      }
      if (proposal.kind === 'object' || proposal.kind === 'relation') {
        const result = await reviewAssistantStructure(proposal, accepted);
        if (result.status === 'saved') {
          assistantApplied.set(proposal.id, { signature, ...result.applied });
          activity('助手工作区建议已应用', proposal.path, 'save', { before: result.applied.before, after: result.applied.after });
        }
        return result;
      }
      let disk: FileSnapshot | null = null;
      let doc: OpenDocument | undefined;
      let path = proposal.path;
      let current = '';
      if (proposal.kind === 'create') {
        if (!isMarkdown(path) || validatePath(path)) throw new Error('新文档路径无效');
        if (refreshed.files.some(file => pathKey(file.path) === pathKey(path))) throw new Error('同名文件已存在，请调整建议路径');
      } else {
        const file = refreshed.files.find(file => file.id === proposal.fileId && file.kind === 'file' && isMarkdown(file.path));
        if (!file) throw new Error('目标文档已删除或身份变化');
        path = file.path;
        disk = await adapter.read(path);
        doc = documents.value.find(doc => doc.id === file.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有的冲突或缺失');
        const reconciled = doc ? mergeMarkdown(doc.base.content, doc.content, disk.content) : { clean: true, content: disk.content };
        if (!reconciled.clean) return { status: 'conflict' as const, preview: { before: doc!.content, after: proposal.content, diskHash: disk.hash, path } };
        current = reconciled.content;
      }
      const merged = mergeMarkdown(proposal.base, proposal.content, current);
      const preview: AssistantPreview = { before: current, after: merged.content, diskHash: disk?.hash ?? null, path };
      if (!merged.clean) return { status: 'conflict' as const, preview: { ...preview, after: proposal.content } };
      if (!accepted) return { status: 'preview' as const, preview };
      if (JSON.stringify(preview) !== JSON.stringify(accepted)) return { status: 'stale' as const, preview };
      writable();
      const draftBefore = doc?.content;
      if (doc) doc.saving = true;
      try {
        let result: FileSnapshot;
        let fileId: string;
        if (proposal.kind === 'create') {
          await adapter.create(path, preview.after);
          workspace.value = await adapter.refresh();
          fileId = workspace.value.files.find(file => file.path === path)?.id ?? '';
          if (!fileId) throw new Error('文档可能已创建，请刷新核对');
          result = await adapter.read(path);
        } else {
          fileId = proposal.fileId!;
          const written = await adapter.write(path, preview.after, disk!.hash);
          if (written.status === 'missing') throw new Error('目标文档已在保存前删除');
          if (written.status === 'conflict') {
            const live = doc ? mergeMarkdown(doc.base.content, doc.content, written.snapshot.content)
              : { clean: true, content: written.snapshot.content };
            const updated = mergeMarkdown(proposal.base, proposal.content, live.content);
            return { status: live.clean && updated.clean ? 'stale' as const : 'conflict' as const,
              preview: { before: live.content, after: live.clean && updated.clean ? updated.content : proposal.content,
                diskHash: written.snapshot.hash, path } };
          }
          result = written.snapshot;
          if (doc) {
            const duringSave = doc.content;
            const remaining = mergeMarkdown(draftBefore!, duringSave, result.content);
            doc.base = result;
            doc.error = undefined;
            if (remaining.clean) doc.content = remaining.content;
            else {
              const copyPath = path.replace(/\.(md|markdown)$/i, `.conflict-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`);
              doc.conflict = { copyPath, disk: result };
              await adapter.create(copyPath, duringSave);
              activity('保存期间的新输入已保留为冲突副本', copyPath, 'conflict');
            }
          }
        }
        const receipt = { signature, before: preview.before, after: result.content, hash: result.hash, fileId };
        assistantApplied.set(proposal.id, receipt);
        activity('助手修改已应用', path, 'save', { before: preview.before, after: result.content });
        return { status: 'saved' as const, applied: receipt };
      } finally { if (doc) doc.saving = false; }
  }
  function readDocumentSuggestions(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, fileId: string) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      return loadSuggestions(adapter, scope.id, fileId);
    });
  }
  function writeDocumentSuggestions(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, state: SuggestionState, records: DocumentSuggestion[]) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (state.file.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const file = workspace.value?.files.find(file => file.id === state.file.fileId);
      if (!file || file.readOnly) throw new Error('目标文档已移除或只读');
      return saveSuggestions(adapter, state, records);
    });
  }
  function acceptDocumentSuggestion(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, state: SuggestionState,
    id: string, accepted?: AssistantPreview) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (state.file.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const latest = await loadSuggestions(adapter, scope.id, state.file.fileId);
      const item = latest.file.suggestions.find(item => item.id === id);
      const expected = state.file.suggestions.find(item => item.id === id);
      if (!item || JSON.stringify(item) !== JSON.stringify(expected)) throw new Error('建议已变化，请重新载入后审阅');
      const target = (await adapter.refresh()).files.find(file => file.id === state.file.fileId && isMarkdown(file.path));
      if (!target || target.readOnly) throw new Error('目标文档已移除或只读');
      const disk = await adapter.read(target.path);
      if (item.status === 'applying') {
        if (disk.content !== item.application?.after) throw new Error('上次写入结果待核对，未重复应用；请比较正式正文与修改前后内容');
        const completed = { ...item, status: 'accepted' as const, revision: item.revision + 1,
          application: { ...item.application, resultHash: disk.hash } };
        const saved = await saveSuggestions(adapter, latest, latest.file.suggestions.map(row => row.id === id ? completed : row));
        return { status: 'saved' as const, state: saved };
      }
      if (item.status !== 'pending') return { status: 'saved' as const, state: latest };
      const doc = documents.value.find(doc => doc.id === state.file.fileId);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理文档冲突或缺失');
      const merged = doc ? mergeMarkdown(doc.base.content, doc.content, disk.content) : { clean: true, content: disk.content };
      if (!merged.clean) throw new Error('外部修改与当前草稿冲突，原文和建议均已保留');
      const location = locateSuggestion(item, merged.content);
      if (!location) throw new Error('建议的原文已变化或无法唯一定位，请核对后重新提出建议');
      const proposal: AssistantProposal = { id: crypto.randomUUID(), runId: id, workspaceId: scope.id,
        kind: 'edit', fileId: state.file.fileId, path: target.path, base: merged.content,
        content: merged.content.slice(0, location.from) + item.text + merged.content.slice(location.to), reason: item.reason ?? '文档建议', status: 'ready' };
      const reviewed = await reviewAssistantProposalNow(scope, proposal);
      if (reviewed.status !== 'preview') throw new Error('文档存在冲突，请重新审阅');
      if (!accepted || JSON.stringify(accepted) !== JSON.stringify(reviewed.preview))
        return { status: 'preview' as const, preview: reviewed.preview, state: latest };
      const intent: DocumentSuggestion = { ...item, status: 'applying', revision: item.revision + 1,
        application: { operationId: proposal.id, before: accepted.before, after: accepted.after, diskHash: accepted.diskHash! } };
      const prepared = await saveSuggestions(adapter, latest, latest.file.suggestions.map(row => row.id === id ? intent : row));
      // A durable intent precedes the Markdown write. Exceptions leave it for explicit recovery.
      const result = await reviewAssistantProposalNow(scope, proposal, accepted);
      if (result.status !== 'saved') {
        const reset = { ...item, revision: intent.revision + 1 };
        const saved = await saveSuggestions(adapter, prepared, prepared.file.suggestions.map(row => row.id === id ? reset : row));
        return { status: 'preview' as const, preview: result.preview, state: saved };
      }
      const completed = { ...intent, status: 'accepted' as const, revision: intent.revision + 1,
        application: { ...intent.application!, resultHash: result.applied.hash } };
      const saved = await saveSuggestions(adapter, prepared, prepared.file.suggestions.map(row => row.id === id ? completed : row));
      return { status: 'saved' as const, state: saved };
    });
  }
  function editDocument(id: string, content: string) {
    const doc = documents.value.find((document) => document.id === id);
    if (!doc || doc.conflict || workspace.value?.readOnly || workspace.value?.files.find(file => file.id === id)?.readOnly) return;
    doc.content = content;
    doc.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
  }
  function receiveDocument(id: string, content: string) {
    const doc = documents.value.find((document) => document.id === id);
    if (!doc || doc.conflict || doc.missing) return;
    doc.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flush(); }, 600);
  }
  async function hydrateDocumentLayout(doc: OpenDocument) {
    if (!workspace.value || !/^[0-9a-f]{6}$/.test(doc.id)) return;
    try { doc.tableLayout = await loadDocumentLayout(adapter, workspace.value, doc.id); }
    catch (error) { report(`无法读取表格布局，原文件已保留：${String(error)}`); }
  }
  function editTableLayout(id: string, tables: TableLayout[]) {
    const doc = documents.value.find(item => item.id === id);
    if (!doc?.tableLayout || doc.conflict || doc.missing || workspace.value?.readOnly) return;
    doc.tableLayout.file = { ...doc.tableLayout.file, tables: JSON.parse(JSON.stringify(tables)) };
    doc.tableLayout.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flush(); }, 300);
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
      state.error = String(error); report(error);
    }
  }
  async function reconcile(doc: OpenDocument, disk: FileSnapshot) {
    if (doc.conflict) {
      doc.conflict.disk = disk;
      return;
    }
    if (disk.hash === doc.base.hash) return;
    referenceDocumentCache.delete(doc.id);
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
          referenceDocumentCache.delete(doc.id);
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
    try { await suggestionPersistence.value?.flush(); }
    catch (error) { report(error); return false; }
    clearTimeout(saveTimer);
    const saved = await serial(async () => {
      for (const doc of documents.value) { await saveInternal(doc); await saveTableLayout(doc); }
      return documents.value.every((doc) => (!dirty(doc) || !!doc.conflict) &&
        !layoutPending(doc));
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
          if (doc.tableLayout && !layoutDirty(doc.tableLayout)) await hydrateDocumentLayout(doc);
          await saveTableLayout(doc);
        }
      });
    } catch (error) {
      clearRevokedReferences(error);
      report(error);
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
  async function importDocuments(prepared: PreparedImport, folder: string, workspaceId: string,
    options: Parameters<typeof writeWorkspaceImport>[4] = {}) {
    return serial(async () => {
      writable();
      if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重新选择导入文件');
      const receipt = await writeWorkspaceImport(adapter, prepared, folder, workspaceId, options);
      activity('内容已导入', `${receipt.folder} · ${receipt.paths.length} 个页面`, 'file');
      try {
        workspace.value = await adapter.refresh();
        const first = workspace.value.files.find(file => file.path === receipt.paths[0]);
        if (first) {
          try { await openInternal(first); }
          catch (error) { receipt.issues.push({ name: first.path, message: `文件已导入，打开失败：${error instanceof Error ? error.message : String(error)}` }); }
        }
      } catch (error) {
        receipt.issues.push({ name: receipt.folder, message: `文件已导入，刷新工作区失败：${error instanceof Error ? error.message : String(error)}` });
      }
      return receipt;
    });
  }
  async function createUntitledFolder(parent = '') {
    await createUntitledEntry(parent, true);
  }
  async function renameEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, path: string) {
    writable();
    if (isWeb && file.kind !== 'file')
      throw new Error('在线工作区暂不支持重命名文件夹');
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
    if (files.some((file) => isWeb && file.kind !== 'file'))
      throw new Error('在线工作区暂不支持移除文件夹');
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
    const pane = panes.value.find(pane => pane.tabs.includes(id));
    const nextTab = () => panes.value.find(item => item.id === pane?.id)?.activeId ?? tabIds.value.at(-1) ?? '';
    if (isUtilityTab(id)) {
      tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
      removeTabNavigation(id);
      if (activeId.value === id) activeId.value = nextTab();
      return;
    }
    if (!(await flush())) { report('此文档尚有未保存的修改或建议，请先处理保存错误。'); return; }
    try {
      await beforeCloseDocument?.(id);
    } catch (error) {
      report(error);
      return;
    }
    const doc = documents.value.find((d) => d.id === id);
    if (doc && ((dirty(doc) && !doc.conflict) || layoutPending(doc))) {
      report('此文档尚未保存，请先另存副本或解决保存错误。');
      return;
    }
    documents.value = documents.value.filter((d) => d.id !== id);
    tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
    removeTabNavigation(id);
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
    layout,
    panes,
    activePaneId,
    paneDrop,
    detachingTabId,
    focusPane,
    dockTab,
    resizeSplit,
    installedPlugins,
    pluginError,
    changePlugin,
    relations,
    relationError,
    relationDefinitions,
    relationIndex,
    createRelation,
    removeRelation,
    setRelationSource,
    objects, objectErrors, objectDefinitions, referenceTargets, referenceRevision, getReferenceContext, assistantReferenceContext, createObject, updateObject,
    templates, writeTemplate, repeatPreview, createRepeat,
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
    canNavigateHistory,
    canGoForward,
    navigateHistory,
    activities,
    notice,
    fatal,
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
    openAttachmentInNewTab,
    openFilesInNewTabsAt,
    createBlankTab,
    openGraphTab,
    openPluginsTab,
    openCalendarTab,
    registerViews,
    openViewTab,
    readGraphDocument,
    assistantSnapshot,
    assistantRules,
    assistantStructures,
    proposeAssistantStructure,
    assistantTaskQuery,
    assistantEpoch,
    reviewAssistantProposal,
    readDocumentSuggestions,
    writeDocumentSuggestions,
    acceptDocumentSuggestion,
    setSuggestionPersistence: (hooks: { flush: () => Promise<void>; pending: () => boolean }) => { suggestionPersistence.value = hooks; },
    edit,
    editDocument,
    editTableLayout,
    preserveDraft,
    receiveDocument,
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
    importDocuments,
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
  };
});
