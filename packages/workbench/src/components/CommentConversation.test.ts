// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive, ref } from 'vue';
import type { CommentThread } from '@tano/protocol';
import CommentConversation from './CommentConversation.vue';

let app: ReturnType<typeof createApp> | undefined;
let root: HTMLDivElement | undefined;
afterEach(() => { app?.unmount(); root?.remove(); });

it('identifies an earlier secondary comment as the reply target and reflects edits without guessing legacy targets', async () => {
  const thread = reactive<CommentThread>({
    id: 'thread-001', resolved: false, detached: false, createdAt: 0,
    messages: [
      { id: 'thread-001', authorId: 'alice', authorName: 'Alice', body: '主评论', createdAt: 0 },
      { id: 'reply-0001', authorId: 'bob', authorName: 'Bob', body: '第一条回复', createdAt: 0, replyTo: 'thread-001' },
      { id: 'reply-0002', authorId: 'grace', authorName: 'Grace', body: '另一条回复', createdAt: 0, replyTo: 'thread-001' },
      { id: 'reply-0003', authorId: 'alice', authorName: 'Alice', body: '回复 Bob', createdAt: 0, replyTo: 'reply-0001' },
      { id: 'reply-0004', authorId: 'alice', authorName: 'Alice', body: '没有记录目标的旧回复', createdAt: 0 },
    ],
  });
  const local = ref(false);
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(defineComponent(() => () => h(CommentConversation, {
    thread, local: local.value, readonly: true, busy: false, authorId: 'alice', authorName: 'Alice',
  })));
  app.mount(root);
  const messages = () => [...root!.querySelectorAll('.comment-message')];
  const reference = () => messages()[3]!.querySelector('.comment-reply-reference');
  expect(reference()?.textContent).toContain('回复 Bob：');
  expect(reference()?.textContent).toContain('第一条回复');
  expect(reference()?.textContent).not.toContain('另一条回复');
  expect(reference()?.textContent).not.toContain('主评论');
  expect(reference()?.getAttribute('title')).toBe('回复 Bob：第一条回复');
  expect(messages()[0]!.querySelector('.comment-reply-reference')).toBeNull();
  expect(messages()[4]!.querySelector('.comment-reply-reference')).toBeNull();

  thread.messages[1]!.body = '已修改的回复';
  await nextTick();
  expect(reference()?.textContent).toContain('已修改的回复');
  expect(reference()?.getAttribute('title')).toBe('回复 Bob：已修改的回复');

  local.value = true;
  await nextTick();
  expect(root.querySelector('.comment-reply-reference')).toBeNull();
  local.value = false;
  thread.messages.splice(1, 1);
  await nextTick();
  expect(messages()[2]!.querySelector('.comment-reply-reference')).toBeNull();
});
