import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import type { DocumentExportFormat } from './document-export';

export async function saveDocumentExport(blob: Blob, filename: string, format: DocumentExportFormat | 'zip' | 'csv') {
  const extensions = format === 'markdown' ? ['md', 'markdown'] : [format];
  const destination = await save({ title: format === 'zip' ? '导出工作区' : format === 'csv' ? '导出成员' : '导出文档', defaultPath: filename, filters: [{ name: format === 'png' ? 'PNG 图片' : format === 'docx' ? 'Word 文档' : format.toUpperCase(), extensions }] });
  if (!destination) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  await invoke('export_document', { destination, content: btoa(binary) });
  return true;
}
