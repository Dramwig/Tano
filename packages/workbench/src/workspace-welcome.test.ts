// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';
import { addWorkspaceWelcome, workspaceWelcomeContent, workspaceWelcomePath } from './workspace-welcome';

it('preserves a guide created concurrently instead of overwriting it', async () => {
  const adapter = new DemoAdapter({ files: {}, storageKey: `welcome-${crypto.randomUUID()}` });
  const workspace = await adapter.open();
  await adapter.create(workspaceWelcomePath, '# 外部写入的引导\n');
  const write = vi.spyOn(adapter, 'write');
  const result = await addWorkspaceWelcome(adapter, workspace);
  expect(result.files.map(file => file.path)).toContain(workspaceWelcomePath);
  expect((await adapter.read(workspaceWelcomePath)).content).toBe('# 外部写入的引导\n');
  expect(write).not.toHaveBeenCalled();
});

it('does not add content to read-only workspaces or folders that already contain attachments', async () => {
  const adapter = new DemoAdapter({ files: {}, storageKey: `welcome-${crypto.randomUUID()}` });
  const workspace = await adapter.open();
  const create = vi.spyOn(adapter, 'create');
  await addWorkspaceWelcome(adapter, { ...workspace, readOnly: true });
  expect(create).not.toHaveBeenCalled();
  await adapter.create('附件.txt', '已有附件');
  create.mockClear();
  await addWorkspaceWelcome(adapter, await adapter.refresh());
  expect(create).not.toHaveBeenCalled();
});

it('allows portable workspace metadata without treating it as user content', async () => {
  const adapter = new DemoAdapter({ files: { '.tano/settings.tano.json': '{"version":1}' }, storageKey: `welcome-${crypto.randomUUID()}` });
  const workspace = await addWorkspaceWelcome(adapter, await adapter.open());
  expect(workspace.files.some(file => file.path === workspaceWelcomePath)).toBe(true);
  expect(workspaceWelcomeContent('demo')).toContain('数据仅保存在本浏览器');
});
