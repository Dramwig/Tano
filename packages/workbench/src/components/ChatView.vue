<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import {
  ArrowUp,
  Bot,
  MessageCircle,
  MessageSquare,
  PanelLeftOpen,
  Sparkles,
  UserPlus,
  Users,
} from 'lucide-vue-next';
import { chatBots } from '../chat';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();
const emit = defineEmits<{ 'show-list': [] }>();
const messages = ref<HTMLElement>();
const showMembers = ref(false);
const draft = computed({
  get: () => chat.drafts[chat.selectedId] ?? '',
  set: (value) => {
    if (chat.active) chat.drafts[chat.selectedId] = value;
  },
});
const activeBot = computed(() => chatBots.find((bot) => `bot:${bot.id}` === chat.selectedId));
const memberNames = computed(
  () =>
    chat.active?.members.map(
      (id) => chat.contacts.find((contact) => contact.id === id)?.name ?? '未知联系人',
    ) ?? [],
);
const senderName = (sender: string) =>
  sender === 'self'
    ? '我'
    : (chat.contacts.find((contact) => contact.id === sender)?.name ?? '示例联系人');
const time = (value: number) =>
  new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit' }).format(value);
watch(
  () => [chat.selectedId, chat.active?.messages.length],
  async () => {
    await nextTick();
    messages.value?.scrollTo?.({ top: messages.value.scrollHeight });
  },
  { immediate: true },
);
watch(
  () => chat.selectedId,
  () => {
    showMembers.value = false;
  },
);
function keydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
    event.preventDefault();
    chat.send();
  }
}
</script>

<template>
  <main class="chat-page" aria-label="聊天页面">
    <div class="chat-preview-notice">
      <span>本地演示</span>
      <p>消息不会发送给他人；联系人、消息和草稿仅保留到本窗口刷新或关闭。</p>
    </div>
    <template v-if="chat.active">
      <header class="chat-heading">
        <button
          class="icon-button chat-show-list"
          type="button"
          aria-label="查看会话列表"
          title="查看会话列表"
          @click="emit('show-list')"
        >
          <PanelLeftOpen :size="18" />
        </button>
        <span class="chat-heading-avatar"
          ><Users v-if="chat.active.kind === 'group'" :size="22" /><Bot
            v-else-if="chat.active.kind === 'bot'"
            :size="22"
          /><template v-else>{{ chat.active.name.slice(0, 1) }}</template></span
        >
        <div>
          <h1>{{ chat.active.name }}</h1>
          <p>
            {{
              chat.active.kind === 'group'
                ? `群聊 · ${chat.active.members.length + 1} 位演示成员`
                : chat.active.kind === 'bot'
                  ? '机器人 · 尚未接入'
                  : '私聊 · 演示联系人'
            }}
          </p>
        </div>
        <button
          v-if="chat.active.kind === 'group'"
          class="icon-button chat-members-button"
          type="button"
          aria-label="查看群成员"
          title="查看群成员"
          :aria-expanded="showMembers"
          @click="showMembers = !showMembers"
        >
          <Users :size="19" />
        </button>
      </header>
      <div v-if="showMembers" class="chat-members">
        <strong>群成员</strong><span>我</span
        ><span v-for="(name, index) in memberNames" :key="index">{{ name }}</span>
      </div>
      <section v-if="activeBot" class="chat-bot-intro">
        <div class="chat-welcome-icon"><Bot :size="32" :stroke-width="1.4" /></div>
        <h2>{{ activeBot.name }}</h2>
        <p>{{ activeBot.description }}</p>
        <div class="chat-bot-status">{{ activeBot.capability }}</div>
        <div class="chat-assistant-note">
          <Sparkles :size="17" />
          <div>
            <strong>接下来的「助手」</strong>
            <p>
              与 AI
              对话、处理本地文件和执行任务，将使用独立的助手工作台，集中查看执行进度与文件改动。
            </p>
          </div>
        </div>
      </section>
      <template v-else>
        <div
          ref="messages"
          class="chat-messages"
          role="log"
          aria-label="会话消息"
          aria-live="polite"
          aria-relevant="additions text"
        >
          <p class="chat-conversation-start">
            {{ chat.active.messages.length ? '以下为本地演示消息' : '对话从这里开始' }}
          </p>
          <article
            v-for="message in chat.active.messages"
            :key="message.id"
            class="chat-message"
            :class="{ self: message.sender === 'self' }"
          >
            <span class="chat-message-avatar" aria-hidden="true">{{
              senderName(message.sender).slice(0, 1)
            }}</span>
            <div class="chat-message-content">
              <div class="chat-message-meta">
                <span>{{ senderName(message.sender) }}</span
                ><time :datetime="new Date(message.createdAt).toISOString()">{{
                  time(message.createdAt)
                }}</time>
              </div>
              <p>{{ message.text }}</p>
              <small v-if="message.sender === 'self'">仅本地 · 未发送</small>
            </div>
          </article>
        </div>
        <form class="chat-compose" @submit.prevent="chat.send()">
          <textarea
            v-model="draft"
            aria-label="消息内容"
            placeholder="写下消息…"
            maxlength="4000"
            rows="3"
            @keydown="keydown"
          />
          <div class="chat-compose-footer">
            <span>Enter 发送到演示 · Shift Enter 换行</span
            ><small v-if="draft.length > 3500">{{ draft.length }}/4000</small
            ><button
              type="submit"
              class="chat-send"
              :disabled="!draft.trim() || draft.trim().length > 4000"
              aria-label="发送演示消息"
              title="发送演示消息"
            >
              <ArrowUp :size="18" />
            </button>
          </div>
        </form>
      </template>
    </template>
    <section v-else class="chat-welcome">
      <div class="chat-welcome-content">
        <div class="chat-welcome-icon"><MessageSquare :size="34" :stroke-width="1.3" /></div>
        <p class="chat-eyebrow">在同一页，也在同一段对话里</p>
        <h1>让交流，自然发生</h1>
        <p class="chat-welcome-description">
          和伙伴聊想法，和团队推进事情。<br />从一段对话开始，把工作连接起来。
        </p>
        <div class="chat-welcome-actions">
          <button type="button" @click="chat.dialog = 'contact'">
            <UserPlus :size="21" :stroke-width="1.5" /><strong>添加好友</strong
            ><span>连接你的伙伴</span>
          </button>
          <button type="button" @click="chat.dialog = 'group'">
            <Users :size="21" :stroke-width="1.5" /><strong>发起群聊</strong
            ><span>一起讨论与协作</span>
          </button>
          <button
            type="button"
            @click="
              chat.section = 'bots';
              emit('show-list');
            "
          >
            <Bot :size="21" :stroke-width="1.5" /><strong>发现机器人</strong
            ><span>通知与智能问答</span>
          </button>
        </div>
        <button
          v-if="!chat.demoLoaded"
          type="button"
          class="chat-demo-link"
          @click="chat.loadDemo()"
        >
          <MessageCircle :size="14" />先体验示例会话<span aria-hidden="true">→</span>
        </button>
        <button v-else type="button" class="chat-demo-link" @click="emit('show-list')">
          从左侧选择一段会话<span aria-hidden="true">→</span>
        </button>
        <p class="chat-welcome-footnote">好友申请、实时消息与机器人服务尚未接入。</p>
      </div>
    </section>
  </main>
