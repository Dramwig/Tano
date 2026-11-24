import { computed, onScopeDispose, ref, type Ref } from 'vue';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import {
  assetTargets,
  basename,
  coreRelationTypes,
  defaultFileDatabaseQuery,
  defaultObjectViewQuery,
  documentTargets,
  FileRegistry,
  isMarkdown,
  isWorkspaceInternalPath,
  newShortId,
  objectDirectory,
  objectTypeRegistry,
  parseObject,
  parseWorkspaceView,
  referenceKey,
  RelationIndex,
  relationKey,
  validateObjectProperties,
  validateRelation,
  WorkspaceAccessRevokedError,
  workspaceViewPath,
  type FileSnapshot,
  type ReferenceIdentity,
  type ReferenceTarget,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceObject,
  type WorkspaceRelation,
  type WorkspaceViewDefinition,
} from '@tano/protocol';
import { contentReferences, referenceContext } from '../objects/content-references';
import type { useDocumentIndex } from '../documents/document-index';
import type { OpenDocument } from '../documents/document-session';
import {
  loadFileMetadata,
  markdownFileMetadata,
  saveFileMetadata,
  type FileMetadataState,
} from '../files/file-metadata';
import { recordHelpCompleted, recordHelpPlanEdit } from '../help/help-checklist';
import { t } from '../i18n/i18n';
import { previewTaskRepeat, repeatRelations, type RepeatPreview } from '../plans/task-repeat';
import { loadObjects, saveObject, type ObjectRecord } from '../objects/workspace-objects';
import type { InstalledObjectPlugin } from '../plugins/workspace-plugins';
import { loadRelations, saveRelationChange, type RelationChange } from '../objects/workspace-relations';
import { loadTemplates, saveTemplate, type DocumentTemplate } from '../workspace/workspace-templates';
import { loadWorkspaceViews, type WorkspaceViewRecord } from '../workspace/workspace-views';
import type { Activity } from './workspace';

export interface WorkspaceKnowledgeDeps {
  adapter: WorkspaceAdapter;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  capabilities: Ref<WorkspaceCapabilities>;
  installedPlugins: Ref<InstalledObjectPlugin[]>;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  activity: (
    label: string,
    detail: string,
    kind: Activity['kind'],
    change?: Activity['change'],
  ) => void;
  loadWorkspacePart: (
    part: 'plugins' | 'objects' | 'views' | 'relations',
    load: () => Promise<unknown>,
  ) => Promise<void>;
  refreshPlugins: (current: Workspace) => Promise<void>;
  disposePluginExecutor: () => void;
  openWorkspaceView: (id: string, options?: { newTab?: boolean; historyIndex?: number }) => Promise<void>;
}

