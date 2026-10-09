import { canonicalPluginJson, pluginRecord } from '@tano/protocol';
import type { PluginPage, PluginPageOptions, PluginTextEdit, PluginEvent } from '../plugin-sdk';
import { assistantHash } from '../assistant/hash';

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
