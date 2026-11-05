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
  replyTo?: string;
  mentions?: CommentMention[];
  /** Stable execution receipt for idempotent agent replies. */
  agentTaskId?: string;
}

/** Explicit person references remain portable; account bindings belong to Cloud. */
export interface CommentMention { personId: string; text: string; id?: string; from?: number }

/** Preserve identities outside an input edit and remove any selected mention it replaces. */
export function rebaseCommentMentions(mentions: readonly CommentMention[], before: string, after: string,
  edit?: { from: number; to: number }): CommentMention[] {
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let oldEnd = before.length, newEnd = after.length;
  while (oldEnd > start && newEnd > start && before[oldEnd - 1] === after[newEnd - 1]) { oldEnd--; newEnd--; }
  if (edit) {
    const inserted = after.length - before.length + edit.to - edit.from;
    if (edit.from >= 0 && edit.to >= edit.from && edit.to <= before.length && inserted >= 0 &&
        before.slice(0, edit.from) === after.slice(0, edit.from) && before.slice(edit.to) === after.slice(edit.from + inserted)) {
      start = edit.from; oldEnd = edit.to; newEnd = edit.from + inserted;
    }
  }
  return mentions.flatMap(mention => {
    if (mention.from === undefined) return after.includes(mention.text) ? [{ ...mention }] : [];
    const end = mention.from + mention.text.length;
    if (mention.from < oldEnd && end > start) return [];
    const from = mention.from >= oldEnd ? mention.from + newEnd - oldEnd : mention.from;
    return after.slice(from, from + mention.text.length) === mention.text ? [{ ...mention, from }] : [];
  });
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
      if (message.replyTo !== undefined && (!validId(message.replyTo) || message.replyTo === message.id ||
          !thread.messages.some(item => item.id === message.replyTo))) throw new Error('回复目标无效');
      if (message.agentTaskId !== undefined && !validId(message.agentTaskId)) throw new Error('机器人任务身份无效');
      if (message.mentions !== undefined && (!Array.isArray(message.mentions) || message.mentions.length > 100 ||
          message.mentions.some(item => !item || !/^[0-9a-f]{6}$/.test(item.personId) ||
            item.id !== undefined && !validId(item.id) ||
            !validText(item.text, 120) || !item.text.startsWith('@') || item.text.length < 2 ||
            (item.from !== undefined && (!Number.isSafeInteger(item.from) || item.from < 0 ||
              message.body.slice(item.from, item.from + item.text.length) !== item.text)) ||
            !message.body.includes(item.text)))) throw new Error('提及人物格式无效');
      const mentionIds = message.mentions?.filter(item => item.id).map(item => item.id) ?? [];
      if (new Set(mentionIds).size !== mentionIds.length) throw new Error('提及身份重复');
      messageIds.add(message.id);
    }
  }
  return file;
}
