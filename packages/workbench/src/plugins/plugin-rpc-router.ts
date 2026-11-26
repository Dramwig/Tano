import type { Ref } from 'vue';
import type { WorkspaceCapabilities } from '@tano/editor/runtime';
import { mergeMarkdown } from '@tano/markdown';
import {
  isMarkdown,
  isWorkspaceInternalPath,
  matchesPluginPathScopes,
  objectDirectory,
  parseObject,
  parsePluginAttachmentWrite,
  pluginRecord,
  referenceKey,
  validateObjectProperties,
  validatePath,
  validateRelation,
  type FileEntry,
  type FileRegistry,
  type FileSnapshot,
  type PluginAiCompleteRequest,
  type PluginAiCompleteResult,
  type PluginAiStructuredRequest,
  type PluginAiStructuredResult,
  type ReferenceTarget,
  type RelationTypeDefinition,
  type Workspace,
  type WorkspaceAdapter,
  type WorkspaceRelation,
} from '@tano/protocol';
import { assistantHash } from '../assistant/hash';
import type { useDocumentIndex } from '../documents/document-index';
import { documentDirty as dirty, type OpenDocument } from '../documents/document-session';
import { nativeAttachments } from '../files/attachments';
import { t } from '../i18n/i18n';
import { mergeObject, saveObject, type ObjectRecord } from '../objects/workspace-objects';
import { saveRelationChange } from '../objects/workspace-relations';
import type { WorkbenchRuntime } from '../runtime';
import type { PluginAttachmentReader } from './attachment-reader';
import type { PluginQueryPager } from './data';
import { queryPluginData } from './queries';

export interface PluginEditorBridge {
  applyEdit(id: string, before: string, after: string): Promise<boolean>;
  activeEditor?(): {
    fileId: string;
    mode: 'rich' | 'source';
    readOnly: boolean;
    selection: { from: number; to: number; empty: boolean };
    selectedText: string;
    blockType?: string;
  } | null;
  applySelectionEdit?(id: string, text: string, mode: 'insert' | 'replace'): Promise<boolean>;
}

export type PluginAiRunner = (options: {
  pluginId: string;
  pluginName: string;
  structured: boolean;
  request: PluginAiCompleteRequest | PluginAiStructuredRequest;
  signal: AbortSignal;
}) => Promise<PluginAiCompleteResult | PluginAiStructuredResult>;

export interface PluginRpcContext {
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
  pluginAttachmentReader: PluginAttachmentReader;
  pluginQueryPager: PluginQueryPager;
  getPluginEditorBridge: () => PluginEditorBridge | undefined;
  getPluginAiRunner: () => PluginAiRunner | undefined;
  openPluginDialog: (
    method: 'ui.pick' | 'ui.prompt' | 'ui.confirm',
    params: Record<string, unknown>,
  ) => Promise<string | boolean | null>;
  showPluginToast: (params: Record<string, unknown>) => void;
  openPluginView: (pluginId: string, viewId: string) => void | Promise<void>;
  serial: <T>(task: () => Promise<T>) => Promise<T>;
  writable: () => void;
  refreshObjects: () => Promise<void>;
  openInternal: (file: FileEntry, replaceId?: string, current?: () => boolean) => Promise<void>;
  saveInternal: (doc: OpenDocument) => Promise<void>;
  ensureTabNavigation: (tabId: string, targetId?: string) => void;
  touchNavigation: () => void;
}

function resolveDocumentText(value: unknown) {
  if (typeof value !== 'string' || value.length > 512000)
    throw new Error('插件文档内容无效或过大');
  return value;
}

function resolveScopedMarkdownFile(
  ctx: PluginRpcContext,
  fileId: unknown,
  pathScopes: string[] | undefined,
): FileEntry {
  const entry = ctx.fileRegistry.value?.get(String(fileId));
  if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path))
    throw new Error('文档不存在或不可访问');
  if (!matchesPluginPathScopes(entry.path, pathScopes))
    throw new Error('文档路径不在插件授权目录范围内');
  return entry;
}

