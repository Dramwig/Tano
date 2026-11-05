import { isWorkspaceInternalPath, isMarkdown, type Workspace } from '@tano/protocol';
import type { AttachmentService } from '../attachments';

/** One bounded snapshot per workbench. A continuation can never mix file versions or instances. */
export class PluginAttachmentReader {
  private snapshot?: { key: string; revision: string; bytes: Uint8Array };
  clear() { this.snapshot = undefined; }
  async read(workspace: Workspace, params: Record<string, unknown>, service: AttachmentService | undefined, assertCurrent: () => void) {
    const file = workspace.files.find(file => file.id === params.fileId && file.kind === 'file');
    if (!file || isMarkdown(file.path) || isWorkspaceInternalPath(file.path)) throw new Error('附件不存在或不可访问');
    const offset = params.offset ?? 0;
    if (!Number.isSafeInteger(offset) || Number(offset) < 0 || Number(offset) % 18000 !== 0) throw new Error('附件分块位置无效');
    const key = JSON.stringify([workspace.id, params.queryScope, file.id, file.path, file.modified, file.size, file.contentHash]);
    if (offset === 0) {
      if (!service?.readAttachment) throw new Error('当前宿主不支持读取附件');
      if (file.size > 50 * 1024 * 1024) throw new Error('附件不能超过 50 MiB');
      const bytes = await service.readAttachment(workspace.id, file.path);
      assertCurrent();
      if (bytes.length > 50 * 1024 * 1024) throw new Error('附件不能超过 50 MiB');
      this.snapshot = { key, revision: crypto.randomUUID(), bytes };
    }
    const snapshot = this.snapshot;
    if (!snapshot || snapshot.key !== key || (offset !== 0 && params.revision !== snapshot.revision)) throw new Error('附件版本已变化，请重新打开');
    if (Number(offset) > snapshot.bytes.length) throw new Error('附件分块位置无效');
    const chunk = btoa(String.fromCharCode(...snapshot.bytes.subarray(Number(offset), Number(offset) + 18000)));
    const result = { path: file.path, revision: snapshot.revision, offset: Number(offset), total: snapshot.bytes.length, chunk };
    if (Number(offset) + 18000 >= snapshot.bytes.length) this.clear();
    return result;
  }
}
