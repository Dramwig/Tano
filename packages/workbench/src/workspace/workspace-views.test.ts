import { describe, expect, it, vi } from 'vitest';
import type { FileSnapshot, Workspace } from '@tano/protocol';
import { loadWorkspaceViews } from './workspace-views';

const workspace: Workspace = {
  id: 'workspace',
  name: 'Workspace',
  path: '/workspace',
  files: [
    { id: 'a1b2c3', path: '.tano/views/research.tano.json', name: 'research.tano.json', kind: 'file', size: 10, modified: 1 },
    { id: 'd4e5f6', path: '.tano/views/ignored.txt', name: 'ignored.txt', kind: 'file', size: 1, modified: 1 },
  ],
};

function adapter(content: string | Record<string, string>) {
  return { read: vi.fn(async (path: string) => {
    const value = typeof content === 'string' ? content : content[path] ?? '';
    const snapshot: FileSnapshot = { content: value, hash: 'abc123', modified: 1 };
    return snapshot;
  }) };
}

describe('loadWorkspaceViews', () => {
  it('loads portable views and keeps their source revision', async () => {
    const result = await loadWorkspaceViews(adapter(JSON.stringify({
      version: 1,
      layer: 'view',
      workspaceId: 'workspace',
      id: 'research',
      name: 'Research',
      kind: 'files',
      sources: [{ layer: 'file', fileId: 'a1b2c3' }],
    })), workspace);
    expect(result.errors).toEqual([]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]).toMatchObject({ path: '.tano/views/research.tano.json', snapshot: { hash: 'abc123' } });
  });

  it('skips views owned by another workspace and reports malformed files', async () => {
    const foreign = JSON.stringify({
      version: 1,
      layer: 'view',
      workspaceId: 'other',
      id: 'research',
      name: 'Other',
      kind: 'files',
      sources: [],
    });
    const result = await loadWorkspaceViews(adapter({
      '.tano/views/research.tano.json': foreign,
      '.tano/views/broken.tano.json': '{',
    }), {
      ...workspace,
      files: [workspace.files[0], { ...workspace.files[0], id: 'd4e5f6', path: '.tano/views/broken.tano.json' }],
    });
    expect(result.records).toHaveLength(0);
    expect(result.errors).toEqual([
      '.tano/views/research.tano.json：视图属于其他工作区，已跳过',
      expect.stringContaining('.tano/views/broken.tano.json：'),
    ]);
  });
});
