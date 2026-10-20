import { invoke } from '@tauri-apps/api/core';
import { ref } from 'vue';
export interface GitEntry { path: string; index: string; worktree: string; originalPath: string | null }
export interface GitStatus { branch: string | null; detached: boolean; entries: GitEntry[] }
export interface GitDiff { path: string; staged: boolean; patch: string }
export interface GitCommit { id: string; shortId: string; author: string; date: string; subject: string }
export interface GitLog { path: string | null; commits: GitCommit[] }
export function createGitInspection(workspaceId: () => string) {
  const status = ref<GitStatus>({ branch: null, detached: false, entries: [] });
  const history = ref<GitLog>({ path: null, commits: [] });
  const diff = ref<(GitDiff & { truncated: boolean }) | null>(null);
  const busy = ref(false), error = ref('');
  let generation = 0;
  const query = <T>(id: string, kind: string, args = {}) => invoke<T>('workspace_git_query', { workspaceId: id, kind, args });
  async function perform(action: (id: string, current: () => boolean) => Promise<void>) {
    if (busy.value) return;
    const id = workspaceId(), token = generation;
    busy.value = true; error.value = '';
    const current = () => token === generation && id === workspaceId();
    try { await action(id, current); } catch (cause) { if (current()) error.value = String(cause).replace(/^Error: /, ''); }
    finally { busy.value = false; }
  }
  const refresh = () => perform(async (id, current) => {
    const [next, log] = await Promise.all([query<GitStatus>(id, 'status'), query<GitLog>(id, 'log', { limit: 30 })]);
    if (current()) { status.value = next; history.value = log; diff.value = null; }
  });
  const showDiff = (path: string, staged: boolean) => perform(async (id, current) => {
    if (!status.value.entries.some(entry => entry.path === path)) throw new Error('文件状态已变化，请刷新');
    const result = await query<GitDiff>(id, 'diff', { path, staged });
    const bytes = new TextEncoder().encode(result.patch), truncated = bytes.length > 48 * 1024;
    if (current()) diff.value = { ...result, patch: truncated ? new TextDecoder().decode(bytes.slice(0, 48 * 1024)) : result.patch, truncated };
  });
  function dispose() { generation++; }
  return { status, history, diff, busy, error, refresh, showDiff, dispose };
}
