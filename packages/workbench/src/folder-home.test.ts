import { expect, it } from 'vitest';
import { basename, type FileEntry } from '@tano/protocol';
import { indexFolderHomes } from './folder-home';

it('recognizes only the selected exact filename in real user directories', () => {
  const entry = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({ id: path, path, name: basename(path), kind, size: 0, modified: 0 });
  const files = [entry('README.md'), entry('项目', 'directory'), entry('项目/README.md'), entry('项目/index.md'),
    entry('项目/_index.md'), entry('项目/readme.md'), entry('缺失目录/README.md'), entry('.tano', 'directory'), entry('.tano/README.md')];
  expect([...indexFolderHomes(files).values()].map(file => file.path)).toEqual(['项目/README.md']);
  expect([...indexFolderHomes(files, '_index.md').values()].map(file => file.path)).toEqual(['项目/_index.md']);
  expect([...indexFolderHomes(files, 'index.md').values()].map(file => file.path)).toEqual(['项目/index.md']);
  expect(indexFolderHomes(files, '').size).toBe(0);
});
