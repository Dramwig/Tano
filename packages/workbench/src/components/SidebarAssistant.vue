<script setup lang="ts">
import { computed, ref } from 'vue';
import { Plus, MessageSquare } from 'lucide-vue-next';
import { t } from '../i18n';
import { useAssistantStore } from '../assistant/store';
import { useWorkspaceStore } from '../stores/workspace';
import { openAssistantPage } from '../assistant/navigation';
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
    <input v-model="query" :aria-label="t('搜索助手会话')" :placeholder="t('搜索助手会话')" />
    <p v-if="assistant.loading" role="status">{{ t('正在读取会话…') }}</p>
    <div class="tree-scroll">
      <button v-for="item in sessions" :key="item.id" class="assistant-navigation-session" :aria-pressed="assistant.session?.id === item.id" :disabled="locked && assistant.session?.id !== item.id" @click="open(item.id)">
        <MessageSquare :size="15" /><span>{{ item.title }}</span>
      </button>
      <p v-if="!assistant.loading && !sessions.length">{{ t('暂无会话') }}</p>
    </div>
  </section>
</template>

<style scoped>
.assistant-navigation { gap: 8px; padding: 8px; min-height: 0; }
.assistant-navigation input { width: 100%; min-width: 0; padding: 8px; }
.assistant-navigation-new, .assistant-navigation-session { display: flex; align-items: center; gap: 8px; padding: 9px; border-radius: 7px; text-align: left; width: 100%; }
.assistant-navigation-session span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-navigation-session svg { flex-shrink: 0; }
.assistant-navigation-session:hover, .assistant-navigation-session[aria-pressed=true] { background: var(--hover); }
.assistant-navigation p { color: var(--muted); padding: 8px; font-size: 12px; }
</style>
