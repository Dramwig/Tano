import { expect, it, vi } from 'vitest';
import run from '../examples/plugins/daily-report/automation';
import type { PluginAutomationExecution, TanoAutomationApi } from '@tano/workbench/plugin-sdk';

it('paginates report tasks, escapes reference labels and creates a distinct file for each run', async () => {
  const create = vi.fn(async (path: string) => ({ id: 'ee1234', path }));
  const query = vi.fn().mockResolvedValueOnce({ items: [{ object: { id: 'aa1234', name: '任务 [A]', properties: { completed: false } } }], nextCursor: 'page-2' })
    .mockResolvedValueOnce({ items: [{ object: { id: 'bb1234', name: '任务 B', properties: { completed: true } } }] })
    .mockResolvedValueOnce({ items: [] });
  const tano = { context: async () => ({ settings: { folder: '团队日报' } }), objects: { query },
    documents: { query: async () => ({ items: [{ id: 'cc1234', name: '笔记.md', path: '笔记.md' }, { id: 'dd1234', name: '旧日报.md', path: '团队日报/旧日报.md' }] }), create } } as unknown as TanoAutomationApi;
  const execution: PluginAutomationExecution = { runId: 'first-run', automationId: 'daily', trigger: 'schedule', scheduledAt: '2026-10-09T08:00:00.000Z', payload: null };
  expect(await run(tano, execution)).toMatchObject({ tasks: 2, truncated: false, path: '团队日报/2026-10-09-first-run.md' });
  expect(query.mock.calls[1]![0].cursor).toBe('page-2');
  const content = (create.mock.calls[0] as unknown as [string, string])[1];
  expect(content).toContain('- [ ] [@任务 \\[A\\]](object://event/aa1234)');
  expect(content).toContain('已完成 1 项，未完成 1 项'); expect(content).not.toContain('旧日报');
  await run(tano, { ...execution, runId: 'second-run' });
  expect(create.mock.calls[1]![0]).toBe('团队日报/2026-10-09-second-run.md');
});
