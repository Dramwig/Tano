import { expect, it, vi } from 'vitest';
import { applyPluginTextEdits, PluginQueryPager, pluginChanges } from './data';
import { queryPluginData, type PluginQueryContext } from './queries';

function context(count = 5): PluginQueryContext {
  return {
    workspace: { id: 'workspace-a', name: 'A', path: '/a', files: Array.from({ length: count }, (_, i) => ({
      id: `id-${i}`, name: `Note ${i}`, path: `notes/${String(i).padStart(4, '0')}.md`, kind: 'file', size: 20, modified: i,
    })) },
    objects: [], relations: [], drafts: [], read: async path => ({ content: `Note in ${path}\nTarget text` }), assertCurrent: () => {},
  };
}
it('paginates deterministic results and binds cursors to instance, filters, revision and lifetime', async () => {
  const pager = new PluginQueryPager(), ctx = context(203);
  const query = (options = {}, scope = 'instance-a') => queryPluginData('documents.query', { queryScope: scope, options }, pager, ctx);
  const first = await query({ limit: 100 });
  expect(first.items).toHaveLength(100); expect(first.total).toBe(203);
  const second = await query({ limit: 100, cursor: first.nextCursor });
  expect(second.items).toHaveLength(100);
  expect(second.items[0]?.id).toBe('id-100');
  const final = await query({ limit: 100, cursor: second.nextCursor });
  expect(final.items).toHaveLength(3); expect(final.nextCursor).toBeUndefined();
  await expect(query({ limit: 100, cursor: first.nextCursor }, 'instance-b')).rejects.toThrow('分页');
  await expect(query({ limit: 100, direction: 'desc', cursor: first.nextCursor })).rejects.toThrow('分页');
  ctx.workspace.files[0]!.modified++;
  await expect(query({ limit: 100, cursor: first.nextCursor })).rejects.toThrow('结果已变化');
  pager.clear();
  await expect(query({ limit: 100, cursor: first.nextCursor })).rejects.toThrow('分页');
  const fresh = await query({ limit: 100 });
  const now = Date.now();
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now + 60001);
  try { await expect(query({ limit: 100, cursor: fresh.nextCursor })).rejects.toThrow('过期'); }
  finally { clock.mockRestore(); }
});
it('searches literal text and current drafts with bounded scans, reports skipped documents and excludes portable rules', async () => {
  const ctx = context(60), pager = new PluginQueryPager(); let reads = 0;
  ctx.workspace.files.push({ id: 'private', name: 'secret', path: '.tano/rules/assistant.md', kind: 'file', size: 2, modified: 1 });
  ctx.read = async () => { reads++; return { content: 'nothing' }; };
  ctx.workspace.files[0]!.size = 600000;
  ctx.drafts = [{ id: 'id-30', content: 'İ😀 [literal.*] current draft', conflict: false, missing: false }];
  const options = { query: '[literal.*]', limit: 10 };
  const first = await queryPluginData('documents.search', { queryScope: 'a', options }, pager, ctx);
  expect(first.items).toEqual([]); expect(first.nextCursor).toBeTypeOf('string'); expect(first.skipped).toEqual(['id-0']);
  expect(reads).toBe(24);
  const second = await queryPluginData('documents.search', { queryScope: 'a', options: { ...options, cursor: first.nextCursor } }, pager, ctx);
  expect(second.items).toMatchObject([{ id: 'id-30', offset: 4, snippet: 'İ😀 [literal.*] current draft' }]);
  expect(reads).toBe(48);
  expect((await queryPluginData('documents.query', { options: { query: 'secret' } }, pager, ctx)).items).toEqual([]);
});
it('filters and sorts object properties and rejects unbounded or malformed queries', async () => {
  const ctx = context(), pager = new PluginQueryPager();
  ctx.objects = Array.from({ length: 4 }, (_, i) => ({ path: `${i}`, object: { version: 1 as const, id: String(i), type: 'event', name: `Task ${i}`, description: '', archived: false, properties: { completed: i % 2 === 0 } }, snapshot: { content: '', hash: `${i}`, modified: 0 } }));
  const page = await queryPluginData('objects.query', { options: { type: 'event', archived: false, properties: { completed: true }, direction: 'desc' } }, pager, ctx);
  expect(page.items.map((row: { id: string }) => row.id)).toEqual(['2', '0']);
  await expect(queryPluginData('objects.query', { options: { properties: { nested: {} } } }, pager, ctx)).rejects.toThrow('标量');
  await expect(queryPluginData('documents.query', { options: { limit: 101 } }, pager, ctx)).rejects.toThrow('100');
  await expect(queryPluginData('documents.query', { options: { readOnly: 'false' } }, pager, ctx)).rejects.toThrow('布尔');
  await expect(queryPluginData('documents.query', { options: { sort: 'unknown' } }, pager, ctx)).rejects.toThrow('排序');
});
it('paginates relations by stable identity with endpoint filters', async () => {
  const ctx = context(), pager = new PluginQueryPager();
  ctx.relations = ['b', 'a', 'c'].map(id => ({ id, type: 'related', source: { type: 'document', id: id === 'c' ? 'other' : 'source' }, target: { type: 'document', id: 'target' } }));
  const options = { sourceId: 'source', targetId: 'target', type: 'related', limit: 1 };
  const first = await queryPluginData('relations.query', { options }, pager, ctx);
  expect(first.total).toBe(2); expect(first.items[0]?.id).toBe('a');
  const second = await queryPluginData('relations.query', { options: { ...options, cursor: first.nextCursor } }, pager, ctx);
  expect(second.items[0]?.id).toBe('b'); expect(second.nextCursor).toBeUndefined();
});
it('limits response bytes without losing rows and aborts when the execution instance is revoked', async () => {
  const pager = new PluginQueryPager();
  const rows = ['a'.repeat(140000), 'b'.repeat(140000)];
  const first = await pager.page('a', 'test', {}, 1, rows);
  expect(first.items).toHaveLength(1);
  expect((await pager.page('a', 'test', { cursor: first.nextCursor }, 1, rows)).items).toEqual([rows[1]]);
  let revoked = false;
  await expect(pager.page('a', 'test', {}, 1, rows, async row => { revoked = true; return row; }, () => { if (revoked) throw new Error('revoked'); })).rejects.toThrow('revoked');
});
it('applies one ordered edit transaction and rejects overlaps, forged ranges and split Unicode characters', () => {
  expect(applyPluginTextEdits('A😀\nB\nC', [{ from: 7, to: 7, insert: '!' }, { from: 4, to: 5, insert: 'New' }])).toBe('A😀\nNew\nC!');
  expect(() => applyPluginTextEdits('abc', [{ from: 0, to: 2, insert: '' }, { from: 1, to: 3, insert: '' }])).toThrow('重叠');
  expect(() => applyPluginTextEdits('😀', [{ from: 1, to: 2, insert: '' }])).toThrow('Unicode');
  expect(() => applyPluginTextEdits('abc', [{ from: 0, to: 4, insert: '' }])).toThrow('范围');
});
it('emits only changed identities, including property-only changes and a bounded reset for large imports', () => {
  expect(pluginChanges('objects.changed', new Map([['a', '1'], ['c', '1']]), new Map([['a', '2'], ['b', '1']]))).toEqual({ type: 'objects.changed', changes: [
    { id: 'a', kind: 'updated' }, { id: 'b', kind: 'created' }, { id: 'c', kind: 'deleted' },
  ] });
  expect(pluginChanges('documents.changed', new Map(), new Map(Array.from({ length: 101 }, (_, i) => [String(i), '1'])))).toEqual({ type: 'documents.changed', changes: [], reset: true });
});