</template>

<style scoped>
.chat-page {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--paper);
}
.chat-preview-notice {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 10px;
  padding: 10px 24px;
  background: var(--surface);
  border-bottom: 1px solid var(--line);
  font-size: 11px;
  color: var(--muted);
}
.chat-preview-notice > span {
  padding: 2px 6px;
  border: 1px solid var(--line);
  border-radius: 4px;
  white-space: nowrap;
  color: var(--text-secondary);
}
.chat-preview-notice p {
  margin: 0;
  line-height: 1.7;
}
.chat-heading {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
  min-height: 79px;
  padding: 16px 28px;
  border-bottom: 1px solid var(--line);
}
.chat-heading > div {
  min-width: 0;
}
.chat-heading h1 {
  font-size: 15px;
  font-weight: 600;
  margin: 0 0 5px;
  overflow-wrap: anywhere;
}
.chat-heading p {
  font-size: 11px;
  margin: 0;
  color: var(--muted);
}
.chat-heading-avatar {
  display: grid;
  width: 39px;
  height: 39px;
  flex-shrink: 0;
  border-radius: 12px;
  place-items: center;
  color: var(--green);
  background: var(--accent);
}
.chat-members-button {
  margin-left: auto;
  flex-shrink: 0;
}
.chat-show-list {
  display: none;
}
.chat-members {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  padding: 14px 28px;
  border-bottom: 1px solid var(--line);
  font-size: 12px;
  max-height: 140px;
  overflow-y: auto;
}
.chat-members strong {
  color: var(--muted);
  font-weight: 500;
}
.chat-members span {
  padding: 5px 9px;
  border-radius: 6px;
  background: var(--surface);
  overflow-wrap: anywhere;
}
.chat-welcome {
  display: grid;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  place-items: center;
  padding: 40px 24px;
}
.chat-welcome-content {
  width: min(100%, 560px);
  text-align: center;
}
.chat-welcome-icon {
  display: grid;
  width: 68px;
  height: 68px;
  margin: 0 auto 25px;
  place-items: center;
  background: var(--accent);
  color: var(--green);
  border-radius: 22px;
}
.chat-eyebrow {
  font-size: 11px;
  color: var(--green);
  letter-spacing: 1.5px;
  margin: 0 0 14px;
}
.chat-welcome h1 {
  margin: 0 0 18px;
  font-weight: 550;
  font-size: 28px;
  letter-spacing: 1px;
}
.chat-welcome-description {
  margin: 0;
  font-size: 13px;
  line-height: 1.9;
  color: var(--muted);
}
.chat-welcome-actions {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  margin: 36px 0 24px;
}
.chat-welcome-actions button {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 20px 18px;
  border: 1px solid var(--line);
  border-radius: 10px;
  text-align: left;
}
.chat-welcome-actions button:hover {
  border-color: var(--green);
  background: var(--accent);
}
.chat-welcome-actions svg {
  color: var(--green);
  margin-bottom: 20px;
}
.chat-welcome-actions strong {
  font-size: 13px;
  font-weight: 500;
  margin-bottom: 7px;
}
.chat-welcome-actions span {
  font-size: 11px;
  color: var(--muted);
}
.chat-demo-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px;
  font-size: 12px;
  color: var(--green);
}
.chat-demo-link:hover {
  text-decoration: underline;
}
.chat-welcome-footnote {
  margin: 24px 0 0;
  font-size: 11px;
  line-height: 1.8;
  color: var(--muted);
}
.chat-messages {
  flex: 1;
  min-height: 0;
  padding: 20px 30px;
  overflow-y: auto;
}
.chat-conversation-start {
  text-align: center;
  color: var(--muted);
  font-size: 11px;
  margin: 4px 0 28px;
}
.chat-message {
  display: flex;
  gap: 10px;
  margin: 0 0 24px;
}
.chat-message.self {
  flex-direction: row-reverse;
}
.chat-message-avatar {
  display: grid;
  flex: 0 0 32px;
  height: 32px;
  place-items: center;
  border-radius: 9px;
  background: var(--surface);
  color: var(--text-secondary);
  font-size: 12px;
}
.self .chat-message-avatar {
  background: var(--accent);
  color: var(--green);
}
.chat-message-content {
  max-width: min(78%, 620px);
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
}
.self .chat-message-content {
  align-items: flex-end;
}
.chat-message-meta {
  display: flex;
  gap: 9px;
  color: var(--muted);
  font-size: 10px;
  margin-bottom: 7px;
}
.chat-message-content p {
  margin: 0;
  padding: 11px 14px;
  border-radius: 0 10px 10px;
  background: var(--surface);
  color: var(--text);
  font-size: 13px;
  line-height: 1.8;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
}
.self .chat-message-content p {
  border-radius: 10px 0 10px 10px;
  background: var(--accent);
}
.chat-message-content small {
  margin-top: 6px;
  color: var(--muted);
  font-size: 10px;
}
.chat-compose {
  margin: 0 28px 24px;
  border: 1px solid var(--control-border);
  border-radius: 10px;
  padding: 13px 14px 10px;
  flex-shrink: 0;
}
.chat-compose:focus-within {
  border-color: var(--green);
}
.chat-compose textarea {
  display: block;
  width: 100%;
  resize: none;
  max-height: 180px;
  border: 0;
  background: transparent;
  outline: 0;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  line-height: 1.8;
}
.chat-compose-footer {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 8px;
  color: var(--muted);
  font-size: 10px;
}
.chat-compose-footer small {
  margin-left: auto;
}
.chat-send {
  display: grid;
  width: 29px;
  height: 29px;
  flex-shrink: 0;
  margin-left: auto;
  border-radius: 7px;
  place-items: center;
  color: white;
  background: var(--green-fill);
}
.chat-send:disabled {
  opacity: 0.35;
}
.chat-bot-intro {
  flex: 1;
  min-height: 0;
  padding: 56px 24px;
  overflow-y: auto;
  text-align: center;
}
.chat-bot-intro h2 {
  font-size: 20px;
  font-weight: 500;
}
.chat-bot-intro > p {
  color: var(--muted);
  font-size: 13px;
}
.chat-bot-status {
  display: inline-block;
  margin: 20px 0;
  padding: 12px 16px;
  border-radius: 7px;
  background: var(--surface);
  font-size: 12px;
  color: var(--muted);
  line-height: 1.8;
}
.chat-assistant-note {
  display: flex;
  gap: 11px;
  max-width: 430px;
  padding-top: 24px;
  border-top: 1px solid var(--line);
  margin: 32px auto 0;
  text-align: left;
  color: var(--muted);
}
.chat-assistant-note > svg {
  flex-shrink: 0;
  color: var(--green);
}
.chat-assistant-note strong {
  color: var(--text-secondary);
  font-weight: 500;
  font-size: 12px;
}
.chat-assistant-note p {
  font-size: 12px;
  line-height: 1.8;
  margin-bottom: 0;
}
@media (max-width: 700px) {
  .chat-preview-notice {
    padding: 9px 12px;
    align-items: flex-start;
    font-size: 10px;
  }
  .chat-heading {
    padding: 14px 12px;
    gap: 9px;
  }
  .chat-show-list {
    display: grid;
  }
  .chat-welcome {
    padding: 28px 18px;
  }
  .chat-welcome h1 {
    font-size: 24px;
  }
  .chat-welcome-actions {
    gap: 7px;
    margin-top: 28px;
  }
  .chat-welcome-actions button {
    padding: 16px 10px;
  }
  .chat-welcome-actions span {
    font-size: 10px;
    line-height: 1.6;
  }
  .chat-messages {
    padding: 18px 12px;
  }
  .chat-message-content {
    max-width: 82%;
  }
  .chat-compose {
    margin: 0 12px 12px;
  }
  .chat-compose-footer > span {
    max-width: 210px;
    line-height: 1.6;
  }
}
</style>
