<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { Sigma } from 'lucide-vue-next';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ insert: [command: 'math' | 'math-block'] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
function closeOutside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
function insert(command: 'math' | 'math-block') {
  open.value = false;
  emit('insert', command);
}
function escape() {
  open.value = false;
  trigger.value?.focus();
}
onMounted(() => window.addEventListener('click', closeOutside));
onBeforeUnmount(() => window.removeEventListener('click', closeOutside));
</script>

<template>
  <div ref="root" class="menu-wrap" @keydown.esc.stop.prevent="escape">
    <button
      ref="trigger"
      class="icon-button"
      aria-label="插入公式"
      title="插入 LaTeX 公式"
      :aria-expanded="open && !disabled"
      :disabled="disabled"
      @mousedown.prevent
      @click="open = !open"
    >
      <Sigma :size="17" />
    </button>
    <div v-if="open && !disabled" class="dropdown document-dropdown">
      <button @mousedown.prevent @click="insert('math')">行内公式 · $…$</button>
      <button @mousedown.prevent @click="insert('math-block')">公式块 · $$…$$</button>
    </div>
  </div>
</template>
