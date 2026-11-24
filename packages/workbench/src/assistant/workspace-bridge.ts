import { shallowRef, ref, type Ref } from 'vue';
import {
  FileRegistry,
  isDataTableFilePath,
  isMarkdown,
  isWorkspaceInternalPath,
  newShortId,
  objectDirectory,
  objectTypeRegistry,
  parentPath,
  parseObject,
  parseRelations,
  pathKey,
  referenceKey,
  validateObjectProperties,
  workspaceRelationPath,
  assistantRulesPath,
  type AssistantPreview,
  type AssistantProposal,
  type AssistantSource,
  type AssistantToolCall,
  type DocumentSuggestion,
  type FileSnapshot,
  type ReferenceIdentity,
  type ReferenceTarget,
  type RelationTypeDefinition,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceObject,
  type WorkspaceRelation,
} from '@tano/protocol';
import { mergeMarkdown } from '@tano/markdown';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import { assistantTableContent, reviewAssistantTable } from './data-tables';
import { isAssistantFile, validateAssistantContent, validAssistantDestination } from './files';
import { assistantHash } from './hash';
import {
  mergeStructureRelations,
  structureProposal,
  type StructureSnapshot,
} from './structures';
import { parseTaskQuery, possibleDuplicateTasks, queryTasks, type TaskQuery } from './tasks';
import { contentReferences } from '../objects/content-references';
import type { createDataTableController } from '../data-tables/data-table-controller';
import { tableTabId } from '../data-tables/data-tables';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { locateSuggestion } from '../documents/document-suggestions';
import { mergeObject, type ObjectRecord } from '../objects/workspace-objects';
import { loadSuggestions, saveSuggestions, type SuggestionState } from '../workspace/workspace-suggestions';
import type { Activity } from '../stores/workspace';

export type AssistantScope = Pick<Workspace, 'id' | 'path'> & { epoch?: number };

export interface WorkspaceAssistantBridgeDeps {
  adapter: WorkspaceAdapter;
  workspace: Ref<Workspace | null>;
  fileRegistry: Ref<FileRegistry | null>;
  documents: Ref<OpenDocument[]>;
  documentIndex: ReturnType<typeof useDocumentIndex>;
  dataTables: ReturnType<typeof createDataTableController>;
  capabilities: Ref<WorkspaceCapabilities>;
  objects: Ref<ObjectRecord[]>;
  objectErrors: Ref<string[]>;
  relations: Ref<WorkspaceRelation[]>;
  relationError: Ref<string>;
  getRelationBase: () => FileSnapshot | null;
  relationDefinitions: Ref<RelationTypeDefinition[]>;
  referenceTargets: Ref<ReferenceTarget[]>;
  tabIds: Ref<string[]>;
  tabAliases: Ref<Map<string, string>>;
  activeId: Ref<string>;
  tabTarget: (id: string) => string;
  removeTabAlias: (id: string) => void;
  removeTabNavigation: (id: string) => void;
  layoutPending: (doc: OpenDocument) => boolean;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  refreshObjects: () => Promise<void>;
  getReferenceContext: (
    identity: ReferenceIdentity,
    draft?: string,
    expected?: Pick<Workspace, 'id' | 'path'>,
  ) => Promise<unknown>;
  activity: (
    label: string,
    detail: string,
    kind: Activity['kind'],
    change?: Activity['change'],
  ) => void;
}

