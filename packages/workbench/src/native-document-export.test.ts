import { beforeEach, expect, it, vi } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { saveDocumentExport } from './native-document-export';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: vi.fn() }));
beforeEach(() => { vi.resetAllMocks(); });

it('saves the chosen format and transfers the exact binary bytes to native storage', async () => {
  vi.mocked(save).mockResolvedValue('C:\\Exports\\document.pdf');
  const bytes = new Uint8Array([0, 255, 128, 37, 80, 68, 70]);
  await saveDocumentExport(new Blob([bytes]), '文档.pdf', 'pdf');
  expect(save).toHaveBeenCalledWith({ title: '导出文档', defaultPath: '文档.pdf', filters: [{ name: 'PDF', extensions: ['pdf'] }] });
  expect(invoke).toHaveBeenCalledWith('export_document', { destination: 'C:\\Exports\\document.pdf', content: Buffer.from(bytes).toString('base64') });
});

it('does not write when the save dialog is canceled', async () => {
  vi.mocked(save).mockResolvedValue(null);
  await saveDocumentExport(new Blob(['正文']), '文档.md', 'markdown');
  expect(invoke).not.toHaveBeenCalled();
});