async function handleEditorRpc(
  ctx: PluginRpcContext,
  method: 'editor.active' | 'editor.insert' | 'editor.replaceSelection',
  params: Record<string, unknown>,
  pathScopes: string[] | undefined,
  expected: string | undefined,
  assertInstance: () => void,
): Promise<unknown> {
  if (method === 'editor.active') {
    assertInstance();
    if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    const snapshot = ctx.getPluginEditorBridge()?.activeEditor?.();
    if (!snapshot) return null;
    const entry = ctx.fileRegistry.value?.get(snapshot.fileId);
    if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path)) return null;
    if (!matchesPluginPathScopes(entry.path, pathScopes)) return null;
    const doc = ctx.documentIndex.byId.value.get(entry.id);
    const content = doc ? doc.content : (await ctx.adapter.read(entry.path)).content;
    assertInstance();
    return {
      fileId: entry.id,
      path: entry.path,
      mode: snapshot.mode,
      readOnly: !!(ctx.workspace.value?.readOnly || entry.readOnly || snapshot.readOnly),
      selection: snapshot.selection,
      selectedText: snapshot.selectedText,
      ...(snapshot.blockType ? { blockType: snapshot.blockType } : {}),
      hash: await assistantHash(content),
    };
  }
  return ctx.serial(async () => {
    assertInstance();
    if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    ctx.writable();
    const bridge = ctx.getPluginEditorBridge();
    const snapshot = bridge?.activeEditor?.();
    if (!snapshot || !bridge?.applySelectionEdit)
      throw new Error('当前没有可编辑的活动文档');
    const entry = ctx.fileRegistry.value?.get(snapshot.fileId);
    if (!entry || !isMarkdown(entry.path) || isWorkspaceInternalPath(entry.path))
      throw new Error('当前没有可编辑的活动文档');
    if (!matchesPluginPathScopes(entry.path, pathScopes))
      throw new Error('文档路径不在插件授权目录范围内');
    if (entry.readOnly || snapshot.readOnly) throw new Error('你对这篇文档只有阅读权限');
    const doc = ctx.documentIndex.byId.value.get(entry.id);
    if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
    const editing = ctx.runtime.extensions?.()?.editing;
    if (editing?.isManaging(entry.id)) {
      throw new Error('当前协作会话暂不支持直接插入选区，请使用 documents.edit');
    }
    const ok = await bridge.applySelectionEdit(
      entry.id,
      String(params.text ?? ''),
      method === 'editor.insert' ? 'insert' : 'replace',
    );
    if (!ok) throw new Error('当前编辑器无法应用选区修改');
    assertInstance();
    const updated = ctx.documentIndex.byId.value.get(entry.id);
    const content = updated ? updated.content : (await ctx.adapter.read(entry.path)).content;
    return {
      fileId: entry.id,
      hash: await assistantHash(content),
      status: 'applied',
    };
  });
}

