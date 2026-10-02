// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { commentDataPath } from '@tano/protocol';
import { DemoAdapter } from './adapter';
import { applyCommentChange, loadCommentFile, saveCommentChange } from './workspace-comments';
import { emptyCommentFile, isObjectPath, parseCommentFile } from '@tano/protocol';

it('stores explicit person mentions and precise reply targets, retaining portable identity on edits', () => {
  const author = { id: 'reviewer', name: 'Reviewer' };
  let file = applyCommentChange(emptyCommentFile('discussion', 'a0b1c2'), { type: 'start', id: 'thread-001', body: 'Root', author });
  file = applyCommentChange(file, { type: 'reply', threadId: 'thread-001', id: 'reply-0001', body: '@Alice hello', author,
    replyTo: 'thread-001', mentions: [{ personId: 'a00001', text: '@Alice' }] });
  expect(parseCommentFile(JSON.stringify(file), 'discussion', 'a0b1c2').threads[0]?.messages[1]).toMatchObject({ replyTo: 'thread-001', mentions: [{ personId: 'a00001', text: '@Alice' }] });
  file = applyCommentChange(file, { type: 'reply', threadId: 'thread-001', id: 'reply-0002', body: 'Nested', author, replyTo: 'reply-0001' });
  file = applyCommentChange(file, { type: 'edit', threadId: 'thread-001', messageId: 'reply-0001', expectedBody: '@Alice hello', body: 'hello', authorId: 'reviewer' });
  expect(file.threads[0]?.messages[1]?.mentions).toEqual([]);
  file = applyCommentChange(file, { type: 'delete', threadId: 'thread-001', messageId: 'reply-0001', expectedBody: 'hello', authorId: 'reviewer' });
  expect(file.threads[0]?.messages[1]?.replyTo).toBeUndefined();
  expect(isObjectPath('.tano/discussions/a0b1c2.tano.json')).toBe(false);
  expect(isObjectPath('.tano/annotations/a0b1c2.tano.json')).toBe(false);
  expect(isObjectPath('.tano/objects/a0b1c2.tano.json')).toBe(true);
});

beforeEach(() => localStorage.clear());

it('persists local annotations and separate document discussions under .tano', async () => {
  const adapter = new DemoAdapter();
  const fileId = 'a0b1c2';
  const author = { id: 'user-1', name: '审阅者' };
  const anchor = { basis: 'prose' as const, baseHash: 'hash', prefix: '', suffix: '',
    spans: [{ from: 0, to: 2, text: '正文' }] };
  await saveCommentChange(adapter, 'annotation', fileId,
    { type: 'start', id: 'thread-1', body: '这里要改', author, anchor });
  await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'start', id: 'thread-2', body: '整体方向', author });
  await saveCommentChange(adapter, 'annotation', fileId,
    { type: 'reply', threadId: 'thread-1', id: 'reply-001', body: '已确认', author });
  const annotations = (await loadCommentFile(adapter, 'annotation', fileId)).file;
  const discussions = (await loadCommentFile(adapter, 'discussion', fileId)).file;
  expect(annotations.threads[0]?.messages.map(message => message.body)).toEqual(['这里要改', '已确认']);
  expect(discussions.threads[0]?.anchor).toBeUndefined();
  expect((await adapter.refresh()).files.map(file => file.path)).toContain(commentDataPath('annotation', fileId));
  expect((await adapter.refresh()).files.map(file => file.path)).toContain(commentDataPath('discussion', fileId));
});

it('preserves two concurrent replies after a compare-and-write conflict', async () => {
  const adapter = new DemoAdapter();
  const fileId = 'a0b1c2';
  const author = { id: 'user-1', name: '审阅者' };
  await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'start', id: 'thread-1', body: '讨论', author });
  await Promise.all([
    saveCommentChange(adapter, 'discussion', fileId,
      { type: 'reply', threadId: 'thread-1', id: 'reply-001', body: '第一条', author }),
    saveCommentChange(adapter, 'discussion', fileId,
      { type: 'reply', threadId: 'thread-1', id: 'reply-002', body: '第二条', author }),
  ]);
  const file = (await loadCommentFile(adapter, 'discussion', fileId)).file;
  expect(file.threads[0]?.messages.map(message => message.body).sort()).toEqual(['第一条', '第二条', '讨论'].sort());
});

it('detaches an annotation while keeping its conversation in history', async () => {
  const adapter = new DemoAdapter();
  const fileId = 'a0b1c2';
  const author = { id: 'user-1', name: '审阅者' };
  const anchor = { basis: 'source' as const, baseHash: 'old', prefix: '', suffix: '',
    spans: [{ from: 0, to: 2, text: '正文' }] };
  await saveCommentChange(adapter, 'annotation', fileId,
    { type: 'start', id: 'thread-1', body: '需要修改', author, anchor });
  const file = await saveCommentChange(adapter, 'annotation', fileId,
    { type: 'reanchor', threadId: 'thread-1', expectedBaseHash: 'old', anchor: null });
  expect(file.threads[0]?.detached).toBe(true);
  expect(file.threads[0]?.messages[0]?.body).toBe('需要修改');
});

it('edits and deletes messages without discarding independent replies or concurrent edits', async () => {
  const adapter = new DemoAdapter();
  const fileId = 'a0b1c2';
  const author = { id: 'user-1', name: '审阅者' };
  await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'start', id: 'thread-1', body: '原评论', author });
  await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'reply', threadId: 'thread-1', id: 'reply-001', body: '回复', author });
  const edited = await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'edit', threadId: 'thread-1', messageId: 'thread-1', expectedBody: '原评论', body: '更新评论', authorId: author.id });
  expect(edited.threads[0]?.messages.map(item => item.body)).toEqual(['更新评论', '回复']);
  expect(edited.threads[0]?.messages[0]?.updatedAt).toEqual(expect.any(Number));
  expect(() => applyCommentChange(edited,
    { type: 'edit', threadId: 'thread-1', messageId: 'thread-1', expectedBody: '原评论', body: '覆盖', authorId: author.id }))
    .toThrow('评论已由其他编辑更新');
  expect(() => applyCommentChange(edited,
    { type: 'delete', threadId: 'thread-1', messageId: 'reply-001', expectedBody: '回复', authorId: 'other-user' }))
    .toThrow('只能编辑或删除自己发表的评论');
  const deletedReply = await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'delete', threadId: 'thread-1', messageId: 'reply-001', expectedBody: '回复', authorId: author.id });
  expect(deletedReply.threads[0]?.messages.map(item => item.body)).toEqual(['更新评论']);
  const removal = { type: 'delete' as const, threadId: 'thread-1', messageId: 'thread-1',
    expectedBody: '更新评论', authorId: author.id,
    expectedMessages: deletedReply.threads[0]!.messages.map(({ id, body }) => ({ id, body })) };
  await saveCommentChange(adapter, 'discussion', fileId,
    { type: 'reply', threadId: 'thread-1', id: 'reply-002', body: '并发回复', author });
  await expect(saveCommentChange(adapter, 'discussion', fileId, removal)).rejects.toThrow('评论或回复已变化');
  const current = (await loadCommentFile(adapter, 'discussion', fileId)).file;
  const deletedThread = await saveCommentChange(adapter, 'discussion', fileId,
    { ...removal, expectedMessages: current.threads[0]!.messages.map(({ id, body }) => ({ id, body })) });
  expect(deletedThread.threads).toEqual([]);
  expect(applyCommentChange(deletedThread, removal).threads).toEqual([]);
});
