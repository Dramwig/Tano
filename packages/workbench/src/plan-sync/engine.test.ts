import { describe, expect, it, vi } from 'vitest';
import { mergeItems, synchronize } from './engine';
import { itemProperties } from './types';
import type { Connection, ItemValue, LocalSyncPort, RemoteAdapter, RemoteItem } from './types';
import type { ObjectRecord } from '../workspace-objects';
const base: ItemValue = { name: '评审', description: '', start: '2026-09-30T03:00:00.000Z', end: '2026-09-30T04:00:00.000Z', archived: false };
const record = (id: string, value: ItemValue, extra = {}): ObjectRecord => ({ object: { id, version: 1, type: 'event', ...value, properties: { ...itemProperties(value, 'calendar'), ...extra } }, path: `.tano/objects/${id}.tano.json`, snapshot: { content: '', hash: 'base', modified: 0 } });
function setup() {
  const c: Connection = { id: 'connection', accountId: 'account', kind: 'calendar', scope: 'personal', collection: { id: 'calendar', name: '日历', writable: true }, direction: 'both', enabled: true, uploadNew: false, bindings: [], conflicts: [] };
  const local: ObjectRecord[] = [];
  const remote: RemoteItem = { id: 'remote', version: 'v1', value: { ...base } };
  const adapter: RemoteAdapter = { collections: vi.fn(), list: vi.fn(async () => [remote]), write: vi.fn(async (_c, item, value) => ({ ...item, value, version: 'v2' })), create: vi.fn(async (_c, value) => ({ id: 'created', version: 'v1', value })) };
  const port: LocalSyncPort = { list: async () => [...local], create: vi.fn(async (value, remoteId, readOnly) => { const r = record('000001', value, { syncConnection: c.id, syncRemoteId: remoteId, syncReadOnly: readOnly }); local.push(r); return r; }), update: vi.fn(async (r, value) => { const next = record(r.object.id, value, r.object.properties); next.object.properties = { ...r.object.properties, ...itemProperties(value, 'calendar') }; local[local.findIndex(l => l.object.id === r.object.id)] = next; return next; }) };
  return { c, local, remote, adapter, port, save: vi.fn(async () => {}) };
}
describe('separate planning synchronization', () => {
  it.each(['calendar', 'todo'] as const)('preserves internal references while merging independent %s description edits and does not echo them upstream', async kind => {
    const s = setup(); s.c.kind = kind;
    s.remote.value.description = 'Read the plan.\nThen act.';
    await synchronize(s.c, s.adapter, s.port, s.save);
    s.local[0].object.description = 'Read [@Plan](object://document/a00001).\nThen act.';
    s.remote.value.description = 'Read the plan.\nThen act today.';
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.c.conflicts).toEqual([]);
    expect(s.local[0].object.description).toBe('Read [@Plan](object://document/a00001).\nThen act today.');
    expect(s.adapter.write).toHaveBeenLastCalledWith('calendar', expect.anything(), expect.objectContaining({ description: 'Read @Plan.\nThen act today.' }));
    s.remote.value = { ...vi.mocked(s.adapter.write).mock.calls.at(-1)![2] };
    vi.mocked(s.adapter.write).mockClear();
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.adapter.write).not.toHaveBeenCalled();
    s.remote.value.description = 'Read @Plan.\nThen act tomorrow.';
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.local[0].object.description).toBe('Read [@Plan](object://document/a00001).\nThen act tomorrow.');
    expect(s.adapter.write).not.toHaveBeenCalled();
  });
  it('preserves both descriptions and the baseline when a remote edit deletes or changes an internal reference', async () => {
    const s = setup();
    const description = 'Read [@Plan](object://document/a00001).\nThen act.';
    s.local.push(record('000001', { ...base, description }));
    s.c.uploadNew = true;
    await synchronize(s.c, s.adapter, s.port, s.save, []);
    expect(s.adapter.create).toHaveBeenCalledWith('calendar', expect.objectContaining({ description: 'Read @Plan.\nThen act.' }), expect.any(String));
    const original = { ...s.c.bindings[0].base };
    await synchronize(s.c, s.adapter, s.port, s.save, [{ id: 'created', version: 'v2', value: { ...base, description: 'Read @Other.\nThen act.' } }]);
    expect(s.c.conflicts[0]).toMatchObject({ local: { description }, reason: expect.stringContaining('内部引用') });
    expect(s.local[0].object.description).toBe(description);
    expect(s.c.bindings[0].base).toEqual(original);
    expect(s.port.update).not.toHaveBeenCalled();
  });
  it('keeps legacy raw references intact and respects reference-only edits in pull connections', async () => {
    const s = setup(); s.c.direction = 'pull';
    const description = 'Read [@Plan](object://document/a00001).';
    s.local.push(record('000001', { ...base, description }));
    s.c.bindings.push({ localId: '000001', base: { ...base, description }, remote: { ...s.remote, value: { ...base, description } } });
    s.remote.value.description = description;
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.c.conflicts).toEqual([]);
    expect(s.adapter.write).not.toHaveBeenCalled();
    s.local[0].object.description = description.replace('a00001', 'a00002');
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.local[0].object.description).toContain('a00002');
    expect(s.c.conflicts).toEqual([]);
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.local[0].object.description).toContain('a00002');
    expect(s.c.conflicts).toEqual([]);
  });
  it('stops before an external write when independent edits would exceed the local description limit', async () => {
    const s = setup();
    s.remote.value.description = 'a'.repeat(19998);
    await synchronize(s.c, s.adapter, s.port, s.save);
    s.local[0].object.description = 'LL' + s.local[0].object.description;
    s.remote.value.description += 'RR';
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.c.conflicts[0].reason).toContain('20000');
    expect(s.adapter.write).not.toHaveBeenCalled();
    expect(s.c.bindings[0].base.description).toHaveLength(19998);
  });
  it('merges independent edits and rejects concurrent content/schedule/delete edits', () => {
    expect(mergeItems(base, { ...base, name: '本地标题' }, { ...base, description: '远端备注' })).toMatchObject({ name: '本地标题', description: '远端备注' });
    expect(mergeItems(base, { ...base, name: '本地' }, { ...base, name: '远端' })).toBeNull();
    expect(mergeItems(base, { ...base, archived: true }, { ...base, name: '远端' })).toBeNull();
    expect(mergeItems(base, { ...base, start: '2026-09-30T05:00:00Z' }, { ...base, end: '2026-09-30T06:00:00Z' })).toBeNull();
  });
  it('imports once even if the local write succeeded and state persistence failed', async () => {
    const s = setup();
    await expect(synchronize(s.c, s.adapter, s.port, async () => { throw new Error('disk'); })).rejects.toThrow('disk');
    s.c.bindings = [];
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.port.create).toHaveBeenCalledTimes(1);
    expect(s.c.bindings).toHaveLength(1);
  });
  it('pushes a local edit with the fresh remote version while preserving independent remote edits', async () => {
    const s = setup(); await synchronize(s.c, s.adapter, s.port, s.save);
    s.local[0]!.object.name = '本地标题'; s.remote.value.description = '远端备注'; s.remote.version = 'fresh';
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.adapter.write).toHaveBeenCalledWith('calendar', expect.objectContaining({ version: 'fresh' }), expect.objectContaining({ name: '本地标题', description: '远端备注' }));
    expect(s.local[0]!.object.description).toBe('远端备注');
  });
  it('preserves both sides on a conflict and does not advance the base', async () => {
    const s = setup(); await synchronize(s.c, s.adapter, s.port, s.save);
    s.local[0]!.object.name = '本地'; s.remote.value = { ...base, name: '远端' };
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.adapter.write).not.toHaveBeenCalled(); expect(s.port.update).not.toHaveBeenCalled();
    expect(s.c.conflicts).toHaveLength(1); expect(s.c.bindings[0]!.base.name).toBe('评审');
  });
  it('never pushes pull-only or recurring resources and never infers deletion from absence', async () => {
    const s = setup(); s.c.direction = 'pull'; await synchronize(s.c, s.adapter, s.port, s.save);
    s.local[0]!.object.name = '本地';
    await synchronize(s.c, s.adapter, s.port, s.save);
    expect(s.c.conflicts).toHaveLength(1); expect(s.adapter.write).not.toHaveBeenCalled();
    await synchronize(s.c, s.adapter, s.port, s.save, []);
    expect(s.local[0]!.object.archived).toBe(false);
  });
  it('retries idempotent creates with the same operation ID and blocks uncertain non-idempotent retries', async () => {
    const s = setup(); s.c.uploadNew = true; s.local.push(record('000002', base));
    vi.mocked(s.adapter.create).mockRejectedValueOnce(new Error('connection dropped'));
    await expect(synchronize(s.c, s.adapter, s.port, s.save, [])).rejects.toThrow('dropped');
    const operation = s.c.pending!.operationId;
    await expect(synchronize(s.c, s.adapter, s.port, s.save, [], false)).rejects.toThrow('结果未知');
    await synchronize(s.c, s.adapter, s.port, s.save, [], true);
    expect(s.adapter.create).toHaveBeenLastCalledWith('calendar', base, operation);
    expect(s.c.pending).toBeUndefined();
  });
});
