// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp, nextTick } from 'vue';
import type { App } from 'vue';
import { createPinia, disposePinia } from 'pinia';
import { useChatStore } from '../stores/chat';
import ChatView from './ChatView.vue';

let app: App;
let root: HTMLElement;
let chat: ReturnType<typeof useChatStore>;
let pinia: ReturnType<typeof createPinia>;
beforeEach(() => {
  pinia = createPinia();
  app = createApp(ChatView);
  app.use(pinia);
  chat = useChatStore(pinia);
  root = document.createElement('div');
  document.body.append(root);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  disposePinia(pinia);
  root.remove();
});

it('keeps IME confirmation and line breaks out of the send path and preserves drafts across conversations', async () => {
  chat.loadDemo();
  await nextTick();
  const groupId = chat.selectedId;
  const initial = chat.active!.messages.length;
  const input = root.querySelector('textarea')!;
  input.value = '中文输入';
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: 'Enter',
      isComposing: true,
      bubbles: true,
      cancelable: true,
    }),
  );
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true }),
  );
  expect(chat.active!.messages).toHaveLength(initial);
  chat.openDirect(chat.contacts[0]!.id);
  await nextTick();
  expect(input.value).toBe('');
  chat.select(groupId);
  await nextTick();
  expect(input.value).toBe('中文输入');
  input.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }),
  );
  await nextTick();
  expect(root.querySelector('[role=log]')!.textContent).toContain('中文输入');
  expect(root.textContent).toContain('仅本地 · 未发送');
  expect(input.value).toBe('');
});

it('renders user text literally and makes disconnected bots non-sendable', async () => {
  chat.loadDemo();
  chat.drafts[chat.selectedId] = '<img src=x onerror=alert(1)>';
  chat.send();
  await nextTick();
  expect(root.querySelector('[role=log] img')).toBeNull();
  expect(root.querySelector('[role=log]')!.textContent).toContain('<img src=x onerror=alert(1)>');
  chat.openBot('qa');
  await nextTick();
  expect(root.textContent).toContain('尚未连接模型服务');
  expect(root.querySelector('textarea')).toBeNull();
});