export function createWorkspaceAssistantBridge(deps: WorkspaceAssistantBridgeDeps) {
  const {
    adapter,
    workspace,
    fileRegistry,
    documents,
    documentIndex,
    dataTables,
    capabilities,
    objects,
    objectErrors,
    relations,
    relationError,
    getRelationBase,
    relationDefinitions,
    referenceTargets,
    tabIds,
    tabAliases,
    activeId,
    tabTarget,
    removeTabAlias,
    removeTabNavigation,
    layoutPending,
    serial,
    writable,
    refreshObjects,
    getReferenceContext,
    activity,
  } = deps;

  const assistantEpoch = ref(0);
  const suggestionPersistence = shallowRef<{ flush: () => Promise<void>; pending: () => boolean }>();
  const assistantApplied = new Map<
    string,
    { signature: string; before: string; after: string; hash: string; fileId: string }
  >();

  function resetForWorkspaceChange() {
    assistantEpoch.value++;
    assistantApplied.clear();
  }

  function requireAssistantWorkspace(scope: AssistantScope) {
    if (workspace.value?.id !== scope.id || workspace.value.path !== scope.path)
      throw new Error('工作区已切换，请在原工作区恢复助手会话');
    if (scope.epoch !== undefined && scope.epoch !== assistantEpoch.value)
      throw new Error('工作区打开会话已变化');
  }

  async function assistantReferenceContext(scope: AssistantScope, identity: ReferenceIdentity) {
    requireAssistantWorkspace(scope);
    if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
    const result = await getReferenceContext(identity, undefined, scope);
    requireAssistantWorkspace(scope);
    return result;
  }

  async function assistantRules(scope: AssistantScope) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path)
        throw new Error('工作区身份已变化');
      const rules: { path: string; content: string }[] = [];
      for (const path of ['AGENTS.md', assistantRulesPath]) {
        if (!current.files.some((file) => file.path === path && file.kind === 'file')) continue;
        const disk = await adapter.read(path);
        const content = documentIndex.byPath.value.get(path)?.content ?? disk.content;
        if (new TextEncoder().encode(content).length > 32_000)
          throw new Error(`${path} 超过 32 KB，请缩短工作区助手规则`);
        rules.push({ path, content });
      }
      return rules;
    });
  }

  async function assistantStructures(scope: AssistantScope) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path)
        throw new Error('工作区身份已变化');
      workspace.value = current;
      await refreshObjects();
      if (objectErrors.value.length || relationError.value)
        throw new Error('请先处理工作区对象或关系记录错误');
      return JSON.parse(
        JSON.stringify({
          targets: referenceTargets.value.filter(
            (target) => !isWorkspaceInternalPath(target.path) || target.type !== 'document',
          ),
          relationTypes: relationDefinitions.value,
          relations: relations.value,
          relationContent: getRelationBase()?.content ?? '',
          objects: objects.value.map((record) => ({
            object: record.object,
            path: record.path,
            content: record.snapshot.content,
            fileId: fileRegistry.value!.at(record.path)!.id,
          })),
        }),
      ) as StructureSnapshot & { relations: WorkspaceRelation[] };
    });
  }

  async function proposeAssistantStructure(
    scope: AssistantScope,
    runId: string,
    call: AssistantToolCall,
    snapshot?: StructureSnapshot,
  ) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path)
        throw new Error('工作区身份已变化');
      workspace.value = current;
      await refreshObjects();
      if (objectErrors.value.length || relationError.value)
        throw new Error('请先处理工作区对象或关系记录错误');
      if (
        !snapshot &&
        (call.function.name !== 'propose_event' ||
          JSON.parse(call.function.arguments)?.properties?.checkable === true)
      )
        throw new Error('必须先读取工作区对象快照，检查已有任务');
      const id =
        call.function.name === 'propose_event'
          ? await adapter.reserveObjectId?.(objects.value.map((record) => record.object.id))
          : newShortId(new Set(relations.value.map((row) => row.id)));
      if (!id) throw new Error('此存储适配器无法分配工作区对象身份');
      return structureProposal(call, {
        workspaceId: scope.id,
        runId,
        id,
        relationContent: getRelationBase()?.content ?? '',
        targets: referenceTargets.value.filter(
          (target) => target.type !== 'document' || !isWorkspaceInternalPath(target.path),
        ),
        relationTypes: relationDefinitions.value,
        ...snapshot,
      });
    });
  }

  async function assistantTaskQuery(
    scope: AssistantScope,
    input: TaskQuery,
    snapshot: StructureSnapshot,
  ) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
      const current = await adapter.refresh();
      if (current.id !== scope.id || current.path !== scope.path)
        throw new Error('工作区身份已变化');
      workspace.value = current;
      await refreshObjects();
      const accessible = new Map(
        referenceTargets.value.map((target) => [referenceKey(target), target]),
      );
      const targets = snapshot.targets
        .filter((target) => accessible.has(referenceKey(target)))
        .map((target) =>
          target.type === 'document' ? accessible.get(referenceKey(target))! : target,
        );
      const contents = new Map<string, string>();
      const errors: string[] = [];
      for (const target of targets) {
        if (target.type !== 'document') {
          contents.set(referenceKey(target), target.description ?? '');
          continue;
        }
        try {
          const content =
            documentIndex.byId.value.get(target.id)?.content ?? (await adapter.read(target.path)).content;
          contents.set(referenceKey(target), content);
        } catch (error) {
          errors.push(`${target.path}：${String(error)}`);
        }
      }
      const parsedRelations = snapshot.relationContent
        ? parseRelations(snapshot.relationContent).relations
        : [];
      return {
        ...queryTasks(
          targets,
          parsedRelations,
          contentReferences(targets, contents),
          parseTaskQuery(input),
        ),
        complete: errors.length === 0,
        errors,
      };
    });
  }

  async function reviewAssistantStructure(
    proposal: AssistantProposal,
    accepted?: AssistantPreview,
    automatic = false,
    signal?: AbortSignal,
    external = false,
  ) {
    if (!capabilities.value.features.objectReferences) throw new Error('工作区对象能力未启用');
    await refreshObjects();
    if (objectErrors.value.length || relationError.value)
      throw new Error('请先处理工作区对象或关系记录错误');
    let disk: FileSnapshot | null = null;
    let content = proposal.content;
    const validateAgentObject = (object: WorkspaceObject, base?: WorkspaceObject) => {
      const definition = objectTypeRegistry.get(object.type);
      if (!definition || definition.storage !== 'record' || definition.retired)
        throw new Error('对象类型不可编辑');
      if (
        base &&
        (base.id !== object.id || base.type !== object.type || base.properties.syncReadOnly === true)
      )
        throw new Error('对象身份不可修改或对象为只读');
      validateObjectProperties(object.type, object.properties);
    };
    if (proposal.kind === 'object') {
      const object = parseObject(content);
      if (proposal.base) {
        const base = parseObject(proposal.base);
        validateAgentObject(object, base);
        const file = workspace.value!.files.find(
          (file) => file.id === proposal.fileId && file.path === proposal.path,
        );
        const record = objects.value.find(
          (record) => record.object.id === base.id && record.path === file?.path,
        );
        if (!file || !record || file.readOnly) throw new Error('对象已删除、移动、只读或身份变化');
        disk = record.snapshot;
        const merged = mergeObject(base, object, record.object);
        if (!merged)
          return {
            status: 'conflict' as const,
            preview: { before: disk.content, after: content, diskHash: disk.hash, path: proposal.path },
          };
        validateAgentObject(merged, record.object);
        content = JSON.stringify(merged, null, 2) + '\n';
      } else {
        if (proposal.path !== `${objectDirectory}/${object.id}.tano.json` || object.archived)
          throw new Error('新增对象路径或归档状态无效');
        validateAgentObject(object);
        if (
          automatic &&
          object.properties.checkable === true &&
          possibleDuplicateTasks(referenceTargets.value, object.name, object.id).length
        )
          throw new Error('发现可能重复的任务，已暂停创建，请核对后决定是否仍需新增');
        if (
          referenceTargets.value.some((target) => target.id === object.id) ||
          workspace.value!.files.some((file) => file.path === proposal.path)
        )
          throw new Error('对象身份或路径已被使用，请保留建议并重新生成');
      }
    } else {
      if (proposal.path !== workspaceRelationPath) throw new Error('关系建议路径无效');
      const base = proposal.base
        ? parseRelations(proposal.base)
        : { version: 1 as const, relations: [] };
      const proposed = parseRelations(proposal.content);
      disk = getRelationBase();
      const current = disk ? parseRelations(disk.content) : { version: 1 as const, relations: [] };
      const merged = mergeStructureRelations(
        base,
        proposed,
        current,
        referenceTargets.value.filter(
          (target) => target.type !== 'document' || !isWorkspaceInternalPath(target.path),
        ),
        relationDefinitions.value,
      );
      if (!merged)
        return {
          status: 'conflict' as const,
          preview: {
            before: disk?.content ?? '',
            after: content,
            diskHash: disk?.hash ?? null,
            path: proposal.path,
          },
        };
      content = JSON.stringify(merged, null, 2) + '\n';
    }
    const preview: AssistantPreview = {
      before: disk?.content ?? '',
      after: content,
      diskHash: disk?.hash ?? null,
      path: proposal.path,
    };
    if (!accepted) return { status: 'preview' as const, preview };
    if (JSON.stringify(accepted) !== JSON.stringify(preview))
      return { status: 'stale' as const, preview };
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
    const file = fileRegistry.value?.at(proposal.path);
    if (!file) throw new Error('工作区记录可能已保存，请刷新核对');
    const result = await adapter.read(proposal.path);
    await refreshObjects();
    return {
      status: 'saved' as const,
      applied: { before: preview.before, after: result.content, hash: result.hash, fileId: file.id },
    };
  }

  async function assistantSnapshot(scope: AssistantScope, fileId: string): Promise<AssistantSource> {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const refreshed = await adapter.refresh();
      if (refreshed.id !== scope.id || refreshed.path !== scope.path)
        throw new Error('工作区身份已变化');
      const file = refreshed.files.find(
        (file) => file.id === fileId && file.kind === 'file' && isAssistantFile(file.path),
      );
      if (!file) throw new Error('参考文档已移除');
      const disk = await adapter.read(file.path);
      const doc = documentIndex.byId.value.get(fileId);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理参考文档的冲突或缺失');
      const content = isDataTableFilePath(file.path)
        ? assistantTableContent(
            disk,
            dataTables.records.value.find((state) => state.fileId === fileId),
          )
        : (doc?.content ?? disk.content);
      if (content.length > 512_000) throw new Error('参考文档过大，请使用较小文档');
      return {
        id: '',
        workspaceId: scope.id,
        fileId,
        path: file.path,
        content,
        hash: await assistantHash(content),
        origin: content !== disk.content ? 'draft' : 'disk',
      };
    });
  }

  async function assistantSearch(scope: AssistantScope, query: string) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      const hits = (await adapter.search?.(scope.id, query)) ?? [];
      const refreshed = await adapter.refresh();
      requireAssistantWorkspace(scope);
      if (refreshed.id !== scope.id || refreshed.path !== scope.path)
        throw new Error('工作区身份已变化');
      const result = hits
        .filter((hit) =>
          refreshed.files.some(
            (file) =>
              file.id === hit.id && isMarkdown(file.path) && isAssistantFile(file.path),
          ),
        )
        .map((hit) => ({ fileId: hit.id, path: hit.path, excerpt: hit.excerpt }));
      const needle = query.trim().toLocaleLowerCase();
      if (!needle)
        for (const file of refreshed.files.filter(
          (file) => file.kind === 'file' && isMarkdown(file.path) && isAssistantFile(file.path),
        ))
          result.push({ fileId: file.id, path: file.path, excerpt: '' });
      for (const file of refreshed.files.filter(
        (file) =>
          file.kind === 'file' && isDataTableFilePath(file.path) && isAssistantFile(file.path),
      )) {
        if (result.some((hit) => hit.fileId === file.id)) continue;
        const state = dataTables.records.value.find((state) => state.fileId === file.id);
        let text = '';
        try {
          text = assistantTableContent(await adapter.read(file.path), state);
        } catch {
          /* Invalid tables remain discoverable by path, never treated as valid content. */
        }
        const index = text.toLocaleLowerCase().indexOf(needle);
        if (!needle || file.path.toLocaleLowerCase().includes(needle) || index >= 0)
          result.push({
            fileId: file.id,
            path: file.path,
            excerpt: text.slice(Math.max(0, index - 40), Math.max(0, index - 40) + 240),
          });
      }
      return result.slice(0, 20);
    });
  }

  async function reviewAssistantProposalNow(
    scope: AssistantScope,
    proposal: AssistantProposal,
    accepted?: AssistantPreview,
    automatic = false,
    signal?: AbortSignal,
    external = false,
  ) {
    signal?.throwIfAborted();
    requireAssistantWorkspace(scope);
    if (proposal.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
    const signature = JSON.stringify([
      scope,
      proposal.kind,
      proposal.fileId,
      proposal.path,
      proposal.destination,
      proposal.base,
      proposal.content,
      external,
    ]);
    const applied = assistantApplied.get(proposal.id);
    if (applied) {
      if (applied.signature !== signature) throw new Error('同一操作标识不能对应不同建议');
      return { status: 'saved' as const, applied };
    }
    const refreshed = await adapter.refresh();
    if (refreshed.id !== scope.id || refreshed.path !== scope.path)
      throw new Error('工作区身份已变化');
    workspace.value = refreshed;
    if (
      proposal.kind === 'edit' &&
      isMarkdown(proposal.path) &&
      proposal.fileId &&
      /^[0-9a-f]{6}$/.test(proposal.fileId)
    ) {
      const published = await loadSuggestions(adapter, scope.id, proposal.fileId);
      if (published.file.suggestions.some((item) => item.groupId === proposal.id))
        throw new Error('此提案已转为文档建议，请在文档中逐项审阅，不能再次整篇应用');
    }
    if (proposal.kind === 'object' || proposal.kind === 'relation') {
      const result = await reviewAssistantStructure(proposal, accepted, automatic, signal, external);
      if (result.status === 'saved') {
        assistantApplied.set(proposal.id, { signature, ...result.applied });
        activity('助手工作区建议已应用', proposal.path, 'save', {
          before: result.applied.before,
          after: result.applied.after,
        });
      }
      return result;
    }
    if (['delete', 'rename', 'move'].includes(proposal.kind)) {
      if (!adapter.changeFile) throw new Error('当前工作区暂不支持文件操作建议');
      const file = refreshed.files.find(
        (file) => file.id === proposal.fileId && file.kind === 'file',
      );
      if (!file) throw new Error('目标文档已删除或身份变化');
      if (file.readOnly || !isAssistantFile(file.path)) throw new Error('目标文件只读或路径无效');
      const destination = proposal.destination;
      if (proposal.kind !== 'delete') {
        if (!destination || !validAssistantDestination(file.path, destination) || file.path === destination)
          throw new Error('目标文档路径无效或已位于目标位置，请核对文件');
        if (refreshed.files.some((entry) => pathKey(entry.path) === pathKey(destination)))
          throw new Error('目标名称已经存在');
        const parent = parentPath(destination);
        if (parent && !refreshed.files.some((entry) => entry.path === parent && entry.kind === 'directory'))
          throw new Error('目标文件夹不存在');
      } else if (destination !== undefined) throw new Error('删除建议不能包含目标路径');
      const doc = documentIndex.byId.value.get(file.id);
      const table = dataTables.records.value.find((state) => state.fileId === file.id);
      const tablePending = () =>
        table && (dataTables.dirty(table) || table.error || table.unavailable || table.saving);
      if (tablePending()) throw new Error('请先保存数据表并处理冲突，再审阅文件操作');
      if (doc && (dirty(doc) || doc.conflict || doc.missing || doc.saving || layoutPending(doc)))
        throw new Error('请先保存文档并处理冲突，再审阅文件操作');
      const disk = await adapter.read(file.path);
      const preview: AssistantPreview = {
        before: disk.content,
        after: proposal.kind === 'delete' ? '' : disk.content,
        path: file.path,
        diskHash: disk.hash,
        ...(destination ? { destination } : {}),
      };
      if (automatic && (file.path !== proposal.path || disk.content !== proposal.base))
        throw new Error('读取后文件内容或位置已变化，已暂停文件操作，请核对后处理');
      if (!accepted) return { status: 'preview' as const, preview };
      if (JSON.stringify(preview) !== JSON.stringify(accepted))
        return { status: 'stale' as const, preview };
      writable();
      if (tablePending()) throw new Error('数据表已变化，请先保存后重新审阅');
      // Read can yield while a user types. Never remove a newly changed draft.
      if (doc && (dirty(doc) || doc.conflict || doc.missing || doc.saving || layoutPending(doc)))
        throw new Error('文档已变化，请先保存后重新审阅');
      signal?.throwIfAborted();
      const changed = await adapter.changeFile({
        workspaceId: scope.id,
        fileId: file.id,
        path: file.path,
        expectedHash: disk.hash,
        ...(destination ? { destination } : {}),
      });
      if (changed.status === 'missing') throw new Error('目标文档已在应用前删除');
      if (changed.status === 'conflict')
        return {
          status: 'stale' as const,
          preview: {
            ...preview,
            before: changed.snapshot.content,
            after: proposal.kind === 'delete' ? '' : changed.snapshot.content,
            diskHash: changed.snapshot.hash,
          },
        };
      const receipt = {
        signature,
        before: changed.snapshot.content,
        after: proposal.kind === 'delete' ? '' : changed.snapshot.content,
        hash: changed.snapshot.hash,
        fileId: file.id,
      };
      assistantApplied.set(proposal.id, receipt);
      if (proposal.kind === 'delete') {
        const tableTab = tableTabId(file.id);
        if (table && dataTables.dirty(table)) table.unavailable = true;
        else if (isDataTableFilePath(file.path)) {
          dataTables.records.value = dataTables.records.value.filter(
            (state) => state.fileId !== file.id,
          );
          tabIds.value = tabIds.value.filter((id) => tabTarget(id) !== tableTab);
          for (const id of [...tabAliases.value.keys()])
            if (tabTarget(id) === tableTab) {
              removeTabAlias(id);
              removeTabNavigation(id);
            }
          removeTabNavigation(tableTab);
          if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
        }
        if (doc && (dirty(doc) || layoutPending(doc))) doc.missing = true;
        // Preserve input received during the native operation for Save Copy.
        else {
          documents.value = documents.value.filter((item) => item.id !== file.id);
          tabIds.value = tabIds.value.filter((id) => tabTarget(id) !== file.id);
          for (const id of [...tabAliases.value.keys()])
            if (tabTarget(id) === file.id) {
              removeTabAlias(id);
              removeTabNavigation(id);
            }
          removeTabNavigation(file.id);
          if (!tabIds.value.includes(activeId.value)) activeId.value = tabIds.value.at(-1) ?? '';
        }
      } else if (doc) doc.path = destination!;
      // Record success before refresh so a failed refresh cannot cause a destructive retry.
      proposal.applied = receipt;
      proposal.status = 'applied';
      workspace.value = await adapter.refresh();
      if (isDataTableFilePath(file.path)) await dataTables.reload();
      activity(
        '助手文件变更已应用',
        destination ? `${file.path} → ${destination}` : file.path,
        'file',
      );
      return { status: 'saved' as const, applied: receipt };
    }
    let disk: FileSnapshot | null = null;
    let doc: OpenDocument | undefined;
    let path = proposal.path;
    let current = '';
    if (proposal.kind === 'create') {
      if (proposal.base !== '') throw new Error('新建文件不能包含已有内容基线');
      validateAssistantContent(path, proposal.content);
      if (refreshed.files.some((file) => pathKey(file.path) === pathKey(path)))
        throw new Error('同名文件已存在，请调整建议路径');
      if (
        parentPath(path) &&
        !refreshed.files.some((file) => file.kind === 'directory' && file.path === parentPath(path))
      )
        throw new Error('目标文件夹不存在');
    } else {
      const file = refreshed.files.find(
        (file) => file.id === proposal.fileId && file.kind === 'file' && isAssistantFile(file.path),
      );
      if (!file) throw new Error('目标文档已删除或身份变化');
      if (file.readOnly) throw new Error('目标文档只读');
      path = file.path;
      disk = await adapter.read(path);
      validateAssistantContent(path, proposal.content, proposal.base);
      if (isDataTableFilePath(path)) {
        const result = await reviewAssistantTable({
          adapter,
          proposal,
          path,
          disk,
          accepted,
          writable,
          signal,
          state: dataTables.records.value.find((state) => state.fileId === file.id),
        });
        if (result.status === 'saved') {
          assistantApplied.set(proposal.id, { signature, ...result.applied });
          activity('助手数据表修改已应用', path, 'save', {
            before: result.applied.before,
            after: result.applied.after,
          });
          await dataTables.reload();
        }
        return result;
      }
      doc = documentIndex.byId.value.get(file.id);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有的冲突或缺失');
      const reconciled = doc
        ? mergeMarkdown(doc.base.content, doc.content, disk.content)
        : { clean: true, content: disk.content };
      if (!reconciled.clean)
        return {
          status: 'conflict' as const,
          preview: { before: doc!.content, after: proposal.content, diskHash: disk.hash, path },
        };
      current = reconciled.content;
    }
    const merged = mergeMarkdown(proposal.base, proposal.content, current);
    const preview: AssistantPreview = {
      before: current,
      after: merged.content,
      diskHash: disk?.hash ?? null,
      path,
    };
    if (!merged.clean)
      return { status: 'conflict' as const, preview: { ...preview, after: proposal.content } };
    if (!accepted) return { status: 'preview' as const, preview };
    if (JSON.stringify(preview) !== JSON.stringify(accepted))
      return { status: 'stale' as const, preview };
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
        fileId = fileRegistry.value?.at(path)?.id ?? '';
        if (!fileId) throw new Error('文档可能已创建，请刷新核对');
        result = await adapter.read(path);
      } else {
        fileId = proposal.fileId!;
        const written = await adapter.write(path, preview.after, disk!.hash);
        if (written.status === 'missing') throw new Error('目标文档已在保存前删除');
        if (written.status === 'conflict') {
          const live = doc
            ? mergeMarkdown(doc.base.content, doc.content, written.snapshot.content)
            : { clean: true, content: written.snapshot.content };
          const updated = mergeMarkdown(proposal.base, proposal.content, live.content);
          return {
            status: live.clean && updated.clean ? ('stale' as const) : ('conflict' as const),
            preview: {
              before: live.content,
              after: live.clean && updated.clean ? updated.content : proposal.content,
              diskHash: written.snapshot.hash,
              path,
            },
          };
        }
        result = written.snapshot;
        if (doc) {
          const duringSave = doc.content;
          const remaining = mergeMarkdown(draftBefore!, duringSave, result.content);
          doc.base = result;
          doc.error = undefined;
          if (remaining.clean) doc.content = remaining.content;
          else {
            const copyPath = path.replace(
              /\.(md|markdown)$/i,
              `.conflict-${Date.now()}-${crypto.randomUUID().slice(0, 6)}.md`,
            );
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
    } finally {
      if (doc) doc.saving = false;
    }
  }

  async function reviewAssistantProposal(
    scope: AssistantScope,
    proposal: AssistantProposal,
    accepted?: AssistantPreview,
    automatic = false,
    signal?: AbortSignal,
    external = false,
  ) {
    return serial(() =>
      reviewAssistantProposalNow(scope, proposal, accepted, automatic, signal, external),
    );
  }

  function readDocumentSuggestions(scope: AssistantScope, fileId: string) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      return loadSuggestions(adapter, scope.id, fileId);
    });
  }

  function writeDocumentSuggestions(
    scope: AssistantScope,
    state: SuggestionState,
    records: DocumentSuggestion[],
  ) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (state.file.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const file = fileRegistry.value?.get(state.file.fileId);
      if (!file || file.readOnly) throw new Error('目标文档已移除或只读');
      return saveSuggestions(adapter, state, records);
    });
  }

  function acceptDocumentSuggestion(
    scope: AssistantScope,
    state: SuggestionState,
    id: string,
    accepted?: AssistantPreview,
  ) {
    return serial(async () => {
      requireAssistantWorkspace(scope);
      writable();
      if (state.file.workspaceId !== scope.id) throw new Error('建议不属于当前工作区');
      const latest = await loadSuggestions(adapter, scope.id, state.file.fileId);
      const item = latest.file.suggestions.find((item) => item.id === id);
      const expected = state.file.suggestions.find((item) => item.id === id);
      if (!item || JSON.stringify(item) !== JSON.stringify(expected))
        throw new Error('建议已变化，请重新载入后审阅');
      const target = (await adapter.refresh()).files.find(
        (file) => file.id === state.file.fileId && isMarkdown(file.path),
      );
      if (!target || target.readOnly) throw new Error('目标文档已移除或只读');
      const disk = await adapter.read(target.path);
      if (item.status === 'applying') {
        if (disk.content !== item.application?.after)
          throw new Error('上次写入结果待核对，未重复应用；请比较正式正文与修改前后内容');
        const completed = {
          ...item,
          status: 'accepted' as const,
          revision: item.revision + 1,
          application: { ...item.application, resultHash: disk.hash },
        };
        const saved = await saveSuggestions(
          adapter,
          latest,
          latest.file.suggestions.map((row) => (row.id === id ? completed : row)),
        );
        return { status: 'saved' as const, state: saved };
      }
      if (item.status !== 'pending') return { status: 'saved' as const, state: latest };
      const doc = documentIndex.byId.value.get(state.file.fileId);
      if (doc?.conflict || doc?.missing) throw new Error('请先处理文档冲突或缺失');
      const merged = doc
        ? mergeMarkdown(doc.base.content, doc.content, disk.content)
        : { clean: true, content: disk.content };
      if (!merged.clean) throw new Error('外部修改与当前草稿冲突，原文和建议均已保留');
      const location = locateSuggestion(item, merged.content);
      if (!location) throw new Error('建议的原文已变化或无法唯一定位，请核对后重新提出建议');
      const proposal: AssistantProposal = {
        id: crypto.randomUUID(),
        runId: id,
        workspaceId: scope.id,
        kind: 'edit',
        fileId: state.file.fileId,
        path: target.path,
        base: merged.content,
        content: merged.content.slice(0, location.from) + item.text + merged.content.slice(location.to),
        reason: item.reason ?? '文档建议',
        status: 'ready',
      };
      const reviewed = await reviewAssistantProposalNow(scope, proposal);
      if (reviewed.status !== 'preview') throw new Error('文档存在冲突，请重新审阅');
      if (!accepted || JSON.stringify(accepted) !== JSON.stringify(reviewed.preview))
        return { status: 'preview' as const, preview: reviewed.preview, state: latest };
      const intent: DocumentSuggestion = {
        ...item,
        status: 'applying',
        revision: item.revision + 1,
        application: {
          operationId: proposal.id,
          before: accepted.before,
          after: accepted.after,
          diskHash: accepted.diskHash!,
        },
      };
      const prepared = await saveSuggestions(
        adapter,
        latest,
        latest.file.suggestions.map((row) => (row.id === id ? intent : row)),
      );
      // A durable intent precedes the Markdown write. Exceptions leave it for explicit recovery.
      const result = await reviewAssistantProposalNow(scope, proposal, accepted);
      if (result.status !== 'saved') {
        const reset = { ...item, revision: intent.revision + 1 };
        const saved = await saveSuggestions(
          adapter,
          prepared,
          prepared.file.suggestions.map((row) => (row.id === id ? reset : row)),
        );
        return { status: 'preview' as const, preview: result.preview, state: saved };
      }
      const completed = {
        ...intent,
        status: 'accepted' as const,
        revision: intent.revision + 1,
        application: { ...intent.application!, resultHash: result.applied.hash },
      };
      const saved = await saveSuggestions(
        adapter,
        prepared,
        prepared.file.suggestions.map((row) => (row.id === id ? completed : row)),
      );
      return { status: 'saved' as const, state: saved };
    });
  }

  function setSuggestionPersistence(hooks: { flush: () => Promise<void>; pending: () => boolean }) {
    suggestionPersistence.value = hooks;
  }

  return {
    assistantEpoch,
    suggestionPersistence,
    resetForWorkspaceChange,
    assistantReferenceContext,
    assistantRules,
    assistantStructures,
    proposeAssistantStructure,
    assistantTaskQuery,
    assistantSnapshot,
    assistantSearch,
    reviewAssistantProposal,
    readDocumentSuggestions,
    writeDocumentSuggestions,
    acceptDocumentSuggestion,
    setSuggestionPersistence,
  };
}