export function createWorkspaceKnowledge(deps: WorkspaceKnowledgeDeps) {
  const {
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    capabilities,
    installedPlugins,
    serial,
    writable,
    activity,
    loadWorkspacePart,
    refreshPlugins,
    disposePluginExecutor,
    openWorkspaceView,
  } = deps;

  const workspaceViews = ref<WorkspaceViewRecord[]>([]);
  const workspaceViewErrors = ref<string[]>([]);
  const objects = ref<ObjectRecord[]>([]);
  const objectErrors = ref<string[]>([]);
  const relations = ref<WorkspaceRelation[]>([]);
  const relationError = ref('');
  let relationBase: FileSnapshot | null = null;

  const relationDefinitions = computed(() => [
    ...coreRelationTypes,
    ...installedPlugins.value
      .filter((item) => item.enabled)
      .flatMap((item) => item.manifest.relationTypes),
  ]);
  const relationIndex = computed(() => new RelationIndex(relations.value));
  const objectDefinitions = ref(objectTypeRegistry.list());
  onScopeDispose(
    objectTypeRegistry.subscribe(() => {
      objectDefinitions.value = objectTypeRegistry.list();
    }),
  );

  const fileReferenceTargets = computed<ReferenceTarget[]>(() =>
    workspace.value
      ? [
          ...documentTargets(workspace.value.id, workspace.value.files),
          ...assetTargets(workspace.value.id, workspace.value.files),
        ]
      : [],
  );
  const referenceTargets = computed<ReferenceTarget[]>(() =>
    workspace.value
      ? [
          ...fileReferenceTargets.value,
          ...objects.value
            .filter(({ object }) => {
              const definition =
                objectDefinitions.value.find((entry) => entry.type === object.type) ??
                objectTypeRegistry.get(object.type);
              if (definition?.storage !== 'record') return false;
              if (definition.retired) return true;
              try {
                validateObjectProperties(object.type, object.properties);
                return true;
              } catch {
                return false;
              }
            })
            .map(({ object, path }) => ({
              workspace: workspace.value!.id,
              type: object.type,
              id: object.id,
              name: object.name,
              description: object.description,
              archived: object.archived,
              path,
              properties: object.properties,
            })),
        ]
      : [],
  );

  // File metadata changes independently of open-document drafts and object loads.
  // Keep its traversal/serialization cached across those more frequent updates.
  const referenceFilesRevision = computed((previous?: { key: string; version: number }) => {
    const key = JSON.stringify([
      workspace.value?.id,
      workspace.value?.path,
      workspace.value?.files.map((file) => [
        file.id,
        file.path,
        file.modified,
        file.size,
        file.contentHash,
      ]),
    ]);
    return previous?.key === key ? previous : { key, version: (previous?.version ?? 0) + 1 };
  });
  const referenceRevision = computed(() =>
    JSON.stringify([
      referenceFilesRevision.value.version,
      documents.value.map((doc) => [doc.id, documentIndex.revision(doc)]),
      objects.value.map((record) => [
        record.object.id,
        record.object.description,
        record.object.name,
        record.object.archived,
      ]),
    ]),
  );

  const referenceDocumentCache = new Map<string, { stamp: string; content: string }>();

  function clearRevokedReferences(error: unknown) {
    if (!(error instanceof WorkspaceAccessRevokedError)) return;
    if (workspace.value) workspace.value = { ...workspace.value, files: [], readOnly: true };
    objects.value = [];
    relations.value = [];
    relationBase = null;
    disposePluginExecutor();
    referenceDocumentCache.clear();
  }

  async function refreshObjects() {
    const current = workspace.value;
    if (!current) return;
    referenceDocumentCache.clear();
    const pluginsReady = loadWorkspacePart('plugins', () => refreshPlugins(current));
    await Promise.all([
      pluginsReady,
      loadWorkspacePart('objects', async () => {
        // Read ahead, but validate custom object properties only after their
        // plugin schemas are registered. Other regions do not depend on this.
        const loaded = await loadObjects(
          {
            read: async (path) => {
              const snapshot = await adapter.read(path);
              await pluginsReady;
              return snapshot;
            },
          },
          current,
        );
        objects.value = loaded.records;
        objectErrors.value = loaded.errors;
      }),
      loadWorkspacePart('views', async () => {
        try {
          const loadedViews = await loadWorkspaceViews(adapter, current);
          workspaceViews.value = loadedViews.records;
          workspaceViewErrors.value = loadedViews.errors;
        } catch (error) {
          workspaceViews.value = [];
          workspaceViewErrors.value = [`无法读取工作区视图：${String(error)}`];
        }
      }),
      loadWorkspacePart('relations', async () => {
        try {
          const loadedRelations = await loadRelations(adapter, current);
          relationBase = loadedRelations.snapshot;
          relations.value = loadedRelations.file.relations;
          relationError.value = '';
        } catch (error) {
          relations.value = [];
          relationBase = null;
          relationError.value = `无法读取关系：${String(error)}。原文件已保留，请修复后重试。`;
        }
      }),
    ]);
  }

  // File metadata
  function metadataTarget(id: string, scope: string) {
    const current = workspace.value;
    const file = fileRegistry.value?.get(id);
    if (!current || current.id !== scope || !file || isWorkspaceInternalPath(file.path))
      throw new Error('文件或工作区已变化');
    return { current, file };
  }
  const readFileMetadata = (id: string, scope: string) =>
    serial(async (): Promise<FileMetadataState> => {
      const { current, file } = metadataTarget(id, scope);
      if (isMarkdown(file.path)) {
        const content =
          documentIndex.byId.value.get(id)?.content ?? (await adapter.read(file.path)).content;
        return {
          file: markdownFileMetadata(id, content),
          base: null,
          referenceCount: contentReferences(
            referenceTargets.value,
            new Map([[`document/${id}`, content]]),
          ).length,
        };
      }
      return loadFileMetadata(adapter, current, id);
    });
  const updateFileMetadata = (state: FileMetadataState, scope: string) =>
    serial(async () => {
      const { current, file } = metadataTarget(state.file.fileId, scope);
      if (isMarkdown(file.path)) throw new Error('请在文档属性中编辑 Markdown 属性');
      if (current.readOnly || file.readOnly) throw new Error('你对此文件只有阅读权限');
      const saved = await saveFileMetadata(adapter, state);
      workspace.value = await adapter.refresh();
      return saved;
    });

  // Workspace databases / views
  async function createObjectDatabase() {
    const scope = workspace.value?.id;
    const id = `objects-${crypto.randomUUID()}`;
    await serial(async () => {
      if (!scope || workspace.value?.id !== scope) throw new Error(t('工作区已切换'));
      writable();
      if (!capabilities.value.features.objectReferences)
        throw new Error('「工作区对象与引用」已关闭');
      const view = parseWorkspaceView(
        JSON.stringify({
          version: 1,
          layer: 'view',
          workspaceId: scope,
          id,
          name: '对象数据库',
          kind: 'objects',
          sources: [],
          objectDatabase: defaultObjectViewQuery(),
        }),
      );
      await adapter.create(workspaceViewPath(id), JSON.stringify(view, null, 2) + '\n');
      workspace.value = await adapter.refresh();
      await refreshObjects();
    });
    await openWorkspaceView(id, { newTab: true });
  }

  async function createFileDatabase(directory = '') {
    const scope = workspace.value?.id;
    const id = `files-${crypto.randomUUID()}`;
    await serial(async () => {
      if (!scope || workspace.value?.id !== scope) throw new Error(t('工作区已切换'));
      writable();
      if (
        directory &&
        !workspace.value.files.some((f) => f.kind === 'directory' && f.path === directory)
      )
        throw new Error('目录已不存在');
      const view = parseWorkspaceView(
        JSON.stringify({
          version: 1,
          layer: 'view',
          workspaceId: scope,
          id,
          name: `${directory ? basename(directory) : workspace.value.name} · 文件数据库`,
          kind: 'files',
          sources: [],
          database: defaultFileDatabaseQuery(directory),
        }),
      );
      await adapter.create(workspaceViewPath(id), JSON.stringify(view, null, 2) + '\n');
      workspace.value = await adapter.refresh();
      await refreshObjects();
    });
    await openWorkspaceView(id, { newTab: true });
  }

  const saveFileDatabase = (view: WorkspaceViewDefinition, base: FileSnapshot) =>
    serial(async () => {
      if (workspace.value?.id !== view.workspaceId) throw new Error(t('工作区已切换'));
      writable();
      const checked = parseWorkspaceView(JSON.stringify(view));
      const result = await adapter.write(
        workspaceViewPath(checked.id),
        JSON.stringify(checked, null, 2) + '\n',
        base.hash,
      );
      if (result.status !== 'saved') {
        const copy = `.tano/conflicts/view-${checked.id}-${crypto.randomUUID()}.tano.json`;
        await adapter.create(copy, JSON.stringify(checked, null, 2) + '\n');
        throw new Error(
          t('视图已被外部修改或删除，外部版本未覆盖；当前设置已保留在 {0}', [copy]),
        );
      }
      workspace.value = await adapter.refresh();
      await refreshObjects();
      return result.snapshot;
    });

  // Relations CRUD
  async function editRelation(change: RelationChange, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace)
        throw new Error('工作区已切换，关系未写入其他工作区');
      writable();
      if (!capabilities.value.features.objectReferences)
        throw new Error('「工作区对象与引用」已关闭');
      if (relationError.value) throw new Error(relationError.value);
      const added = 'add' in change ? [change.add] : 'replace' in change ? change.replace.next : [];
      for (const row of added) {
        validateRelation(row, relationDefinitions.value);
        for (const endpoint of [row.source, row.target])
          if (
            !referenceTargets.value.some(
              (target) => referenceKey(target) === referenceKey(endpoint) && !target.archived,
            )
          )
            throw new Error('关系端点不存在、已归档或插件未启用');
      }
      const saved = await saveRelationChange(adapter, relationBase, change);
      relationBase = saved.snapshot;
      relations.value = saved.file.relations;
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity(
        '关系已更新',
        'add' in change
          ? change.add.type
          : 'remove' in change
            ? change.remove.type
            : change.replace.type,
        'save',
      );
    });
  }

  function createRelation(type: string, source: ReferenceIdentity, target: ReferenceIdentity) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    return editRelation(
      { add: { id: newShortId(new Set(relations.value.map((row) => row.id))), type, source, target } },
      workspaceId,
    );
  }

  function removeRelation(row: WorkspaceRelation) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    return editRelation({ remove: JSON.parse(JSON.stringify(row)) }, workspaceId);
  }

  function setRelationSource(
    type: string,
    target: ReferenceIdentity,
    source: ReferenceIdentity | null,
  ) {
    const workspaceId = workspace.value?.id;
    if (!workspaceId) return Promise.reject(new Error('请先打开工作区'));
    const previous: WorkspaceRelation[] = JSON.parse(
      JSON.stringify(
        relations.value.filter(
          (row) => row.type === type && referenceKey(row.target) === referenceKey(target),
        ),
      ),
    );
    const existing =
      source && previous.find((row) => referenceKey(row.source) === referenceKey(source));
    const next = source
      ? [
          existing ?? {
            id: newShortId(new Set(relations.value.map((row) => row.id))),
            type,
            source,
            target,
          },
        ]
      : [];
    return editRelation({ replace: { type, target, previous, next } }, workspaceId);
  }

  // Objects CRUD
  async function createObject(
    draft: Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'properties' | 'archived'>,
  ) {
    const workspaceId = workspace.value?.id;
    return serial(async () => {
      if (!workspaceId || workspace.value?.id !== workspaceId) throw new Error(t('工作区已切换'));
      writable();
      if (!capabilities.value.features.objectReferences)
        throw new Error('「工作区对象与引用」已关闭');
      validateObjectProperties(draft.type, draft.properties);
      workspace.value = await adapter.refresh();
      await refreshObjects();
      if (!adapter.reserveObjectId) throw new Error('此存储适配器尚未实现短 ID 分配');
      if (objectErrors.value.length) throw new Error('请先修复对象格式或重复 ID，再创建对象');
      const id = await adapter.reserveObjectId(objects.value.map(({ object }) => object.id));
      const object = parseObject(JSON.stringify({ ...draft, id, version: 1 }));
      const path = `${objectDirectory}/${object.id}.tano.json`;
      await adapter.create(path, JSON.stringify(object, null, 2) + '\n');
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity('对象已创建', `${object.name} · ${object.type}`, 'file');
      const record = objects.value.find((record) => record.object.id === object.id)!;
      if (record) recordHelpPlanEdit(undefined, object);
      return record;
    });
  }

  async function updateObject(
    record: ObjectRecord,
    draft: WorkspaceObject,
    expectedWorkspace: string,
  ) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace)
        throw new Error('工作区已切换，草稿未写入其他工作区');
      writable();
      if (!capabilities.value.features.objectReferences)
        throw new Error('「工作区对象与引用」已关闭');
      const saved = await saveObject(adapter, record, draft);
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity('对象已更新', `${saved.object.name} · ${saved.object.type}`, 'save');
      recordHelpPlanEdit(record.object, draft);
      return saved;
    });
  }

  async function deleteObject(record: ObjectRecord, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error(t('工作区已切换'));
      writable();
      if (!capabilities.value.features.objectReferences)
        throw new Error('「工作区对象与引用」已关闭');
      if (record.object.properties.syncReadOnly === true) throw new Error('此对象为只读');
      if (!adapter.removeObjectFile) throw new Error('此存储适配器不支持安全删除对象');
      const file = fileRegistry.value?.at(record.path);
      if (!file || file.readOnly) throw new Error('对象已不存在或为只读');
      const base = parseObject(record.snapshot.content);
      if (base.id !== record.object.id || base.type !== record.object.type)
        throw new Error('对象身份不一致');
      const result = await adapter.removeObjectFile({
        workspaceId: expectedWorkspace,
        fileId: file.id,
        path: record.path,
        expectedHash: record.snapshot.hash,
      });
      if (result.status !== 'saved') throw new Error('对象已被外部修改或删除，请重新读取后重试');
      // Preserve relation provenance. Missing endpoints remain explicit and can be removed separately.
      workspace.value = await adapter.refresh();
      await refreshObjects();
      activity('对象已删除', record.object.name, 'file');
    });
  }

  // Templates & task repeats
  async function templates(expectedWorkspace: string) {
    if (workspace.value?.id !== expectedWorkspace) throw new Error(t('工作区已切换'));
    const current = await adapter.refresh();
    const loaded = await loadTemplates(adapter, current);
    if (workspace.value?.id !== expectedWorkspace) throw new Error(t('工作区已切换'));
    return loaded;
  }

  async function writeTemplate(
    content: string,
    expectedWorkspace: string,
    base?: DocumentTemplate,
  ) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace)
        throw new Error('工作区已切换，模板草稿已保留');
      writable();
      workspace.value = await adapter.refresh();
      const path = await saveTemplate(
        adapter,
        content,
        base,
        new Set(workspace.value.files.map((file) => file.path.split('/').at(-1)!.slice(0, 6))),
      );
      workspace.value = await adapter.refresh();
      recordHelpCompleted('save-template');
      return path;
    });
  }

  async function repeatPreview(record: ObjectRecord, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error(t('工作区已切换'));
      writable();
      workspace.value = await adapter.refresh();
      await refreshObjects();
      const current = objects.value.find((item) => item.object.id === record.object.id);
      if (!current || current.snapshot.hash !== record.snapshot.hash)
        throw new Error('任务已变化，请重新读取再创建下一次');
      const series = objects.value.find(
        (item) => item.object.id === (current.object.properties.repeatSourceId ?? current.object.id),
      );
      if (!series) throw new Error('重复任务来源已不可用');
      return previewTaskRepeat(current, relations.value, series);
    });
  }

  async function createRepeat(preview: RepeatPreview, expectedWorkspace: string) {
    return serial(async () => {
      if (workspace.value?.id !== expectedWorkspace) throw new Error(t('工作区已切换'));
      writable();
      workspace.value = await adapter.refresh();
      await refreshObjects();
      if (objectErrors.value.length || relationError.value)
        throw new Error('请先处理对象或关系读取错误');
      const source = objects.value.find((item) => item.object.id === preview.sourceId);
      if (
        !source ||
        source.snapshot.hash !== preview.sourceHash ||
        JSON.stringify(repeatRelations(source.object, relations.value)) !== preview.relationBase
      )
        throw new Error('任务或关联已变化，请重新预览');
      const series = objects.value.find((item) => item.object.id === preview.seriesId);
      if (!series || series.snapshot.hash !== preview.seriesHash)
        throw new Error('重复规则已变化，请重新预览');
      const recomputed = await previewTaskRepeat(source, relations.value, series);
      if (JSON.stringify(recomputed) !== JSON.stringify(preview))
        throw new Error('重复任务预览已失效');
      const content = JSON.stringify(preview.object, null, 2) + '\n';
      let saved = objects.value.find((item) => item.object.id === preview.object.id);
      if (
        saved &&
        (saved.object.properties.repeatSourceId !== preview.object.properties.repeatSourceId ||
          saved.object.properties.repeatOccurrence !== preview.object.properties.repeatOccurrence)
      )
        throw new Error('下一次任务身份发生冲突，已有文件未改动');
      if (saved && JSON.stringify(saved.object) !== JSON.stringify(preview.object)) return saved;
      for (const row of preview.relations)
        for (const endpoint of [row.source, row.target]) {
          if (referenceKey(endpoint) === referenceKey(preview.object)) continue;
          if (
            !referenceTargets.value.some(
              (target) => !target.archived && referenceKey(target) === referenceKey(endpoint),
            )
          )
            throw new Error('关联目标已不可用');
        }
      try {
        if (!saved) {
          if (workspace.value.files.some((file) => file.id === preview.object.id))
            throw new Error('下一次任务身份与文件冲突');
          await adapter.create(`${objectDirectory}/${preview.object.id}.tano.json`, content);
        }
        for (const row of preview.relations) {
          if (relations.value.some((existing) => relationKey(existing) === relationKey(row)))
            continue;
          if (
            row.type === 'assigned' &&
            relations.value.some(
              (existing) =>
                existing.type === 'assigned' &&
                referenceKey(existing.target) === referenceKey(row.target),
            )
          )
            throw new Error('下一次任务负责人已变化，请检查已有任务');
          const result = await saveRelationChange(adapter, relationBase, { add: row });
          relationBase = result.snapshot;
          relations.value = result.file.relations;
        }
      } finally {
        workspace.value = await adapter.refresh();
        await refreshObjects();
      }
      saved = objects.value.find((item) => item.object.id === preview.object.id);
      if (!saved) throw new Error('下一次任务已被移除，请刷新');
      return saved;
    });
  }

  // Reference context graph
  function getReferenceContext(
    identity: ReferenceIdentity,
    draft?: string,
    expected = workspace.value
      ? { id: workspace.value.id, path: workspace.value.path }
      : undefined,
  ) {
    return serial(async () => {
      if (!expected || workspace.value?.id !== expected.id || workspace.value.path !== expected.path)
        throw new Error(t('工作区已切换'));
      if (adapter.mode === 'web') {
        try {
          workspace.value = await adapter.refresh();
          await refreshObjects();
        } catch (error) {
          clearRevokedReferences(error);
          throw error;
        }
      }
      const targets = referenceTargets.value.filter(
        (target) => target.type !== 'document' || !isWorkspaceInternalPath(target.path),
      );
      if (
        draft !== undefined &&
        !targets.some((target) => referenceKey(target) === referenceKey(identity))
      )
        targets.push({
          ...identity,
          workspace: expected.id,
          name: '未保存对象',
          path: '',
          description: draft,
        });
      const contents = new Map<string, string>();
      const errors: string[] = [...objectErrors.value];
      for (const target of targets) {
        const key = referenceKey(target);
        if (target.type !== 'document') {
          contents.set(key, target.description ?? '');
          continue;
        }
        try {
          const open = documentIndex.byId.value.get(target.id);
          const stamp = JSON.stringify([
            expected.id,
            expected.path,
            target.path,
            target.modified,
            target.size,
          ]);
          const cached = referenceDocumentCache.get(target.id);
          const content =
            open?.content ??
            (cached?.stamp === stamp ? cached.content : (await adapter.read(target.path)).content);
          if (!open) referenceDocumentCache.set(target.id, { stamp, content });
          contents.set(key, content);
        } catch (error) {
          errors.push(`${target.path}：${String(error)}`);
        }
      }
      if (draft !== undefined) contents.set(referenceKey(identity), draft);
      return referenceContext(contentReferences(targets, contents), identity, errors);
    });
  }

  function resetKnowledge(clearErrors = false) {
    objects.value = [];
    objectErrors.value = [];
    workspaceViews.value = [];
    workspaceViewErrors.value = [];
    relations.value = [];
    relationBase = null;
    if (clearErrors) relationError.value = '';
  }

  return {
    workspaceViews,
    workspaceViewErrors,
    objects,
    objectErrors,
    objectDefinitions,
    relations,
    relationError,
    getRelationBase: () => relationBase,
    relationDefinitions,
    relationIndex,
    referenceTargets,
    referenceRevision,
    referenceDocumentCache,
    clearRevokedReferences,
    refreshObjects,
    readFileMetadata,
    updateFileMetadata,
    createObjectDatabase,
    createFileDatabase,
    saveFileDatabase,
    createRelation,
    removeRelation,
    setRelationSource,
    createObject,
    updateObject,
    deleteObject,
    templates,
    writeTemplate,
    repeatPreview,
    createRepeat,
    getReferenceContext,
    resetKnowledge,
  };
}
