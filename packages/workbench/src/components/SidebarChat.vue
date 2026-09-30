<script setup lang="ts">
import { computed } from 'vue';
import { Bot, MessageCircle, Plus, Search, UserPlus, Users } from 'lucide-vue-next';
import { chatBots } from '../chat';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();
const emit = defineEmits<{ open: [] }>();
const sections = [
  { id: 'messages', label: '消息' },
  { id: 'contacts', label: '联系人' },
  { id: 'bots', label: '机器人' },
] as const;
const matches = (...values: string[]) =>
  values.some((value) => value.toLocaleLowerCase().includes(chat.query.trim().toLocaleLowerCase()));
const conversations = computed(() =>
  chat.orderedConversations.filter((item) => matches(item.name, item.messages.at(-1)?.text ?? '')),
);
const contacts = computed(() => chat.contacts.filter((item) => matches(item.name, item.account)));
const bots = computed(() => chatBots.filter((item) => matches(item.name, item.description)));
function open(action: () => void) {
  action();
  emit('open');
}
</script>

<template>
  <section class="chat-sidebar" aria-label="聊天列表">
    <div class="section-label">
      <span>聊天</span>
      <div>
        <button
          class="icon-button"
          type="button"
          aria-label="添加好友"
          title="添加好友"
          @click="chat.dialog = 'contact'"
        >
          <UserPlus :size="16" />
        </button>
        <button
          class="icon-button"
          type="button"
          aria-label="发起群聊"
          title="发起群聊"
          @click="chat.dialog = 'group'"
        >
          <Plus :size="17" />
        </button>
      </div>
    </div>
    <label class="chat-search"
      ><Search :size="14" aria-hidden="true" /><input
        v-model="chat.query"
        type="search"
        aria-label="搜索聊天或联系人"
        placeholder="搜索聊天或联系人"
    /></label>
    <div class="chat-sections" role="group" aria-label="聊天分类">
      <button
        v-for="item in sections"
        :key="item.id"
        type="button"
        :aria-pressed="chat.section === item.id"
        @click="chat.section = item.id"
      >
        {{ item.label }}
      </button>
    </div>
    <div class="chat-list">
      <template v-if="chat.section === 'messages'">
        <button
          v-for="item in conversations"
          :key="item.id"
          type="button"
          class="chat-list-item"
          :aria-pressed="chat.selectedId === item.id"
          @click="open(() => chat.select(item.id))"
        >
          <span class="chat-avatar" :class="item.kind" aria-hidden="true"
            ><Users v-if="item.kind === 'group'" :size="17" /><Bot
              v-else-if="item.kind === 'bot'"
              :size="17"
            /><template v-else>{{ item.name.slice(0, 1) }}</template></span
          >
          <span class="chat-list-copy"
            ><strong>{{ item.name }}</strong
            ><small>{{
              chat.drafts[item.id]
                ? `[草稿] ${chat.drafts[item.id]}`
                : item.messages.at(-1)?.text || (item.kind === 'bot' ? '尚未接入' : '开始一段对话')
            }}</small></span
          >
        </button>
        <div v-if="!conversations.length" class="chat-list-empty">
          <MessageCircle :size="24" :stroke-width="1.4" />
          <p>{{ chat.query ? '没有匹配的会话' : '还没有会话' }}</p>
          <span>{{ chat.query ? '试试其他关键词' : '从一位联系人开始交流' }}</span>
        </div>
      </template>
      <template v-else-if="chat.section === 'contacts'">
        <button class="chat-add-contact" type="button" @click="chat.dialog = 'contact'">
          <UserPlus :size="16" />添加好友
        </button>
        <button
          v-for="item in contacts"
          :key="item.id"
          type="button"
          class="chat-list-item"
          @click="open(() => chat.openDirect(item.id))"
        >
          <span class="chat-avatar direct" aria-hidden="true">{{ item.name.slice(0, 1) }}</span
          ><span class="chat-list-copy"
            ><strong>{{ item.name }}</strong
            ><small>{{ item.account }}</small></span
          >
        </button>
        <div v-if="!contacts.length" class="chat-list-empty">
          <Users :size="24" :stroke-width="1.4" />
          <p>{{ chat.query ? '没有匹配的联系人' : '联系人会出现在这里' }}</p>
          <span>当前仅支持添加演示联系人</span>
        </div>
      </template>
      <template v-else>
        <button
          v-for="item in bots"
          :key="item.id"
          type="button"
          class="chat-list-item"
          :aria-pressed="chat.selectedId === `bot:${item.id}`"
          @click="open(() => chat.openBot(item.id))"
        >
          <span class="chat-avatar bot" aria-hidden="true"><Bot :size="18" /></span
          ><span class="chat-list-copy"
            ><strong>{{ item.name }}</strong
            ><small>尚未接入</small></span
          >
        </button>
        <div v-if="!bots.length" class="chat-list-empty"><p>没有匹配的机器人</p></div>
      </template>
    </div>
    <p class="chat-sidebar-note"><span />本地演示 · 未联网</p>
  </section>
</template>

<style scoped>
.chat-sidebar {
  display: flex;
  flex: 1;
  min-height: 0;
  flex-direction: column;
  margin-top: 6px;
}
.chat-search {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 8px 9px;
  margin: 5px 0 12px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--muted);
  background: var(--paper);
}
.chat-search:focus-within {
  border-color: var(--green);
}
.chat-search input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
}
.chat-sections {
  display: flex;
  gap: 3px;
  padding-bottom: 12px;
}
.chat-sections button {
  flex: 1;
  padding: 6px 2px;
  font-size: 12px;
  border-radius: 6px;
  color: var(--muted);
  white-space: nowrap;
}
.chat-sections button[aria-pressed='true'] {
  color: var(--text);
  background: var(--hover);
  font-weight: 600;
}
.chat-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.chat-list-item {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 9px;
  padding: 11px 6px;
  border-radius: 7px;
  text-align: left;
}
.chat-list-item:hover,
.chat-add-contact:hover {
  background: var(--hover);
}
.chat-list-item[aria-pressed='true'] {
  background: var(--accent);
}
.chat-avatar {
  display: grid;
  flex: 0 0 34px;
  height: 34px;
  place-items: center;
  border-radius: 10px;
  background: var(--hover);
  color: var(--text-secondary);
  font-size: 14px;
}
.chat-avatar.group {
  background: var(--accent);
  color: var(--green);
}
.chat-avatar.bot {
  background: var(--surface);
  color: var(--syntax-purple);
  border: 1px solid var(--line);
}
.chat-list-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
}
.chat-list-copy strong,
.chat-list-copy small {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chat-list-copy strong {
  font-size: 13px;
  font-weight: 500;
}
.chat-list-copy small {
  font-size: 11px;
  color: var(--muted);
  line-height: 1.5;
}
.chat-add-contact {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 11px 8px;
  margin-bottom: 6px;
  border-radius: 7px;
  font-size: 12px;
  color: var(--green);
}
.chat-list-empty {
  padding: 32px 6px;
  text-align: center;
  color: var(--muted);
}
.chat-list-empty p {
  margin: 12px 0 7px;
  font-size: 12px;
}
.chat-list-empty span {
  font-size: 11px;
  line-height: 1.7;
}
.chat-sidebar-note {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 12px 3px;
  color: var(--muted);
  font-size: 10px;
}
.chat-sidebar-note span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: var(--muted);
}
</style>
