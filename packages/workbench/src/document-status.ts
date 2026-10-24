import { t } from './i18n';
import { documentDirty, type OpenDocument } from './document-session';
import { layoutDirty } from './workspace-document-layout';

export type DocumentStatusKind = 'error' | 'offline' | 'syncing' | 'pushing' | 'saving' | 'locked' | 'preview' | 'updated' | 'saved';
export interface DocumentSyncStatus {
  kind: 'error' | 'offline' | 'syncing' | 'pushing' | 'updated' | 'saved';
  detail: string;
  readOnly?: boolean;
}
export interface DocumentStatusItem { kind: DocumentStatusKind; label: string; detail: string }
const priority: DocumentStatusKind[] = ['error', 'offline', 'pushing', 'syncing', 'saving', 'locked', 'preview', 'updated', 'saved'];

export function documentStatusItems(input: {
  document?: OpenDocument | null;
  locked?: boolean;
  preview?: boolean;
  sync?: DocumentSyncStatus;
  storage: 'demo' | 'web' | 'local';
}): DocumentStatusItem[] {
  const items: DocumentStatusItem[] = [];
  const add = (kind: DocumentStatusKind, label: string, detail: string) => items.push({ kind, label, detail });
  const doc = input.document;
  const dirty = !!doc && (documentDirty(doc) || !!doc.tableLayout && layoutDirty(doc.tableLayout));
  if (doc?.conflict || doc?.tableLayout?.conflict) add('error', t('修改冲突'), t('存在冲突副本，请处理后继续保存。'));
  else if (doc?.missing) add('error', t('文件已丢失'), t('原文件已不存在，请保留副本或恢复文件。'));
  else if (doc?.error || doc?.tableLayout?.error) add('error', t('保存失败'), doc.error || doc.tableLayout!.error!);
  if (input.locked) add('locked', t('已锁定'), t('当前文章处于阅读模式，解锁后可继续编辑。'));
  if (input.preview || input.sync?.readOnly) add('preview', t('仅预览'), t('当前文章只读，暂时无法编辑。'));
  if (!items.some(item => item.kind === 'error')) {
    if (input.sync) {
      const labels = { error: t('同步失败'), offline: t('离线'), syncing: t('同步中'), pushing: t('推送中'), updated: t('有更新'), saved: t('已保存') };
      // A newly changed draft must never briefly claim to be fully synchronized.
      if (input.sync.kind === 'saved' && dirty) add('updated', t('有更新'), t('文章有修改，正在等待保存。'));
      else add(input.sync.kind, labels[input.sync.kind], input.sync.detail);
    } else if (doc?.saving) add('saving', t('保存中'), t('正在保存当前文章。'));
    else if (dirty) add('updated', t('有更新'), t('文章有修改，正在等待保存。'));
    else if (doc) add('saved', t('已保存'), input.storage === 'demo' ? t('修改已保存在当前浏览器。')
      : input.storage === 'web' ? t('修改已保存到云端。') : t('修改已保存到本机文件。'));
  }
  return items.sort((a, b) => priority.indexOf(a.kind) - priority.indexOf(b.kind));
}