async function handleDocumentWriteRpc(
  ctx: PluginRpcContext,
  method: 'documents.create' | 'documents.move' | 'documents.trash' | 'documents.write',
  params: Record<string, unknown>,
  pathScopes: string[] | undefined,
  current: Workspace,
  assertCurrent: () => void,
): Promise<unknown> {
  if (method === 'documents.create') {
    const path = resolveDocumentText(params.path);
    if (!isMarkdown(path) || validatePath(path)) throw new Error('新文档路径无效');
    if (!matchesPluginPathScopes(path, pathScopes))
      throw new Error('新文档路径不在插件授权目录范围内');
    assertCurrent();
    await ctx.adapter.create(path, resolveDocumentText(params.content));
    ctx.workspace.value = await ctx.adapter.refresh();
    const entry = ctx.fileRegistry.value?.at(path)!;
    return { id: entry.id, path };
  }
  if (method === 'documents.move') {
    const entry = resolveScopedMarkdownFile(ctx, params.fileId, pathScopes);
    if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
    const destination = resolveDocumentText(params.destination);
    if (!isMarkdown(destination) || validatePath(destination) || isWorkspaceInternalPath(destination))
      throw new Error('目标文档路径无效');
    if (!matchesPluginPathScopes(destination, pathScopes))
      throw new Error('目标路径不在插件授权目录范围内');
    if (destination === entry.path) return { id: entry.id, path: entry.path };
    if (current.files.some((row) => row.path === destination))
      throw new Error('目标路径已存在同名文件');
    if (!pluginRecord(params.base) || params.base.id !== entry.id || typeof params.base.content !== 'string')
      throw new Error('文档版本无效');
    const doc = ctx.documentIndex.byId.value.get(entry.id);
    if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
    if (doc && dirty(doc)) throw new Error('文档存在未保存修改，请先保存后再移动');
    const disk = await ctx.adapter.read(entry.path);
    if (disk.content !== params.base.content)
      throw new Error('文档内容已变化，请重新读取后再移动');
    assertCurrent();
    if (ctx.adapter.changeFile) {
      const result = await ctx.adapter.changeFile({
        workspaceId: current.id,
        fileId: entry.id,
        path: entry.path,
        expectedHash: disk.hash,
        destination,
      });
      if (result.status !== 'saved') throw new Error('文档内容已变化或不存在，请重新读取后再移动');
    } else {
      await ctx.adapter.move(entry.path, destination, 'file');
    }
    assertCurrent();
    ctx.workspace.value = await ctx.adapter.refresh();
    if (doc) doc.path = destination;
    return { id: entry.id, path: destination };
  }
  if (method === 'documents.trash') {
    const entry = resolveScopedMarkdownFile(ctx, params.fileId, pathScopes);
    if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
    if (!pluginRecord(params.base) || params.base.id !== entry.id || typeof params.base.content !== 'string')
      throw new Error('文档版本无效');
    const doc = ctx.documentIndex.byId.value.get(entry.id);
    if (doc?.conflict || doc?.missing) throw new Error('请先处理文档已有冲突');
    if (doc && dirty(doc)) throw new Error('文档存在未保存修改，请先保存后再移入回收站');
    const disk = await ctx.adapter.read(entry.path);
    if (disk.content !== params.base.content)
      throw new Error('文档内容已变化，请重新读取后再移入回收站');
    assertCurrent();
    if (ctx.adapter.changeFile) {
      const result = await ctx.adapter.changeFile({
        workspaceId: current.id,
        fileId: entry.id,
        path: entry.path,
        expectedHash: disk.hash,
      });
      if (result.status !== 'saved') throw new Error('文档内容已变化或不存在，请重新读取后再移入回收站');
    } else {
      await ctx.adapter.remove(entry.path);
    }
    assertCurrent();
    ctx.workspace.value = await ctx.adapter.refresh();
    if (doc) doc.missing = true;
    return { id: entry.id, path: entry.path, trashed: true };
  }
  // documents.write
  const entry = resolveScopedMarkdownFile(ctx, params.fileId, pathScopes);
  if (entry.readOnly) throw new Error('你对这篇文档只有阅读权限');
  if (!pluginRecord(params.base) || params.base.id !== entry.id)
    throw new Error('文档版本无效');
  const base = resolveDocumentText(params.base.content);
  const desired = resolveDocumentText(params.content);
  const disk = await ctx.adapter.read(entry.path);
  const doc = ctx.documentIndex.byId.value.get(entry.id);
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
    await ctx.adapter.create(copyPath, desired);
    throw new Error(t('文档有重叠修改，插件版本已保存在 {0}', [copyPath]));
  }
  const editing = ctx.runtime.extensions?.()?.editing;
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
  const bridge = ctx.getPluginEditorBridge();
  if (doc && bridge && (await bridge.applyEdit(entry.id, doc.content, merged.content))) {
    return { id: entry.id, hash: await assistantHash(doc.content), status: 'applied' };
  }
  if (doc) {
    doc.content = merged.content;
    doc.base = disk;
    assertCurrent();
    await ctx.saveInternal(doc);
    if (doc.error || doc.conflict || dirty(doc))
      throw new Error(doc.error ?? '插件修改已保留为草稿，请处理冲突后保存');
    return { id: entry.id, hash: await assistantHash(doc.content), status: 'saved' };
  }
  assertCurrent();
  const result = await ctx.adapter.write(entry.path, merged.content, disk.hash);
  if (result.status !== 'saved') {
    const copyPath = entry.path.replace(
      /\.(md|markdown)$/i,
      `.plugin-conflict-${crypto.randomUUID().slice(0, 8)}.md`,
    );
    await ctx.adapter.create(copyPath, desired);
    throw new Error(t('保存时文件发生变化，插件版本已保存在 {0}', [copyPath]));
  }
  return { id: entry.id, hash: await assistantHash(result.snapshot.content), status: 'saved' };
}

