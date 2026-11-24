import { expect, it } from 'vitest';
import type { FileEntry } from '@tano/protocol';
import { applyFileMovePreview, planFileMove, planFileMovePreview } from './file-move';

const entry = (path: string, kind: FileEntry['kind']): FileEntry => ({
  id: kind === 'directory' ? `folder:${path}` : `file:${path}`,
  path,
  name: path.split('/').at(-1)!,
  kind,
  size: 0,
  modified: 0,
});

it('plans a whole directory move and preserves each child path', () => {
  const entries = [
    entry('项目', 'directory'),
    entry('项目/笔记.md', 'file'),
    entry('项目/图片', 'directory'),
    entry('项目/图片/a.png', 'file'),
    entry('归档', 'directory'),
  ];
  const plan = planFileMove(entries[0], '归档', entries);
  expect(plan.destination).toBe('归档/项目');
  expect(plan.moved.map((item) => item.path)).toEqual([
    '归档/项目',
    '归档/项目/笔记.md',
    '归档/项目/图片',
    '归档/项目/图片/a.png',
  ]);
  expect(() => planFileMove(entries[0], '项目/图片', entries)).toThrow('自身或子文件夹');
});

it('rejects existing names and allows moving a file back to the workspace root', () => {
  const entries = [
    entry('来源', 'directory'),
    entry('来源/笔记.md', 'file'),
    entry('归档', 'directory'),
    entry('归档/笔记.md', 'file'),
  ];
  expect(() => planFileMove(entries[1], '归档', entries)).toThrow('目标名称已经存在');
  expect(planFileMove(entries[1], '', entries).destination).toBe('笔记.md');
  expect(() => planFileMove(entries[1], '来源', entries)).toThrow('已在该目录');
});

it('previews a directory move without changing authoritative entries and yields to refreshed paths', () => {
  const entries = [
    entry('项目', 'directory'),
    entry('项目/笔记.md', 'file'),
    entry('项目/图片', 'directory'),
    entry('项目/图片/a.png', 'file'),
    entry('归档', 'directory'),
  ];
  const preview = planFileMovePreview([entries[0]], '归档', entries);
  const visible = applyFileMovePreview(entries, preview);
  expect(visible.map((item) => item.path)).toEqual([
    '归档/项目',
    '归档/项目/笔记.md',
    '归档/项目/图片',
    '归档/项目/图片/a.png',
    '归档',
  ]);
  expect(visible[0].name).toBe('项目');
  expect(visible[4]).toBe(entries[4]);
  expect(entries[0].path).toBe('项目');

  const refreshed = [
    { ...entries[0], path: '归档/项目' },
    entries[1],
    entries[2],
    { ...entries[3], path: '其他/a.png' },
    entries[4],
  ];
  const afterRefresh = applyFileMovePreview(refreshed, preview);
  expect(afterRefresh[0]).toBe(refreshed[0]);
  expect(afterRefresh[1].path).toBe('归档/项目/笔记.md');
  expect(afterRefresh[3]).toBe(refreshed[3]);
});

it('previews every file in a multi-selection move', () => {
  const entries = [entry('一.md', 'file'), entry('二.md', 'file'), entry('归档', 'directory')];
  const preview = planFileMovePreview(entries.slice(0, 2), '归档', entries);
  expect(applyFileMovePreview(entries, preview).map((item) => item.path)).toEqual([
    '归档/一.md',
    '归档/二.md',
    '归档',
  ]);
});

it('rejects a multi-selection when its files would collide at the destination', () => {
  const entries = [
    entry('来源一', 'directory'),
    entry('来源一/笔记.md', 'file'),
    entry('来源二', 'directory'),
    entry('来源二/笔记.md', 'file'),
    entry('归档', 'directory'),
  ];
  expect(() => planFileMovePreview([entries[1], entries[3]], '归档', entries)).toThrow(
    '目标名称已经存在',
  );
});
