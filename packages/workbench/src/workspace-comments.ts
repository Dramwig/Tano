import {
  commentDataPath,
  emptyCommentFile,
  parseCommentFile,
} from '@tano/protocol';
import type {
  CommentAnchor,
  CommentFile,
  CommentKind,
  CommentMessage,
  CommentMention,
  CommentThread,
  WorkspaceAdapter,
  Workspace,
} from '@tano/protocol';

export interface CommentAuthor { id: string; name: string }
export interface CommentMessageEdit { messageId: string; expectedBody: string; body: string }
export interface CommentMessageRemoval {
  messageId: string;
  expectedBody: string;
  expectedMessages?: { id: string; body: string }[];
}
const pendingWrites = new WeakMap<WorkspaceAdapter, Map<string, Promise<unknown>>>();
export type CommentChange =
  | { type: 'start'; id: string; body: string; author: CommentAuthor; anchor?: CommentAnchor; mentions?: CommentMention[] }
  | { type: 'reply'; threadId: string; id: string; body: string; author: CommentAuthor; replyTo?: string; mentions?: CommentMention[] }
  | { type: 'resolve'; threadId: string; resolved: boolean }
  | ({ type: 'edit'; threadId: string; authorId: string } & CommentMessageEdit)
  | ({ type: 'delete'; threadId: string; authorId: string } & CommentMessageRemoval)
  | { type: 'reanchor'; threadId: string; expectedBaseHash: string; anchor: CommentAnchor | null };

function message(id: string, body: string, author: CommentAuthor, mentions?: CommentMention[], replyTo?: string): CommentMessage {
  return { id, body: body.trim(), authorId: author.id, authorName: author.name, createdAt: Date.now(),
    ...(mentions?.length ? { mentions } : {}), ...(replyTo ? { replyTo } : {}) };
}

/** Each edit is reapplied to the newest file, so independent replies survive a CAS conflict. */
export function applyCommentChange(file: CommentFile, change: CommentChange): CommentFile {
  const next = structuredClone(file);
  if (change.type === 'start') {
    if (next.threads.some(thread => thread.id === change.id)) return next;
    if (!change.body.trim()) throw new Error('请输入评论内容');
    if (next.kind === 'annotation' && !change.anchor) throw new Error('请先选择要批注的内容');
    if (next.kind === 'discussion' && change.anchor) throw new Error('整篇讨论不需要局部锚点');
    const createdAt = Date.now();
    next.threads.push({ id: change.id, ...(change.anchor ? { anchor: change.anchor } : {}),
      messages: [message(change.id, change.body, change.author, change.mentions)], resolved: false,
      detached: false, createdAt });
  } else {
    const thread = next.threads.find(item => item.id === change.threadId);
    if (!thread && change.type === 'delete') return next;
    if (!thread) throw new Error('评论已被移除，请刷新后重试');
    if (change.type === 'reply') {
      if (thread.messages.some(item => item.id === change.id)) return next;
      if (!change.body.trim()) throw new Error('请输入回复内容');
      thread.messages.push(message(change.id, change.body, change.author, change.mentions, change.replyTo));
    } else if (change.type === 'resolve') thread.resolved = change.resolved;
    else if (change.type === 'edit' || change.type === 'delete') {
      const index = thread.messages.findIndex(item => item.id === change.messageId);
      const current = thread.messages[index];
      if (!current && change.type === 'delete') return next;
      if (!current) throw new Error('评论已被移除，请刷新后重试');
      if (current.authorId !== change.authorId) throw new Error('只能编辑或删除自己发表的评论');
      if (current.body !== change.expectedBody) throw new Error('评论已由其他编辑更新，请刷新后重试；输入内容仍保留');
      if (change.type === 'edit') {
        if (!change.body.trim()) throw new Error('请输入评论内容');
        current.body = change.body.trim();
        current.mentions = current.mentions?.filter(item => current.body.includes(item.text));
        current.updatedAt = Date.now();
      } else if (index === 0) {
        if (!change.expectedMessages || change.expectedMessages.length !== thread.messages.length ||
            thread.messages.some((item, i) => item.id !== change.expectedMessages![i]?.id ||
              item.body !== change.expectedMessages![i]?.body))
          throw new Error('评论或回复已变化，请刷新后重新确认删除');
        next.threads = next.threads.filter(item => item.id !== thread.id);
      } else {
        thread.messages.splice(index, 1);
        for (const item of thread.messages) if (item.replyTo === change.messageId) delete item.replyTo;
      }
    }
    else {
      if (!thread.anchor || thread.anchor.baseHash !== change.expectedBaseHash)
        throw new Error('批注锚点已由其他编辑更新，请刷新后重试');
      if (change.anchor) thread.anchor = change.anchor;
      thread.detached = !change.anchor;
    }
  }
  return parseCommentFile(JSON.stringify(next), next.kind, next.fileId);
}

export async function loadCommentFile(adapter: WorkspaceAdapter, kind: CommentKind, fileId: string, workspaceSnapshot?: Workspace) {
  const path = commentDataPath(kind, fileId);
  const workspace = workspaceSnapshot ?? await adapter.refresh();
  if (!workspace.files.some(file => file.kind === 'file' && file.path === path))
    return { file: emptyCommentFile(kind, fileId), hash: null as string | null };
  const snapshot = await adapter.read(path);
  return { file: parseCommentFile(snapshot.content, kind, fileId), hash: snapshot.hash };
}

export async function saveCommentChange(
  adapter: WorkspaceAdapter,
  kind: CommentKind,
  fileId: string,
  change: CommentChange,
) {
  const path = commentDataPath(kind, fileId);
  let queued = pendingWrites.get(adapter);
  if (!queued) { queued = new Map(); pendingWrites.set(adapter, queued); }
  const previous = queued.get(path);
  const save = async () => {
    await previous?.catch(() => {});
    return writeCommentChange(adapter, kind, fileId, path, change);
  };
  const result = save();
  queued.set(path, result);
  try { return await result; }
  finally { if (queued.get(path) === result) queued.delete(path); }
}

async function writeCommentChange(
  adapter: WorkspaceAdapter, kind: CommentKind, fileId: string, path: string, change: CommentChange,
) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await loadCommentFile(adapter, kind, fileId);
    const updated = applyCommentChange(current.file, change);
    const content = `${JSON.stringify(updated, null, 2)}\n`;
    if (current.hash) {
      const result = await adapter.write(path, content, current.hash);
      if (result.status === 'saved') return updated;
      if (result.status === 'missing') continue;
    } else {
      try { await adapter.create(path, content); return updated; }
      catch (error) {
        const refreshed = await adapter.refresh();
        if (!refreshed.files.some(file => file.path === path)) throw error;
      }
    }
  }
  throw new Error('评论同时被修改，请稍后重试；输入内容仍保留');
}

export function visibleThreads(file: CommentFile): CommentThread[] {
  return file.threads.filter(thread => !thread.detached);
}
