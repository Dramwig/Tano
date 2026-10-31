import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { nativeAttachments } from './attachments';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(), convertFileSrc: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('writes spreadsheet bytes with a workspace and base hash, returning the backup path', async () => {
  vi.mocked(invoke).mockResolvedValue('app-data/backup.xlsx');
  const bytes = new Uint8Array([0, 255, 128]);
  expect(await nativeAttachments.writeSpreadsheet!('ws', 'book.xlsx', bytes, 'base')).toBe('app-data/backup.xlsx');
  expect(invoke).toHaveBeenCalledWith('write_spreadsheet', { workspaceId: 'ws', path: 'book.xlsx', content: Buffer.from(bytes).toString('base64'), expected: 'base' });
});
it('reads scoped binary attachments through native storage without altering bytes', async () => {
  const bytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
  vi.mocked(invoke).mockResolvedValue(Buffer.from(bytes).toString('base64'));
  expect(await nativeAttachments.readAttachment!('ws', '附件/文档.pdf')).toEqual(bytes);
  expect(invoke).toHaveBeenCalledWith('read_attachment', { workspaceId: 'ws', path: '附件/文档.pdf' });
});
