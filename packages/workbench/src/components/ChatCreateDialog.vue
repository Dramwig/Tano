<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { UserPlus, Users, X } from 'lucide-vue-next';
import { useChatStore } from '../stores/chat';

const chat = useChatStore();
const emit = defineEmits<{ created: [] }>();
const dialogElement = ref<HTMLDialogElement>();
const previousFocus = document.activeElement as HTMLElement | null;
const name = ref('');
const account = ref('');
const members = ref<string[]>([]);
const error = ref('');
const isGroup = computed(() => chat.dialog === 'group');
onMounted(() => dialogElement.value?.showModal());
onBeforeUnmount(() => {
  dialogElement.value?.close();
  previousFocus?.focus();
});
function submit() {
  error.value = '';
  try {
    if (isGroup.value) chat.createGroup(name.value, members.value);
    else {
      const contact = chat.addContact(name.value, account.value);
      chat.openDirect(contact.id);
      chat.section = 'contacts';
      chat.query = '';
    }
    chat.dialog = null;
    emit('created');
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  }
}
</script>

<template>
  <dialog
    ref="dialogElement"
    class="chat-dialog"
    :aria-label="isGroup ? '发起群聊' : '添加好友'"
    aria-describedby="chat-dialog-notice"
    @cancel.prevent="chat.dialog = null"
    @click="$event.target === dialogElement && (chat.dialog = null)"
  >
    <form @submit.prevent="submit">
      <header>
        <h2>
          <Users v-if="isGroup" :size="20" /><UserPlus v-else :size="20" />{{
            isGroup ? '发起群聊' : '添加好友'
          }}
        </h2>
        <button
          type="button"
          class="icon-button"
          aria-label="关闭聊天对话框"
          @click="chat.dialog = null"
        >
          <X :size="18" />
        </button>
      </header>
      <p id="chat-dialog-notice" class="chat-dialog-notice">
        本地演示：{{
          isGroup
            ? '创建的群聊仅在当前窗口可见，不会邀请真实用户。'
            : '只创建演示联系人，不会搜索真实账号或发送好友申请。'
        }}
      </p>
      <label class="chat-dialog-field"
        >{{ isGroup ? '群名称' : '联系人名称'
        }}<input
          v-model="name"
          :aria-label="isGroup ? '群名称' : '联系人名称'"
          :placeholder="isGroup ? '例如：项目讨论组' : '如何称呼这位伙伴'"
          maxlength="40"
          required
          autofocus
      /></label>
      <template v-if="isGroup">
        <fieldset>
          <legend>
            选择成员 <span>已选 {{ members.length }} 人，至少选择 2 人</span>
          </legend>
          <div v-if="chat.contacts.length" class="chat-member-options">
            <label v-for="contact in chat.contacts" :key="contact.id"
              ><input v-model="members" type="checkbox" :value="contact.id" /><span
                >{{ contact.name }}<small>{{ contact.account }}</small></span
              ></label
            >
          </div>
          <p v-else class="chat-no-contacts">
            还没有联系人。先添加好友，或在聊天首页载入示例会话。
          </p>
        </fieldset>
      </template>
      <label v-else class="chat-dialog-field"
        >演示账号<input
          v-model="account"
          aria-label="演示账号"
          placeholder="例如：lin.example"
          maxlength="80"
          autocapitalize="off"
          spellcheck="false"
          required
      /></label>
      <p v-if="error" class="chat-dialog-error" role="alert">{{ error }}</p>
      <footer>
        <button type="button" class="secondary-button" @click="chat.dialog = null">取消</button
        ><button
          class="primary-button"
          type="submit"
          :disabled="!name.trim() || (isGroup ? members.length < 2 : !account.trim())"
        >
          {{ isGroup ? '创建演示群聊' : '添加到本地演示' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.chat-dialog {
  width: min(440px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  padding: 0;
  color: var(--text);
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 14px;
  box-shadow: 0 18px 80px #0003;
}
.chat-dialog::backdrop {
  background: #0005;
}
.chat-dialog form {
  padding: 24px;
}
.chat-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.chat-dialog h2 {
  display: flex;
  align-items: center;
  gap: 9px;
  margin: 0;
  font-size: 17px;
  font-weight: 550;
}
.chat-dialog h2 svg {
  color: var(--green);
}
.chat-dialog-notice {
  margin: 20px 0;
  padding: 10px 12px;
  background: var(--surface);
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
  border-radius: 7px;
}
.chat-dialog-field {
  display: flex;
  flex-direction: column;
  gap: 9px;
  font-size: 12px;
  margin-bottom: 20px;
}
.chat-dialog-field input {
  width: 100%;
  padding: 10px 11px;
  border: 1px solid var(--control-border);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.chat-dialog fieldset {
  border: 0;
  margin: 0;
  padding: 0;
  min-width: 0;
}
.chat-dialog legend {
  font-size: 12px;
  margin-bottom: 12px;
}
.chat-dialog legend span {
  color: var(--muted);
  margin-left: 8px;
  font-size: 11px;
}
.chat-member-options {
  max-height: 230px;
  overflow-y: auto;
}
.chat-member-options label {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 4px;
  font-size: 13px;
}
.chat-member-options input {
  accent-color: var(--green);
}
.chat-member-options span {
  min-width: 0;
  overflow-wrap: anywhere;
}
.chat-member-options small {
  display: block;
  color: var(--muted);
  margin-top: 3px;
  font-size: 11px;
}
.chat-no-contacts {
  padding: 16px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.8;
}
.chat-dialog-error {
  font-size: 12px;
  color: var(--danger);
}
.chat-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 26px;
}
</style>
