import { expect, it, vi } from 'vitest';
import activate from '../examples/plugins/github-importer/main';
import type { TanoPluginApi } from '../packages/workbench/src/plugin-sdk';

it('previews a bounded issue before creating Markdown, preserves existing files and does not retry service failures', async () => {
  let action!: Parameters<TanoPluginApi['views']['onAction']>[1];
  const request = vi.fn().mockResolvedValue({ status: 200, contentType: 'application/json', body: JSON.stringify({ title: 'A real issue', number: 42, body: 'Issue body' }) });
  const create = vi.fn().mockResolvedValue({ id: 'doc', path: 'GitHub-owner-repo-42.md' }), open = vi.fn();
  const render = vi.fn();
  const api = { connections: { request }, documents: { create, open }, views: { render, onAction: (_: string, handler: typeof action) => { action = handler; }, open: vi.fn() }, commands: { register: vi.fn() } } as unknown as TanoPluginApi;
  await activate(api);
  expect(request).not.toHaveBeenCalled();
  await action({ action: 'preview', values: { repository: 'owner/repo', number: '42' } });
  expect(request).toHaveBeenCalledExactlyOnceWith('https://api.github.com', { path: '/repos/owner/repo/issues/42' });
  expect(create).not.toHaveBeenCalled(); expect(JSON.stringify(render.mock.lastCall)).toContain('确认创建 Markdown');
  create.mockRejectedValueOnce(new Error('已有同名文档'));
  await action({ action: 'import', values: {} });
  expect(JSON.stringify(render.mock.lastCall)).toContain('已有同名文档'); expect(open).not.toHaveBeenCalled();
  await action({ action: 'import', values: {} });
  expect(create).toHaveBeenLastCalledWith('GitHub-owner-repo-42.md', '# A real issue\n\n来源：https://github.com/owner/repo/issues/42\n\nIssue body\n');
  expect(open).toHaveBeenCalledWith('doc');
  request.mockResolvedValueOnce({ status: 403, body: '' });
  await action({ action: 'preview', values: { repository: 'owner/repo', number: '42' } });
  expect(request).toHaveBeenCalledTimes(2); expect(JSON.stringify(render.mock.lastCall)).toContain('HTTP 403');
  await action({ action: 'preview', values: { repository: '../escape', number: '42' } });
  expect(request).toHaveBeenCalledTimes(2);
});
