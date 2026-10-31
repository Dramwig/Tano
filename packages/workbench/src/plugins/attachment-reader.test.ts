import { expect, it, vi } from 'vitest';
import type { Workspace } from '@tano/protocol';
import type { AttachmentService } from '../attachments';
import { PluginAttachmentReader } from './attachment-reader';

const workspace = { id: 'ws', files: [{ id: 'slides', kind: 'file', path: 'deck.ppt', size: 20000, modified: 1 }] } as Workspace;
it('reads one binary snapshot and binds continuations to workspace, file revision and plugin instance', async () => {
  const bytes = new Uint8Array(20000).fill(255), readAttachment = vi.fn().mockResolvedValue(bytes);
  const service = { readAttachment } as unknown as AttachmentService;
  const reader = new PluginAttachmentReader();
  const request = { fileId: 'slides', queryScope: 'instance', offset: 0 };
  const first = await reader.read(workspace, request, service, () => {});
  expect(atob(first.chunk)).toHaveLength(18000);
  const next = { ...request, offset: 18000, revision: first.revision };
  await expect(reader.read(workspace, { ...next, queryScope: 'other' }, service, () => {})).rejects.toThrow('版本已变化');
  await expect(reader.read({ ...workspace, id: 'other' }, next, service, () => {})).rejects.toThrow('版本已变化');
  await expect(reader.read({ ...workspace, files: [{ ...workspace.files[0], contentHash: 'changed' }] }, next, service, () => {})).rejects.toThrow('版本已变化');
  expect(atob((await reader.read(workspace, next, service, () => {})).chunk)).toHaveLength(2000);
  expect(readAttachment).toHaveBeenCalledTimes(1);
  reader.clear();
  await expect(reader.read(workspace, next, service, () => {})).rejects.toThrow('版本已变化');
});
it('rejects internal paths, invalid offsets and revoked reads before returning bytes', async () => {
  const reader = new PluginAttachmentReader(), readAttachment = vi.fn().mockResolvedValue(new Uint8Array(10));
  const service = { readAttachment } as unknown as AttachmentService;
  const request = { fileId: 'slides', offset: 0 };
  await expect(reader.read({ ...workspace, files: [{ ...workspace.files[0], path: '.tano/private.ppt' }] }, request, service, () => {})).rejects.toThrow('不可访问');
  await expect(reader.read(workspace, { ...request, offset: -1 }, service, () => {})).rejects.toThrow('位置无效');
  expect(readAttachment).not.toHaveBeenCalled();
  await expect(reader.read(workspace, request, service, () => { throw new Error('revoked'); })).rejects.toThrow('revoked');
});