async function handleObjectRelationWriteRpc(
  ctx: PluginRpcContext,
  method: 'objects.create' | 'objects.update' | 'relations.add' | 'relations.remove',
  params: Record<string, unknown>,
  current: Workspace,
  assertCurrent: () => void,
): Promise<unknown> {
  if (!ctx.capabilities.value.features.objectReferences) throw new Error('工作区对象功能已关闭');
  if (method === 'objects.create' || method === 'objects.update') {
    if (!pluginRecord(params.object)) throw new Error('对象无效');
    const draft = JSON.parse(JSON.stringify(params.object));
    if (method === 'objects.create') {
      if (!ctx.adapter.reserveObjectId) throw new Error('存储适配器不支持对象身份分配');
      const id = await ctx.adapter.reserveObjectId(ctx.objects.value.map((row) => row.object.id));
      const object = parseObject(JSON.stringify({ ...draft, version: 1, id }));
      validateObjectProperties(object.type, object.properties);
      assertCurrent();
      await ctx.adapter.create(
        `${objectDirectory}/${id}.tano.json`,
        JSON.stringify(object, null, 2) + '\n',
      );
      ctx.workspace.value = await ctx.adapter.refresh();
      await ctx.refreshObjects();
      return object;
    }
    if (!pluginRecord(params.base) || !pluginRecord(params.base.object))
      throw new Error('对象版本无效');
    const record = ctx.objects.value.find((row) => row.object.id === draft.id);
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
      await ctx.adapter.create(
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
      saved = await saveObject(ctx.adapter, record, merged);
    } catch (error) {
      throw new Error(t('{0} 插件版本已保存在 {1}', [String(error), await preserve()]));
    }
    ctx.workspace.value = await ctx.adapter.refresh();
    await ctx.refreshObjects();
    return saved.object;
  }
  if (ctx.relationError.value) throw new Error(ctx.relationError.value);
  const relation = params.relation as WorkspaceRelation;
  validateRelation(relation, ctx.relationDefinitions.value);
  for (const endpoint of [relation.source, relation.target])
    if (!ctx.referenceTargets.value.some((target) => referenceKey(target) === referenceKey(endpoint)))
      throw new Error('关系端点不存在或不可访问');
  assertCurrent();
  await saveRelationChange(
    ctx.adapter,
    ctx.getRelationBase(),
    method === 'relations.add' ? { add: relation } : { remove: relation },
  );
  ctx.workspace.value = await ctx.adapter.refresh();
  await ctx.refreshObjects();
  return null;
}

