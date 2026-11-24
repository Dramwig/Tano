<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus, MessageSquare, Search } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import { useAssistantStore } from '../store';
import { useWorkspaceStore } from '../../stores/workspace';
import { openAssistantPage } from '../navigation';
const assistant = useAssistantStore();
const workspace = useWorkspaceStore();
const query = ref('');
const emit = defineEmits<{ open: [] }>();
function open(id?: string, create = false) {
  openAssistantPage(workspace, assistant, id, create);
  if (assistant.opened) emit('open');
}
const locked = computed(() => assistant.loading || assistant.busy || assistant.applying);
const sessions = computed(() => {
  const items = [...assistant.sessions];
  if (assistant.session && !items.some(item => item.id === assistant.session?.id)) items.push(assistant.session);
  return items.filter(item => item.workspaceId === workspace.workspace?.id && item.title.toLocaleLowerCase().includes(query.value.toLocaleLowerCase()))
    .sort((a, b) => b.updatedAt - a.updatedAt);
});
</script>

<template>
  <section class="sidebar-content assistant-navigation" :aria-label="t('工作区助手')">
    <button class="assistant-navigation-new" :disabled="locked || !workspace.workspace" @click="open(undefined, true)"><Plus :size="16" />{{ t('新会话') }}</button>
    <label class="assistant-navigation-search">
      <Search :size="14" />
      <input v-model="query" :aria-label="t('搜索助手会话')" :placeholder="t('搜索助手会话')" />
    </label>
    <p v-if="assistant.loading" role="status">{{ t('正在读取会话…') }}</p>
    <div class="tree-scroll assistant-navigation-list">
      <button v-for="item in sessions" :key="item.id" class="assistant-navigation-session" :aria-pressed="assistant.session?.id === item.id" :disabled="locked && assistant.session?.id !== item.id" @click="open(item.id)">
        <MessageSquare :size="15" /><span>{{ item.title }}</span>
      </button>
      <p v-if="!assistant.loading && !sessions.length" class="assistant-navigation-empty"><MessageSquare :size="20" />{{ t('暂无会话') }}</p>
    </div>
  </section>
</template>

<style scoped>
.assistant-navigation { gap: 10px; padding: 10px 10px 12px; min-height: 0; }

/* 新会话按钮：主操作，带边框的浅色卡片 */
.assistant-navigation-new { display: flex; align-items: center; justify-content: center; gap: 6px; width: 100%; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-raised, var(--surface)); color: var(--text); font-size: 13px; font-weight: 500; cursor: pointer; box-shadow: 0 1px 2px rgba(0, 0, 0, .04); transition: background .15s, border-color .15s, box-shadow .15s, transform .1s; }
.assistant-navigation-new:hover:not(:disabled) { background: var(--hover); box-shadow: 0 1px 3px rgba(0, 0, 0, .08); }
.assistant-navigation-new:active:not(:disabled) { transform: translateY(1px); }
.assistant-navigation-new:disabled { opacity: .5; cursor: not-allowed; }

/* 搜索框：图标内嵌、无硬边框、聚焦时高亮 */
.assistant-navigation-search { display: flex; align-items: center; gap: 7px; padding: 0 10px; border: 1px solid transparent; border-radius: 8px; background: var(--hover); color: var(--muted); transition: border-color .15s, background .15s, box-shadow .15s; }
.assistant-navigation-search:focus-within { border-color: var(--line); background: var(--surface-raised, var(--surface)); box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 8%, transparent); color: var(--text-secondary); }
.assistant-navigation-search svg { flex-shrink: 0; }
.assistant-navigation .assistant-navigation-search input { flex: 1; width: 100%; min-width: 0; padding: 8px 0; border: 0; outline: none; box-shadow: none; background: transparent; color: var(--text); font-size: 13px; }
.assistant-navigation-search input::placeholder { color: var(--muted); }

/* 会话列表 */
.assistant-navigation-list { display: flex; flex-direction: column; gap: 2px; }
.assistant-navigation-session { position: relative; display: flex; align-items: center; gap: 9px; width: 100%; padding: 8px 10px; border-radius: 8px; text-align: left; color: var(--text-secondary); font-size: 13px; cursor: pointer; transition: background .12s, color .12s; }
.assistant-navigation-session span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-navigation-session svg { flex-shrink: 0; color: var(--muted); }
.assistant-navigation-session:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.assistant-navigation-session[aria-pressed=true] { background: var(--hover); color: var(--text); font-weight: 500; }
.assistant-navigation-session[aria-pressed=true] svg { color: var(--text); }
.assistant-navigation-session[aria-pressed=true]::before { content: ''; position: absolute; left: 0; top: 9px; bottom: 9px; width: 3px; border-radius: 2px; background: var(--text); }
.assistant-navigation-session:disabled { opacity: .5; cursor: not-allowed; }
.assistant-navigation-session:focus-visible, .assistant-navigation-new:focus-visible { outline: 2px solid color-mix(in srgb, var(--text) 35%, transparent); outline-offset: 1px; }

/* 状态 / 空状态 */
.assistant-navigation p { color: var(--muted); padding: 8px 10px; font-size: 12px; }
.assistant-navigation-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 28px 10px !important; text-align: center; }
.assistant-navigation-empty svg { opacity: .5; }
</style>
