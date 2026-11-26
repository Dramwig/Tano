import { canonicalPluginJson, matchesPluginPathScopes, pluginRecord } from '../extensions';
import type { WorkspaceObject } from '../objects';
import { isMarkdown } from '../paths';
import type { WorkspaceRelation } from '../relations';
import type { Workspace } from '../types';
import { isWorkspaceInternalPath } from '../workspace-paths';
import type {
  PluginDocumentEntry,
  PluginEvent,
  PluginPage,
  PluginPageOptions,
  PluginTextEdit,
} from './plugin-sdk';

export async function assistantHash(content: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function pluginQueryOptions(value: unknown, allowed: readonly string[]) {
  const options = value === undefined ? {} : value;
  if (!pluginRecord(options) || Object.keys(options).some(key => ![...allowed, 'limit', 'cursor', 'direction'].includes(key))) throw new Error('查询参数无效');
  if (options.limit !== undefined && (!Number.isInteger(options.limit) || Number(options.limit) < 1 || Number(options.limit) > 100)) throw new Error('每页数量必须为 1 至 100');
  if (options.cursor !== undefined && (typeof options.cursor !== 'string' || options.cursor.length > 100)) throw new Error('分页游标无效');
  if (options.direction !== undefined && !['asc', 'desc'].includes(String(options.direction))) throw new Error('查询排序方向无效');
  return options;
}

export function queryText(value: unknown, limit = 200): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.length > limit) throw new Error('查询文本无效');
  return value;
}

export function queryBoolean(value: unknown): boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') throw new Error('查询条件必须为布尔值');
  return value as boolean | undefined;
}

export const compareQueryText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Cursors never contain workspace data and are bound to an execution instance and query revision. */
export class PluginQueryPager {
  private cursors = new Map<string, { scope: string; signature: string; offset: number; expires: number }>();
  clear() { this.cursors.clear(); }
  async page<T, R = T>(scope: string, method: string, options: PluginPageOptions, revision: unknown, rows: T[],
    project: (row: T) => Promise<R | undefined> = async row => row as unknown as R,
    assertCurrent: () => void = () => {}, scanLimit = Number.POSITIVE_INFINITY): Promise<PluginPage<R>> {
    const { cursor, ...query } = options;
    const signature = await assistantHash(canonicalPluginJson([method, query, revision]));
    assertCurrent();
    for (const [key, value] of this.cursors) if (value.expires < Date.now()) this.cursors.delete(key);
    const previous = cursor ? this.cursors.get(cursor) : undefined;
    if (cursor && (!previous || previous.scope !== scope || previous.signature !== signature)) throw new Error('查询结果已变化或分页已过期，请从第一页重新查询');
    let offset = previous?.offset ?? 0, scanned = 0, bytes = 0;
    const items: R[] = [], limit = options.limit ?? 50;
    while (offset < rows.length && items.length < limit && scanned < scanLimit) {
      assertCurrent();
      const item = await project(rows[offset]!);
      assertCurrent();
      if (item !== undefined) {
        const size = new TextEncoder().encode(JSON.stringify(item)).length;
        if (size > 256 * 1024) throw new Error('单条查询结果超过 256 KB，请缩小对象内容');
        if (bytes + size > 256 * 1024) break;
        items.push(item); bytes += size;
      }
      offset++; scanned++;
    }
    const result: PluginPage<R> = { items };
    if (scanLimit === Number.POSITIVE_INFINITY) result.total = rows.length;
    if (offset < rows.length) {
      result.nextCursor = crypto.randomUUID();
      this.cursors.set(result.nextCursor, { scope, signature, offset, expires: Date.now() + 60_000 });
      if (this.cursors.size > 128) this.cursors.delete(this.cursors.keys().next().value!);
    }
    return result;
  }
}