export async function dispatchPluginRpcCall(
  ctx: PluginRpcContext,
  method: string,
  params: Record<string, unknown>,
  assertInstance: () => void,
): Promise<unknown> {
  const expected = ctx.workspace.value?.id;
  if (method === 'ui.pick' || method === 'ui.prompt' || method === 'ui.confirm') {
    assertInstance();
    if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    return ctx.openPluginDialog(method, params);
  }
  if (method === 'ui.toast') {
    assertInstance();
    if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    ctx.showPluginToast(params);
    return null;
  }
  if (method === 'ai.complete' || method === 'ai.structured') {
    assertInstance();
    if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    const aiRunner = ctx.getPluginAiRunner();
    if (!aiRunner) throw new Error('当前环境尚未配置同页助手模型连接');
    const signal = params.signal instanceof AbortSignal ? params.signal : new AbortController().signal;
    return aiRunner({
      pluginId: String(params.pluginId ?? ''),
      pluginName: String(params.pluginName ?? ''),
      structured: method === 'ai.structured',
      request: params.request as PluginAiCompleteRequest | PluginAiStructuredRequest,
      signal,
    });
  }
  const pathScopes = Array.isArray(params.pathScopes) ? (params.pathScopes as string[]) : undefined;
  if (method === 'editor.active' || method === 'editor.insert' || method === 'editor.replaceSelection') {
    return handleEditorRpc(ctx, method, params, pathScopes, expected, assertInstance);
  }
  return ctx.serial(async () => {
    const assertCurrent = () => {
      assertInstance();
      if (!expected || ctx.workspace.value?.id !== expected) throw new Error(t('工作区已切换'));
    };
    assertCurrent();
    const attachmentService =
      ctx.runtime.attachments ??
      (ctx.runtime.native && ctx.adapter.mode === 'desktop' ? nativeAttachments : undefined);
    if (method === 'attachments.read')
      return ctx.pluginAttachmentReader.read(
        ctx.workspace.value!,
        params,
        attachmentService,
        assertCurrent,
      );
    if (method === 'attachments.write') {
      ctx.writable();
      if (!attachmentService?.importAttachment)
        throw new Error('当前宿主不支持写入附件');
      const parsed = parsePluginAttachmentWrite(params.request);
      const targetDocPath = parsed.documentPath || (pathScopes?.length ? `${pathScopes[0]!}note.md` : '');
      if (pathScopes?.length && !matchesPluginPathScopes(targetDocPath, pathScopes))
        throw new Error('附件目标目录不在插件授权目录范围内');
      const fileBytes = new Uint8Array(parsed.bytes);
      const uploadFile = new File([fileBytes], parsed.name, { type: parsed.mimeType });
      assertCurrent();
      const imported = await attachmentService.importAttachment(
        ctx.workspace.value!.id,
        targetDocPath,
        uploadFile,
        parsed.image,
      );
      assertCurrent();
      ctx.workspace.value = await ctx.adapter.refresh();
      return imported;
    }
    ctx.workspace.value = await ctx.adapter.refresh();
    await ctx.refreshObjects();
    assertCurrent();
    const current = ctx.workspace.value!;
    if (method === 'views.open') {
      await ctx.openPluginView(String(params.pluginId), String(params.viewId));
      return null;
    }
    if (method.endsWith('.query') || method === 'documents.search')
      return queryPluginData(method, params, ctx.pluginQueryPager, {
        workspace: current,
        objects: ctx.objects.value,
        relations: ctx.relations.value,
        drafts: ctx.documents.value,
        read: (path) => ctx.adapter.read(path),
        assertCurrent,
      });
    if (method === 'documents.list')
      return current.files
        .filter(
          (row) =>
            row.kind === 'file' &&
            isMarkdown(row.path) &&
            !isWorkspaceInternalPath(row.path) &&
            matchesPluginPathScopes(row.path, pathScopes),
        )
        .map(({ id, path, name, readOnly }) => ({
          id,
          path,
          name,
          readOnly: current.readOnly || readOnly || false,
        }));
    if (method === 'documents.read') {
      const entry = resolveScopedMarkdownFile(ctx, params.fileId, pathScopes);
      const disk = await ctx.adapter.read(entry.path);
      const doc = ctx.documentIndex.byId.value.get(entry.id);
      if (doc?.conflict || doc?.missing) throw new Error('文档存在冲突，请先处理');
      const content = resolveDocumentText(doc?.content ?? disk.content);
      return { id: entry.id, path: entry.path, content, hash: await assistantHash(content) };
    }
    if (method === 'documents.open') {
      await ctx.openInternal(resolveScopedMarkdownFile(ctx, params.fileId, pathScopes));
      ctx.ensureTabNavigation(String(params.fileId), String(params.fileId));
      ctx.touchNavigation();
      return null;
    }
    if (method === 'objects.list')
      return ctx.objects.value.map((record) => ({
        id: record.object.id,
        object: JSON.parse(JSON.stringify(record.object)),
        hash: record.snapshot.hash,
      }));
    if (method === 'objects.read') {
      const record = ctx.objects.value.find((row) => row.object.id === params.objectId);
      if (!record) throw new Error('对象不存在或不可访问');
      return {
        id: record.object.id,
        object: JSON.parse(JSON.stringify(record.object)),
        hash: record.snapshot.hash,
      };
    }
    if (method === 'relations.list') return JSON.parse(JSON.stringify(ctx.relations.value));
    ctx.writable();
    if (
      method === 'documents.create' ||
      method === 'documents.move' ||
      method === 'documents.trash' ||
      method === 'documents.write'
    ) {
      return handleDocumentWriteRpc(ctx, method, params, pathScopes, current, assertCurrent);
    }
    if (
      method === 'objects.create' ||
      method === 'objects.update' ||
      method === 'relations.add' ||
      method === 'relations.remove'
    ) {
      return handleObjectRelationWriteRpc(ctx, method, params, current, assertCurrent);
    }
    throw new Error('不支持此插件 API');
  });
}
