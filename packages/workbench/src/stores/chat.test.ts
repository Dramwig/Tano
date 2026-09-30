import { beforeEach, expect, it } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import { useChatStore } from './chat';

beforeEach(() => setActivePinia(createPinia()));

it('validates contact identities and reuses private conversations without losing drafts', () => {
  const chat = useChatStore();
  const one = chat.addContact(' 林一 ', ' Lin.Example ');
  const two = chat.addContact('夏木', 'xia.example');
  expect(() => chat.addContact('重复', 'lin.example')).toThrow('已在演示联系人');
  expect(() => chat.addContact('空格', 'invalid id')).toThrow('不能包含空格');
  const direct = chat.openDirect(one.id);
  chat.drafts[direct.id] = '未完成的想法';
  chat.openDirect(two.id);
  chat.openDirect(one.id);
  expect(chat.conversations).toHaveLength(2);
  expect(chat.drafts[chat.selectedId]).toBe('未完成的想法');
  expect(chat.send()).toBe(true);
  expect(chat.active?.messages[0]?.text).toBe('未完成的想法');
  expect(chat.drafts[chat.selectedId]).toBe('');
  expect(chat.send()).toBe(false);
});

it('requires distinct existing group members and keeps local messages isolated by conversation', () => {
  const chat = useChatStore();
  const one = chat.addContact('林一', 'lin');
  const two = chat.addContact('夏木', 'xia');
  expect(() => chat.createGroup('讨论', [one.id, one.id])).toThrow('至少选择两位');
  expect(() => chat.createGroup('讨论', [one.id, 'missing'])).toThrow('已不存在');
  const group = chat.createGroup(' 讨论 ', [one.id, two.id, one.id]);
  expect(group.members).toEqual([one.id, two.id]);
  chat.drafts[group.id] = '群里的消息';
  chat.send();
  chat.openDirect(one.id);
  expect(chat.active?.messages).toEqual([]);
  chat.drafts[chat.selectedId] = 'x'.repeat(4001);
  expect(chat.send()).toBe(false);
  expect(chat.drafts[chat.selectedId]).toHaveLength(4001);
});

it('does not send to disconnected bots and loads examples only on request', () => {
  const chat = useChatStore();
  expect(chat.contacts).toEqual([]);
  expect(chat.conversations).toEqual([]);
  chat.openBot('qa');
  chat.drafts[chat.selectedId] = '不会发送';
  expect(chat.send()).toBe(false);
  expect(chat.active?.messages).toEqual([]);
  chat.loadDemo();
  chat.loadDemo();
  expect(chat.contacts).toHaveLength(2);
  expect(chat.conversations).toHaveLength(3);
  setActivePinia(createPinia());
  expect(useChatStore().contacts).toEqual([]);
});
