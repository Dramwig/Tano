import { computed, onScopeDispose, ref, shallowRef, watch, type Ref } from 'vue';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import { mergeMarkdown } from '@tano/markdown';
import {
  FileRegistry,
  isMarkdown,
  isWorkspaceInternalPath,
  objectDirectory,
  parseObject,
  parsePluginConnectionInput,
  pluginRecord,
  referenceKey,
  validateObjectProperties,
  validatePath,
  validateRelation,
  type FileEntry,
  type FileSnapshot,
  type PluginConnectionInput,
  type PluginOAuthInput,
  type ReferenceTarget,
  type RelationTypeDefinition,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceRelation,
} from '@tano/protocol';
import { assistantHash } from '../assistant/hash';
import { nativeAttachments } from '../attachments';
import type { useDocumentIndex } from '../document-index';
import { documentDirty as dirty, type OpenDocument } from '../document-session';
import { t } from '../i18n';
import { PluginAttachmentReader } from '../plugins/attachment-reader';
import { PluginQueryPager, pluginChanges } from '../plugins/data';
import type { PluginDevelopmentState } from '../plugins/development';
import type { PluginRuntimeState } from '../plugins/host';
import { canManageWorkspacePlugins } from '../plugins/policy';
import { queryPluginData } from '../plugins/queries';
import {
  pluginViewKey,
  pluginWorkbenchCommands,
  pluginWorkbenchViews,
  type PluginInteraction,
} from '../plugins/workbench';
import type { WorkbenchRuntime } from '../runtime';
import { mergeObject, saveObject, type ObjectRecord } from '../workspace-objects';
import { WorkspacePluginRuntime } from '../workspace-plugin-runtime';
import { PLUGINS_TAB_ID, type InstalledObjectPlugin } from '../workspace-plugins';
import { saveRelationChange } from '../workspace-relations';

export interface WorkspacePluginsStateDeps {
  adapter: WorkspaceAdapter;
  runtime: WorkbenchRuntime;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  capabilities: Ref<WorkspaceCapabilities>;
  objects: Ref<ObjectRecord[]>;
  relations: Ref<WorkspaceRelation[]>;
  relationError: Ref<string>;
  getRelationBase: () => FileSnapshot | null;
  relationDefinitions: Ref<RelationTypeDefinition[]>;
  referenceTargets: Ref<ReferenceTarget[]>;
  tabIds: Ref<string[]>;
  activeId: Ref<string>;
  installedPlugins: Ref<InstalledObjectPlugin[]>;
  activePluginSidebar: Ref<string>;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  scheduleRefresh: () => void;
  refreshObjects: () => Promise<void>;
  openInternal: (file: FileEntry, replaceId?: string, current?: () => boolean) => Promise<void>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  ensureTabNavigation: (tabId: string, targetId?: string) => void;
  touchNavigation: () => void;
}

