import { computed, onScopeDispose, ref } from 'vue';
import { defineStore } from 'pinia';
import { invoke } from '@tauri-apps/api/core';
import type { WorkspaceObject } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from './workspace';
import { usePlanStore } from './plans';
import { isCheckableEvent } from '../calendar';
import type { ObjectRecord } from '../workspace-objects';
import { loadObjects } from '../workspace-objects';
import { itemProperties, localValue } from '../plan-sync/types';
import { sha256 } from '../adapter';
import type { Account, Connection, ItemValue, LocalSyncPort, RemoteItem, SyncKind, SyncState } from '../plan-sync/types';
import { remoteAdapter, readMissingTodoist } from '../plan-sync/providers';
import { synchronize } from '../plan-sync/engine';
import { projectDescription } from '../plan-sync/descriptions';

export const usePlanSyncStore = defineStore('plan-sync', () => {
  const runtime = useWorkbenchRuntime(), plans = usePlanStore(), workspace = useWorkspaceStore();
  const available = runtime.native && !runtime.mobile;
  const accounts = ref<Account[]>([]), state = ref<SyncState>({ version: 1, connections: [] });
  const busy = ref(''), loadError = ref(''), loaded = ref(false);
  let hash = '';
  const connections = computed(() => state.value.connections);
  async function refresh() {
    if (!available) { loaded.value = true; return; }
    try {
      const [list, saved] = await Promise.all([invoke<Account[]>('plan_accounts_list'), invoke<{ content: string; hash: string }>('plan_sync_state_read')]);
      const parsed = saved.content ? JSON.parse(saved.content) as SyncState : { version: 1 as const, connections: [] };
      if (parsed.version !== 1 || !Array.isArray(parsed.connections) || parsed.connections.some(c => !c.id || !c.accountId || !['calendar', 'todo'].includes(c.kind) || !Array.isArray(c.bindings) || !Array.isArray(c.conflicts))) throw new Error('同步配置损坏，原数据已保留');
      accounts.value = list; state.value = parsed; hash = saved.hash; loadError.value = ''; loaded.value = true;
    } catch (error) {
      loadError.value = /command.*not found/i.test(String(error)) ? '当前桌面版本尚不支持同步连接，请更新并重启应用。' : String(error);
      throw new Error(loadError.value);
    }
  }
  async function save() {
    if (!available || !loaded.value || loadError.value) throw new Error(loadError.value || '桌面同步不可用');
    const result = await invoke<{ hash: string }>('plan_sync_state_write', { content: JSON.stringify(state.value), expectedHash: hash });
    hash = result.hash;
  }
  async function locked<T>(name: string, run: () => Promise<T>) {
    if (busy.value) throw new Error('请等待当前同步操作完成');
    if (!navigator.locks) throw new Error('当前环境不支持安全的同步锁');
    busy.value = name;
    try { return await navigator.locks.request('tano-planning-sync', run); }
    finally { busy.value = ''; }
  }
  async function records(scope: 'personal' | 'workspace', workspaceId?: string) {
    if (scope === 'personal') {
      await plans.refreshPersonal();
      if (!plans.personalWritable) throw new Error(plans.loadError || '个人计划暂时不可写');
      return plans.personal;
    }
    if (!workspaceId || workspace.workspace?.id !== workspaceId) throw new Error('目标工作区未打开，连接保持暂停');
    if (!plans.workspaceWritable) throw new Error('目标工作区不可写');
    const current = await runtime.adapter.refresh();
    if (current.id !== workspaceId) throw new Error('目标工作区已切换');
    const loaded = await loadObjects(runtime.adapter, current);
    if (loaded.errors.length) throw new Error('工作区中有无效事项，请修复后同步');
    return loaded.records;
  }
  function draft(value: ItemValue, kind: SyncKind, extra: Record<string, unknown> = {}): Pick<WorkspaceObject, 'type' | 'name' | 'description' | 'archived' | 'properties'> {
    return { type: 'event', name: value.name, description: value.description, archived: value.archived, properties: { ...itemProperties(value, kind), ...extra } };
  }
  function port(connection: Connection): LocalSyncPort {
    const list = async () => (await records(connection.scope, connection.workspaceId)).filter(r => ['event', 'task'].includes(r.object.type) && (connection.kind === 'todo' ? isCheckableEvent(r) : !isCheckableEvent(r)));
    return {
      list,
      create: (value, remoteId, readOnly) => plans.create(draft(value, connection.kind, { syncConnection: connection.id, syncRemoteId: remoteId, syncReadOnly: readOnly }), connection.scope, connection.workspaceId),
      async link(record, remoteId) {
        const object = { ...record.object, properties: { ...record.object.properties, syncConnection: connection.id, syncRemoteId: remoteId } };
        if (connection.scope === 'personal') await plans.updatePersonal(record, object, plans.personalId);
        else await workspace.updateObject(record, object, connection.workspaceId!);
      },
      async update(record, value) {
        const properties: Record<string, unknown> = { ...record.object.properties, ...itemProperties(value, connection.kind) };
        for (const key of Object.keys(properties)) if (properties[key] === undefined) delete properties[key];
        const object = { ...record.object, name: value.name, description: value.description, archived: value.archived, properties };
        return connection.scope === 'personal' ? plans.updatePersonal(record, object, plans.personalId) : workspace.updateObject(record, object, connection.workspaceId!);
      },
    };
  }
  async function addConnection(value: Omit<Connection, 'id' | 'bindings' | 'conflicts'>) {
    return locked('configure', async () => {
      await refresh();
      if (connections.value.some(c => c.accountId === value.accountId && c.collection.id === value.collection.id && c.kind === value.kind && c.scope === value.scope && c.workspaceId === value.workspaceId)) throw new Error('该清单已连接到此范围');
      const account = accounts.value.find(a => a.id === value.accountId);
      if (!account) throw new Error('账号已移除，请重新连接');
      const identity = await sha256(JSON.stringify([account.provider, account.server, value.collection.id, value.kind, value.scope, value.workspaceId]));
      if (connections.value.some(c => c.id === identity)) throw new Error('该清单已连接到此范围，无需重复授权');
      const connection: Connection = { ...value, id: identity, bindings: [], conflicts: [] };
      state.value.connections.push(connection); await save(); return connection.id;
    });
  }
  async function changeConnection(id: string, enabled: boolean) {
    return locked(id, async () => { await refresh(); const c = connections.value.find(c => c.id === id); if (!c) return; c.enabled = enabled; await save(); });
  }
  async function removeConnection(id: string) {
    return locked(id, async () => {
      await refresh();
      const connection = connections.value.find(c => c.id === id);
      if (!connection) return;
      for (const record of await records(connection.scope, connection.workspaceId)) {
        if (record.object.properties.syncConnection !== id || !record.object.properties.syncReadOnly) continue;
        const object = { ...record.object, properties: { ...record.object.properties, syncReadOnly: false } };
        if (connection.scope === 'personal') await plans.updatePersonal(record, object, plans.personalId);
        else await workspace.updateObject(record, object, connection.workspaceId!);
      }
      state.value.connections = connections.value.filter(c => c.id !== id); await save();
    });
  }
  async function removeAccount(id: string) {
    return locked(id, async () => {
      await refresh();
      if (connections.value.some(c => c.accountId === id)) throw new Error('请先断开此账号的日历与 Todo 连接');
      await invoke('plan_account_remove', { accountId: id }); await refresh();
    });
  }
  async function sync(id: string) {
    return locked(id, async () => {
      await refresh();
      const c = connections.value.find(c => c.id === id);
      if (!c) throw new Error('连接已移除');
      const account = accounts.value.find(a => a.id === c.accountId);
      if (!account) throw new Error('请重新连接账号');
      try {
        c.lastAttempt = new Date().toISOString();
        await save();
        await records(c.scope, c.workspaceId);
        const adapter = remoteAdapter(account, c.kind);
        const remote = await adapter.list(c.collection.id);
        if (account.provider === 'todoist') remote.push(...await readMissingTodoist(account, c.bindings.filter(b => !remote.some(r => r.id === b.remote.id)).map(b => b.remote.id)));
        await synchronize(c, adapter, port(c), save, remote, account.provider !== 'microsoft');
      } catch (error) { c.error = String(error instanceof Error ? error.message : error); await save(); throw error; }
    });
  }
  async function importItems(items: RemoteItem[], kind: SyncKind, scope: 'personal' | 'workspace', workspaceId?: string) {
    return locked('import', async () => {
      const existing = await records(scope, workspaceId);
      const seen = new Set(existing.map(r => r.object.properties.importKey));
      let imported = 0, skipped = 0;
      for (const item of items) {
        const key = `${kind}:${item.id}`;
        if (seen.has(key) || item.value.archived) { skipped++; continue; }
        await records(scope, workspaceId); // A workspace switch during a batch must stop subsequent writes.
        await plans.create(draft(item.value, kind, { importKey: key }), scope, workspaceId);
        seen.add(key); imported++;
      }
      plans.view = scope;
      return { imported, skipped };
    });
  }
  async function keepRemote(connectionId: string, remoteId: string) {
    return locked(connectionId, async () => {
      await refresh();
      const c = connections.value.find(c => c.id === connectionId), conflict = c?.conflicts.find(v => v.remoteId === remoteId);
      if (!c || !conflict) return;
      const p = port(c), local = (await p.list()).find(r => r.object.id === conflict.localId);
      if (!local) throw new Error('本地事项已不存在，请先恢复该事项');
      // Preserve the user's version as an independent local copy before accepting the reviewed remote snapshot.
      const properties: Record<string, unknown> = { ...local.object.properties, syncConflictCopy: true };
      for (const key of ['syncConnection', 'syncRemoteId', 'syncReadOnly']) delete properties[key];
      const copy = { ...local.object, name: `${local.object.name.slice(0, 180)}（本地冲突副本）`, properties };
      await plans.create(copy, c.scope, c.workspaceId);
      await p.update(local, conflict.remote);
      const binding = c.bindings.find(b => b.remote.id === remoteId);
      if (binding) { binding.base = { ...conflict.remote, description: projectDescription(conflict.remote.description) }; binding.localDescription = conflict.remote.description; }
      c.conflicts = c.conflicts.filter(v => v.remoteId !== remoteId);
      await save();
    });
  }
  const timer = setInterval(() => {
    if (!available || busy.value || !loaded.value || loadError.value || document.visibilityState !== 'visible') return;
    const candidate = connections.value.find(c => c.enabled && !c.conflicts.length && !c.pending?.uncertain && (c.scope === 'personal' || c.workspaceId === workspace.workspace?.id) && Date.now() - Date.parse(c.lastAttempt || c.lastSync || '1970-01-01') > 300000);
    if (candidate) void sync(candidate.id).catch(() => {});
  }, 60000);
  onScopeDispose(() => clearInterval(timer));
  void refresh().catch(() => {});
  return { available, accounts, connections, busy, loadError, loaded, refresh, sync, addConnection, changeConnection, removeConnection, removeAccount, importItems, keepRemote };
});