export function applyPluginTextEdits(content: string, value: unknown): string {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new Error('编辑事务需要 1 至 100 个修改');
  const edits: PluginTextEdit[] = value.map(edit => {
    if (!pluginRecord(edit) || Object.keys(edit).some(key => !['from', 'to', 'insert'].includes(key)) ||
      !Number.isInteger(edit.from) || !Number.isInteger(edit.to) || Number(edit.from) < 0 || Number(edit.to) < Number(edit.from) ||
      Number(edit.to) > content.length || typeof edit.insert !== 'string') throw new Error('编辑范围无效');
    const splitsSurrogate = (offset: number) => /[\uD800-\uDBFF]/.test(content[offset - 1] ?? '') && /[\uDC00-\uDFFF]/.test(content[offset] ?? '');
    if (splitsSurrogate(Number(edit.from)) || splitsSurrogate(Number(edit.to))) throw new Error('编辑范围不能拆分 Unicode 字符');
    return edit as unknown as PluginTextEdit;
  }).sort((a, b) => a.from - b.from || a.to - b.to);
  for (let i = 1; i < edits.length; i++) if (edits[i]!.from < edits[i - 1]!.to || edits[i]!.from === edits[i - 1]!.from) throw new Error('编辑范围不能重叠');
  let next = content;
  for (const edit of edits.reverse()) next = next.slice(0, edit.from) + edit.insert + next.slice(edit.to);
  if (next.length > 512000) throw new Error('编辑后的文档超过大小限制');
  return next;
}

/** Deltas expose identities only; permission checks occur again before delivery in the host. */
export function pluginChanges(type: Exclude<PluginEvent['type'], 'workspace.changed'>, before: Map<string, string>, after: Map<string, string>): PluginEvent | undefined {
  const changes: { id: string; kind: 'created' | 'updated' | 'deleted' }[] = [];
  for (const [id, stamp] of after) if (before.get(id) !== stamp) changes.push({ id, kind: before.has(id) ? 'updated' : 'created' });
  for (const id of before.keys()) if (!after.has(id)) changes.push({ id, kind: 'deleted' });
  if (!changes.length) return;
  return changes.length > 100 ? { type, changes: [], reset: true } : { type, changes };
}

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
  const pathScopes = Array.isArray(params.pathScopes) ? (params.pathScopes as string[]) : undefined;
  if (method === 'documents.query' || method === 'documents.search') {
    const options = pluginQueryOptions(params.options, method === 'documents.search' ? ['query', 'pathPrefix', 'readOnly'] : ['query', 'pathPrefix', 'readOnly', 'sort']);
    const query = queryText(options.query) ?? '', prefix = queryText(options.pathPrefix, 1000) ?? '', readOnly = queryBoolean(options.readOnly);
    if (options.sort !== undefined && !['path', 'name', 'modified'].includes(String(options.sort))) throw new Error('文档排序字段无效');
    if (method === 'documents.search' && !query.trim()) throw new Error('请输入搜索文本');
    const rows = workspace.files.filter(row => row.kind === 'file' && isMarkdown(row.path) && !isWorkspaceInternalPath(row.path) &&
      matchesPluginPathScopes(row.path, pathScopes) &&
      row.path.startsWith(prefix) && (readOnly === undefined || !!(workspace.readOnly || row.readOnly) === readOnly) &&
      (method === 'documents.search' || `${row.path}\n${row.name}`.toLowerCase().includes(query.toLowerCase())));
    const sort = String(options.sort ?? 'path'), direction = options.direction === 'desc' ? -1 : 1;
    rows.sort((a, b) => direction * ((sort === 'modified' ? a.modified - b.modified : compareQueryText(sort === 'name' ? a.name : a.path, sort === 'name' ? b.name : b.path)) || compareQueryText(a.id, b.id)));
    const metadata = (row: typeof rows[number]): PluginDocumentEntry => ({ id: row.id, name: row.name, path: row.path, readOnly: !!(workspace.readOnly || row.readOnly) });
    const revision = [context.revision ?? null, rows.map(row => [row.id, row.path, row.name, row.modified, row.size, metadata(row).readOnly]),
      method === 'documents.search' ? drafts.map(row => [row.id, row.content, !!row.conflict, row.missing]) : []];
    if (method === 'documents.query') return pager.page(scope, method, options as PluginPageOptions, revision, rows, async row => metadata(row), assertCurrent);
    const draftsById = new Map(drafts.map(draft => [draft.id, draft]));
    const skipped: string[] = [];
    const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'iu');
    const page = await pager.page(scope, method, options as PluginPageOptions, revision, rows, async row => {
      const draft = draftsById.get(row.id);
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
