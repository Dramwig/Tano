import type { PluginGitStatus, PluginGitDiff, TanoPluginApi } from '@tano/workbench/plugin-sdk';

export default async function activate(tano: TanoPluginApi) {
  let status: PluginGitStatus = { branch: null, detached: false, entries: [] };
  let diff: (PluginGitDiff & { truncated: boolean }) | null = null, busy = false, error = '';
  const render = () => {
    const entries = []; let bytes = 0;
    for (const entry of status.entries) {
      bytes += new TextEncoder().encode(JSON.stringify(entry)).length;
      if (bytes > 64 * 1024) break;
      entries.push({ ...entry });
    }
    return tano.views.renderCustom('changes', { ...status, entries, total: status.entries.length, diff: diff ? { ...diff } : null, busy, error });
  };
  async function perform(action: () => Promise<void>) {
    if (busy) return;
    busy = true; error = ''; await render();
    try { await action(); } catch (cause) { error = String(cause).replace(/^(Error: )+/, ''); }
    finally { busy = false; await render(); }
  }
  const refresh = () => perform(async () => { diff = null; status = await tano.native.invoke('git.status'); });
  tano.views.onMessage('changes', async message => {
    if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('Git 视图消息无效');
    if (message.type === 'refresh') await refresh();
    else if (message.type === 'diff' && typeof message.path === 'string' && typeof message.staged === 'boolean') {
      const path = message.path, staged = message.staged;
      if (!status.entries.some(entry => entry.path === path)) throw new Error('文件状态已变化，请刷新');
      await perform(async () => {
        const result = await tano.native.invoke('git.diff', { path, staged });
        const bytes = new TextEncoder().encode(result.patch), truncated = bytes.length > 48 * 1024;
        diff = { ...result, patch: truncated ? new TextDecoder().decode(bytes.slice(0, 48 * 1024)) : result.patch, truncated };
      });
    } else throw new Error('Git 操作无效');
  });
  await tano.commands.register('open', async () => { await tano.views.open('changes'); await refresh(); });
  await refresh();
}
