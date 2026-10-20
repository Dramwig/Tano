import { computed, onScopeDispose, ref, shallowRef, watch } from 'vue';
import { defineStore } from 'pinia';
import { FileRegistry, defaultFileDatabaseQuery, defaultObjectViewQuery, parseWorkspaceView, workspaceViewPath, type WorkspaceViewDefinition } from '@tano/protocol';
import { loadFileMetadata, saveFileMetadata, markdownFileMetadata, type FileMetadataState } from '../file-metadata';
import type {
  FileEntry,
  FileSnapshot,
  Workspace,
  WorkspaceSession,
  WorkspaceLayout,
  RecentWorkspace,
} from '@tano/protocol';
import { basename, parentPath, isMarkdown, pathKey, objectDirectory, validatePath, assistantRulesPath, isWorkspaceInternalPath, workspaceSettingsPath } from '@tano/protocol';
import { mergeMarkdown } from '@tano/markdown';
import { useWorkbenchRuntime } from '../runtime';
import type { WorkbenchViewTab } from '../runtime';
import { planFileMove } from '../file-move';
import { optimisticFiles, type FileMutationPreview } from '../optimistic-files';
import { topLevelEntries } from '../file-selection';
import { defaultCapabilities } from '@tano/editor/runtime';
import { loadCapabilities, saveCapabilityPatch } from '../workspace-capabilities';
import type { CapabilityPatch } from '../workspace-capabilities';
import { defaultWorkspaceSettings, loadWorkspaceSettings, saveWorkspaceSettingsPatch } from '../workspace-settings';
import type { WorkspaceSettings, WorkspaceSettingsPatch } from '../workspace-settings';
import { loadObjects, saveObject, mergeObject } from '../workspace-objects';
import type { ObjectRecord } from '../workspace-objects';
import { loadWorkspaceViews } from '../workspace-views';
import type { WorkspaceViewRecord } from '../workspace-views';
import { assetTargets, documentTargets, parseObject, objectTypeRegistry, validateObjectProperties } from '@tano/protocol';
import type { WorkspaceObject, ReferenceTarget } from '@tano/protocol';
import { coreRelationTypes, newShortId, RelationIndex, referenceKey, relationKey, validateRelation, parseRelations, workspaceRelationPath, WorkspaceAccessRevokedError } from '@tano/protocol';
import type { ReferenceIdentity, WorkspaceRelation } from '@tano/protocol';
import { PLUGINS_TAB_ID, WorkspacePluginHost } from '../workspace-plugins';
import type { InstalledObjectPlugin, PluginChange } from '../workspace-plugins';
import { PluginExecutionHost, type PluginRuntimeState } from '../plugins/host';
import { canManageWorkspacePlugins } from '../plugins/policy';
import { PluginPackageCache } from '../plugins/packages';
import { PluginQueryPager, pluginChanges } from '../plugins/data';
import { queryPluginData } from '../plugins/queries';
import { PluginDevelopmentRunner, type PluginDevelopmentState } from '../plugins/development';
import { pluginWorkbenchViews, pluginWorkbenchCommands, pluginViewKey, type PluginWorkbenchView, type PluginInteraction } from '../plugins/workbench';
import { pluginRecord, parsePluginPackage } from '@tano/protocol';
import { parsePluginCatalog, type PluginCatalogRelease } from '@tano/protocol';
import { verifyCatalogPackage } from '../plugins/catalog';
import { parsePluginConnectionInput, type PluginConnectionInput, type PluginOAuthInput } from '@tano/protocol';
import { loadRelations, saveRelationChange } from '../workspace-relations';
import type { RelationChange } from '../workspace-relations';
import { contentReferences, referenceContext } from '../content-references';
import { GRAPH_TAB_ID } from '../document-graph';
import { CALENDAR_TAB_ID } from '../calendar';
import { dockLayout, layoutPanes, newPane, reconcileLayout, restoreLayout } from '../pane-layout';
import type { PaneDrop } from '../pane-layout';
import { DocumentLayoutConflict, loadDocumentLayout, layoutDirty, saveDocumentLayout } from '../workspace-document-layout';
import { documentLayoutPath, parseDocumentLayout } from '@tano/protocol';
import type { DocumentLayoutState } from '../workspace-document-layout';
import type { TableLayout } from '@tano/protocol';
import type { AssistantProposal, AssistantPreview, AssistantSource, AssistantToolCall } from '@tano/protocol';
import { assistantHash } from '../assistant/hash';
import { isAssistantFile, validateAssistantContent, validAssistantDestination } from '../assistant/files';
import { assistantTableContent, reviewAssistantTable } from '../assistant/data-tables';
import { structureProposal, mergeStructureRelations, validateTaskUpdate } from '../assistant/structures';
import { parseTaskQuery, possibleDuplicateTasks, queryTasks } from '../assistant/tasks';
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
import { addWorkspaceWelcome, workspaceWelcomePath } from '../workspace-welcome';
import { readStartupWorkspace, rememberStartupWorkspace } from '../workspace-startup';
import { recordHelpCompleted, recordHelpPlanEdit } from '../help-checklist';
import { createHelpEditQueue } from '../help-edit-queue';
import { createDataTableController } from '../data-table-controller';
import { isTableTab, TABLES_TAB_ID, tableFileId, tableTabId } from '../data-tables';
import { isDataTableFilePath, dataTableName } from '@tano/protocol';

