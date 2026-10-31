import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import {
  basename,
  relativeWorkspaceReference,
  resolveWorkspaceReference,
  safeRemoteImage,
} from '@tano/protocol';
import type { Workspace } from '@tano/protocol';

export interface AttachmentService {
  readonly revision?: number;
  imageUrl(workspace: Workspace | null, documentPath: string, reference: string): string | null;
  importAttachment(workspaceId: string, documentPath: string, file: File, requireImage: boolean): Promise<{
    path: string; name: string; image: boolean; url: string;
  }>;
  exportAttachment(workspaceId: string, path: string): Promise<void>;
  readAttachment?(workspaceId: string, path: string): Promise<Uint8Array>;
  writeSpreadsheet?(workspaceId: string, path: string, bytes: Uint8Array, expected: string): Promise<string>;
}

export const nativeAttachments: AttachmentService = {
  imageUrl, importAttachment, exportAttachment,
  async writeSpreadsheet(workspaceId, path, bytes, expected) {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
    return invoke<string>('write_spreadsheet', { workspaceId, path, content: btoa(binary), expected });
  },
  async readAttachment(workspaceId, path) {
    const content = await invoke<string>('read_attachment', { workspaceId, path });
    return Uint8Array.from(atob(content), char => char.charCodeAt(0));
  },
};

export function imageUrl(
  workspace: Workspace | null,
  documentPath: string,
  reference: string,
): string | null {
  const remote = safeRemoteImage(reference);
  if (remote) return remote;
  if (!workspace) return null;
  const path = resolveWorkspaceReference(documentPath, reference);
  const file = workspace.files.find((entry) => entry.path === path && entry.kind === 'file');
  return file
    ? `${convertFileSrc(`${workspace.id}/${file.path}`, 'tano-asset')}?v=${file.modified}-${file.size}`
    : null;
}

export async function importAttachment(
  workspaceId: string,
  documentPath: string,
  file: File,
  requireImage: boolean,
) {
  if (file.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50 MiB');
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192)
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  const result = await invoke<{ path: string; name: string; image: boolean }>('import_attachment', {
    workspaceId,
    name: file.name,
    content: btoa(binary),
    requireImage,
  });
  return { ...result, url: relativeWorkspaceReference(documentPath, result.path) };
}

export async function exportAttachment(workspaceId: string, path: string) {
  const destination = await save({ title: '导出附件副本', defaultPath: basename(path) });
  if (destination) await invoke('export_attachment', { workspaceId, path, destination });
}

export async function openExternalUrl(url: string) {
  await invoke('open_external_url', { url });
}

export async function openWorkspaceEntry(workspaceId: string, path: string, reveal: boolean) {
  await invoke('open_workspace_entry', { workspaceId, path, reveal });
}

export function workspaceEntryPath(workspaceId: string, path: string) {
  return invoke<string>('workspace_entry_path', { workspaceId, path });
}

export function resourceMarkdown(resource: { url: string; name: string; image: boolean }) {
  const label = resource.name.replace(/[\\[\]]/g, '\\$&').replace(/[\r\n]/g, ' ');
  return `${resource.image ? '!' : ''}[${label}](${resource.url})`;
}
