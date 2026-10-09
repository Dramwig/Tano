import { expect, it, vi } from 'vitest';
import { summarize } from '../examples/plugins/task-insights/model';
import activate from '../examples/plugins/task-insights/main';
import type { PluginEvent, PluginJson, PluginObjectSnapshot, TanoPluginApi } from '@tano/workbench/plugin-sdk';

const task = (id: number, status = id % 3): PluginObjectSnapshot => ({ id: String(id), hash: `hash-${id}`,
  object: { version: 1, id: String(id), type: 'event', name: `任务 ${id}`, description: '', archived: false,
    properties: { checkable: true, completed: status === 2, kanbanLane: status === 1 ? 'doing' : 'todo' } } });
const api = (query: TanoPluginApi['objects']['query']) => ({ objects: { query } }) as TanoPluginApi;

it('counts every page while bounding the UI preview and retaining filters on empty pages', async () => {
  const query = vi.fn().mockResolvedValueOnce({ items: Array.from({ length: 50 }, (_, i) => task(i)), total: 75, nextCursor: 'second' })
    .mockResolvedValueOnce({ items: [], total: 75, nextCursor: 'third', skipped: ['unreadable'] })
    .mockResolvedValueOnce({ items: Array.from({ length: 25 }, (_, i) => task(i + 50)), total: 75 });
  const result = await summarize(api(query), { query: '项目', includeArchived: false });
  expect(result).toMatchObject({ loaded: 75, total: 75, counts: [25, 25, 25], truncated: false, skipped: 1 });
  expect(result.rows).toHaveLength(60);
  expect(query.mock.calls.map(([options]) => options.cursor)).toEqual([undefined, 'second', 'third']);
  for (const [options] of query.mock.calls) expect(options).toMatchObject({ query: '项目', archived: false, properties: { checkable: true }, type: 'event', sort: 'name' });
});

it('labels bounded scans as partial and does not count the unscanned total as completed work', async () => {
  let page = 0;
  const query = vi.fn(async () => ({ items: Array.from({ length: 50 }, (_, i) => task(page * 50 + i)), total: 3000, nextCursor: String(++page) }));
  const result = await summarize(api(query), { query: '', includeArchived: true });
  expect(result.loaded).toBe(1000); expect(result.total).toBe(3000); expect(result.truncated).toBe(true);
  expect(result.counts.reduce((sum, count) => sum + count, 0)).toBe(1000); expect(query).toHaveBeenCalledTimes(20);
  expect(query.mock.calls.every(([options]: any[]) => options.archived === undefined)).toBe(true);
});

it('bounds sparse pages and rejects repeated cursors, duplicate objects and changed totals', async () => {
  let page = 0;
  const sparse = vi.fn(async () => ({ items: [], nextCursor: String(++page) }));
  expect(await summarize(api(sparse), { query: '', includeArchived: false })).toMatchObject({ loaded: 0, truncated: true });
  expect(sparse).toHaveBeenCalledTimes(40);
  await expect(summarize(api(vi.fn(async () => ({ items: [], nextCursor: 'same' }))), { query: '', includeArchived: false })).rejects.toThrow('分页没有继续前进');
  const duplicate = vi.fn().mockResolvedValueOnce({ items: [task(1)], nextCursor: 'next' }).mockResolvedValueOnce({ items: [task(1)] });
  await expect(summarize(api(duplicate), { query: '', includeArchived: false })).rejects.toThrow('重复任务');
  const changed = vi.fn().mockResolvedValueOnce({ items: [task(1)], total: 2, nextCursor: 'next' }).mockResolvedValueOnce({ items: [task(2)], total: 3 });
  await expect(summarize(api(changed), { query: '', includeArchived: false })).rejects.toThrow('发生变化');
});

it('discards stale filter results, reports query failures and refreshes once for an event burst', async () => {
  vi.useFakeTimers();
  try {
    let message!: (value: PluginJson) => Promise<void>, event!: (value: PluginEvent) => void;
    const query = vi.fn().mockResolvedValue({ items: [task(1)], total: 1 });
    const renderCustom = vi.fn(async () => {});
    const tano = { objects: { query }, commands: { register: vi.fn() },
      views: { renderCustom, onMessage: (_id: string, handler: typeof message) => { message = handler; } },
      events: { subscribe: (handler: typeof event) => { event = handler; } } } as unknown as TanoPluginApi;
    await activate(tano);
    let release!: (value: unknown) => void;
    query.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const first = message({ type: 'filter', query: '旧筛选', includeArchived: false });
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const second = message({ type: 'filter', query: '新筛选', includeArchived: true });
    release({ items: [task(99)], total: 1 });
    await Promise.all([first, second]);
    expect(renderCustom.mock.calls.some(([, state]: any[]) => state.query === '旧筛选' && !state.loading)).toBe(false);
    expect(renderCustom.mock.lastCall?.[1]).toMatchObject({ query: '新筛选', includeArchived: true, loaded: 1 });
    query.mockRejectedValueOnce(new Error('分页已过期'));
    await message({ type: 'refresh' });
    expect(renderCustom.mock.lastCall?.[1]).toMatchObject({ error: '分页已过期', loaded: 0, rows: [] });
    const calls = query.mock.calls.length;
    for (let i = 0; i < 20; i++) event({ type: 'objects.changed', changes: [], reset: true });
    await vi.advanceTimersByTimeAsync(300);
    expect(query).toHaveBeenCalledTimes(calls + 1);
    expect(renderCustom.mock.lastCall?.[1]).toMatchObject({ error: '', loaded: 1 });
    await expect(message({ type: 'filter', query: 'x'.repeat(201), includeArchived: false })).rejects.toThrow('筛选条件无效');
  } finally { vi.useRealTimers(); }
});
