<script setup lang="ts">
import { computed } from 'vue';
import { markdownDemoPath, type MarkdownDemoLocale } from '../markdown-demo-routes';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ locale: MarkdownDemoLocale }>();
const store = useWorkspaceStore();
const english = computed(() => props.locale === 'en-us');
const target = computed(() => markdownDemoPath(english.value ? 'zh-cn' : 'en-us'));
async function switchDemo(event: MouseEvent) {
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  event.preventDefault();
  if (await store.flush()) window.location.assign(target.value);
}
</script>

<template>
  <span class="markdown-demo-status">
    <span :title="english ? 'Edits are saved only in this browser. Network sync and real agents are unavailable.' : '修改仅保存在本浏览器，不提供网络同步或真实 Agent 连接。'">
      {{ english ? 'English demo · Browser storage' : '中文演示 · 浏览器存储' }}
    </span>
    <a :href="target" :lang="english ? 'zh-CN' : 'en-US'"
      :aria-label="english ? '打开中文演示' : 'Open English demo'" @click="switchDemo">
      {{ english ? '简体中文' : 'English' }}
    </a>
  </span>
</template>

<style scoped>
.markdown-demo-status { display: inline-flex; align-items: center; gap: 10px; font-size: 12px; white-space: nowrap; }
.markdown-demo-status a { color: var(--green); text-decoration: none; }
.markdown-demo-status a:hover { text-decoration: underline; }
</style>
