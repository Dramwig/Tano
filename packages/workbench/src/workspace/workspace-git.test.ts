import { beforeEach, expect, it, vi } from 'vitest';
import { createGitInspection } from './workspace-git';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
beforeEach(() => { invoke.mockReset(); });
it('loads system status and history and requests both diff modes without plugins', async () => {
  invoke.mockImplementation(async (_command, { kind, args }) => kind === 'status'
    ? { branch: 'main', detached: false, entries: [{ path: 'note.md', index: 'M', worktree: 'M' }] }
    : kind === 'log' ? { path: null, commits: [{ subject: 'First' }] }
    : { ...args, patch: '+change' });
  const model = createGitInspection(() => 'workspace');
  await model.refresh();
  expect(model.status.value.branch).toBe('main');
  expect(model.history.value.commits[0]?.subject).toBe('First');
  for (const staged of [false, true]) {
    await model.showDiff('note.md', staged);
    expect(invoke).toHaveBeenLastCalledWith('workspace_git_query', { workspaceId: 'workspace', kind: 'diff', args: { path: 'note.md', staged } });
    expect(model.diff.value?.patch).toBe('+change');
  }
  await model.showDiff('unknown.md', false);
  expect(model.error.value).toContain('请刷新');
});
it('discards results when the workspace changes or the panel closes', async () => {
  let finish!: (value: unknown) => void;
  invoke.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const model = createGitInspection(() => 'workspace');
  const pending = model.showDiff('missing.md', false);
  await pending;
  invoke.mockResolvedValueOnce({ branch: 'old', entries: [] });
  const refresh = model.refresh();
  model.dispose();
  finish({ commits: [] });
  await refresh;
  expect(model.status.value.branch).toBeNull();
});