export interface OpenDocument {
  id: string;
  path: string;
  content: string;
  base: FileSnapshot;
  saving: boolean;
  creating?: boolean;
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
  workspaceView?: WorkspaceViewRecord;
  pluginView?: PluginWorkbenchView;
  document?: OpenDocument;
  attachmentPreview: boolean;
  attachment?: FileEntry;
  dataTable?: { name: string; dirty: boolean };
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
  const views = shallowRef<ReadonlyMap<string, WorkbenchViewTab>>(new Map());
  const workspaceViewTabPrefix = 'workspace-view:';
  const workspaceViewTabId = (id: string) => `${workspaceViewTabPrefix}${id}`;
  const workspaceViewId = (id: string) => id.startsWith(workspaceViewTabPrefix) ? id.slice(workspaceViewTabPrefix.length) : undefined;
  const isWorkspaceViewTab = (id: string) => !!workspaceViewId(id);
  const hasWorkspaceViewTab = (id: string) => {
    const viewId = workspaceViewId(id);
    return viewId !== undefined && workspaceViews.value.some((record) => record.view.id === viewId);
  };
  const isNavigationPage = (id: string) => id === GRAPH_TAB_ID || id === PLUGINS_TAB_ID || isTableTab(id) || hasWorkspaceViewTab(id);
  const isBuiltinTab = (id: string) => id.startsWith('blank:') || id.startsWith('attachment:') || id === GRAPH_TAB_ID || id === PLUGINS_TAB_ID || id === CALENDAR_TAB_ID || isTableTab(id) || hasWorkspaceViewTab(id);
  const isUtilityTab = (id: string) => isBuiltinTab(id) || views.value.has(id) || pluginViews.value.some(view => view.key === id && view.location === 'tab');
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
  const fileRegistry = computed(() => workspace.value ? FileRegistry.from(workspace.value) : null);
  function metadataTarget(id: string, scope: string) {
    const current = workspace.value;
    const file = fileRegistry.value?.get(id);
    if (!current || current.id !== scope || !file || isWorkspaceInternalPath(file.path)) throw new Error('文件或工作区已变化');
    return { current, file };
  }
  const readFileMetadata = (id: string, scope: string) => serial(async (): Promise<FileMetadataState> => {
    const { current, file } = metadataTarget(id, scope);
    if (isMarkdown(file.path)) {
      const content = documents.value.find(doc => doc.id === id)?.content ?? (await adapter.read(file.path)).content;
      return { file: markdownFileMetadata(id, content), base: null,
        referenceCount: contentReferences(referenceTargets.value, new Map([[`document/${id}`, content]])).length };
    }
    return loadFileMetadata(adapter, current, id);
  });
  const updateFileMetadata = (state: FileMetadataState, scope: string) => serial(async () => {
    const { current, file } = metadataTarget(state.file.fileId, scope);
    if (isMarkdown(file.path)) throw new Error('请在文档属性中编辑 Markdown 属性');
    if (current.readOnly || file.readOnly) throw new Error('你对此文件只有阅读权限');
    const saved = await saveFileMetadata(adapter, state);
    workspace.value = await adapter.refresh();
    return saved;
  });
  const workspaceViews = ref<WorkspaceViewRecord[]>([]);
  const workspaceViewErrors = ref<string[]>([]);
  async function createObjectDatabase() {
    const scope = workspace.value?.id;
    const id = `objects-${crypto.randomUUID()}`;
    await serial(async () => {
      if (!scope || workspace.value?.id !== scope) throw new Error('工作区已切换');
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('Level 2 已关闭');
      const view = parseWorkspaceView(JSON.stringify({ version: 1, layer: 'view', workspaceId: scope, id,
        name: '对象数据库', kind: 'objects', sources: [], objectDatabase: defaultObjectViewQuery() }));
      await adapter.create(workspaceViewPath(id), JSON.stringify(view, null, 2) + '\n');
      workspace.value = await adapter.refresh(); await refreshObjects();
    });
    await openWorkspaceView(id, { newTab: true });
  }
  async function createFileDatabase(directory = '') {
    const scope = workspace.value?.id;
    const id = `files-${crypto.randomUUID()}`;
    await serial(async () => {
      if (!scope || workspace.value?.id !== scope) throw new Error('工作区已切换');
      writable();
      if (directory && !workspace.value.files.some(f => f.kind === 'directory' && f.path === directory)) throw new Error('目录已不存在');
      const view = parseWorkspaceView(JSON.stringify({ version: 1, layer: 'view', workspaceId: scope, id,
        name: `${directory ? basename(directory) : workspace.value.name} · 文件数据库`, kind: 'files', sources: [], database: defaultFileDatabaseQuery(directory) }));
      await adapter.create(workspaceViewPath(id), JSON.stringify(view, null, 2) + '\n');
      workspace.value = await adapter.refresh(); await refreshObjects();
    });
    await openWorkspaceView(id, { newTab: true });
  }
  const saveFileDatabase = (view: WorkspaceViewDefinition, base: FileSnapshot) => serial(async () => {
    if (workspace.value?.id !== view.workspaceId) throw new Error('工作区已切换');
    writable();
    const checked = parseWorkspaceView(JSON.stringify(view));
    const result = await adapter.write(workspaceViewPath(checked.id), JSON.stringify(checked, null, 2) + '\n', base.hash);
    if (result.status !== 'saved') {
      const copy = `.tano/conflicts/view-${checked.id}-${crypto.randomUUID()}.tano.json`;
      await adapter.create(copy, JSON.stringify(checked, null, 2) + '\n');
      throw new Error(`视图已被外部修改或删除，外部版本未覆盖；当前设置已保留在 ${copy}`);
    }
    workspace.value = await adapter.refresh(); await refreshObjects();
    return result.snapshot;
  });
  const fileMutations = optimisticFiles(() => workspace.value, report);
  const visibleWorkspace = computed({ get: () => fileMutations.workspace.value, set: (value) => { workspace.value = value; } });
  function displayPath(file: Pick<FileEntry, 'id' | 'path'>) {
    return visibleWorkspace.value?.files.find(entry => entry.id === file.id)?.path ?? file.path;
  }
  const dataTables = createDataTableController({ adapter, workspace: () => workspace.value, serial,
    refresh: async () => { workspace.value = await adapter.refresh(); } });
  function dataTableFileId(id: string) {
    if (workspace.value?.files.some(file => file.id === id && isDataTableFilePath(file.path))) return id;
    // Resolve previously shared links, whose suffix was the table's embedded identity.
    return dataTables.records.value.find(record => record.table.id === id)?.fileId ?? id;
  }
  async function openDataTable(id?: string, options?: { newTab?: boolean; historyIndex?: number }) {
    if (!id) { createBlankTab(); return; }
    await openPageTab(tableTabId(dataTableFileId(id)), options);
  }
  async function createDataTable(template: 'blank' | 'parts' = 'blank', parent = '') {
    const id = await dataTables.create(template, undefined, parent);
    await openDataTable(id);
    return id;
  }
  async function renameDataTable(id: string, name: string) {
    const file = workspace.value?.files.find(file => file.id === id && isDataTableFilePath(file.path));
    if (!file) throw new Error('数据表文件已不存在');
    const path = `${parentPath(file.path) ? `${parentPath(file.path)}/` : ''}${name.trim().normalize('NFC')}.table.json`;
    if (!name.trim() || /[\\/]/.test(name)) throw new Error('请输入有效的文件名称');
    const error = validatePath(path);
    if (error) throw new Error(error);
    if (path !== file.path) await renameEntry(file, path);
  }
  const workspaceSettings = ref({ ...defaultWorkspaceSettings });
  const pendingWorkspaceIcon = ref<{ workspaceId: string; value: string }>();
  const visibleWorkspaceSettings = computed(() => {
    const pending = pendingWorkspaceIcon.value;
    return pending && pending.workspaceId === workspace.value?.id
      ? { ...workspaceSettings.value, icon: pending.value }
      : workspaceSettings.value;
  });
  const workspaceSettingsError = ref('');
  const workspaceSettingsSaving = ref(false);
  let workspaceSettingsBase: FileSnapshot | null = null;
  let workspaceSettingsScope = '';
  let workspaceDefaultName = '';
  const workspaceNames = new Map<string, string>();
  watch(workspace, current => {
    workspaceDefaultName = current?.name ?? '';
    if (current?.id === workspaceSettingsScope && workspaceSettings.value.name)
      current.name = workspaceSettings.value.name;
  }, { flush: 'sync' });
  function applyWorkspaceSettings(current: Workspace, loaded: { snapshot: FileSnapshot | null; settings: WorkspaceSettings }) {
    workspaceSettingsScope = current.id;
    workspaceSettingsBase = loaded.snapshot;
    workspaceSettings.value = loaded.settings;
    workspaceSettingsError.value = '';
    current.name = loaded.settings.name || workspaceDefaultName;
    workspaceNames.set(current.id, current.name);
    recent.value = recent.value.map(item => ({ ...item, name: workspaceNames.get(item.id) ?? item.name,
      ...(item.id === current.id ? { icon: loaded.settings.icon } : {}) }));
  }
  async function refreshWorkspaceSettings() {
    const current = workspace.value;
    if (!current) return;
    try {
      const loaded = await loadWorkspaceSettings(adapter, current);
      applyWorkspaceSettings(current, loaded);
    } catch (error) {
      workspaceSettingsError.value = `无法读取工作区设置：${String(error)}。原文件已保留。`;
    }
  }
  async function updateWorkspaceSettings(workspaceId: string, patch: WorkspaceSettingsPatch) {
    if (workspaceSettingsSaving.value || workspaceSettingsError.value) return;
    workspaceSettingsSaving.value = true;
    // Preview before joining the filesystem queue; keep the persisted base intact
    // so refreshes and failed writes can still reconcile against the actual file.
    if (patch.key === 'icon' && workspace.value?.id === workspaceId && !workspace.value.readOnly && canManageSettings.value)
      pendingWorkspaceIcon.value = { workspaceId, value: patch.value };
    try {
      await serial(async () => {
        if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换，请重新打开设置');
        writable();
        if (!canManageSettings.value) throw new Error('只有工作区所有者和管理者可以修改工作区设置');
        if (patch.key === 'homePageId' && patch.value && !workspace.value.files.some(file => file.id === patch.value && file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path)))
          throw new Error('默认页面已不存在，请重新选择');
        const saved = await saveWorkspaceSettingsPatch(adapter, workspaceSettingsBase, patch);
        // Use the acknowledged state, including a newly created settings file.
        // Legacy adapters only need a scan when they cannot return that new entry.
        if (saved.workspace) workspace.value = saved.workspace;
        else if (!workspace.value.files.some(file => file.path === workspaceSettingsPath))
          workspace.value = await adapter.refresh();
        applyWorkspaceSettings(workspace.value, saved);
        const entry = workspace.value.files.find(file => file.path === workspaceSettingsPath);
        if (entry) {
          entry.size = new TextEncoder().encode(saved.snapshot.content).length;
          entry.modified = saved.snapshot.modified;
        }
        pendingWorkspaceIcon.value = undefined;
      });
    } catch (error) {
      pendingWorkspaceIcon.value = undefined;
      report(error);
      if (workspace.value?.id === workspaceId) {
        await serial(async () => {
          if (workspace.value?.id !== workspaceId) return;
          workspace.value = await adapter.refresh();
          await refreshWorkspaceSettings();
        }).catch(report);
        if (workspace.value?.id === workspaceId) workspaceSettingsError.value = String(error);
      }
    } finally {
      pendingWorkspaceIcon.value = undefined;
      workspaceSettingsSaving.value = false;
    }
  }
  async function reloadWorkspaceSettings() {
    await serial(async () => {
      if (!workspace.value) return;
      workspace.value = await adapter.refresh();
      await refreshWorkspaceSettings();
    }).catch(report);
  }
  const assistantEpoch = ref(0);
  const objects = ref<ObjectRecord[]>([]);
  const objectErrors = ref<string[]>([]);
  const pluginHost = new WorkspacePluginHost(objectTypeRegistry, undefined, runtime.plugins?.principal);
  let pluginEditorEdit: ((id: string, before: string, after: string) => Promise<boolean>) | undefined;
  const pluginRuntime = shallowRef<PluginRuntimeState[]>([]);
  const pluginQueryPager = new PluginQueryPager();
  const pluginExecutor = new PluginExecutionHost({ call: pluginCall }, states => { pluginRuntime.value = states; }, runtime.plugins);
  const canManageSettings = computed(() => !!workspace.value && !workspace.value.readOnly &&
    (workspace.value.canManageSettings ?? adapter.mode !== 'web'));
  const canManagePlugins = computed(() => !!workspace.value && canManageWorkspacePlugins(adapter, workspace.value));
  const pluginStorageChanged = (event: StorageEvent) => {
    if (event.key?.startsWith('tano.object-plugins.v1.') || event.key?.startsWith('tano.plugin-')) scheduleRefresh();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', pluginStorageChanged);
  onScopeDispose(() => { if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged); });
  const installedPlugins = ref<InstalledObjectPlugin[]>([]);
  const pluginDevelopment = shallowRef<PluginDevelopmentState>({ pluginId: '', active: false, message: '' });
  const pluginDeveloper = new PluginDevelopmentRunner({
    snapshot(id) {
      const installation = installedPlugins.value.find(plugin => plugin.manifest.id === id);
      if (!workspace.value || installation?.manifest.manifestVersion !== 2 || !installation.rule?.integrity) return;
      return { workspaceId: workspace.value.id, manifest: installation.manifest, integrity: installation.rule.integrity,
        authorized: !!installation.authorized, enabled: installation.enabled, canManage: canManagePlugins.value };
    },
    apply: (pkg, integrity, previous, guards) => serial(async () => {
      const assertSession = guards.beforeInstall;
      assertSession(); workspace.value = await adapter.refresh(); await refreshObjects(); assertSession();
      await pluginHost.changeWorkspace(adapter, workspace.value!, { install: pkg.manifest, package: pkg }, assertSession, runtime.plugins?.repository);
      // Re-read authority before authorizing the newly installed bytes. The previous
      // digest assertion remains valid until refreshObjects publishes the new rule.
      assertSession(); workspace.value = await adapter.refresh();
      if (workspace.value.id !== previous.workspaceId || !canManageWorkspacePlugins(adapter, workspace.value)) throw new Error('工作区或管理权限已变化');
      await refreshObjects();
      if (installedPlugins.value.find(plugin => plugin.manifest.id === pkg.manifest.id)?.rule?.integrity !== integrity) throw new Error('插件版本被另一操作更改，请重新连接开发服务');
      guards.beforeAuthorize();
      pluginHost.authorize(previous.workspaceId, pkg.manifest.id, integrity, previous.integrity);
      await refreshObjects();
    }),
  }, state => { pluginDevelopment.value = state; });
  onScopeDispose(() => pluginDeveloper.stop());
  const pluginViews = computed(() => pluginWorkbenchViews(installedPlugins.value));
  const pluginCommands = computed(() => pluginWorkbenchCommands(pluginRuntime.value));
  const activePluginSidebar = ref('');
  const pluginSettingsRequest = shallowRef<{ key: string; sequence: number }>();
  const pluginSettingsPages = computed(() => pluginViews.value.filter(view => view.location === 'settings').map(view => ({
    view, workspaceId: workspace.value?.id ?? '', runtime: pluginRuntime.value.find(runtime => runtime.id === view.pluginId),
  })));
  function openPluginView(pluginId: string, viewId: string) {
    const view = pluginViews.value.find(view => view.key === pluginViewKey(pluginId, viewId));
    if (!workspace.value || !view) throw new Error('插件视图已停用或不存在');
    if (view.location === 'tab') {
      if (!tabIds.value.includes(view.key)) tabIds.value.push(view.key);
      activeId.value = view.key; ensureTabNavigation(view.key); touchNavigation();
    } else if (view.location === 'sidebar') activePluginSidebar.value = view.key;
    else if (view.location === 'settings') pluginSettingsRequest.value = { key: view.key, sequence: (pluginSettingsRequest.value?.sequence ?? 0) + 1 };
    else {
      if (!tabIds.value.includes(PLUGINS_TAB_ID)) tabIds.value.push(PLUGINS_TAB_ID);
      activeId.value = PLUGINS_TAB_ID; ensureTabNavigation(PLUGINS_TAB_ID); touchNavigation();
    }
  }
  function interactWithPlugin(interaction: PluginInteraction) {
    if (workspace.value?.id !== interaction.workspaceId) return Promise.reject(new Error('工作区已切换，请重新打开插件界面'));
    return pluginExecutor.invoke(interaction.pluginId, interaction.kind, interaction.name, interaction.payload, interaction.instanceId);
  }
  const pluginError = ref('');
  const relations = ref<WorkspaceRelation[]>([]);
  const relationError = ref('');
  let relationBase: FileSnapshot | null = null;
  onScopeDispose(() => { pluginExecutor.dispose(); pluginHost.dispose(); });
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
  let pluginEventTimer: ReturnType<typeof setTimeout>;
  onScopeDispose(() => clearTimeout(pluginEventTimer));
  const referenceDocumentCache = new Map<string, { stamp: string; content: string }>();
  function clearRevokedReferences(error: unknown) {
    if (!(error instanceof WorkspaceAccessRevokedError)) return;
    if (workspace.value) workspace.value = { ...workspace.value, files: [], readOnly: true };
    objects.value = []; relations.value = []; relationBase = null;
    pluginExecutor.dispose();
    referenceDocumentCache.clear();
  }
  async function refreshObjects() {
    if (!workspace.value) return;
    referenceDocumentCache.clear();
    try {
      installedPlugins.value = await pluginHost.loadWorkspace(adapter, workspace.value);
      pluginExecutor.sync(workspace.value, installedPlugins.value);
      pluginError.value = '';
    } catch (error) {
      pluginExecutor.dispose(); pluginHost.dispose(); installedPlugins.value = [];
      pluginError.value = `无法加载插件：${String(error)}。安装记录已保留。`;
    }
    const loaded = await loadObjects(adapter, workspace.value);
    objects.value = loaded.records; objectErrors.value = loaded.errors;
    try {
      const loadedViews = await loadWorkspaceViews(adapter, workspace.value);
      workspaceViews.value = loadedViews.records;
      workspaceViewErrors.value = loadedViews.errors;
    } catch (error) {
      workspaceViews.value = [];
      workspaceViewErrors.value = [`无法读取工作区视图：${String(error)}`];
    }
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
      const assertCurrent = () => { if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换，请重试'); };
      await pluginHost.changeWorkspace(adapter, workspace.value, change, assertCurrent, runtime.plugins?.repository);
      workspace.value = await adapter.refresh();
      await refreshObjects();
    });
  }
  async function loadPluginCatalog(signal: AbortSignal) {
    if (!runtime.plugins?.catalog) throw new Error('此产品尚未配置社区插件目录');
    const value = await runtime.plugins.catalog.list(signal);
    signal.throwIfAborted();
    return parsePluginCatalog(JSON.stringify(value));
  }
  async function installCatalogRelease(release: PluginCatalogRelease, expectedWorkspace: string, signal: AbortSignal) {
    const assertCurrent = () => {
      signal.throwIfAborted();
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value) throw new Error('工作区或管理权限已变化');
    };
    assertCurrent();
    if (!runtime.plugins?.catalog || release.status !== 'published') throw new Error('此目录版本不可安装');
    const downloaded = await runtime.plugins.catalog.download(release, signal);
    assertCurrent();
    const pkg = parsePluginPackage(JSON.stringify(downloaded.pkg));
    await verifyCatalogPackage(release, pkg); assertCurrent();
    return serial(async () => {
      assertCurrent(); workspace.value = await adapter.refresh(); await refreshObjects(); assertCurrent();
      await pluginHost.changeWorkspace(adapter, workspace.value!, { install: pkg.manifest, package: pkg, sourceUrl: downloaded.sourceUrl }, assertCurrent, runtime.plugins?.repository);
      assertCurrent(); workspace.value = await adapter.refresh(); await refreshObjects();
    });
  }
  async function authorizePlugin(id: string, integrity: string | undefined, expectedWorkspace: string) {
    if (!integrity && workspace.value?.id === expectedWorkspace && pluginDevelopment.value.pluginId === id) pluginDeveloper.stop();
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
      pluginHost.authorize(expectedWorkspace, id, integrity);
      await refreshObjects();
    });
  }
  async function cachePluginPackage(content: string) {
    const pkg = parsePluginPackage(content);
    const integrity = await new PluginPackageCache().put(pkg);
    pluginExecutor.invalidate(pkg.manifest.id);
    return integrity;
  }
  async function restartPlugin(id: string, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
      pluginExecutor.invalidate(id);
      workspace.value = await adapter.refresh(); await refreshObjects();
    });
  }
  async function rollbackPlugin(id: string, integrity: string, expectedWorkspace: string) {
    return serial(async () => {
      const assertCurrent = () => {
        if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value) throw new Error('工作区或管理权限已变化');
      };
      assertCurrent();
      workspace.value = await adapter.refresh(); await refreshObjects(); assertCurrent();
      const rule = installedPlugins.value.find(plugin => plugin.manifest.id === id)?.rule;
      const previous = rule?.history?.find(version => version.integrity === integrity);
      if (!rule || !previous) throw new Error('此历史版本已不可用，请刷新后重试');
      const pkg = await new PluginPackageCache().resolve(expectedWorkspace, { ...previous, mode: rule.mode, settings: rule.settings }, AbortSignal.timeout(15000), runtime.plugins?.repository);
      assertCurrent();
      await pluginHost.changeWorkspace(adapter, workspace.value!, { install: pkg.manifest, package: pkg, sourceUrl: previous.sourceUrl }, assertCurrent, runtime.plugins?.repository);
      workspace.value = await adapter.refresh(); await refreshObjects();
    });
  }
  async function pluginCall(method: string, params: Record<string, unknown>, assertInstance: () => void): Promise<unknown> {
    const expected = workspace.value?.id;
    return serial(async () => {
      const assertCurrent = () => {
        assertInstance();
        if (!expected || workspace.value?.id !== expected) throw new Error('工作区已切换');
      };
      assertCurrent();
      workspace.value = await adapter.refresh();
      await refreshObjects();
      assertCurrent();
      const current = workspace.value!;
      if (method === 'views.open') { await openPluginView(String(params.pluginId), String(params.viewId)); return null; }
      if (method.endsWith('.query') || method === 'documents.search') return queryPluginData(method, params, pluginQueryPager, {
        workspace: current, objects: objects.value, relations: relations.value, drafts: documents.value,
        read: path => adapter.read(path), assertCurrent,
      });
      const file = () => {
        const entry = current.files.find(row => row.id === params.fileId && row.kind === 'file' && isMarkdown(row.path) && !isWorkspaceInternalPath(row.path));
        if (!entry) throw new Error('文档不存在或不可访问');
        return entry;
      };
      const text = (value: unknown) => { if (typeof value !== 'string' || value.length > 512000) throw new Error('插件文档内容无效或过大'); return value; };
      if (method === 'documents.list') return current.files.filter(row => row.kind === 'file' && isMarkdown(row.path) && !isWorkspaceInternalPath(row.path)).map(({ id, path, name, readOnly }) => ({ id, path, name, readOnly: current.readOnly || readOnly || false }));
      if (method === 'documents.read') {
        const entry = file();
        const disk = await adapter.read(entry.path);
        const doc = documents.value.find(row => row.id === entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('文档存在冲突，请先处理');
        const content = text(doc?.content ?? disk.content);
        return { id: entry.id, path: entry.path, content, hash: await assistantHash(content) };
      }
      if (method === 'documents.open') {
        await openInternal(file()); ensureTabNavigation(String(params.fileId), String(params.fileId)); touchNavigation(); return null;
      }
      if (method === 'objects.list') return objects.value.map(record => ({ id: record.object.id, object: JSON.parse(JSON.stringify(record.object)), hash: record.snapshot.hash }));
      if (method === 'objects.read') {
        const record = objects.value.find(row => row.object.id === params.objectId);
        if (!record) throw new Error('对象不存在或不可访问');
        return { id: record.object.id, object: JSON.parse(JSON.stringify(record.object)), hash: record.snapshot.hash };
      }
      if (method === 'relations.list') return JSON.parse(JSON.stringify(relations.value));
      writable();
      if (method === 'documents.create') {
        const path = text(params.path);
        if (!isMarkdown(path) || validatePath(path)) throw new Error('新文档路径无效');
        assertCurrent(); await adapter.create(path, text(params.content));
        workspace.value = await adapter.refresh();
        const entry = workspace.value.files.find(row => row.path === path)!;
        return { id: entry.id, path };
      }
      if (method === 'documents.write') {
        const entry = file();
        if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
        if (!pluginRecord(params.base) || params.base.id !== entry.id) throw new Error('文档版本无效');
        const base = text(params.base.content), desired = text(params.content);
        const disk = await adapter.read(entry.path);
        const doc = documents.value.find(row => row.id === entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        const live = doc ? mergeMarkdown(doc.base.content, doc.content, disk.content) : { clean: true, content: disk.content };
        const merged = mergeMarkdown(base, desired, live.content);
        if (!live.clean || !merged.clean) {
          const copyPath = entry.path.replace(/\.(md|markdown)$/i, `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`);
          assertCurrent(); await adapter.create(copyPath, desired);
          throw new Error(`文档有重叠修改，插件版本已保存在 ${copyPath}`);
        }
        const editing = runtime.extensions?.()?.editing;
        if (editing?.isManaging(entry.id)) {
          if (!editing.applyPluginEdit) throw new Error('当前协作会话不支持插件编辑，请退出协作后重试');
          assertCurrent(); const applied = await editing.applyPluginEdit(entry.id, live.content, merged.content);
          assertCurrent();
          return { id: entry.id, hash: await assistantHash(applied ?? merged.content), status: 'applied' };
        }
        if (doc && pluginEditorEdit && await pluginEditorEdit(entry.id, doc.content, merged.content)) {
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'applied' };
        }
        if (doc) {
          // The editor observes this value and applies a transaction through its existing bridge.
          doc.content = merged.content; doc.base = disk;
          assertCurrent(); await saveInternal(doc);
          if (doc.error || doc.conflict || dirty(doc)) throw new Error(doc.error ?? '插件修改已保留为草稿，请处理冲突后保存');
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'saved' };
        }
        assertCurrent();
        const result = await adapter.write(entry.path, merged.content, disk.hash);
        if (result.status !== 'saved') {
          const copyPath = entry.path.replace(/\.(md|markdown)$/i, `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`);
          await adapter.create(copyPath, desired);
          throw new Error(`保存时文件发生变化，插件版本已保存在 ${copyPath}`);
        }
        return { id: entry.id, hash: await assistantHash(result.snapshot.content), status: 'saved' };
      }
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象功能已关闭');
      if (method === 'objects.create' || method === 'objects.update') {
        if (!pluginRecord(params.object)) throw new Error('对象无效');
        const draft = JSON.parse(JSON.stringify(params.object));
        if (method === 'objects.create') {
          if (!adapter.reserveObjectId) throw new Error('存储适配器不支持对象身份分配');
          const id = await adapter.reserveObjectId(objects.value.map(row => row.object.id));
          const object = parseObject(JSON.stringify({ ...draft, version: 1, id }));
          validateObjectProperties(object.type, object.properties);
          assertCurrent(); await adapter.create(`${objectDirectory}/${id}.tano.json`, JSON.stringify(object, null, 2) + '\n');
          workspace.value = await adapter.refresh(); await refreshObjects(); return object;
        }
        if (!pluginRecord(params.base) || !pluginRecord(params.base.object)) throw new Error('对象版本无效');
        const record = objects.value.find(row => row.object.id === draft.id);
        if (!record) throw new Error('对象不存在');
        if (current.files.find(row => row.path === record.path)?.readOnly) throw new Error('对象只读');
        const object = parseObject(JSON.stringify(draft));
        validateObjectProperties(object.type, object.properties);
        const merged = mergeObject(parseObject(JSON.stringify(params.base.object)), object, record.object);
        const preserve = async () => {
          const path = `.tano/conflicts/plugin-object-${crypto.randomUUID()}.json`;
          assertCurrent(); await adapter.create(path, JSON.stringify({ version: 1, pluginProposal: object, base: params.base }, null, 2) + '\n');
          return path;
        };
        if (!merged) throw new Error(`对象已有重叠修改，插件版本已保存在 ${await preserve()}`);
        let saved: ObjectRecord;
        try { assertCurrent(); saved = await saveObject(adapter, record, merged); }
        catch (error) { throw new Error(`${String(error)} 插件版本已保存在 ${await preserve()}`); }
        workspace.value = await adapter.refresh(); await refreshObjects(); return saved.object;
      }
      if (method === 'relations.add' || method === 'relations.remove') {
        if (relationError.value) throw new Error(relationError.value);
        const relation = params.relation as WorkspaceRelation;
        validateRelation(relation, relationDefinitions.value);
        for (const endpoint of [relation.source, relation.target]) if (!referenceTargets.value.some(target => referenceKey(target) === referenceKey(endpoint))) throw new Error('关系端点不存在或不可访问');
        assertCurrent();
        await saveRelationChange(adapter, relationBase, method === 'relations.add' ? { add: relation } : { remove: relation });
        workspace.value = await adapter.refresh(); await refreshObjects(); return null;
      }
      throw new Error('不支持此插件 API');
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
      const record = objects.value.find((record) => record.object.id === object.id)!;
      if (record) recordHelpPlanEdit(undefined, object);
      return record;
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
      recordHelpPlanEdit(record.object, draft);
      return saved;
    });
  }
  async function deleteObject(record: ObjectRecord, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error('工作区已切换');
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('Level 2 已关闭');
      if (record.object.properties.syncReadOnly === true) throw new Error('此对象为只读');
      if (!adapter.removeObjectFile) throw new Error('此存储适配器不支持安全删除对象');
      const file = workspace.value.files.find(file => file.path === record.path);
      if (!file || file.readOnly) throw new Error('对象已不存在或为只读');
      const base = parseObject(record.snapshot.content);
      if (base.id !== record.object.id || base.type !== record.object.type) throw new Error('对象身份不一致');
      const result = await adapter.removeObjectFile({ workspaceId: expectedWorkspace, fileId: file.id, path: record.path, expectedHash: record.snapshot.hash });
      if (result.status !== 'saved') throw new Error('对象已被外部修改或删除，请重新读取后重试');
      // Preserve relation provenance. Missing endpoints remain explicit and can be removed separately.
      workspace.value = await adapter.refresh(); await refreshObjects();
      activity('对象已删除', record.object.name, 'file');
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
      workspace.value = await adapter.refresh();
      recordHelpCompleted('save-template');
      return path;
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
        if (!canManageSettings.value) throw new Error('只有工作区所有者和管理者可以修改工作区设置');
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
  const pluginDataRevision = computed(() => JSON.stringify([
    workspace.value?.id,
    workspace.value?.files.filter(file => file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path)).map(file => {
      const draft = documents.value.find(doc => doc.id === file.id);
      return [file.id, JSON.stringify([file.path, file.size, file.modified, !!(workspace.value?.readOnly || file.readOnly),
        draft && draft.content !== draft.base.content ? draft.content : '', !!draft?.conflict, !!draft?.missing])];
    }) ?? [],
    objects.value.map(record => [record.object.id, record.snapshot.hash]),
    relations.value.map(relation => [relation.id, JSON.stringify(relation)]),
  ]));
  let pluginEventScope: string | undefined;
  let pluginPrevious = [new Map<string, string>(), new Map<string, string>(), new Map<string, string>()];
  watch(pluginDataRevision, revision => {
    clearTimeout(pluginEventTimer);
    const [scope, ...values] = JSON.parse(revision) as [string | undefined, [string, string][], [string, string][], [string, string][]];
    const next = values.map(rows => new Map(rows));
    if (scope !== pluginEventScope) {
      pluginEventScope = scope; pluginPrevious = next; pluginQueryPager.clear(); pluginDeveloper.stop(); return;
    }
    pluginEventTimer = setTimeout(() => {
      if (workspace.value?.id !== scope) return;
      const types = ['documents.changed', 'objects.changed', 'relations.changed'] as const;
      let changed = false;
      for (let index = 0; index < types.length; index++) {
        const event = pluginChanges(types[index]!, pluginPrevious[index]!, next[index]!);
        if (event) { changed = true; pluginExecutor.notify(event); }
      }
      pluginPrevious = next;
      if (changed) pluginExecutor.notify({ type: 'workspace.changed' });
    }, 150);
  }, { immediate: true });
  const tabIds = ref<string[]>([]);
  // Most tabs use the file/page id directly.  A context-menu "open in new
  // tab" request can target an already open file, though, so those additional
  // tab instances need an id of their own while continuing to share the open
  // document and its draft.
  const tabAliases = ref(new Map<string, string>());
  const activeId = ref('');
  let activationRevision = 0;
  watch(activeId, () => { activationRevision++; }, { flush: 'sync' });
  watch(pluginViews, definitions => {
    const keys = new Set(definitions.filter(view => view.location === 'tab').map(view => view.key));
    const remaining = tabIds.value.filter(id => !id.startsWith('plugin:') || keys.has(id));
    if (remaining.length !== tabIds.value.length) {
      for (const id of tabIds.value) if (!remaining.includes(id)) removeTabNavigation(id);
      tabIds.value = remaining;
    }
    if (activeId.value.startsWith('plugin:') && !keys.has(activeId.value)) activeId.value = tabIds.value[0] ?? '';
    if (!definitions.some(view => view.location === 'sidebar' && view.key === activePluginSidebar.value)) activePluginSidebar.value = '';
  });
  watch(workspaceViews, definitions => {
    const keys = new Set(definitions.map((record) => workspaceViewTabId(record.view.id)));
    const remaining = tabIds.value.filter((id) => !isWorkspaceViewTab(id) || keys.has(id));
    if (remaining.length !== tabIds.value.length) {
      for (const id of tabIds.value) if (!remaining.includes(id)) removeTabNavigation(id);
      tabIds.value = remaining;
      if (isWorkspaceViewTab(activeId.value) && !keys.has(activeId.value)) activeId.value = tabIds.value[0] ?? '';
    }
  });
  watch(() => workspace.value?.id, () => { activePluginSidebar.value = ''; pluginSettingsRequest.value = undefined; });
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
  const tabTarget = (id: string) => tabAliases.value.get(id) ?? id;
  function newTabAlias(target: string) {
    const id = isTableTab(target)
      ? `${target}:${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
      : `tab:${crypto.randomUUID()}`;
    tabAliases.value = new Map(tabAliases.value).set(id, target);
    return id;
  }
  function removeTabAlias(id: string) {
    if (!tabAliases.value.has(id)) return;
    const next = new Map(tabAliases.value);
    next.delete(id);
    tabAliases.value = next;
  }
  const active = computed(() => documents.value.find((d) => d.id === tabTarget(activeId.value)));
  const tabs = computed<DocumentTab[]>(() =>
    tabIds.value.map((id) => {
      const targetId = tabTarget(id);
      const document = documents.value.find((doc) => doc.id === targetId);
      const attachmentPreview = id.startsWith('attachment:');
      const attachment = attachmentPreview ? workspace.value?.files.find(file => file.id === id.slice('attachment:'.length) && file.kind === 'file') : undefined;
      const table = dataTables.records.value.find(record => tableTabId(record.fileId) === targetId);
      const tableFile = isTableTab(targetId) ? workspace.value?.files.find(file => file.id === tableFileId(targetId)) : undefined;
      const tablePath = tableFile ? displayPath(tableFile) : table?.path;
      const workspaceView = workspaceViews.value.find(record => workspaceViewTabId(record.view.id) === targetId);
      return { id, path: document ? displayPath(document) : attachment ? displayPath(attachment) : tableFile ? displayPath(tableFile) : workspaceView?.path ?? tablePath ?? (attachmentPreview ? '附件不可用' : ''), blank: id.startsWith('blank:'), graph: id === GRAPH_TAB_ID, plugins: id === PLUGINS_TAB_ID, calendar: id === CALENDAR_TAB_ID, view: views.value.get(id), workspaceView, pluginView: pluginViews.value.find(view => view.key === id && view.location === 'tab'), document, attachmentPreview, attachment,
        ...(isTableTab(targetId) ? { dataTable: { name: tablePath ? dataTableName(tablePath) : '数据表不可用', dirty: !!table && dataTables.dirty(table) } } : {}) };
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
      if (isNavigationPage(id) || pluginViews.value.some(view => view.key === id && view.location === 'tab') || tabIds.value.includes(id) || workspace.value?.files.some((file) =>
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
      if (isNavigationPage(id) || pluginViews.value.some(view => view.key === id && view.location === 'tab')) await openPageTab(id, { historyIndex: index });
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
  const remembersStartupWorkspace = !isDemo && !isWeb && !detachedTabId;
  const dirty = (doc: OpenDocument) => !!doc.creating || doc.content !== doc.base.content;
  const layoutPending = (doc: OpenDocument) => !!doc.tableLayout && layoutDirty(doc.tableLayout) &&
    doc.tableLayout.conflict?.draft !== JSON.stringify(doc.tableLayout.file);
  const suggestionPersistence = shallowRef<{ flush: () => Promise<void>; pending: () => boolean }>();
  const pending = computed(() => fileMutations.pending.value || dataTables.records.value.some(dataTables.dirty) || !!suggestionPersistence.value?.pending() || documents.value.some((d) => (dirty(d) || layoutPending(d)) && !d.conflict));
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  let watchTimer: ReturnType<typeof setTimeout> | undefined;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let unwatch: (() => void) | undefined;
  let refreshRunning = false;
  let refreshPending = false;
  let chain: Promise<unknown> = Promise.resolve();
  let creationChain: Promise<unknown> = Promise.resolve();
  let creationRevision = 0;
  const creationTasks = new Map<string, Promise<boolean>>();
  let disposed = false;
  let sessionReady = false;
  let sessionBlocked = false;
  let pendingSession: { id: string; payload: WorkspaceSession } | undefined;
  let journalTask: Promise<void> = Promise.resolve();
  let journalWriting = false;
  let beforeSwitch: (() => Promise<void>) | undefined;
  let afterSwitch: (() => Promise<void>) | undefined;
  let beforeCloseDocument: ((id: string) => Promise<void>) | undefined;
  let fileOpenRevision = 0;
  function queueSession() {
    if (detachedTabId || !sessionReady || sessionBlocked || !workspace.value || !adapter.saveSession) return;
    pendingSession = {
      id: workspace.value.id,
      payload: {
        version: 1,
        activeId: activeId.value,
        // Alias tabs are a live UI detail.  Persist one canonical tab per
        // document so a restart cannot restore an id whose alias map is gone.
        tabs: [...new Set(tabIds.value.map(tabTarget))],
        layout: JSON.parse(JSON.stringify(layout.value)) as WorkspaceLayout,
        dataTables: dataTables.drafts(),
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
  const stopSessionWatch = watch([documents, tabIds, activeId, layout, dataTables.records], queueSession, {
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
  async function initialize(requestedWorkspace?: string) {
    if (detachedTabId && detachedWorkspacePath) await openWorkspace(detachedWorkspacePath);
    else if (isDemo || isWeb) {
      await openWorkspace(requestedWorkspace);
      if (!workspace.value && requestedWorkspace) await openWorkspace();
      if (isWeb) await refreshWorkspaces();
    } else if (requestedWorkspace) {
      await openWorkspace(requestedWorkspace);
    } else if (adapter.recent && await refreshWorkspaces()) {
      const savedId = readStartupWorkspace();
      const previous = savedId === undefined
        ? recent.value.reduce<RecentWorkspace | undefined>((latest, item) =>
          !latest || item.openedAt > latest.openedAt ? item : latest, undefined)
        : recent.value.find(item => item.id === savedId);
      if (previous) await openWorkspace(previous.path);
      else if (savedId) rememberStartupWorkspace(null);
    }
  }
  async function refreshWorkspaces() {
    if (!adapter.recent) return false;
    try {
      recent.value = await adapter.recent();
      recent.value = recent.value.map(item => ({ ...item, name: workspaceNames.get(item.id) ?? item.name,
        ...(item.id === workspaceSettingsScope ? { icon: workspaceSettings.value.icon } : {}) }));
      return true;
    } catch (error) {
      report(error);
      return false;
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
        pluginExecutor.dispose();
        fatal.value = '';
        if (!detachedTabId && (newName !== undefined || next.newlyCreated)) {
          try {
            next = await addWorkspaceWelcome(adapter, next);
          } catch (error) {
            report(`工作区已创建，但入门文档未能添加：${String(error)}。可以继续新建文档。`);
          }
        }
        workspaceSettingsScope = '';
        workspaceSettingsBase = null;
        workspaceSettings.value = { ...defaultWorkspaceSettings };
        workspaceSettingsError.value = '';
        workspace.value = next;
        if (remembersStartupWorkspace) rememberStartupWorkspace(next.id);
        objects.value = []; objectErrors.value = [];
        workspaceViews.value = []; workspaceViewErrors.value = [];
        capabilityBase = null;
        capabilities.value = structuredClone(defaultCapabilities);
        await dataTables.reload();
        // These reads all use the committed workspace snapshot and do not
        // depend on one another. Keep the switch responsive by sharing the
        // network and filesystem wait instead of paying for three serial
        // round trips on every online workspace change.
        await Promise.all([
          refreshWorkspaceSettings(),
          refreshObjects(),
          refreshCapabilities(),
        ]);
        assistantEpoch.value++;
        assistantApplied.clear();
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
          next.files.find(f => f.id === workspaceSettings.value.homePageId && f.kind === 'file' && isMarkdown(f.path)) ??
          next.files.find((f) => f.path === workspaceWelcomePath) ??
          next.files.find((f) => /^readme\.md$/i.test(f.path)) ??
          next.files.find((f) => f.kind === 'file' && isMarkdown(f.path) && !isWorkspaceInternalPath(f.path));
        if (detachedTabId) {
          if (detachedTabId === GRAPH_TAB_ID) await openGraphTab({ newTab: true });
          else if (detachedTabId === PLUGINS_TAB_ID) await openPluginsTab({ newTab: true });
          else if (detachedTabId === CALENDAR_TAB_ID) openCalendarTab();
          else if (isTableTab(detachedTabId)) await openPageTab(detachedTabId, { newTab: true });
          else if (isWorkspaceViewTab(detachedTabId)) await openWorkspaceView(workspaceViewId(detachedTabId)!, { newTab: true });
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
        recent.value = recent.value.map(item => ({ ...item, name: workspaceNames.get(item.id) ?? item.name }));
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
  function createWorkspace(name?: string) {
    if (name === undefined) {
      const spaces = [...recent.value, ...(workspace.value ? [workspace.value] : [])];
      // Local display names can change independently of their backing folder names.
      const occupied = new Set(spaces.flatMap(space => [space.name, basename(space.path.replace(/\\/g, '/'))]));
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
        if (detachedTabId) throw new Error('请在主工作台删除工作区');
        if (!adapter.deleteWorkspace || !workspace.value.canDelete)
          throw new Error(isWeb ? '仅工作区所有者可以删除工作区' : '此平台暂不支持删除本地工作区注册');
      };
      assertDeletion();
      if (!(await flush())) {
        report(`还有未保存的修改。请先处理保存错误，再${deleteId === undefined ? '退出' : '删除'}工作区。`);
        return false;
      }
      await beforeSwitch?.();
      await serial(async () => {
        assertDeletion();
        const current = workspace.value;
        if (!current) return;
        queueSession();
        await journalTask;
        if (deleteId !== undefined) await adapter.deleteWorkspace!(deleteId);
        else if (!detachedTabId) await adapter.close?.(current.id);
        if (remembersStartupWorkspace) rememberStartupWorkspace(null);
        sessionReady = false;
        stopWatching();
        pluginHost.dispose();
        pluginExecutor.dispose();
        workspace.value = null;
        dataTables.reset();
        workspaceSettingsScope = '';
        workspaceSettingsBase = null;
        workspaceSettings.value = { ...defaultWorkspaceSettings };
        workspaceSettingsError.value = '';
        assistantEpoch.value++;
        assistantApplied.clear();
        documents.value = [];
        tabIds.value = [];
        tabAliases.value = new Map();
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
        if (deleteId !== undefined) {
          workspaceNames.delete(deleteId);
          recent.value = recent.value.filter(item => item.id !== deleteId);
          referenceDocumentCache.clear();
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
  async function restoreSession(saved: WorkspaceSession) {
    await dataTables.restore(saved.dataTables ?? []);
    tabAliases.value = new Map();
    const remapped = new Map<string, string>();
    for (const id of saved.tabs ?? [])
      if (isTableTab(id) && id !== TABLES_TAB_ID) remapped.set(id, tableTabId(dataTableFileId(tableFileId(id))));
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
        creating: file?.pendingCreation,
        missing: !file,
      };
      if (!doc.creating) await hydrateDocumentLayout(doc);
      documents.value.push(doc);
      remapped.set(tab.id, doc.id);
      activity('已恢复未保存草稿', doc.path, 'file');
      if (file) {
        try {
          if (!doc.creating) await reconcile(doc, await adapter.read(file.path));
          await saveInternal(documents.value.find(item => item.id === doc.id)!);
        } catch (error) {
          doc.error = String(error);
          report(error);
        }
      } else doc.error = '原文件已不存在，恢复草稿已保留，请另存副本';
    }
    const restored = saved.tabs
      ?.map((id) => remapped.get(id) ?? id)
      .filter((id) => id !== TABLES_TAB_ID && (isUtilityTab(id) || documents.value.some((doc) => doc.id === id)));
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
        const ordered = reordered.map(tabTarget).filter((id, index, all) => all.indexOf(id) === index)
          .map(id => byId.get(id)).filter((doc): doc is OpenDocument => !!doc);
        documents.value = [...ordered, ...documents.value.filter(doc => !ordered.includes(doc))];
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
  async function openInternal(file: FileEntry, replaceId?: string, current = () => true) {
    // The tree may already show a pending rename; storage still uses its
    // confirmed path until the background mutation completes.
    file = workspace.value?.files.find(entry => entry.id === file.id) ?? file;
    if (file.kind === 'file' && isDataTableFilePath(file.path)) {
      activateTab(tableTabId(file.id), replaceId);
      return;
    }
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
        creating: file.pendingCreation,
        missing: false,
      };
      if (!doc.creating) await hydrateDocumentLayout(doc);
    }
    if (!current()) return;
    activateTab(doc.id, replaceId, doc);
    const opened = documents.value.find(item => item.id === doc!.id)!;
    if (opened.creating) void confirmCreation(opened).then(confirmed => {
      if (confirmed && !disposed && dirty(opened)) void flush();
    });
  }
  async function prepareTabReplacement(id?: string) {
    if (id && isTableTab(id) && !(await flush())) {
      report('此数据表尚未保存，请先处理保存错误。');
      return false;
    }
    if (suggestionPersistence.value?.pending() && !(await flush())) return false;
    const current = documents.value.find((doc) => doc.id === tabTarget(id ?? ''));
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
    if (!adapter.prefetch || busy.value || disposed || file.kind !== 'file' || !isMarkdown(file.path)) return;
    const entry = workspace.value?.files.find(entry => entry.id === file.id);
    if (!entry || entry.pendingCreation) return;
    // This is only a hint. Opening still reports real read errors and validates
    // the current version; hovering must never surface an error banner.
    void adapter.prefetch(entry.path).catch(() => {});
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      if (workspace.value?.files.some(file => file.path === path))
        void adapter.prefetch(path).catch(() => {});
    }
  }
  function openCached(file: FileEntry, replaceId?: string) {
    if (fileMutations.pending.value) return false;
    const existing = documents.value.find(doc => doc.id === file.id);
    if (existing) { activateTab(existing.id, replaceId, existing); return true; }
    const entry = workspace.value?.files.find(entry => entry.id === file.id);
    if (!entry || entry.pendingCreation) return false;
    const snapshot = adapter.readCached?.(entry.path);
    if (!snapshot) return false;
    const doc: OpenDocument = { id: entry.id, path: entry.path, content: snapshot.content,
      base: snapshot, saving: false, missing: false };
    if (/^[0-9a-f]{6}$/.test(entry.id)) {
      const path = documentLayoutPath(entry.id);
      const exists = workspace.value!.files.some(file => file.path === path);
      const base = exists ? adapter.readCached?.(path) : null;
      if (exists && !base) return false;
      try {
        doc.tableLayout = { base: base ?? null, file: base ? parseDocumentLayout(base.content, entry.id)
          : { version: 1, fileId: entry.id, tables: [] } };
      } catch { return false; } // The ordinary loader reports malformed layouts.
    }
    // Cache lookup and activation are synchronous. A background workspace scan
    // can reconcile later; it must not make displaying known bytes wait on I/O.
    activateTab(doc.id, replaceId, doc);
    return true;
  }
  async function openFile(file: FileEntry, options?: { historyIndex?: number }) {
    const creationAtRequest = creationRevision;
    const request = ++fileOpenRevision;
    const epoch = assistantEpoch.value, activation = activationRevision;
    const workspaceId = workspace.value?.id;
    const current = () => !disposed && !busy.value && request === fileOpenRevision &&
      creationAtRequest === creationRevision && epoch === assistantEpoch.value &&
      workspaceId === workspace.value?.id && activation === activationRevision;
    try {
      if (file.kind === 'file' && isDataTableFilePath(file.path)) return openDataTable(file.id, options);
      if (!isMarkdown(file.path) || file.kind !== 'file') return;
      const replaceId = isUtilityTab(activeId.value) && !activeId.value.startsWith('blank:') && !isNavigationPage(activeId.value)
        ? undefined : activeId.value;
      const wasOpen = documents.value.some((doc) => doc.id === file.id);
      prefetchFile(file);
      if (!wasOpen && !(await prepareTabReplacement(replaceId))) return;
      if (!current()) return;
      if (!openCached(file, replaceId)) await serial(async () => {
        if (!current()) return;
        await openInternal(file, replaceId, current);
      });
      if (!wasOpen && replaceId && activeId.value === file.id)
        recordTabNavigation(replaceId, file.id, options?.historyIndex);
      else if (!replaceId && activeId.value === file.id)
        ensureTabNavigation(file.id, file.id);
      if (active.value?.id === file.id) recordHelpCompleted('welcome');
    } catch (e) {
      if (current()) report(e);
    }
  }
  async function openFileInNewTab(file: FileEntry) {
    try {
      await serial(async () => {
        if (file.kind === 'file' && isDataTableFilePath(file.path)) {
          const target = tableTabId(dataTableFileId(file.id));
          if (tabIds.value.includes(target)) {
            const alias = newTabAlias(target);
            tabIds.value.push(alias);
            activeId.value = alias;
            ensureTabNavigation(alias, target);
            touchNavigation();
          } else await openDataTable(file.id, { newTab: true });
          return;
        }
        const target = file.id;
        if (tabIds.value.includes(target)) {
          const alias = newTabAlias(target);
          tabIds.value.push(alias);
          activeId.value = alias;
          ensureTabNavigation(alias, target);
          touchNavigation();
          return;
        }
        await openInternal(file);
        if (activeId.value === file.id) ensureTabNavigation(file.id, file.id);
      });
      if (active.value?.id === file.id) recordHelpCompleted('welcome');
    } catch (error) {
      report(error);
    }
  }
  function openAttachmentInNewTab(file: FileEntry) {
    if (!workspace.value || file.kind !== 'file' || isMarkdown(file.path) || isDataTableFilePath(file.path) ||
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
        if (!files.length || files.some((file) => !file || file.kind !== 'file' || !(isMarkdown(file.path) || isDataTableFilePath(file.path)))) return;
        // Keep a stable neighbor while reads are pending and already-open tabs move.
        const moving = new Set(files.map(file => isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id));
        const following = tabIds.value.slice(Math.max(0, index)).filter((id) => !moving.has(id));
        for (const file of files) {
          await openInternal(file!);
          if (active.value?.id === file!.id) recordHelpCompleted('welcome');
          const id = isDataTableFilePath(file!.path) ? tableTabId(file!.id) : file!.id;
          ensureTabNavigation(id, id);
          const target = following.find((id) => tabIds.value.includes(id));
          if (target) moveDocument(id, target, 'before');
          else placeTab(id, tabIds.value.length);
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
  async function openGraphTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(GRAPH_TAB_ID, options);
    if (workspace.value && activeId.value === GRAPH_TAB_ID) recordHelpCompleted('graph');
  }
  async function openWorkspaceView(id: string, options?: { newTab?: boolean; historyIndex?: number }) {
    if (!workspaceViews.value.some((record) => record.view.id === id)) throw new Error('工作区视图已不存在，请刷新后重试');
    await openPageTab(workspaceViewTabId(id), options);
  }
  async function openPluginsTab(options?: { newTab?: boolean; historyIndex?: number }) {
    await openPageTab(PLUGINS_TAB_ID, options);
    if (workspace.value && activeId.value === PLUGINS_TAB_ID) recordHelpCompleted('plugins');
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
  function readGraphDocument(expectedWorkspace: Pick<Workspace, 'id' | 'path'>, file: Pick<FileEntry, 'id'> & Partial<Pick<FileEntry, 'path'>>) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace.id || workspace.value.path !== expectedWorkspace.path)
        throw new Error('工作区已切换');
      const entry = workspace.value.files.find(entry => entry.id === file.id && (file.path === undefined || entry.path === file.path));
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
  async function reviewAssistantStructure(proposal: AssistantProposal, accepted?: AssistantPreview, automatic = false, signal?: AbortSignal, external = false) {
    if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
    await refreshObjects();
    if (objectErrors.value.length || relationError.value) throw new Error('请先处理工作区对象或关系记录错误');
    let disk: FileSnapshot | null = null;
    let content = proposal.content;
    const validateAgentObject = (object: WorkspaceObject, base?: WorkspaceObject) => {
      const definition = objectTypeRegistry.get(object.type);
      if (!definition || definition.storage !== 'record' || definition.retired) throw new Error('对象类型不可编辑');
      if (base && (base.id !== object.id || base.type !== object.type || base.properties.syncReadOnly === true)) throw new Error('对象身份不可修改或对象为只读');
      validateObjectProperties(object.type, object.properties);
    };
    if (proposal.kind === 'object') {
      const object = parseObject(content);
      if (proposal.base) {
        const base = parseObject(proposal.base);
        validateAgentObject(object, base);
        const file = workspace.value!.files.find(file => file.id === proposal.fileId && file.path === proposal.path);
        const record = objects.value.find(record => record.object.id === base.id && record.path === file?.path);
        if (!file || !record || file.readOnly) throw new Error('对象已删除、移动、只读或身份变化');
        disk = record.snapshot;
        const merged = mergeObject(base, object, record.object);
        if (!merged) return { status: 'conflict' as const, preview: { before: disk.content, after: content, diskHash: disk.hash, path: proposal.path } };
        validateAgentObject(merged, record.object);
        content = JSON.stringify(merged, null, 2) + '\n';
      } else {
        if (proposal.path !== `${objectDirectory}/${object.id}.tano.json` || object.archived)
          throw new Error('新增对象路径或归档状态无效');
        validateAgentObject(object);
        if (automatic && object.properties.checkable === true && possibleDuplicateTasks(referenceTargets.value, object.name, object.id).length)
          throw new Error('发现可能重复的任务，已暂停创建，请核对后决定是否仍需新增');
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
    signal?.throwIfAborted();
    if (disk) {
      const written = await adapter.write(proposal.path, preview.after, disk.hash);
      if (written.status === 'missing') throw new Error('关系文件在保存前移除，请重新审阅');
      if (written.status !== 'saved') return { status: 'stale' as const, preview: undefined };
     } else if (external && proposal.kind === 'object') {
      if (!adapter.createAgentRecord) throw new Error('此宿主不支持安全创建外部对象提案');
      await adapter.createAgentRecord(proposal.path, preview.after);
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
      const file = refreshed.files.find(file => file.id === fileId && file.kind === 'file' && isAssistantFile(file.path));
      if (!file) throw new Error('参考文档已移除');
      const disk = await adapter.read(file.path);
      const doc = documents.value.find(doc => doc.id === fileId);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理参考文档的冲突或缺失');
      const content = isDataTableFilePath(file.path)
        ? assistantTableContent(disk, dataTables.records.value.find(state => state.fileId === fileId))
        : doc?.content ?? disk.content;
      if (content.length > 512_000) throw new Error('参考文档过大，请使用较小文档');
      return { id: '', workspaceId: scope.id, fileId, path: file.path, content,
        hash: await assistantHash(content), origin: content !== disk.content ? 'draft' : 'disk' };
    });
  }
  async function assistantSearch(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, query: string) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const hits = await adapter.search?.(scope.id, query) ?? [];
      const refreshed = await adapter.refresh();
      requireAssistantWorkspace(scope);
      if (refreshed.id !== scope.id || refreshed.path !== scope.path) throw new Error('工作区身份已变化');
      const result = hits.filter(hit => refreshed.files.some(file => file.id === hit.id && isMarkdown(file.path) && isAssistantFile(file.path)))
        .map(hit => ({ fileId: hit.id, path: hit.path, excerpt: hit.excerpt }));
      const needle = query.trim().toLocaleLowerCase();
      if (!needle) for (const file of refreshed.files.filter(file => file.kind === 'file' && isMarkdown(file.path) && isAssistantFile(file.path)))
        result.push({ fileId: file.id, path: file.path, excerpt: '' });
      for (const file of refreshed.files.filter(file => file.kind === 'file' && isDataTableFilePath(file.path) && isAssistantFile(file.path))) {
        if (result.some(hit => hit.fileId === file.id)) continue;
        const state = dataTables.records.value.find(state => state.fileId === file.id);
        let text = '';
        try { text = assistantTableContent(await adapter.read(file.path), state); }
        catch { /* Invalid tables remain discoverable by path, never treated as valid content. */ }
        const index = text.toLocaleLowerCase().indexOf(needle);
        if (!needle || file.path.toLocaleLowerCase().includes(needle) || index >= 0)
          result.push({ fileId: file.id, path: file.path, excerpt: text.slice(Math.max(0, index - 40), Math.max(0, index - 40) + 240) });
      }
      return result.slice(0, 20);
    });
  }
  async function reviewAssistantProposal(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, proposal: AssistantProposal,
    accepted?: AssistantPreview, automatic = false, signal?: AbortSignal, external = false) {
    return serial(() => reviewAssistantProposalNow(scope, proposal, accepted, automatic, signal, external));
  }
  async function reviewAssistantProposalNow(scope: Pick<Workspace, 'id' | 'path'> & { epoch?: number }, proposal: AssistantProposal,
    accepted?: AssistantPreview, automatic = false, signal?: AbortSignal, external = false) {
      signal?.throwIfAborted();
      requireAssistantWorkspace(scope);
      if (proposal.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const signature = JSON.stringify([scope, proposal.kind, proposal.fileId, proposal.path, proposal.destination, proposal.base, proposal.content, external]);
      const applied = assistantApplied.get(proposal.id);
      if (applied) {
        if (applied.signature !== signature) throw new Error('同一操作标识不能对应不同建议');
        return { status: 'saved' as const, applied };
      }
      const refreshed = await adapter.refresh();
      if (refreshed.id !== scope.id || refreshed.path !== scope.path) throw new Error('工作区身份已变化');
      workspace.value = refreshed;
      if (proposal.kind === 'edit' && isMarkdown(proposal.path) && proposal.fileId && /^[0-9a-f]{6}$/.test(proposal.fileId)) {
        const published = await loadSuggestions(adapter, scope.id, proposal.fileId);
        if (published.file.suggestions.some(item => item.groupId === proposal.id))
          throw new Error('此提案已转为文档建议，请在文档中逐项审阅，不能再次整篇应用');
      }
      if (proposal.kind === 'object' || proposal.kind === 'relation') {
        const result = await reviewAssistantStructure(proposal, accepted, automatic, signal, external);
        if (result.status === 'saved') {
          assistantApplied.set(proposal.id, { signature, ...result.applied });
          activity('助手工作区建议已应用', proposal.path, 'save', { before: result.applied.before, after: result.applied.after });
        }
        return result;
      }
      if (['delete', 'rename', 'move'].includes(proposal.kind)) {
        if (!adapter.changeFile) throw new Error('当前工作区暂不支持文件操作建议');
        const file = refreshed.files.find(file => file.id === proposal.fileId && file.kind === 'file');
        if (!file) throw new Error('目标文档已删除或身份变化');
        if (file.readOnly || !isAssistantFile(file.path)) throw new Error('目标文件只读或路径无效');
        const destination = proposal.destination;
        if (proposal.kind !== 'delete') {
          if (!destination || !validAssistantDestination(file.path, destination) || file.path === destination)
            throw new Error('目标文档路径无效或已位于目标位置，请核对文件');
          if (refreshed.files.some(entry => pathKey(entry.path) === pathKey(destination))) throw new Error('目标名称已经存在');
          const parent = parentPath(destination);
          if (parent && !refreshed.files.some(entry => entry.path === parent && entry.kind === 'directory')) throw new Error('目标文件夹不存在');
        } else if (destination !== undefined) throw new Error('删除建议不能包含目标路径');
        const doc = documents.value.find(doc => doc.id === file.id);
        const table = dataTables.records.value.find(state => state.fileId === file.id);
        const tablePending = () => table && (dataTables.dirty(table) || table.error || table.unavailable || table.saving);
        if (tablePending()) throw new Error('请先保存数据表并处理冲突，再审阅文件操作');
        if (doc && (dirty(doc) || doc.conflict || doc.missing || doc.saving || layoutPending(doc)))
          throw new Error('请先保存文档并处理冲突，再审阅文件操作');
        const disk = await adapter.read(file.path);
        const preview: AssistantPreview = { before: disk.content, after: proposal.kind === 'delete' ? '' : disk.content,
          path: file.path, diskHash: disk.hash, ...(destination ? { destination } : {}) };
        if (automatic && (file.path !== proposal.path || disk.content !== proposal.base))
          throw new Error('读取后文件内容或位置已变化，已暂停文件操作，请核对后处理');
        if (!accepted) return { status: 'preview' as const, preview };
        if (JSON.stringify(preview) !== JSON.stringify(accepted)) return { status: 'stale' as const, preview };
        writable();
        if (tablePending()) throw new Error('数据表已变化，请先保存后重新审阅');
        // Read can yield while a user types. Never remove a newly changed draft.
        if (doc && (dirty(doc) || doc.conflict || doc.missing || doc.saving || layoutPending(doc))) throw new Error('文档已变化，请先保存后重新审阅');
        signal?.throwIfAborted();
        const changed = await adapter.changeFile({ workspaceId: scope.id, fileId: file.id, path: file.path, expectedHash: disk.hash,
          ...(destination ? { destination } : {}) });
        if (changed.status === 'missing') throw new Error('目标文档已在应用前删除');
        if (changed.status === 'conflict') return { status: 'stale' as const,
          preview: { ...preview, before: changed.snapshot.content, after: proposal.kind === 'delete' ? '' : changed.snapshot.content, diskHash: changed.snapshot.hash } };
        const receipt = { signature, before: changed.snapshot.content, after: proposal.kind === 'delete' ? '' : changed.snapshot.content,
          hash: changed.snapshot.hash, fileId: file.id };
        assistantApplied.set(proposal.id, receipt);
        if (proposal.kind === 'delete') {
          const tableTab = tableTabId(file.id);
          if (table && dataTables.dirty(table)) table.unavailable = true;
          else if (isDataTableFilePath(file.path)) {
            dataTables.records.value = dataTables.records.value.filter(state => state.fileId !== file.id);
            tabIds.value = tabIds.value.filter(id => tabTarget(id) !== tableTab);
            for (const id of [...tabAliases.value.keys()]) if (tabTarget(id) === tableTab) { removeTabAlias(id); removeTabNavigation(id); }
            removeTabNavigation(tableTab);
            if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
          }
          if (doc && (dirty(doc) || layoutPending(doc))) doc.missing = true; // Preserve input received during the native operation for Save Copy.
          else {
            documents.value = documents.value.filter(item => item.id !== file.id);
            tabIds.value = tabIds.value.filter(id => tabTarget(id) !== file.id);
            for (const id of [...tabAliases.value.keys()]) if (tabTarget(id) === file.id) { removeTabAlias(id); removeTabNavigation(id); }
            removeTabNavigation(file.id);
            if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
          }
        } else if (doc) doc.path = destination!;
        // Record success before refresh so a failed refresh cannot cause a destructive retry.
        proposal.applied = receipt;
        proposal.status = 'applied';
        workspace.value = await adapter.refresh();
        if (isDataTableFilePath(file.path)) await dataTables.reload();
        activity('助手文件变更已应用', destination ? `${file.path} → ${destination}` : file.path, 'file');
        return { status: 'saved' as const, applied: receipt };
      }
      let disk: FileSnapshot | null = null;
      let doc: OpenDocument | undefined;
      let path = proposal.path;
      let current = '';
      if (proposal.kind === 'create') {
        if (proposal.base !== '') throw new Error('新建文件不能包含已有内容基线');
        validateAssistantContent(path, proposal.content);
        if (refreshed.files.some(file => pathKey(file.path) === pathKey(path))) throw new Error('同名文件已存在，请调整建议路径');
        if (parentPath(path) && !refreshed.files.some(file => file.kind === 'directory' && file.path === parentPath(path))) throw new Error('目标文件夹不存在');
      } else {
        const file = refreshed.files.find(file => file.id === proposal.fileId && file.kind === 'file' && isAssistantFile(file.path));
        if (!file) throw new Error('目标文档已删除或身份变化');
        if (file.readOnly) throw new Error('目标文档只读');
        path = file.path;
        disk = await adapter.read(path);
        validateAssistantContent(path, proposal.content, proposal.base);
        if (isDataTableFilePath(path)) {
          const result = await reviewAssistantTable({ adapter, proposal, path, disk, accepted, writable, signal,
            state: dataTables.records.value.find(state => state.fileId === file.id) });
          if (result.status === 'saved') {
            assistantApplied.set(proposal.id, { signature, ...result.applied });
            activity('助手数据表修改已应用', path, 'save', { before: result.applied.before, after: result.applied.after });
            await dataTables.reload();
          }
          return result;
        }
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
      signal?.throwIfAborted();
      const draftBefore = doc?.content;
      if (doc) doc.saving = true;
      try {
        let result: FileSnapshot;
        let fileId: string;
        if (proposal.kind === 'create') {
          if (external && isDataTableFilePath(path)) {
            if (!adapter.createAgentRecord) throw new Error('此宿主不支持安全创建外部数据表提案');
            await adapter.createAgentRecord(path, preview.after);
          } else await adapter.create(path, preview.after);
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
        if (isDataTableFilePath(path)) await dataTables.reload();
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
  function editDocument(id: string, content: string, options: { origin?: 'local' | 'remote' } = {}) {
    const doc = documents.value.find((document) => document.id === id);
    if (!doc || doc.conflict || workspace.value?.readOnly || workspace.value?.files.find(file => file.id === id)?.readOnly) return;
    const before = doc.content;
    doc.content = content;
    if (!doc.creating) doc.error = undefined;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      void flush();
    }, 600);
    if (options.origin !== 'remote') helpEdits.record(id, before, content, referenceTargets.value);
  }
  function receiveDocument(id: string, content: string, options: { origin?: 'local' | 'remote' } = {}) {
    const doc = documents.value.find((document) => document.id === id);
    if (!doc || doc.conflict || doc.missing) return;
    const before = doc.content;
    doc.content = content;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { void flush(); }, 600);
    if (options.origin === 'local') helpEdits.record(id, before, content, referenceTargets.value);
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
    if (doc.creating && !(await confirmCreation(doc))) return;
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
    await fileMutations.flush();
    return flushDocuments();
  }
  async function flushDocuments(): Promise<boolean> {
    await creationChain;
    try { await suggestionPersistence.value?.flush(); }
    catch (error) { report(error); return false; }
    clearTimeout(saveTimer);
    const saved = await serial(async () => {
      const tablesSaved = await dataTables.persistAll();
      for (const doc of documents.value) { await saveInternal(doc); await saveTableLayout(doc); }
      return tablesSaved && documents.value.every((doc) => (!dirty(doc) || !!doc.conflict) &&
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
        await refreshWorkspaceSettings();
        await refreshObjects();
        await dataTables.reload();
        for (const doc of documents.value) {
          if (doc.creating) continue;
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
    const created = folder
      ? await adapter.createFolder(path)
      : await adapter.create(path, content ?? '');
    workspace.value = created ?? await adapter.refresh();
    activity(folder ? '文件夹已创建' : '文档已创建', path, 'file');
    const file = workspace.value.files.find((f) => f.path === path);
    if (file?.kind === 'directory' && folder) recordHelpCompleted('create-folder');
    else if (file?.kind === 'file' && isMarkdown(file.path)) recordHelpCompleted('create-document');
    if (file && !folder) {
      const replaceId = activeId.value.startsWith('blank:') ? activeId.value : undefined;
      await openInternal(file, replaceId);
      if (active.value?.id === file.id) recordHelpCompleted('welcome');
      if (replaceId) recordTabNavigation(replaceId, file.id);
      else ensureTabNavigation(file.id, file.id);
    }
  }
  function confirmCreation(doc: OpenDocument): Promise<boolean> {
    const workspaceId = workspace.value?.id;
    if (!doc.creating || !workspaceId || !adapter.commitCreate) return Promise.resolve(!doc.creating);
    const key = `${workspaceId}:${doc.id}`;
    const pending = creationTasks.get(key);
    if (pending) return pending;
    doc.saving = true;
    doc.error = undefined;
    const task = (async () => {
      try {
        const confirmed = await adapter.commitCreate!(doc.id);
        if (disposed || workspace.value?.id !== workspaceId || !documents.value.includes(doc)) return false;
        doc.path = confirmed.file.path;
        doc.base = confirmed.snapshot;
        doc.creating = false;
        workspace.value.files = workspace.value.files.map(file => file.id === doc.id ? confirmed.file : file);
        activity('文档已创建', doc.path, 'file');
        recordHelpCompleted('create-document');
        await hydrateDocumentLayout(doc);
        return true;
      } catch (error) {
        if (!disposed && workspace.value?.id === workspaceId) {
          doc.error = `创建未完成：${error instanceof Error ? error.message : String(error)}。草稿已保留，可重试或另存副本。`;
        }
        return false;
      } finally {
        doc.saving = false;
        creationTasks.delete(key);
      }
    })();
    creationTasks.set(key, task);
    return task;
  }
  async function stageDocument(path: string, content = '', expectedWorkspaceId?: string) {
    writable();
    if (busy.value || !workspace.value) throw new Error('工作区正在切换，请稍后重试');
    if (expectedWorkspaceId && workspace.value.id !== expectedWorkspaceId) throw new Error('工作区已切换');
    const staged = await adapter.stageCreate!(path, content);
    creationRevision++;
    workspace.value = staged.workspace;
    const replaceId = activeId.value.startsWith('blank:') ? activeId.value : undefined;
    await openInternal(staged.file, replaceId);
    const doc = documents.value.find(item => item.id === staged.file.id)!;
    if (replaceId) recordTabNavigation(replaceId, doc.id);
    else ensureTabNavigation(doc.id, doc.id);
  }
  function stageSerial(task: () => Promise<void>) {
    // Only local preparation is serialized. Remote confirmation never blocks the
    // next click, even while an autosave is waiting for another creation.
    const next = creationChain.then(task, task);
    creationChain = next.catch(() => {});
    return next;
  }
  async function create(
    path: string,
    folder = false,
    content?: string,
    expectedWorkspaceId?: string,
  ) {
    if (!folder && isMarkdown(path) && adapter.stageCreate && adapter.commitCreate)
      return stageSerial(() => stageDocument(path, content, expectedWorkspaceId));
    await serial(() => createInternal(path, folder, content, expectedWorkspaceId));
  }
  async function createUntitledEntry(parent: string, folder: boolean) {
    const optimistic = !folder && !!adapter.stageCreate && !!adapter.commitCreate;
    await (optimistic ? stageSerial : serial)(async () => {
      writable();
      if (!workspace.value) throw new Error('请先打开一个工作空间');
      if (!optimistic) workspace.value = await adapter.refresh();
      if (parent && !workspace.value.files.some((file) => file.kind === 'directory' && file.path === parent))
        throw new Error('目标文件夹不存在，请重新选择后重试');
      const paths = new Set(workspace.value.files.map((file) => pathKey(file.path)));
      const prefix = `${parent ? `${parent}/` : ''}${folder ? '新建文件夹' : '新建文档'}`;
      const extension = folder ? '' : '.md';
      let path = `${prefix}${extension}`;
      for (let index = 2; paths.has(pathKey(path)); index++) path = `${prefix} ${index}${extension}`;
      if (optimistic) await stageDocument(path);
      else await createInternal(path, folder);
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
      if (receipt.paths.length) recordHelpCompleted('import-document');
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
  function prepareFileMutation(files: Pick<FileEntry, 'id' | 'path' | 'kind'>[], expectedWorkspaceId?: string) {
    writable();
    const current = visibleWorkspace.value;
    if (!current || busy.value || (expectedWorkspaceId && current.id !== expectedWorkspaceId))
      throw new Error('工作空间已切换或正在加载，请重新选择文件');
    for (const file of files) {
      const entry = current.files.find(item => item.id === file.id && item.path === file.path);
      if (!entry) throw new Error('文件位置已变化，请重新选择文件');
      if (entry.readOnly) throw new Error('你对此条目只有阅读权限');
    }
    const affected = current.files.filter(entry => files.some(file => entry.id === file.id ||
      (file.kind === 'directory' && entry.path.startsWith(`${file.path}/`))));
    const ids = new Set(affected.map(file => file.id));
    if (affected.some(file => file.readOnly)) throw new Error('所选范围内有只读条目');
    if (documents.value.some(doc => ids.has(doc.id) && (doc.conflict || doc.missing)))
      throw new Error('请先处理所选文档的冲突或缺失');
    const preview: FileMutationPreview = { workspaceId: current.id, paths: new Map(),
      expected: new Map(workspace.value!.files.filter(file => ids.has(file.id)).map(file => [file.id, { ...file }])) };
    return { current, affected, preview };
  }
  function confirmedEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, affected: FileEntry[]) {
    if (file.kind === 'file') {
      const current = workspace.value?.files.find(entry => entry.id === file.id);
      if (!current) throw new Error('文件已不存在，请刷新工作区');
      return current;
    }
    // Online folders have path-based virtual IDs. Follow a descendant's stable
    // identity when an earlier queued folder move has already been confirmed.
    const child = affected.find(entry => entry.kind === 'file' && entry.path.startsWith(`${file.path}/`));
    const current = child && workspace.value?.files.find(entry => entry.id === child.id);
    const path = current && child ? current.path.slice(0, -child.path.slice(file.path.length).length) : file.path;
    const entry = workspace.value?.files.find(entry => entry.kind === 'directory' && entry.path === path);
    if (!entry) throw new Error('文件夹已不存在，请刷新工作区');
    return entry;
  }
  async function confirmFileMutation(scope: string, run: () => Promise<void>) {
    if (disposed || workspace.value?.id !== scope) throw new Error('工作区已切换');
    try { await run(); }
    catch (error) {
      // A response can fail after the server committed. Recover its actual state
      // without replacing editor content or a newer optimistic presentation.
      try {
        const refreshed = await adapter.refresh();
        if (!disposed && workspace.value?.id === scope && refreshed.id === scope) {
          workspace.value = refreshed;
          for (const doc of documents.value) {
            const file = refreshed.files.find(file => file.id === doc.id);
            if (file) doc.path = file.path;
          }
        }
      } catch { /* Keep the last confirmed state and the user's draft. */ }
      throw error;
    }
  }
  async function renameEntry(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, path: string) {
    if (!isWeb) return renameEntryConfirmed(file, path);
    const invalid = validatePath(path);
    if (invalid) throw new Error(invalid);
    const { current, affected, preview } = prepareFileMutation([file]);
    if (current.files.some(entry => entry.id !== file.id && pathKey(entry.path) === pathKey(path)))
      throw new Error('已经存在一个同名文件');
    if (file.path === path) return;
    preview.paths.set(file.id, path);
    fileMutations.enqueue('重命名', preview, () => confirmFileMutation(preview.workspaceId,
      () => renameEntryConfirmed(confirmedEntry(file, affected), path)));
  }
  async function renameEntryConfirmed(file: Pick<FileEntry, 'id' | 'path' | 'kind'>, path: string) {
    writable();
    const creating = documents.value.some(doc => doc.id === file.id && doc.creating);
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
    if (creating) file = workspace.value?.files.find(entry => entry.id === file.id) ?? file;
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
      await dataTables.reload();
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
      if (file.kind === 'file' && isMarkdown(file.path) && file.path !== path)
        recordHelpCompleted('rename-document');
    });
  }
  async function rename(doc: OpenDocument, path: string) {
    return renameEntry({ id: doc.id, path: displayPath(doc), kind: 'file' }, path);
  }
  async function moveEntry(file: FileEntry, folder: string, expectedWorkspaceId?: string) {
    if (!isWeb) return moveEntryConfirmed(file, folder, expectedWorkspaceId);
    const { current, affected, preview } = prepareFileMutation([file], expectedWorkspaceId);
    const plan = planFileMove(file, folder, current.files);
    for (const item of plan.moved) preview.paths.set(item.entry.id, item.path);
    fileMutations.enqueue('移动', preview, () => confirmFileMutation(preview.workspaceId, async () => {
      const entry = confirmedEntry(file, affected);
      // Keep the destination selected at click time, including its filename.
      await renameEntryConfirmed(entry, plan.destination);
    }));
  }
  async function moveEntryConfirmed(file: FileEntry, folder: string, expectedWorkspaceId?: string) {
    writable();
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
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
        await dataTables.reload();
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
      if (file.kind === 'file' && isMarkdown(file.path) && file.path !== destination)
        recordHelpCompleted('move-document');
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
      await dataTables.reload();
      if (!destination) throw new Error('创建副本没有返回目标路径');
      activity('已创建副本', `${file.path} → ${destination}`, 'file');
      if (file.kind === 'file' && isMarkdown(file.path)) recordHelpCompleted('duplicate-document');
      return destination;
    });
  }
  async function saveCopy(doc: OpenDocument, path: string) {
    const content = doc.content;
    await create(path, false, content);
    if (doc.missing && doc.content === content) {
      documents.value = documents.value.filter((d) => d.id !== doc.id);
      tabIds.value = tabIds.value.filter((id) => tabTarget(id) !== doc.id);
      for (const id of [...tabAliases.value.keys()]) if (tabTarget(id) === doc.id) { removeTabAlias(id); removeTabNavigation(id); }
      if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
    }
  }
  async function removeEntries(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
    expectedContents?: FileEntry[],
  ) {
    if (!isWeb) return removeEntriesConfirmed(files, expectedWorkspaceId, expectedContents);
    if (!files.length) return;
    const { affected, preview } = prepareFileMutation(files, expectedWorkspaceId);
    // Preserve the confirmation dialog's snapshot, rather than silently deleting
    // an external edit which arrived while the dialog was open.
    if (expectedContents) for (const file of affected) {
      const expected = expectedContents.find(entry => entry.id === file.id);
      if (!expected || expected.modified !== file.modified || expected.size !== file.size)
        throw new Error('所选条目内容已变化，请核对后重试');
    }
    const ids = new Set(affected.map(file => file.id));
    const removedTabs = tabIds.value.map((id, index) => ({ id, index })).filter(({ id }) =>
      ids.has(tabTarget(id)) || (isTableTab(id) && ids.has(tableFileId(id))) || (id.startsWith('attachment:') && ids.has(id.slice(11))));
    const removedIds = new Set(removedTabs.map(tab => tab.id));
    const previousActive = activeId.value;
    tabIds.value = tabIds.value.filter(id => !removedIds.has(id));
    if (removedIds.has(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
    const fallbackActive = activeId.value;
    const activationAtRemoval = activationRevision;
    for (const file of affected) preview.paths.set(file.id, null);
    fileMutations.enqueue('删除', preview, () => confirmFileMutation(preview.workspaceId, async () => {
      const current = files.map(file => confirmedEntry(file, affected));
      const expected = current.map(file => ({ ...(preview.expected.get(file.id) ?? file), path: file.path }));
      await removeEntriesConfirmed(current, preview.workspaceId, expected);
    }), () => {
      if (disposed) return;
      for (const tab of removedTabs) {
        const id = tab.id.replace(/^(table:|attachment:)/, '');
        if (workspace.value?.files.some(file => file.id === id) && !tabIds.value.includes(tab.id))
          tabIds.value.splice(Math.min(tab.index, tabIds.value.length), 0, tab.id);
      }
      if (activationRevision === activationAtRemoval && activeId.value === fallbackActive && tabIds.value.includes(previousActive))
        activeId.value = previousActive;
    });
  }
  async function removeEntriesConfirmed(
    files: Pick<FileEntry, 'id' | 'path' | 'kind'>[],
    expectedWorkspaceId?: string,
    expectedContents?: FileEntry[],
  ) {
    writable();
    if (!files.length) return;
    if (files.some((file) => mobile && file.kind === 'directory'))
      throw new Error('手机回收站暂不支持文件夹');
    const locallyModified = new Set(
      documents.value.filter((doc) => dirty(doc)).map((doc) => doc.id),
    );
    const creating = new Set(documents.value.filter(doc => doc.creating).map(doc => doc.id));
    if (!(await flushDocuments())) throw new Error('请先处理未保存的修改');
    files = files.map(file => creating.has(file.id)
      ? workspace.value?.files.find(entry => entry.id === file.id) ?? file : file);
    expectedContents = expectedContents?.map(file => creating.has(file.id)
      ? workspace.value?.files.find(entry => entry.id === file.id) ?? file : file);
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
        const removedTableIds = new Set(workspace.value.files.filter(entry => isDataTableFilePath(entry.path) && (entry.path === file.path || (file.kind === 'directory' && entry.path.startsWith(`${file.path}/`)))).map(entry => tableTabId(entry.id)));
        tabIds.value = tabIds.value.filter((id) => !removedTableIds.has(tabTarget(id)) && (isUtilityTab(id) || remainingIds.has(tabTarget(id))));
        for (const tabId of previousTabIds)
          if (!tabIds.value.includes(tabId)) { removeTabAlias(tabId); removeTabNavigation(tabId); }
        if (activeId.value && !tabIds.value.includes(activeId.value))
          activeId.value = tabIds.value.at(-1) ?? '';
        workspace.value = await adapter.refresh();
        await dataTables.reload();
        activity(
          isDemo
            ? '演示条目已删除'
            : isWeb
              ? file.kind === 'directory'
                ? '在线文件夹已删除'
                : '在线文档已删除'
              : '条目已移入回收站',
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
    return removeEntry({ id: doc.id, path: displayPath(doc), kind: 'file' });
  }
  function moveDocument(id: string, targetId: string, side: 'before' | 'after') {
    if (id === targetId) return;
    if (!tabIds.value.includes(id) || !tabIds.value.includes(targetId)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    const targetIndex = reordered.indexOf(targetId);
    reordered.splice(targetIndex + (side === 'after' ? 1 : 0), 0, id);
    if (reordered.every((tabId, index) => tabId === tabIds.value[index])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    const ordered = reordered.map(tabTarget).filter((id, index, all) => all.indexOf(id) === index)
      .map(id => byId.get(id)).filter((doc): doc is OpenDocument => !!doc);
    documents.value = [...ordered, ...documents.value.filter(doc => !ordered.includes(doc))];
    tabIds.value = reordered;
  }
  function placeTab(id: string, index: number) {
    if (!tabIds.value.includes(id)) return;
    const reordered = tabIds.value.filter((tabId) => tabId !== id);
    reordered.splice(Math.max(0, Math.min(index, reordered.length)), 0, id);
    if (reordered.every((tabId, position) => tabId === tabIds.value[position])) return;
    const byId = new Map(documents.value.map((doc) => [doc.id, doc]));
    const ordered = reordered.map(tabTarget).filter((id, index, all) => all.indexOf(id) === index)
      .map(id => byId.get(id)).filter((doc): doc is OpenDocument => !!doc);
    documents.value = [...ordered, ...documents.value.filter(doc => !ordered.includes(doc))];
    tabIds.value = reordered;
  }
  async function close(id: string) {
    if (isTableTab(id) && !(await flush())) { report('数据表尚有未保存的修改，请先处理保存错误。'); return; }
    const pane = panes.value.find(pane => pane.tabs.includes(id));
    const nextTab = () => {
      const candidate = panes.value.find(item => item.id === pane?.id)?.tabs.find(tabId => tabId !== id && tabIds.value.includes(tabId));
      return candidate ?? tabIds.value.find(tabId => tabId !== id) ?? '';
    };
    if (isUtilityTab(id)) {
      tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
      removeTabAlias(id);
      removeTabNavigation(id);
      if (activeId.value === id) activeId.value = nextTab();
      return;
    }
    if (!(await flush())) { report('此文档尚有未保存的修改或建议，请先处理保存错误。'); return; }
    try {
      await beforeCloseDocument?.(tabTarget(id));
    } catch (error) {
      report(error);
      return;
    }
    const target = tabTarget(id);
    const doc = documents.value.find((d) => d.id === target);
    if (doc && ((dirty(doc) && !doc.conflict) || layoutPending(doc))) {
      report('此文档尚未保存，请先另存副本或解决保存错误。');
      return;
    }
    tabIds.value = tabIds.value.filter((tabId) => tabId !== id);
    removeTabAlias(id);
    removeTabNavigation(id);
    if (!tabIds.value.some(tabId => tabTarget(tabId) === target))
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
    disposed = true;
    helpEdits.dispose();
    pluginDeveloper.stop();
    clearTimeout(pluginEventTimer);
    pluginExecutor.dispose();
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
    dataTableRecords: dataTables.records,
    dataTableErrors: dataTables.errors,
    editDataTable: dataTables.edit,
    undoDataTable: dataTables.undo,
    retryDataTable: dataTables.retry,
    discardDataTable: dataTables.discard,
    copyDataTable: async (source: import('@tano/protocol').DataTable, parent = '') => { const id = await dataTables.create('blank', source, parent); await openDataTable(id); },
    createDataTable,
    renameDataTable,
    openDataTable,
    layout,
    panes,
    activePaneId,
    paneDrop,
    detachingTabId,
    focusPane,
    dockTab,
    resizeSplit,
    installedPlugins,
    pluginRuntime,
    canManagePlugins,
    canManageSettings,
    authorizePlugin,
    restartPlugin,
    rollbackPlugin,
    pluginDevelopment,
    startPluginDevelopment: (id: string, url: string) => pluginDeveloper.start(id, url),
    stopPluginDevelopment: () => pluginDeveloper.stop(),
    pluginStorageUsage: (id: string) => pluginExecutor.storageUsage(workspace.value?.id ?? '', id),
    pluginRepositoryAvailable: !!runtime.plugins?.repository?.usage,
    pluginCatalogSource: runtime.plugins?.catalog?.source ?? '',
    pluginConnectionStorageLabel: runtime.plugins?.connections?.storageLabel ?? '',
    startPluginOAuth: async (workspaceId: string, input: PluginOAuthInput, signal: AbortSignal) => {
      signal.throwIfAborted();
      const installation = installedPlugins.value.find(item => item.manifest.id === input.pluginId);
      const oauth = runtime.plugins?.connections?.oauth;
      if (workspace.value?.id !== workspaceId || !oauth || !installation?.enabled || !installation.authorized || installation.rule?.integrity !== input.integrity ||
        installation.manifest.manifestVersion !== 2 || !installation.manifest.permissions.includes('connections') || !installation.manifest.networkOrigins.includes(input.origin)) throw new Error('请先启用并授权此插件的当前版本');
      const flow = await oauth.start(workspaceId, input, signal);
      signal.throwIfAborted(); if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换');
      return flow;
    },
    loadPluginConnections: async (workspaceId: string, signal: AbortSignal) => {
      if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections) throw new Error('当前工作区未提供凭据连接');
      const connections = await runtime.plugins.connections.list(workspaceId, signal);
      signal.throwIfAborted(); if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换');
      return connections;
    },
    savePluginConnection: async (workspaceId: string, input: PluginConnectionInput, signal: AbortSignal) => {
      signal.throwIfAborted();
      const installation = installedPlugins.value.find(item => item.manifest.id === input.pluginId);
      if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections || !installation?.enabled || !installation.authorized || installation.rule?.integrity !== input.integrity ||
          installation.manifest.manifestVersion !== 2 || !installation.manifest.permissions.includes('connections') || !installation.manifest.networkOrigins.includes(input.origin)) throw new Error('请先启用并授权此插件的当前版本');
      const connection = await runtime.plugins.connections.save(workspaceId, parsePluginConnectionInput(input), signal);
      signal.throwIfAborted(); if (workspace.value?.id !== workspaceId) throw new Error('工作区已切换');
      return connection;
    },
    removePluginConnection: async (workspaceId: string, pluginId: string, origin: string, version: string, signal: AbortSignal) => {
      signal.throwIfAborted(); if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections) throw new Error('工作区已切换');
      await runtime.plugins.connections.remove(workspaceId, pluginId, origin, version, signal);
      signal.throwIfAborted();
    },
    loadPluginCatalog,
    installCatalogRelease,
    canRemovePluginPackage: !!runtime.plugins?.repository?.remove,
    removePluginPackage: (integrity: string, expectedWorkspace: string) => serial(async () => {
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value) throw new Error('工作区或管理权限已变化');
      if (!runtime.plugins?.repository?.remove) throw new Error('当前环境不支持云端包回收');
      await runtime.plugins.repository.remove(expectedWorkspace, integrity);
    }),
    loadPluginPackageUsage: async (expectedWorkspace: string) => {
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value) throw new Error('工作区或管理权限已变化');
      const usage = await runtime.plugins?.repository?.usage?.(expectedWorkspace);
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value) throw new Error('工作区或管理权限已变化');
      return usage;
    },
    clearPluginLogs: (id: string) => pluginExecutor.clearLogs(id),
    cachePluginPackage,
    setPluginEditor: (apply?: (id: string, before: string, after: string) => Promise<boolean>) => { pluginEditorEdit = apply; },
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
    workspaceSettings: visibleWorkspaceSettings,
    workspaceSettingsError,
    workspaceSettingsSaving,
    updateWorkspaceSettings,
    reloadWorkspaceSettings,
    workspace: visibleWorkspace,
    fileRegistry, readFileMetadata, updateFileMetadata, createFileDatabase, saveFileDatabase, createObjectDatabase, deleteObject,
    workspaceViews,
    workspaceViewErrors,
    displayPath,
    fileMutationPending: fileMutations.pending,
    documents,
    documentForTab: (id: string) => documents.value.find(doc => doc.id === tabTarget(id)),
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
    deleteWorkspace,
    createWorkspace,
    openFile,
    prefetchFile,
    openFileInNewTab,
    openAttachmentInNewTab,
    openFilesInNewTabsAt,
    createBlankTab,
    openGraphTab,
    openWorkspaceView,
    openPluginsTab,
    openCalendarTab,
    registerViews,
    pluginViews,
    pluginCommands,
    activePluginSidebar,
    pluginSettingsRequest,
    pluginSettingsPages,
    openPluginView,
    interactWithPlugin,
    openViewTab,
    readGraphDocument,
    assistantSnapshot,
    assistantSearch,
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
