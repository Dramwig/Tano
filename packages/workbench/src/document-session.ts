import type { FileSnapshot, Workspace, WorkspaceAdapter } from '@tano/protocol';
import { mergeMarkdown } from '@tano/markdown';
import type { DocumentLayoutState } from './workspace-document-layout';

export interface OpenDocument {
  id: string;
  path: string;
  content: string;
  base: FileSnapshot;
  saving: boolean;
  creating?: boolean;
  missing: boolean;
  conflict?: { copyPath: string; disk: FileSnapshot };
  error?: string;
  tableLayout?: DocumentLayoutState;
}

export const documentDirty = (doc: OpenDocument) => !!doc.creating || doc.content !== doc.base.content;

export interface DocumentSessionHost {
  adapter: Pick<WorkspaceAdapter, 'write' | 'create' | 'refresh'>;
  confirmCreation(doc: OpenDocument): Promise<boolean>;
  invalidate(id: string): void;
  refreshed(workspace: Workspace): void;
  activity(label: string, detail: string, kind: 'save' | 'external' | 'conflict', change: { before: string; after: string }): void;
  report(error: unknown): void;
}

/** Conditional saves and three-way reconciliation, independent of tabs and Vue. */
export function createDocumentSession(host: DocumentSessionHost) {

  async function reconcile(doc: OpenDocument, disk: FileSnapshot): Promise<void> {
    if (doc.conflict) { doc.conflict.disk = disk; return; }
    if (disk.hash === doc.base.hash) return;
    host.invalidate(doc.id);
    const change = { before: doc.base.content, after: disk.content };
    const merge = mergeMarkdown(doc.base.content, doc.content, disk.content);
    if (merge.clean) {
      doc.content = merge.content;
      doc.base = disk;
      doc.missing = false;
      doc.error = undefined;
      host.activity('外部修改已载入', doc.path, 'external', change);
    } else {
      const copyPath = doc.path.replace(
        /\.(md|markdown)$/i,
        `.conflict-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID().slice(0, 6)}.md`,
      );
      // Freeze editing before the asynchronous copy so further input cannot be lost.
      doc.conflict = { copyPath, disk };
      try { await host.adapter.create(copyPath, doc.content); }
      catch (error) { doc.conflict = undefined; throw error; }
      host.refreshed(await host.adapter.refresh());
      host.activity('修改发生冲突，已保留副本', copyPath, 'conflict', {
        before: disk.content, after: doc.content,
      });
    }
  }

  async function save(doc: OpenDocument): Promise<void> {
    if (doc.creating && !(await host.confirmCreation(doc))) return;
    if (!documentDirty(doc) || doc.conflict || doc.missing) return;
    doc.saving = true;
    try {
      for (let attempt = 0; attempt < 3; attempt++) {
        const result = await host.adapter.write(doc.path, doc.content, doc.base.hash);
        if (result.status === 'saved') {
          host.invalidate(doc.id);
          const change = { before: doc.base.content, after: result.snapshot.content };
          doc.base = result.snapshot;
          doc.error = undefined;
          host.activity('文档已保存', doc.path, 'save', change);
          return;
        }
        if (result.status === 'missing') {
          doc.missing = true;
          doc.error = '文件已在外部删除，请另存副本';
          return;
        }
        await reconcile(doc, result.snapshot);
        if (doc.conflict || !documentDirty(doc)) return;
      }
      doc.error = '文件正在被频繁修改，自动保存已暂停。请稍后按 Ctrl + S 重试。';
    } catch (error) {
      doc.error = String(error);
      host.report(error);
    } finally { doc.saving = false; }
  }
  return { reconcile, save };
}
