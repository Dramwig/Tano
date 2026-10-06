<script setup lang="ts">
import './review-card.css';
import { relativeTime } from './review-time';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Bot, Check, MoreHorizontal, Pencil, Reply, RotateCcw, Trash2, UserRound, X } from 'lucide-vue-next';
import type { CommentMessage, CommentMention, CommentThread } from '@tano/protocol';
import type { CommentMessageEdit, CommentMessageRemoval } from '../workspace-comments';
import CommentComposer from './CommentComposer.vue';

const props = defineProps<{ thread: CommentThread; quote?: string; local?: boolean; preview?: boolean; readonly: boolean; busy: boolean; authorId: string; authorName: string; assistant?: boolean }>();
const emit = defineEmits<{
  expand: [];
  reply: [body: string, mentions: CommentMention[]];
  'reply-request': [message: CommentMessage];
  resolve: [resolved: boolean];
  edit: [change: CommentMessageEdit];
  remove: [change: CommentMessageRemoval];
  assistant: [];
}>();
const reply = ref('');
const replyComposer = ref<InstanceType<typeof CommentComposer>>();
const hiddenReplies = computed(() => Math.max(0, props.thread.messages.length - 2));
const replyTargets = computed(() => {
  const messages = new Map(props.thread.messages.map(message => [message.id, message]));
  const targets = new Map<string, CommentMessage>();
  for (const message of props.thread.messages) {
    const target = message.replyTo && messages.get(message.replyTo);
    if (target) targets.set(message.id, target);
  }
  return targets;
});
const editInput = ref<HTMLTextAreaElement[]>();
const editing = ref<{ id: string; body: string; base: string }>();
const menu = ref<HTMLElement>();
const menuMessage = ref<CommentMessage>();
const menuPosition = ref({ left: '0px', top: '0px' });
const removal = ref<CommentMessageRemoval>();
let menuButton: HTMLButtonElement | undefined;
function sendReply(mentions: CommentMention[] = []) {
  if (reply.value.trim()) emit('reply', reply.value, mentions);
}
function clearReply() { reply.value = ''; }
function finishEdit() { editing.value = undefined; }
async function focusReply() { await replyComposer.value?.focus(); }
defineExpose({ clearReply, finishEdit, focusReply, setReply: (body: string) => { if (reply.value.trim()) throw new Error('批注回复已有草稿，请先发布或清除'); reply.value = body; } });

