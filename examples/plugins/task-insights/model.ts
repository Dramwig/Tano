import type { TanoPluginApi } from '@tano/workbench/plugin-sdk';

export const statuses = ['待办', '进行中', '已完成'] as const;
export type Filters = { query: string; includeArchived: boolean };
export type Summary = {
  loaded: number; total: number | null; truncated: boolean; skipped: number;
  counts: number[]; rows: { id: string; title: string; status: number }[];
};
export type DashboardState = Summary & Filters & { loading: boolean; error: string };
export const emptySummary = (): Summary => ({ loaded: 0, total: null, truncated: false, skipped: 0, counts: [0, 0, 0], rows: [] });

/** Keep the full count in the Worker and send only a bounded preview to the UI. */
export async function summarize(tano: Pick<TanoPluginApi, 'objects'>, filters: Filters): Promise<Summary> {
  const result = emptySummary(), seen = new Set<string>(), cursors = new Set<string>(), previews = [0, 0, 0];
  let cursor: string | undefined;
  for (let pageNumber = 0; pageNumber < 40; pageNumber++) {
    const page = await tano.objects.query({ type: 'event', properties: { checkable: true }, sort: 'name',
      query: filters.query, ...(filters.includeArchived ? {} : { archived: false }), limit: 50, ...(cursor ? { cursor } : {}) });
    if (page.total !== undefined) {
      if (result.total !== null && result.total !== page.total) throw new Error('任务在查询期间发生变化，请刷新重试。');
      result.total = page.total;
    }
    result.skipped += page.skipped?.length ?? 0;
    for (const { object } of page.items) {
      if (seen.has(object.id)) throw new Error('分页结果包含重复任务，请刷新重试。');
      seen.add(object.id); result.loaded++;
      const status = object.properties.completed === true ? 2 : object.properties.kanbanLane === 'doing' ? 1 : 0;
      result.counts[status]++;
      if (previews[status]++ < 20) result.rows.push({ id: object.id, title: object.name, status });
    }
    cursor = page.nextCursor;
    if (!cursor) return result;
    if (cursors.has(cursor)) throw new Error('分页没有继续前进，请刷新重试。');
    cursors.add(cursor);
    if (result.loaded >= 1000) break;
  }
  result.truncated = true;
  return result;
}
