import type { Connection, ItemValue, LocalSyncPort, RemoteAdapter, RemoteItem } from './types';
import { localValue } from './types';
import { mergeDescription } from '../description-merge';
import { projectDescription, restoreDescription } from './descriptions';
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
    if (key === 'description') {
      const description = mergeDescription(base.description, local.description, remote.description);
      if (description === null) return null;
      value.description = description;
      continue;
    }
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
    const raw = localValue(record, connection.kind);
    const value = connection.pending?.value ?? { ...raw, description: projectDescription(raw.description) };
    connection.pending ??= { localId: record.object.id, operationId: crypto.randomUUID(), value, localDescription: raw.description };
    if (connection.pending.uncertain && !idempotentCreate) throw new Error('上次创建请求结果未知，请先在来源应用确认，避免重复创建');
    connection.pending.uncertain = true;
    await save();
    const created = await adapter.create(connection.collection.id, value, connection.pending.operationId);
    await port.link?.(record, created.id);
    connection.bindings.push({ localId: record.object.id, base: { ...value }, localDescription: connection.pending.localDescription ?? value.description,
      remote: { ...created, raw: undefined, value: { ...created.value } } });
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
      binding = { localId: record.object.id, localDescription: record.object.description,
        remote: { ...incoming, raw: undefined, value: { ...incoming.value } }, base: { ...incoming.value, description: projectDescription(incoming.value.description) } };
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
    const conflict = (reason: string) => connection.conflicts.push({ localId: record.object.id, remoteId: incoming.id, local: ours, remote: theirs, reason });
    const localBase = binding.localDescription ?? binding.base.description;
    // Legacy remote descriptions may still contain Markdown references. Keep explicit identity edits visible to the merge.
    const remoteText = projectDescription(theirs.description);
    const explicitIdentityEdit = remoteText !== theirs.description && theirs.description !== binding.remote.value.description;
    const restored = explicitIdentityEdit ? theirs.description : restoreDescription(localBase, remoteText);
    if (restored === null) { conflict('远端修改涉及内部引用，需核对引用与描述'); continue; }
    const merged = mergeItems({ ...binding.base, description: localBase }, ours, { ...theirs, description: restored });
    if (!merged) { conflict('本地与远端同时修改了同一内容'); continue; }
    if (merged.description.length > 20000) { conflict('合并后的描述超过 20000 字符，请核对双方内容'); continue; }
    const outgoing = { ...merged, description: projectDescription(merged.description) };
    const comparable = { ...theirs, description: projectDescription(theirs.description) };
    if (!equalItems(outgoing, comparable) && (incoming.readOnly || connection.direction === 'pull' || !connection.collection.writable)) { conflict('本地有修改，此连接或事项仅支持读取'); continue; }
    let persisted = incoming.value.archived ? { ...incoming, value: theirs } : incoming;
    if (!equalItems(outgoing, comparable)) {
      // A failed external write must never advance the common base.
      persisted = await adapter.write(connection.collection.id, incoming, outgoing);
    }
    const description = restoreDescription(merged.description, projectDescription(persisted.value.description));
    if (description === null) { conflict('远端保存时改变了内部引用，需核对双方描述'); continue; }
    const localResult = { ...persisted.value, description };
    if (!equalItems(ours, localResult)) await port.update(record, localResult);
    binding.base = { ...persisted.value, description: projectDescription(persisted.value.description) };
    binding.localDescription = description;
    binding.remote = { ...persisted, raw: undefined, value: { ...persisted.value } };
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