async function openMenu(event: MouseEvent, message: CommentMessage) {
  if (menuMessage.value?.id === message.id) { closeMenu(); return; }
  menuButton = event.currentTarget as HTMLButtonElement;
  const rect = menuButton.getBoundingClientRect();
  menuPosition.value = {
    left: `${Math.max(8, Math.min(rect.right - 184, window.innerWidth - 192))}px`,
    top: `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 148))}px`,
  };
  removal.value = undefined;
  menuMessage.value = message;
  await nextTick();
  if (menu.value) {
    menuPosition.value = {
      left: `${Math.max(8, Math.min(rect.right - menu.value.offsetWidth, window.innerWidth - menu.value.offsetWidth - 8))}px`,
      top: `${Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.value.offsetHeight - 8))}px`,
    };
  }
  menu.value?.querySelector<HTMLButtonElement>('button')?.focus();
}
function closeMenu(restoreFocus = false) {
  menuMessage.value = undefined;
  removal.value = undefined;
  if (restoreFocus) menuButton?.focus();
}
function inviteAssistant() {
  closeMenu(true);
  emit('assistant');
}
async function editMessage() {
  const message = menuMessage.value;
  if (!message) return;
  editing.value = { id: message.id, body: message.body, base: message.body };
  closeMenu();
  await nextTick();
  const input = editInput.value?.[0];
  resizeEdit();
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);
}
function saveEdit() {
  if (props.busy || !editing.value?.body.trim()) return;
  emit('edit', { messageId: editing.value.id, body: editing.value.body, expectedBody: editing.value.base });
}
function resizeEdit() {
  const input = editInput.value?.[0];
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${Math.min(320, input.scrollHeight)}px`;
}
function cancelEdit() { if (!props.busy) finishEdit(); }
function editKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.stopPropagation();
    event.preventDefault();
    cancelEdit();
  } else if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    saveEdit();
  }
}
function prepareRemoval() {
  const message = menuMessage.value;
  if (!message) return;
  removal.value = { messageId: message.id, expectedBody: message.body,
    ...(props.thread.messages[0]?.id === message.id
      ? { expectedMessages: props.thread.messages.map(item => ({ id: item.id, body: item.body })) } : {}) };
  void nextTick(() => menu.value?.querySelector<HTMLButtonElement>('.comment-delete-confirm')?.focus());
}
function removeMessage() {
  if (removal.value) emit('remove', removal.value);
  closeMenu();
}
function outsidePointer(event: PointerEvent) {
  const target = event.target;
  if (target instanceof Node && !menu.value?.contains(target) && !menuButton?.contains(target)) closeMenu();
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
  const options = [...menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []];
  const current = options.indexOf(document.activeElement as HTMLButtonElement);
  if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 :
      (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
    options[index]?.focus();
  }
  if (event.key === 'Tab') closeMenu();
}
function closeOnLayoutChange() { closeMenu(); }
onMounted(() => {
  window.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('resize', closeOnLayoutChange);
  window.addEventListener('scroll', closeOnLayoutChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outsidePointer, true);
  window.removeEventListener('resize', closeOnLayoutChange);
  window.removeEventListener('scroll', closeOnLayoutChange, true);
});
watch(() => [props.readonly, props.authorId], () => { closeMenu(); finishEdit(); });
watch(() => props.thread.messages, messages => {
  if (menuMessage.value && !messages.some(message => message.id === menuMessage.value?.id)) closeMenu();
  if (editing.value && !messages.some(message => message.id === editing.value?.id)) finishEdit();
});
</script>

<template>
  <article class="comment-conversation" :class="{ 'is-local': local, 'is-preview': preview }" :data-comment-thread="thread.id">
    <div v-for="(message, index) in thread.messages" v-show="!preview || index === 0 || index === thread.messages.length - 1" :key="message.id" class="comment-message" :class="{ 'is-reply': index > 0 }">
      <span class="comment-avatar" :title="message.authorName"><UserRound :size="local ? 15 : 18" /></span>
      <div class="comment-message-content">
        <div class="comment-message-header">
          <div class="comment-message-meta"><strong>{{ message.authorName }}</strong>
            <time :datetime="new Date(message.createdAt).toISOString()" :title="new Date(message.createdAt).toLocaleString('zh-CN')">{{ relativeTime(message.createdAt) }}</time>
            <span v-if="message.updatedAt" class="comment-edited" :title="new Date(message.updatedAt).toLocaleString('zh-CN')">已编辑</span>
          </div>
          <slot v-if="index === 0 && $slots['first-tools']" name="first-tools" />
          <div v-else-if="!readonly && editing?.id !== message.id && (!local || index === 0 || message.authorId === authorId)" class="comment-message-tools review-card-tools" :class="{ 'is-open': menuMessage?.id === message.id }" role="group" aria-label="评论操作">
            <button v-if="!local" type="button" :disabled="busy" aria-label="回复评论" title="回复" @click="emit('reply-request', message)"><Reply :size="15" /></button>
            <button v-if="local && index === 0" type="button" :disabled="busy" :aria-label="thread.resolved ? '重新打开批注' : '完成批注'" :title="thread.resolved ? '重新打开批注' : '完成批注'" @click="emit('resolve', !thread.resolved)">
              <RotateCcw v-if="thread.resolved" :size="15" /><Check v-else :size="15" />
            </button>
            <button v-if="message.authorId === authorId || (index === 0 && assistant)" type="button" :disabled="busy" aria-label="更多评论操作" title="更多" aria-haspopup="menu" :aria-expanded="menuMessage?.id === message.id" @click="openMenu($event, message)"><MoreHorizontal :size="17" /></button>
          </div>
        </div>
        <blockquote v-if="index === 0 && quote" class="comment-quote">{{ quote }}</blockquote>
        <div v-if="!local && index > 0 && replyTargets.has(message.id)" class="comment-reply-reference"
          aria-label="回复目标" :title="`回复 ${replyTargets.get(message.id)?.authorName}：${replyTargets.get(message.id)?.body}`">
          <Reply :size="12" aria-hidden="true" />
          <span class="comment-reply-reference-author">回复 {{ replyTargets.get(message.id)?.authorName }}：</span>
          <span class="comment-reply-reference-body">{{ replyTargets.get(message.id)?.body }}</span>
        </div>
        <slot v-if="index === 0 && $slots['first-body']" name="first-body" :preview="preview" />
        <form v-else-if="editing?.id === message.id" class="comment-edit" @submit.prevent="saveEdit" @keydown="editKeydown">
          <textarea ref="editInput" v-model="editing.body" aria-label="编辑评论" rows="1" maxlength="20000" :readonly="busy" @input="resizeEdit" />
          <div class="comment-edit-actions" role="group" aria-label="编辑操作">
            <button type="button" class="comment-edit-cancel" aria-label="取消编辑" title="取消编辑" :disabled="busy" @click="cancelEdit"><X :size="13" /></button>
            <button type="submit" class="comment-edit-confirm" aria-label="确认编辑" title="确认编辑" :disabled="busy || !editing.body.trim()"><Check :size="13" /></button>
          </div>
        </form>
        <p v-else>{{ message.body }}</p>
        <button v-if="preview && index === 0 && hiddenReplies" type="button" class="comment-expand-replies" @click="emit('expand')">查看 {{ hiddenReplies }} 条回复</button>
        <div v-if="index === 0 && thread.resolved" class="comment-message-actions">
          <span>已完成</span>
        </div>
      </div>
    </div>
    <CommentComposer v-if="!readonly && local" v-show="!preview" ref="replyComposer" v-model="reply" :author-name="authorName"
      label="添加回复" :busy="busy" compact class="comment-reply-composer" @submit="sendReply" />
  </article>
  <Teleport to="body">
    <div v-if="menuMessage && !readonly" ref="menu" class="dropdown compact-action-menu comment-more-menu" :style="menuPosition" role="menu" aria-label="更多评论操作" @keydown.stop="menuKeydown">
      <template v-if="removal">
        <p>{{ removal.expectedMessages ? (local ? '删除这条批注？' : '删除这条讨论？') : '删除这条回复？' }}<span v-if="removal.expectedMessages && removal.expectedMessages.length > 1">同时删除 {{ removal.expectedMessages.length - 1 }} 条回复</span></p>
        <button type="button" role="menuitem" class="comment-delete-confirm danger-text" :disabled="busy" @click="removeMessage"><Trash2 :size="15" />确认删除</button>
        <button type="button" role="menuitem" @click="closeMenu(true)">取消</button>
      </template>
      <template v-else>
        <button v-if="assistant && menuMessage.id === thread.messages[0]?.id" type="button" role="menuitem" :disabled="busy" @click="inviteAssistant"><Bot :size="15" />请助手参与讨论</button>
        <button v-if="menuMessage.authorId === authorId" type="button" role="menuitem" :disabled="busy" @click="editMessage"><Pencil :size="15" />编辑</button>
        <div v-if="menuMessage.authorId === authorId" class="menu-divider" role="separator" />
        <button v-if="menuMessage.authorId === authorId" type="button" role="menuitem" class="comment-menu-delete danger-text" :disabled="busy" @click="prepareRemoval"><Trash2 :size="15" />删除</button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.comment-conversation { padding: 20px 0; }
.is-local + .is-local { border-top: 1px solid var(--line); }
.comment-message { position: relative; display: flex; align-items: flex-start; gap: 8px; }
.is-local .comment-message:not(:last-of-type)::after { content: ''; position: absolute; left: 11.45px; top: 30px; bottom: -10px; width: 1.1px; background: color-mix(in srgb, var(--control-border) 60%, transparent); pointer-events: none; }
.comment-message.is-reply { margin: 16px 0 0; }
.comment-avatar { display: grid; place-items: center; width: 24px; height: 24px; box-sizing: border-box; flex: none; border: 1px solid var(--line); border-radius: 50%; color: var(--muted); background: var(--paper); }
.comment-message-content { min-width: 0; flex: 1; padding: 0 0 2px; }
.comment-message-header { display: flex; align-items: center; min-height: 24px; justify-content: space-between; gap: 8px; }
.comment-message-meta { display: flex; align-items: baseline; flex-wrap: wrap; gap: 6px; min-width: 0; font-size: 13px; line-height: 20px; overflow-wrap: anywhere; }
.comment-message-meta strong { font-weight: 600; color: var(--text); }
.comment-message-meta time, .comment-edited { color: var(--muted); font-size: 12px; }
.comment-message p { margin: 5px 0 0; white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.65; color: var(--text); }
.comment-quote { margin: 8px 0 10px 2px; border-left: 2px solid #eabf35; padding-left: 10px; color: var(--muted); font-size: 12px; line-height: 1.6; max-height: 80px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-message-actions { display: flex; align-items: center; gap: 12px; min-height: 22px; margin-top: 7px; font-size: 12px; color: var(--muted); }
.comment-edit { display: flex; align-items: flex-start; gap: 10px; margin-top: 8px; }
.comment-edit textarea { flex: 1; min-width: 0; width: 100%; min-height: 22px; max-height: 320px; box-sizing: border-box; resize: none; border: 0; border-radius: 0; padding: 0; margin: 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; line-height: 1.65; overflow-wrap: anywhere; }
.comment-edit-actions { display: flex; flex: none; align-items: center; gap: 8px; height: 22px; }
.comment-edit-actions button { display: grid; place-items: center; width: 22px; height: 22px; padding: 0; border: 0; border-radius: 50%; color: white; cursor: pointer; }
.comment-edit-cancel { background: #858585; }
.comment-edit-confirm { background: #2683e8; }
.comment-edit-actions button:hover { filter: brightness(.92); }
.comment-edit-actions button:focus-visible { outline: 2px solid #2683e8; outline-offset: 3px; }
.comment-edit-actions button:disabled { opacity: .45; cursor: default; }
.comment-conversation:not(.is-local) { padding: 12px 0; }
.comment-conversation:not(.is-local) .comment-message { gap: 12px; }
.comment-conversation:not(.is-local) .comment-message.is-reply { margin: 16px 0 0 44px; }
.comment-conversation:not(.is-local) .comment-avatar { width: 32px; height: 32px; }
.comment-conversation:not(.is-local) .comment-message-content { padding: 0; }
.comment-conversation:not(.is-local) .comment-message-header { align-items: center; min-height: 32px; }
.comment-conversation:not(.is-local) .comment-message-meta { gap: 8px; font-size: 14px; line-height: 24px; }
.comment-conversation:not(.is-local) .comment-message p { margin-top: 4px; font-size: 15px; line-height: 1.65; }
.comment-conversation:not(.is-local) .comment-edit textarea { font-size: 15px; line-height: 1.65; }
.comment-reply-reference { display: flex; align-items: center; gap: 4px; min-width: 0; margin-top: 2px; color: var(--muted); font-size: 12px; line-height: 18px; }
.comment-reply-reference > svg { flex: none; }
.comment-reply-reference-author { flex: none; max-width: 45%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.comment-reply-reference-body { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.comment-reply-composer { margin-top: 12px; }
.comment-expand-replies { margin: 10px 0 0; padding: 0; border: 0; background: transparent; color: var(--muted); font: inherit; font-size: 12px; cursor: pointer; }
.comment-expand-replies:hover { color: var(--text); }
.comment-expand-replies:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.is-local { padding: 0; }
.is-local + .is-local { padding-top: 16px; margin-top: 16px; }
.comment-more-menu { position: fixed; z-index: 100; max-height: calc(100dvh - 16px); overflow-y: auto; }
.comment-more-menu p { margin: 4px 7px 6px; font-size: 12px; line-height: 16px; }
.comment-more-menu p span { display: block; color: var(--muted); }
</style>
