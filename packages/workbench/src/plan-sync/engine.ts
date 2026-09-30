import type { Connection, ItemValue, LocalSyncPort, RemoteAdapter, RemoteItem } from './types';
import { localValue } from './types';
const fields = ['name', 'description', 'start', 'end', 'date', 'allDay', 'completed', 'archived'] as const;
export const equalItems = (a: ItemValue, b: ItemValue) => fields.every(k => a[k] === b[k]);
/** Three-way field merge. Neither side wins a concurrent edit implicitly. */
export function mergeItems(base: ItemValue, local: ItemValue, remote: ItemValue): ItemValue | null {
  if (local.archived !== remote.archived && (!equalItems(base, local) && !equalItems(base, remote))) return null;
  const value = { ...remote };
  // Dates and times form one scheduling field; merging them independently could produce invalid ranges.
  const schedule = (v: ItemValue) => JSON.stringify([v.start, v.end, v.date, v.allDay]);
  if (schedule(local) !== schedule(base) && schedule(remote) !== schedule(base) && schedule(local) !== schedule(remote)) return null;
  for (const key of fields) {
    if (local[key] === base[key]) continue;
    if (remote[key] !== base[key] && local[key] !== remote[key]) return null;
    Object.assign(value, { [key]: local[key] });
  }
  return value;
}
export async function synchronize(connection: Connection, adapter: RemoteAdapter, port: LocalSyncPort, save: () => Promise<void>, remoteItems?: RemoteItem[], idempotentCreate = true) {
  const remote = remoteItems ?? await adapter.list(connection.collection.id);
  if (new Set(remote.map(r => r.id)).size !== remote.length) throw new Error('远端包含重复事项 ID，同步已停止');
  connection.conflicts = [];
  let local = await port.list();
  async function upload(record: (typeof local)[number]) {
    const value = connection.pending?.value ?? localValue(record, connection.kind);
    connection.pending ??= { localId: record.object.id, operationId: crypto.randomUUID(), value };
    if (connection.pending.uncertain && !idempotentCreate) throw new Error('上次创建请求结果未知，请先在来源应用确认，避免重复创建');
    connection.pending.uncertain = true;
    await save();
    const created = await adapter.create(connection.collection.id, value, connection.pending.operationId);
    await port.link?.(record, created.id);
    connection.bindings.push({ localId: record.object.id, base: { ...value }, remote: { ...created, raw: undefined, value: { ...created.value } } });
    connection.pending = undefined;
    await save();
    return created;
  }
  // Reconcile a possibly successful create BEFORE treating remote entries as new downloads.
  if (connection.pending) {
    const record = local.find(r => r.object.id === connection.pending!.localId);
    if (!record) throw new Error('待确认上传的本地事项已移除，请先恢复后重试');
    const created = await upload(record);
    if (!remote.some(r => r.id === created.id)) remote.push(created);
    local = await port.list();
  }
  for (const incoming of remote) {
    let binding = connection.bindings.find(b => b.remote.id === incoming.id);
    if (!binding) {
      if (incoming.value.archived) continue;
      // A successful local write can precede a failed state write. Persisted provenance makes retry idempotent.
      let record = local.find(r => r.object.properties.syncConnection === connection.id && r.object.properties.syncRemoteId === incoming.id);
      if (!record) record = await port.create(incoming.value, incoming.id, !!incoming.readOnly || connection.direction === 'pull');
      binding = { localId: record.object.id, remote: { ...incoming, raw: undefined, value: { ...incoming.value } }, base: { ...incoming.value } };
      connection.bindings.push(binding);
      local.push(record);
      await save();
      continue;
    }
    const record = local.find(r => r.object.id === binding!.localId);
    if (!record) {
      connection.conflicts.push({ localId: binding.localId, remoteId: incoming.id, local: { ...binding.base, archived: true }, remote: incoming.value, reason: '本地事项已移除；未删除远端事项' });
      continue;
    }
    const ours = localValue(record, connection.kind);
    const theirs = incoming.value.archived ? { ...binding.base, archived: true } : incoming.value;
    const merged = mergeItems(binding.base, ours, theirs);
    const conflict = (reason: string) => connection.conflicts.push({ localId: record.object.id, remoteId: incoming.id, local: ours, remote: theirs, reason });
    if (!merged) { conflict('本地与远端同时修改了同一内容'); continue; }
    if (!equalItems(merged, theirs) && (incoming.readOnly || connection.direction === 'pull' || !connection.collection.writable)) { conflict('本地有修改，此连接或事项仅支持读取'); continue; }
    let persisted = incoming;
    if (!equalItems(merged, theirs)) {
      // A failed external write must never advance the common base.
      persisted = await adapter.write(connection.collection.id, incoming, merged);
    }
    if (!equalItems(ours, persisted.value)) await port.update(record, persisted.value);
    binding.base = { ...persisted.value }; binding.remote = { ...persisted, raw: undefined, value: { ...persisted.value } };
    await save();
  }
  // Missing entries can be outside a provider's date window or permissions. Never infer destructive deletion.
  if (connection.uploadNew && connection.direction === 'both' && connection.collection.writable) {
    local = await port.list();
    for (const record of local.filter(r => !r.object.archived && !r.object.properties.syncConnection && !r.object.properties.syncConflictCopy && !connection.bindings.some(b => b.localId === r.object.id))) {
      await upload(record);
    }
  }
  connection.lastSync = new Date().toISOString();
  connection.error = undefined;
  await save();
}
