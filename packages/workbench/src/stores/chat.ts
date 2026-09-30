import { computed, ref } from 'vue';
import { defineStore } from 'pinia';
import { chatBots } from '../chat';
import type { ChatContact, ChatConversation } from '../chat';

// Deliberately session-only: this preview never invokes a workspace adapter or
// pretends to deliver messages. A future communication service owns account data.
export const useChatStore = defineStore('chat-preview', () => {
  const contacts = ref<ChatContact[]>([]);
  const conversations = ref<ChatConversation[]>([]);
  const selectedId = ref('');
  const section = ref<'messages' | 'contacts' | 'bots'>('messages');
  const query = ref('');
  const drafts = ref<Record<string, string>>({});
  const dialog = ref<'contact' | 'group' | null>(null);
  const active = computed(() => conversations.value.find((item) => item.id === selectedId.value));
  const orderedConversations = computed(() =>
    [...conversations.value].sort((a, b) => b.updatedAt - a.updatedAt),
  );
  const demoLoaded = ref(false);

  function select(id: string) {
    if (conversations.value.some((item) => item.id === id)) selectedId.value = id;
  }
  function addContact(name: string, account: string) {
    name = name.trim();
    account = account.trim();
    if (!name || name.length > 40) throw new Error('请填写 1–40 字的联系人名称。');
    if (!/^[\p{L}\p{N}_.@+-]{2,80}$/u.test(account))
      throw new Error('账号需为 2–80 个字母、数字或 _ . @ + -，不能包含空格。');
    if (
      contacts.value.some(
        (item) => item.account.toLocaleLowerCase() === account.toLocaleLowerCase(),
      )
    )
      throw new Error('这个账号已在演示联系人中。');
    const contact = { id: crypto.randomUUID(), name, account };
    contacts.value.push(contact);
    return contact;
  }
  function openDirect(contactId: string) {
    const contact = contacts.value.find((item) => item.id === contactId);
    if (!contact) throw new Error('联系人不存在。');
    let conversation = conversations.value.find(
      (item) => item.kind === 'direct' && item.members.includes(contactId),
    );
    if (!conversation) {
      conversation = {
        id: crypto.randomUUID(),
        kind: 'direct',
        name: contact.name,
        members: [contactId],
        messages: [],
        updatedAt: Date.now(),
      };
      conversations.value.push(conversation);
    }
    selectedId.value = conversation.id;
    return conversation;
  }
  function createGroup(name: string, members: string[]) {
    name = name.trim();
    const unique = [...new Set(members)];
    if (!name || name.length > 40) throw new Error('请填写 1–40 字的群名称。');
    if (unique.length < 2) throw new Error('请至少选择两位联系人。');
    if (unique.some((id) => !contacts.value.some((contact) => contact.id === id)))
      throw new Error('所选联系人已不存在，请重新选择。');
    const conversation: ChatConversation = {
      id: crypto.randomUUID(),
      kind: 'group',
      name,
      members: unique,
      messages: [],
      updatedAt: Date.now(),
    };
    conversations.value.push(conversation);
    selectedId.value = conversation.id;
    section.value = 'messages';
    query.value = '';
    return conversation;
  }
  function openBot(botId: string) {
    const bot = chatBots.find((item) => item.id === botId);
    if (!bot) return;
    const id = `bot:${bot.id}`;
    if (!conversations.value.some((item) => item.id === id))
      conversations.value.push({
        id,
        kind: 'bot',
        name: bot.name,
        members: [],
        messages: [],
        updatedAt: Date.now(),
      });
    selectedId.value = id;
  }
  function send() {
    const conversation = active.value;
    if (!conversation || conversation.kind === 'bot') return false;
    const text = (drafts.value[conversation.id] ?? '').trim();
    if (!text || text.length > 4000) return false;
    const now = Date.now();
    conversation.messages.push({ id: crypto.randomUUID(), sender: 'self', text, createdAt: now });
    conversation.updatedAt = now;
    drafts.value[conversation.id] = '';
    return true;
  }
  function loadDemo() {
    if (demoLoaded.value) return;
    const exampleContact = (name: string, account: string) =>
      contacts.value.find((item) => item.account.toLocaleLowerCase() === account) ??
      addContact(name, account);
    const lin = exampleContact('林一', 'lin.example');
    const xia = exampleContact('夏木', 'xia.example');
    const direct = openDirect(lin.id);
    direct.messages.push({
      id: crypto.randomUUID(),
      sender: lin.id,
      text: '这是示例消息。以后可以在这里交流想法，再回到同一页一起完成。',
      createdAt: Date.now(),
    });
    const group = createGroup('同页交流小组', [lin.id, xia.id]);
    group.messages.push({
      id: crypto.randomUUID(),
      sender: xia.id,
      text: '欢迎来到同页交流小组。这是本地演示，消息不会发送给任何人。',
      createdAt: Date.now(),
    });
    demoLoaded.value = true;
  }
  return {
    contacts,
    conversations,
    selectedId,
    section,
    query,
    drafts,
    dialog,
    active,
    orderedConversations,
    demoLoaded,
    select,
    addContact,
    openDirect,
    createGroup,
    openBot,
    send,
    loadDemo,
  };
});
