import { canonicalPluginJson, isMarkdown, isWorkspaceInternalPath, pluginRecord } from '@tano/protocol';
import type { Workspace, WorkspaceRelation, WorkspaceObject } from '@tano/protocol';
import type { PluginDocumentEntry, PluginPageOptions } from '../plugin-sdk';
import { assistantHash } from '../assistant/hash';
import { compareQueryText, PluginQueryPager, pluginQueryOptions, queryBoolean, queryText } from './data';

export interface PluginQueryContext {
  workspace: Workspace;
  objects: { object: WorkspaceObject; snapshot: { hash: string } }[];
  relations: WorkspaceRelation[];
  drafts: { id: string; content: string; conflict?: unknown; missing: boolean }[];
  read(path: string): Promise<{ content: string }>;
  assertCurrent(): void;
  /** Host revision, for stores whose timestamp and size alone do not identify a content version. */
  revision?: unknown;
}
export async function queryPluginData(method: string, params: Record<string, unknown>, pager: PluginQueryPager, context: PluginQueryContext) {
  const { workspace, objects, relations, drafts, assertCurrent } = context;
  const scope = `${workspace.id}:${String(params.queryScope)}`;
  if (method === 'documents.query' || method === 'documents.search') {
    const options = pluginQueryOptions(params.options, method === 'documents.search' ? ['query', 'pathPrefix', 'readOnly'] : ['query', 'pathPrefix', 'readOnly', 'sort']);
    const query = queryText(options.query) ?? '', prefix = queryText(options.pathPrefix, 1000) ?? '', readOnly = queryBoolean(options.readOnly);
    if (options.sort !== undefined && !['path', 'name', 'modified'].includes(String(options.sort))) throw new Error('文档排序字段无效');
    if (method === 'documents.search' && !query.trim()) throw new Error('请输入搜索文本');
    const rows = workspace.files.filter(row => row.kind === 'file' && isMarkdown(row.path) && !isWorkspaceInternalPath(row.path) &&
      row.path.startsWith(prefix) && (readOnly === undefined || !!(workspace.readOnly || row.readOnly) === readOnly) &&
      (method === 'documents.search' || `${row.path}\n${row.name}`.toLowerCase().includes(query.toLowerCase())));
    const sort = String(options.sort ?? 'path'), direction = options.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => direction * ((sort === 'modified' ? a.modified - b.modified : compareQueryText(sort === 'name' ? a.name : a.path, sort === 'name' ? b.name : b.path)) || compareQueryText(a.id, b.id)));
    const metadata = (row: typeof rows[number]): PluginDocumentEntry => ({ id: row.id, name: row.name, path: row.path, readOnly: !!(workspace.readOnly || row.readOnly) });
    const revision = [context.revision ?? null, rows.map(row => [row.id, row.path, row.name, row.modified, row.size, metadata(row).readOnly]),
      method === 'documents.search' ? drafts.map(row => [row.id, row.content, !!row.conflict, row.missing]) : []];
    if (method === 'documents.query') return pager.page(scope, method, options as PluginPageOptions, revision, rows, async row => metadata(row), assertCurrent);
    const skipped: string[] = [];
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    const page = await pager.page(scope, method, options as PluginPageOptions, revision, rows, async row => {
      const draft = drafts.find(draft => draft.id === row.id);
      if (draft?.conflict || draft?.missing || (!draft && row.size > 512000)) { skipped.push(row.id); return; }
      assertCurrent();
      const content = draft?.content ?? (await context.read(row.path)).content;
      assertCurrent();
      if (content.length > 512000) { skipped.push(row.id); return; }
      const match = pattern.exec(content);
      if (!match) return;
      return { ...metadata(row), snippet: content.slice(Math.max(0, match.index - 60), match.index + query.length + 120), offset: match.index, hash: await assistantHash(content) };
    }, assertCurrent, 25);
    return { ...page, skipped };
  }
  if (method === 'objects.query') {
    const options = pluginQueryOptions(params.options, ['query', 'type', 'archived', 'properties', 'sort']);
    const query = (queryText(options.query) ?? '').toLowerCase(), type = queryText(options.type), archived = queryBoolean(options.archived);
    if (options.sort !== undefined && !['name', 'type', 'id'].includes(String(options.sort))) throw new Error('对象排序字段无效');
    const properties = options.properties ?? {};
    if (!pluginRecord(properties) || Object.keys(properties).length > 10 || Object.entries(properties).some(([key, value]) => key.length > 100 ||
      (value !== null && !['string', 'number', 'boolean'].includes(typeof value)) || (typeof value === 'number' && !Number.isFinite(value)) ||
      (typeof value === 'string' && value.length > 200))) throw new Error('属性筛选只支持最多 10 个标量条件');
    const rows = objects.filter(({ object }) => (!type || object.type === type) && (archived === undefined || object.archived === archived) &&
      `${object.name}\n${object.description}`.toLowerCase().includes(query) && Object.entries(properties).every(([key, value]) => Object.hasOwn(object.properties, key) && object.properties[key] === value));
    const sort = (options.sort ?? 'name') as 'name' | 'type' | 'id', direction = options.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => direction * (compareQueryText(a.object[sort], b.object[sort]) || compareQueryText(a.object.id, b.object.id)));
    return pager.page(scope, method, options as PluginPageOptions, rows.map(row => [row.object.id, row.snapshot.hash]), rows,
      async row => ({ id: row.object.id, object: JSON.parse(JSON.stringify(row.object)), hash: row.snapshot.hash }), assertCurrent);
  }
  if (method === 'relations.query') {
    const options = pluginQueryOptions(params.options, ['type', 'sourceId', 'targetId']);
    const type = queryText(options.type), source = queryText(options.sourceId), target = queryText(options.targetId);
    const rows = relations.filter(row => (!type || row.type === type) && (!source || row.source.id === source) && (!target || row.target.id === target));
    rows.sort((a, b) => (options.direction === 'desc' ? -1 : 1) * compareQueryText(a.id, b.id));
    return pager.page(scope, method, options as PluginPageOptions, canonicalPluginJson(rows), rows, async row => JSON.parse(JSON.stringify(row)), assertCurrent);
  }
  throw new Error('不支持此查询');
}
