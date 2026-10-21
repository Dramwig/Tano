import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
import type { WorkbenchExtensions } from './runtime';
import type { useWorkspaceStore } from './stores/workspace';

export interface WorkspaceSyncState { backend: 'git' | 'cloud' | null; lastSynced: number | null; message: string; conflicts: string[] }
export const syncEvent = 'tano:workspace-sync';
export function openWorkspaceSync(workspaceId?: string) { window.dispatchEvent(new CustomEvent(syncEvent, { detail: { workspaceId } })); }
export function systemSync(workspaceId: string, action: 'status' | 'configure' | 'run' | 'disable' | 'claimCloud' | 'releaseCloud', remote?: string) {
  return invoke<WorkspaceSyncState>('workspace_sync', { request: { workspaceId, action, ...(remote === undefined ? {} : { remote }) } });
}
/** Window-scoped orchestration. Durable backend selection and history live in the native host. */
export function createWorkspaceSync(store: ReturnType<typeof useWorkspaceStore>, extensions: WorkbenchExtensions) {
  const state = ref<WorkspaceSyncState>({ backend: null, lastSynced: null, message: '', conflicts: [] });
  const busy = ref(false), error = ref('');
  const operation = ref<'status' | 'configure' | 'run' | 'disable'>();
  let generation = 0;
  async function action(kind: 'status' | 'configure' | 'run' | 'disable', remote?: string) {
    const id = store.workspace?.id;
    if (!id || store.isWeb || store.isDemo || busy.value) return;
    const current = generation;
    busy.value = true; operation.value = kind; error.value = '';
    try {
      if (kind === 'disable' && extensions.sync?.enabled) await extensions.sync.disconnect();
      if (kind === 'configure' || kind === 'run') {
        if (extensions.sync?.enabled || extensions.editing.active) throw new Error('请先断开云端文件同步与实时协作，再启用 Git 同步');
        if (!(await store.flush())) throw new Error('请先处理未保存修改');
        await extensions.editing.flush();
      }
      if (id !== store.workspace?.id || current !== generation) return;
      const result = await systemSync(id, kind, remote);
      if (id !== store.workspace?.id || current !== generation) return;
      state.value = result;
      if (kind === 'run') await store.refresh();
    } catch (reason) { if (current === generation) error.value = String(reason).replace(/^Error: /, ''); }
    finally { busy.value = false; operation.value = undefined; }
  }
  function reset() { generation++; state.value = { backend: null, lastSynced: null, message: '', conflicts: [] }; error.value = ''; }
  async function tick() {
    if (busy.value || store.busy || !store.workspace || store.isWeb || store.isDemo) return;
    await action('status');
    if (state.value.backend === 'git' && !state.value.conflicts.length && !extensions.editing.active) await action('run');
  }
  return { state, busy, operation, error, action, reset, tick };
}
export type WorkspaceSyncController = ReturnType<typeof createWorkspaceSync>;
