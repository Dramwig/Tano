/** Portable document discussions and content-bound annotations. */
export type CommentKind = 'annotation' | 'discussion';

export interface CommentSpan {
  from: number;
  to: number;
  text: string;
}

/** Offsets are in the projected visible text or in the raw Markdown source. */
export interface CommentAnchor {
  basis: 'prose' | 'source';
  baseHash: string;
  spans: CommentSpan[];
  prefix: string;
  suffix: string;
}

export interface CommentMessage {
  id: string;
  authorId: string;
  authorName: string;
  body: string;
  createdAt: number;
  updatedAt?: number;
}

export interface CommentThread {
  id: string;
  anchor?: CommentAnchor;
  messages: CommentMessage[];
  resolved: boolean;
  detached: boolean;
  createdAt: number;
}

export interface CommentFile {
  version: 1;
  kind: CommentKind;
  fileId: string;
  threads: CommentThread[];
}

const validId = (value: unknown) => typeof value === 'string' && /^[0-9a-z-]{8,80}$/i.test(value);
const validText = (value: unknown, max: number) =>
  typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

export function emptyCommentFile(kind: CommentKind, fileId: string): CommentFile {
  if (!/^[0-9a-f]{6}$/.test(fileId)) throw new Error('文档身份无效');
  return { version: 1, kind, fileId, threads: [] };
}

export function parseCommentFile(content: string, kind: CommentKind, fileId: string): CommentFile {
  const value: unknown = JSON.parse(content);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('评论文件格式无效');
  const file = value as CommentFile;
  if (file.version !== 1 || file.kind !== kind || file.fileId !== fileId ||
      !Array.isArray(file.threads) || file.threads.length > 2000)
    throw new Error('评论文件身份或格式无效');
  const threadIds = new Set<string>();
  for (const thread of file.threads) {
    if (!thread || !validId(thread.id) || threadIds.has(thread.id) ||
        !Array.isArray(thread.messages) || thread.messages.length < 1 || thread.messages.length > 1000 ||
        typeof thread.resolved !== 'boolean' || typeof thread.detached !== 'boolean' ||
        !Number.isFinite(thread.createdAt)) throw new Error('评论串格式无效');
    threadIds.add(thread.id);
    if (kind === 'annotation') {
      const anchor = thread.anchor;
      if (!anchor || !['prose', 'source'].includes(anchor.basis) ||
          typeof anchor.baseHash !== 'string' || anchor.baseHash.length > 128 ||
          !Array.isArray(anchor.spans) || anchor.spans.length < 1 || anchor.spans.length > 1000 ||
          !validText(anchor.prefix, 256) || !validText(anchor.suffix, 256) ||
          anchor.spans.some(span => !span || !Number.isSafeInteger(span.from) ||
            !Number.isSafeInteger(span.to) || span.from < 0 || span.to <= span.from ||
            !validText(span.text, 100_000) || span.text.length !== span.to - span.from))
        throw new Error('批注锚点格式无效');
    } else if (thread.anchor !== undefined) throw new Error('整篇讨论不能包含局部锚点');
    const messageIds = new Set<string>();
    for (const message of thread.messages) {
      if (!message || !validId(message.id) || messageIds.has(message.id) ||
          !validText(message.authorId, 120) || !validText(message.authorName, 120) ||
          !validText(message.body, 20_000) || !message.body.trim() ||
          !Number.isFinite(message.createdAt) ||
          (message.updatedAt !== undefined && !Number.isFinite(message.updatedAt))) throw new Error('评论内容格式无效');
      messageIds.add(message.id);
    }
  }
  return file;
}
