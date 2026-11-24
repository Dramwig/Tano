// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { DemoAdapter } from './adapter';

beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

it('moves demo folders and attachments together without changing file identity', async () => {
  const adapter = new DemoAdapter();
  await adapter.createFolder('归档');
  await adapter.create('项目/笔记.md', 'note');
  await adapter.create('项目/图片.png', 'image');
  const before = await adapter.refresh();
  const note = before.files.find((file) => file.path === '项目/笔记.md')!;
  await adapter.move('项目', '归档/项目', 'directory');
  const after = await adapter.refresh();
  expect(after.files.find((file) => file.path === '归档/项目/笔记.md')?.id).toBe(note.id);
  expect(after.files.some((file) => file.path === '归档/项目/图片.png')).toBe(true);
  expect(after.files.some((file) => file.path === '项目/笔记.md')).toBe(false);
  await expect(adapter.move('归档/项目', '归档/项目/子目录', 'directory')).rejects.toThrow('自身或子文件夹');
});
