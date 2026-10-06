import { parseCommentFile } from './comments';
import type { CommentMessage, CommentThread } from './comments';

/** Portable review records. Pending text never replaces the Markdown source. */
export interface DocumentSuggestion {
  id: string;
  revision: number;
  authorId: string;
  authorName: string;
  createdAt: number;
  updatedAt: number;
  base: string;
  from: number;
  to: number;
  text: string;
  reason?: string;
  groupId?: string;
  status: 'pending' | 'applying' | 'accepted' | 'rejected';
  replies?: CommentMessage[];
  /** Durable write intent: recovery must never blindly replay an uncertain write. */
  application?: { operationId: string; before: string; after: string; diskHash: string; resultHash?: string };
}

export function suggestionReviewThread(item: DocumentSuggestion): CommentThread {
  return {
    id: item.id, createdAt: item.createdAt, resolved: false, detached: false,
    messages: [{ id: item.id, authorId: item.authorId, authorName: item.authorName,
      createdAt: item.createdAt, body: item.reason || '编辑建议' }, ...(item.replies ?? [])],
  };
}

export interface SuggestionFile {
  version: 1;
  workspaceId: string;
  fileId: string;
  suggestions: DocumentSuggestion[];
}

/** Transient positions in either the source editor or the rich-text projection. */
export interface SuggestionDecorations {
  text: string;
  ranges: { id: string; from: number; to: number; removed: string; inserted?: string }[];
}

export function suggestionDataPath(fileId: string) {
  if (!/^[0-9a-f]{6}$/.test(fileId)) throw new Error('文档身份无效');
  return `.tano/suggestions/${fileId}.tano.json`;
}

export function parseSuggestionFile(content: string, workspaceId: string, fileId: string): SuggestionFile {
  const file = JSON.parse(content) as SuggestionFile;
  if (!file || file.version !== 1 || file.workspaceId !== workspaceId || file.fileId !== fileId ||
      !Array.isArray(file.suggestions) || file.suggestions.length > 4000)
    throw new Error('建议文件身份或格式无效，原文件已保留');
  const ids = new Set<string>();
  const text = (value: unknown, max: number): value is string => typeof value === 'string' && value.length <= max;
  for (const item of file.suggestions) {
    if (!item || !text(item.id, 80) || !/^[a-z0-9-]{8,80}$/i.test(item.id) || ids.has(item.id) ||
        !Number.isSafeInteger(item.revision) || item.revision < 1 ||
        !text(item.authorId, 120) || !text(item.authorName, 120) ||
        !Number.isFinite(item.createdAt) || !Number.isFinite(item.updatedAt) ||
        !text(item.base, 2_000_000) || !text(item.text, 2_000_000) ||
        !Number.isSafeInteger(item.from) || !Number.isSafeInteger(item.to) ||
        item.from < 0 || item.to < item.from || item.to > item.base.length ||
        !['pending', 'applying', 'accepted', 'rejected'].includes(item.status) ||
        (item.reason !== undefined && !text(item.reason, 4000)) ||
        (item.groupId !== undefined && !text(item.groupId, 80)))
      throw new Error('建议记录格式无效，原文件已保留');
    if (item.application) {
      const application = item.application;
      if (!text(application.operationId, 80) || !text(application.before, 2_000_000) ||
          !text(application.after, 2_000_000) || !text(application.diskHash, 128) ||
          (application.resultHash !== undefined && !text(application.resultHash, 128)))
        throw new Error('建议写入回执无效');
    }
    if ((item.status === 'applying' || item.status === 'accepted') && !item.application)
      throw new Error('建议缺少写入凭据');
    if (item.replies !== undefined) {
      if (!Array.isArray(item.replies)) throw new Error('建议回复格式无效');
      parseCommentFile(JSON.stringify({ version: 1, kind: 'discussion', fileId,
        threads: [suggestionReviewThread(item)] }), 'discussion', fileId);
    }
    ids.add(item.id);
  }
  return file;
}
