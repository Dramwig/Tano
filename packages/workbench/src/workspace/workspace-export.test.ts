import { expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import type { Workspace, WorkspaceAdapter } from '@tano/protocol';
import { workspaceArchive } from './workspace-export';

const paths = ['项目/文档.md', '附件/图片.png', '.tano/settings.tano.json', '.tano/config.json'];
const workspace: Workspace = { id: 'ws', name: '工作区', path: '', files: paths.map((path, index) => ({ id: `${index}`, path, name: path, kind: 'file', size: 1, modified: 0 })) };
it('exports original Markdown, binary attachments and portable settings, excluding private identity', async () => {
  const content: Record<string, string> = { '项目/文档.md': '# 原文\r\n', '.tano/settings.tano.json': '{"version":1}' };
  const adapter = { read: vi.fn(async (path: string) => ({ content: content[path], hash: '', modified: 0 })) } as unknown as WorkspaceAdapter;
  const bytes = new Uint8Array([0, 255, 128, 137, 80, 78, 71]);
  const readAttachment = vi.fn(async () => bytes);
  const blob = await workspaceArchive(workspace, adapter, readAttachment);
  const archive = unzipSync(new Uint8Array(await blob.arrayBuffer()));
  expect(Object.keys(archive)).toEqual(paths.slice(0, 3));
  expect(strFromU8(archive['项目/文档.md'])).toBe(content['项目/文档.md']);
  expect(archive['附件/图片.png']).toEqual(bytes);
  expect(readAttachment).toHaveBeenCalledWith('ws', '附件/图片.png');
  expect(adapter.read).not.toHaveBeenCalledWith('.tano/config.json');
});
it('aborts an export on a workspace switch instead of mixing files from different workspaces', async () => {
  let current = 'ws';
  const adapter = { read: vi.fn(async () => { current = 'other'; return { content: 'text' }; }) } as unknown as WorkspaceAdapter;
  await expect(workspaceArchive(workspace, adapter, undefined, () => {
    if (current !== workspace.id) throw new Error('工作区已切换');
  })).rejects.toThrow('工作区已切换');
  expect(adapter.read).toHaveBeenCalledTimes(1);
});
it('decodes bundled demo image data rather than exporting a data URL as a PNG file', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 0, 255]);
  const adapter = { mode: 'demo', read: async () => ({ content: `data:image/png;base64,${Buffer.from(bytes).toString('base64')}` }) } as unknown as WorkspaceAdapter;
  const blob = await workspaceArchive({ ...workspace, files: [workspace.files[1]] }, adapter);
  expect(unzipSync(new Uint8Array(await blob.arrayBuffer()))['附件/图片.png']).toEqual(bytes);
});