export function createWorkspacePluginsState(deps: WorkspacePluginsStateDeps) {
  const {
    adapter,
    runtime,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    capabilities,
    objects,
    relations,
    relationError,
    getRelationBase,
    relationDefinitions,
    referenceTargets,
    tabIds,
    activeId,
    installedPlugins,
    activePluginSidebar,
    serial,
    writable,
    scheduleRefresh,
    refreshObjects,
    openInternal,
    saveInternal,
    ensureTabNavigation,
    touchNavigation,
  } = deps;

  const pluginAttachmentReader = new PluginAttachmentReader();
  let pluginEditorEdit: ((id: string, before: string, after: string) => Promise<boolean>) | undefined;
  const pluginRuntime = shallowRef<PluginRuntimeState[]>([]);
  watch(
    [
      () => workspace.value?.id,
      () => pluginRuntime.value.map((plugin) => `${plugin.instanceId}:${plugin.status}`).join(','),
    ],
    () => pluginAttachmentReader.clear(),
  );
  const pluginQueryPager = new PluginQueryPager();
  const canManagePlugins = computed(
    () => !!workspace.value && canManageWorkspacePlugins(adapter, workspace.value),
  );
  const pluginStorageChanged = (event: StorageEvent) => {
    if (event.key?.startsWith('tano.object-plugins.v1.') || event.key?.startsWith('tano.plugin-'))
      scheduleRefresh();
  };
  if (typeof window !== 'undefined') window.addEventListener('storage', pluginStorageChanged);
  onScopeDispose(() => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged);
  });

  const installedPluginWorkspace = ref('');
  const pluginDevelopment = shallowRef<PluginDevelopmentState>({
    pluginId: '',
    active: false,
    message: '',
  });
  const pluginServices = new WorkspacePluginRuntime({
    adapter,
    services: runtime.plugins,
    serial,
    refresh: refreshObjects,
    call: pluginCall,
    workspace: () => workspace.value,
    setWorkspace: (current) => {
      workspace.value = current;
    },
    installed: () => installedPlugins.value,
    canManage: () => canManagePlugins.value,
    changed: (states) => {
      pluginRuntime.value = states;
    },
    developmentChanged: (state) => {
      pluginDevelopment.value = state;
    },
  });
  const { policy: pluginHost, executor: pluginExecutor, developer: pluginDeveloper } = pluginServices;
  onScopeDispose(() => pluginServices.dispose());

  const pluginViews = computed(() => pluginWorkbenchViews(installedPlugins.value));
  const pluginCommands = computed(() => pluginWorkbenchCommands(pluginRuntime.value));
  const pluginSettingsRequest = shallowRef<{ key: string; sequence: number }>();
  const pluginSettingsPages = computed(() =>
    pluginViews.value
      .filter((view) => view.location === 'settings')
      .map((view) => ({
        view,
        workspaceId: workspace.value?.id ?? '',
        runtime: pluginRuntime.value.find((rt) => rt.id === view.pluginId),
      })),
  );
  const pluginError = ref('');

  watch(
    () => workspace.value?.id,
    () => {
      activePluginSidebar.value = '';
      pluginSettingsRequest.value = undefined;
    },
  );

  let pluginEventTimer: ReturnType<typeof setTimeout> | undefined;
  onScopeDispose(() => clearTimeout(pluginEventTimer));

  const pluginDataRevision = computed(
    () =>
      [
        workspace.value?.id,
        workspace.value?.files
          .filter(
            (file) =>
              file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path),
          )
          .map((file) => {
            const draft = documentIndex.byId.value.get(file.id);
            return [
              file.id,
              JSON.stringify([
                file.path,
                file.size,
                file.modified,
                !!(workspace.value?.readOnly || file.readOnly),
                draft ? documentIndex.draftRevision(draft) : 0,
                !!draft?.conflict,
                !!draft?.missing,
              ]),
            ] as [string, string];
          }) ?? [],
        objects.value.map((record) => [record.object.id, record.snapshot.hash] as [string, string]),
        relations.value.map(
          (relation) => [relation.id, JSON.stringify(relation)] as [string, string],
        ),
      ] as const,
  );
  let pluginEventScope: string | undefined;
  let pluginPrevious = [
    new Map<string, string>(),
    new Map<string, string>(),
    new Map<string, string>(),
  ];
  watch(
    pluginDataRevision,
    (revision) => {
      clearTimeout(pluginEventTimer);
      const [scope, ...values] = revision;
      const next = values.map((rows) => new Map(rows));
      if (scope !== pluginEventScope) {
        pluginEventScope = scope;
        pluginPrevious = next;
        pluginQueryPager.clear();
        pluginDeveloper.stop();
        return;
      }
      pluginEventTimer = setTimeout(() => {
        if (workspace.value?.id !== scope) return;
        const types = ['documents.changed', 'objects.changed', 'relations.changed'] as const;
        let changed = false;
        for (let index = 0; index < types.length; index++) {
          const event = pluginChanges(types[index]!, pluginPrevious[index]!, next[index]!);
          if (event) {
            changed = true;
            pluginExecutor.notify(event);
          }
        }
        pluginPrevious = next;
        if (changed) pluginExecutor.notify({ type: 'workspace.changed' });
      }, 150);
    },
    { immediate: true },
  );

  async function refreshPlugins(current: Workspace) {
    try {
      const installed = await pluginHost.loadWorkspace(adapter, current);
      if (workspace.value?.id !== current.id) return;
      installedPlugins.value = installed;
      installedPluginWorkspace.value = current.id;
      pluginExecutor.sync(current, installedPlugins.value);
      pluginError.value = '';
    } catch (error) {
      pluginExecutor.dispose();
      pluginHost.dispose();
      installedPlugins.value = [];
      pluginError.value = `无法加载插件：${String(error)}。安装记录已保留。`;
    }
  }

  function openPluginView(pluginId: string, viewId: string) {
    const view = pluginViews.value.find((view) => view.key === pluginViewKey(pluginId, viewId));
    if (!workspace.value || !view) throw new Error('插件视图已停用或不存在');
    if (view.location === 'tab') {
      if (!tabIds.value.includes(view.key)) tabIds.value.push(view.key);
      activeId.value = view.key;
      ensureTabNavigation(view.key);
      touchNavigation();
    } else if (view.location === 'sidebar') activePluginSidebar.value = view.key;
    else if (view.location === 'settings')
      pluginSettingsRequest.value = {
        key: view.key,
        sequence: (pluginSettingsRequest.value?.sequence ?? 0) + 1,
      };
    else {
      if (!tabIds.value.includes(PLUGINS_TAB_ID)) tabIds.value.push(PLUGINS_TAB_ID);
      activeId.value = PLUGINS_TAB_ID;
      ensureTabNavigation(PLUGINS_TAB_ID);
      touchNavigation();
    }
  }

  function interactWithPlugin(interaction: PluginInteraction) {
    if (workspace.value?.id !== interaction.workspaceId)
      return Promise.reject(new Error('工作区已切换，请重新打开插件界面'));
    return pluginExecutor.invoke(
      interaction.pluginId,
      interaction.kind,
      interaction.name,
      interaction.payload,
      interaction.instanceId,
    );
  }

  async function pluginCall(
    method: string,
    params: Record<string, unknown>,
    assertInstance: () => void,
  ): Promise<unknown> {
    const expected = workspace.value?.id;
    return serial(async () => {
      const assertCurrent = () => {
        assertInstance();
        if (!expected || workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
      };
      assertCurrent();
      if (method === 'attachments.read')
        return pluginAttachmentReader.read(
          workspace.value!,
          params,
          runtime.attachments ??
            (runtime.native && adapter.mode === 'desktop' ? nativeAttachments : undefined),
          assertCurrent,
        );
      workspace.value = await adapter.refresh();
      await refreshObjects();
      assertCurrent();
      const current = workspace.value!;
      if (method === 'views.open') {
        await openPluginView(String(params.pluginId), String(params.viewId));
        return null;
      }
      if (method.endsWith('.query') || method === 'documents.search')
        return queryPluginData(method, params, pluginQueryPager, {
          workspace: current,
          objects: objects.value,
          relations: relations.value,
          drafts: documents.value,
          read: (path) => adapter.read(path),
          assertCurrent,
        });
      const file = () => {
        const entry = fileRegistry.value?.get(String(params.fileId));
        if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path))
          throw new Error('文档不存在或不可访问');
        return entry;
      };
      const text = (value: unknown) => {
        if (typeof value !== 'string' || value.length > 512000)
          throw new Error('插件文档内容无效或过大');
        return value;
      };
      if (method === 'documents.list')
        return current.files
          .filter(
            (row) =>
              row.kind === 'file' && isMarkdown(row.path) && !isWorkspaceInternalPath(row.path),
          )
          .map(({ id, path, name, readOnly }) => ({
            id,
            path,
            name,
            readOnly: current.readOnly || readOnly || false,
          }));
      if (method === 'documents.read') {
        const entry = file();
        const disk = await adapter.read(entry.path);
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('文档存在冲突，请先处理');
        const content = text(doc?.content ?? disk.content);
        return { id: entry.id, path: entry.path, content, hash: await assistantHash(content) };
      }
      if (method === 'documents.open') {
        await openInternal(file());
        ensureTabNavigation(String(params.fileId), String(params.fileId));
        touchNavigation();
        return null;
      }
      if (method === 'objects.list')
        return objects.value.map((record) => ({
          id: record.object.id,
          object: JSON.parse(JSON.stringify(record.object)),
          hash: record.snapshot.hash,
        }));
      if (method === 'objects.read') {
        const record = objects.value.find((row) => row.object.id === params.objectId);
        if (!record) throw new Error('对象不存在或不可访问');
        return {
          id: record.object.id,
          object: JSON.parse(JSON.stringify(record.object)),
          hash: record.snapshot.hash,
        };
      }
      if (method === 'relations.list') return JSON.parse(JSON.stringify(relations.value));
      writable();
      if (method === 'documents.create') {
        const path = text(params.path);
        if (!isMarkdown(path) || validatePath(path)) throw new Error('新文档路径无效');
        assertCurrent();
        await adapter.create(path, text(params.content));
        workspace.value = await adapter.refresh();
        const entry = fileRegistry.value?.at(path)!;
        return { id: entry.id, path };
      }
      if (method === 'documents.write') {
        const entry = file();
        if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
        if (!pluginRecord(params.base) || params.base.id !== entry.id)
          throw new Error('文档版本无效');
        const base = text(params.base.content);
        const desired = text(params.content);
        const disk = await adapter.read(entry.path);
        const doc = documentIndex.byId.value.get(entry.id);
        if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
        const live = doc
          ? mergeMarkdown(doc.base.content, doc.content, disk.content)
          : { clean: true, content: disk.content };
        const merged = mergeMarkdown(base, desired, live.content);
        if (!live.clean || !merged.clean) {
          const copyPath = entry.path.replace(
            /\.(md|markdown)$/i,
            `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`,
          );
          assertCurrent();
          await adapter.create(copyPath, desired);
          throw new Error(t('文档有重叠修改，插件版本已保存在 {0}', [copyPath]));
        }
        const editing = runtime.extensions?.()?.editing;
        if (editing?.isManaging(entry.id)) {
          if (!editing.applyPluginEdit)
            throw new Error('当前协作会话不支持插件编辑，请退出协作后重试');
          assertCurrent();
          const applied = await editing.applyPluginEdit(entry.id, live.content, merged.content);
          assertCurrent();
          return {
            id: entry.id,
            hash: await assistantHash(applied ?? merged.content),
            status: 'applied',
          };
        }
        if (doc && pluginEditorEdit && (await pluginEditorEdit(entry.id, doc.content, merged.content))) {
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'applied' };
        }
        if (doc) {
          // The editor observes this value and applies a transaction through its existing bridge.
          doc.content = merged.content;
          doc.base = disk;
          assertCurrent();
          await saveInternal(doc);
          if (doc.error || doc.conflict || dirty(doc))
            throw new Error(doc.error ?? '插件修改已保留为草稿，请处理冲突后保存');
          return { id: entry.id, hash: await assistantHash(doc.content), status: 'saved' };
        }
        assertCurrent();
        const result = await adapter.write(entry.path, merged.content, disk.hash);
        if (result.status !== 'saved') {
          const copyPath = entry.path.replace(
            /\.(md|markdown)$/i,
            `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`,
          );
          await adapter.create(copyPath, desired);
          throw new Error(t('保存时文件发生变化，插件版本已保存在 {0}', [copyPath]));
        }
        return { id: entry.id, hash: await assistantHash(result.snapshot.content), status: 'saved' };
      }
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象功能已关闭');
      if (method === 'objects.create' || method === 'objects.update') {
        if (!pluginRecord(params.object)) throw new Error('对象无效');
        const draft = JSON.parse(JSON.stringify(params.object));
        if (method === 'objects.create') {
          if (!adapter.reserveObjectId) throw new Error('存储适配器不支持对象身份分配');
          const id = await adapter.reserveObjectId(objects.value.map((row) => row.object.id));
          const object = parseObject(JSON.stringify({ ...draft, version: 1, id }));
          validateObjectProperties(object.type, object.properties);
          assertCurrent();
          await adapter.create(
            `${objectDirectory}/${id}.tano.json`,
            JSON.stringify(object, null, 2) + '\n',
          );
          workspace.value = await adapter.refresh();
          await refreshObjects();
          return object;
        }
        if (!pluginRecord(params.base) || !pluginRecord(params.base.object))
          throw new Error('对象版本无效');
        const record = objects.value.find((row) => row.object.id === draft.id);
        if (!record) throw new Error('对象不存在');
        if (current.files.find((row) => row.path === record.path)?.readOnly)
          throw new Error('对象只读');
        const object = parseObject(JSON.stringify(draft));
        validateObjectProperties(object.type, object.properties);
        const merged = mergeObject(
          parseObject(JSON.stringify(params.base.object)),
          object,
          record.object,
        );
        const preserve = async () => {
          const path = `.tano/conflicts/plugin-object-${crypto.randomUUID()}.json`;
          assertCurrent();
          await adapter.create(
            path,
            JSON.stringify({ version: 1, pluginProposal: object, base: params.base }, null, 2) + '\n',
          );
          return path;
        };
        if (!merged)
          throw new Error(t('对象已有重叠修改，插件版本已保存在 {0}', [await preserve()]));
        let saved: ObjectRecord;
        try {
          assertCurrent();
          saved = await saveObject(adapter, record, merged);
        } catch (error) {
          throw new Error(t('{0} 插件版本已保存在 {1}', [String(error), await preserve()]));
        }
        workspace.value = await adapter.refresh();
        await refreshObjects();
        return saved.object;
      }
      if (method === 'relations.add' || method === 'relations.remove') {
        if (relationError.value) throw new Error(relationError.value);
        const relation = params.relation as WorkspaceRelation;
        validateRelation(relation, relationDefinitions.value);
        for (const endpoint of [relation.source, relation.target])
          if (!referenceTargets.value.some((target) => referenceKey(target) === referenceKey(endpoint)))
            throw new Error('关系端点不存在或不可访问');
        assertCurrent();
        await saveRelationChange(
          adapter,
          getRelationBase(),
          method === 'relations.add' ? { add: relation } : { remove: relation },
        );
        workspace.value = await adapter.refresh();
        await refreshObjects();
        return null;
      }
      throw new Error('不支持此插件 API');
    });
  }

  // OAuth, connections & package repository helpers
  async function startPluginOAuth(
    workspaceId: string,
    input: PluginOAuthInput,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const installation = installedPlugins.value.find((item) => item.manifest.id === input.pluginId);
    const oauth = runtime.plugins?.connections?.oauth;
    if (
      workspace.value?.id !== workspaceId ||
      !oauth ||
      !installation?.enabled ||
      !installation.authorized ||
      installation.rule?.integrity !== input.integrity ||
      installation.manifest.manifestVersion !== 2 ||
      !installation.manifest.permissions.includes('connections') ||
      !installation.manifest.networkOrigins.includes(input.origin)
    )
      throw new Error('请先启用并授权此插件的当前版本');
    const flow = await oauth.start(workspaceId, input, signal);
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return flow;
  }

  async function loadPluginConnections(workspaceId: string, signal: AbortSignal) {
    if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections)
      throw new Error('当前工作区未提供凭据连接');
    const connections = await runtime.plugins.connections.list(workspaceId, signal);
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return connections;
  }

  async function savePluginConnection(
    workspaceId: string,
    input: PluginConnectionInput,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    const installation = installedPlugins.value.find((item) => item.manifest.id === input.pluginId);
    if (
      workspace.value?.id !== workspaceId ||
      !runtime.plugins?.connections ||
      !installation?.enabled ||
      !installation.authorized ||
      installation.rule?.integrity !== input.integrity ||
      installation.manifest.manifestVersion !== 2 ||
      !installation.manifest.permissions.includes('connections') ||
      !installation.manifest.networkOrigins.includes(input.origin)
    )
      throw new Error('请先启用并授权此插件的当前版本');
    const connection = await runtime.plugins.connections.save(
      workspaceId,
      parsePluginConnectionInput(input),
      signal,
    );
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
    return connection;
  }

  async function removePluginConnection(
    workspaceId: string,
    pluginId: string,
    origin: string,
    version: string,
    signal: AbortSignal,
  ) {
    signal.throwIfAborted();
    if (workspace.value?.id !== workspaceId || !runtime.plugins?.connections)
      throw new Error(t('工作区已切换'));
    await runtime.plugins.connections.remove(workspaceId, pluginId, origin, version, signal);
    signal.throwIfAborted();
  }

  const removePluginPackage = (integrity: string, expectedWorkspace: string) =>
    serial(async () => {
      if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
        throw new Error('工作区或管理权限已变化');
      if (!runtime.plugins?.repository?.remove) throw new Error('当前环境不支持云端包回收');
      await runtime.plugins.repository.remove(expectedWorkspace, integrity);
    });

  async function loadPluginPackageUsage(expectedWorkspace: string) {
    if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
      throw new Error('工作区或管理权限已变化');
    const usage = await runtime.plugins?.repository?.usage?.(expectedWorkspace);
    if (workspace.value?.id !== expectedWorkspace || !canManagePlugins.value)
      throw new Error('工作区或管理权限已变化');
    return usage;
  }

  function disposePlugins() {
    pluginAttachmentReader.clear();
    clearTimeout(pluginEventTimer);
    pluginServices.dispose();
    if (typeof window !== 'undefined') window.removeEventListener('storage', pluginStorageChanged);
  }

  return {
    pluginRuntime,
    canManagePlugins,
    installedPlugins,
    installedPluginWorkspace,
    pluginDevelopment,
    pluginServices,
    pluginHost,
    pluginExecutor,
    pluginDeveloper,
    pluginViews,
    pluginCommands,
    activePluginSidebar,
    pluginSettingsRequest,
    pluginSettingsPages,
    pluginError,
    refreshPlugins,
    openPluginView,
    interactWithPlugin,
    startPluginOAuth,
    loadPluginConnections,
    savePluginConnection,
    removePluginConnection,
    removePluginPackage,
    loadPluginPackageUsage,
    clearPluginLogs: (id: string) => pluginExecutor.clearLogs(id),
    setPluginEditor: (apply?: (id: string, before: string, after: string) => Promise<boolean>) => {
      pluginEditorEdit = apply;
    },
    disposePlugins,
  };
}
