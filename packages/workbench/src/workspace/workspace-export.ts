import { strToU8, zipSync } from 'fflate';
import { isMarkdown, isWorkspaceDataPath, isWorkspaceInternalPath } from '@tano/protocol';
import type { Workspace, WorkspaceAdapter } from '@tano/protocol';

export async function workspaceArchive(
  workspace: Workspace,
  adapter: WorkspaceAdapter,
  readAttachment?: (workspaceId: string, path: string) => Promise<Uint8Array>,
  assertCurrent: () => void = () => {},
) {
  const files: Record<string, Uint8Array> = Object.create(null);
  for (const entry of workspace.files) {
    if (entry.kind !== 'file' || (isWorkspaceInternalPath(entry.path) && !isWorkspaceDataPath(entry.path))) continue;
    assertCurrent();
    if (!isMarkdown(entry.path) && !isWorkspaceDataPath(entry.path) && readAttachment) {
      files[entry.path] = await readAttachment(workspace.id, entry.path);
    } else {
      const content = (await adapter.read(entry.path)).content;
      const image = adapter.mode === 'demo' && /\.(png|jpe?g|gif|webp)$/i.test(entry.path)
        ? /^data:image\/(?:png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(content) : null;
      files[entry.path] = image ? Uint8Array.from(atob(image[1]), char => char.charCodeAt(0)) : strToU8(content);
    }
    assertCurrent();
  }
  return new Blob([Uint8Array.from(zipSync(files))], { type: 'application/zip' });
}

export function workspaceArchiveName(name: string) {
  return `${name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim() || '工作区'}.zip`;
}
