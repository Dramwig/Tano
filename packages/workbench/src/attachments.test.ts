import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { nativeAttachments } from './attachments';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('reads scoped binary attachments through native storage without altering bytes', async () => {
  const bytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
  vi.mocked(invoke).mockResolvedValue(Buffer.from(bytes).toString('base64'));
  expect(await nativeAttachments.readAttachment!('ws', '附件/文档.pdf')).toEqual(bytes);
  expect(invoke).toHaveBeenCalledWith('read_attachment', { workspaceId: 'ws', path: '附件/文档.pdf' });
});
