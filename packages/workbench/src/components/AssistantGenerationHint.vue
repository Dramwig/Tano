<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { AssistantConnection } from '@tano/protocol';

const props = defineProps<{ connectionKind?: AssistantConnection['kind'] }>();
const index = ref(0);
const hints = computed(() => [
  props.connectionKind === 'codex-cli'
    ? 'Codex CLI 可能需要较长时间，请耐心等待。'
    : props.connectionKind === 'claude-cli'
      ? 'Claude CLI 可能需要较长时间，请耐心等待。'
      : '复杂问题可能需要更多时间，请耐心等待。',
  '参考文档越多，整理和生成可能需要更久。',
  '可以继续浏览笔记，稍后回来查看回答。',
  '想调整问题时，可以先停止生成。',
]);

watch(() => props.connectionKind, (_kind, _previous, onCleanup) => {
  index.value = 0;
  const timer = setInterval(() => { index.value = (index.value + 1) % hints.value.length; }, 8000);
  onCleanup(() => clearInterval(timer));
}, { immediate: true });
</script>

<template>
  <span class="assistant-generation-hint" aria-live="off">
    <Transition name="assistant-hint" mode="out-in">
      <span :key="hints[index]">{{ hints[index] }}</span>
    </Transition>
  </span>
</template>

<style scoped>
.assistant-generation-hint { flex: 1; min-width: 0; min-height: 3.2em; color: color-mix(in srgb, var(--muted) 70%, var(--paper)); line-height: 1.6; overflow-wrap: anywhere; }
.assistant-hint-enter-active, .assistant-hint-leave-active { transition: opacity 160ms ease; }
.assistant-hint-enter-from, .assistant-hint-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .assistant-hint-enter-active, .assistant-hint-leave-active { transition: none; }
}
</style>
