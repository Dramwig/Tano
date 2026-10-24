<script setup lang="ts">
withDefaults(defineProps<{ active?: boolean }>(), { active: true });
const emit = defineEmits<{ close: [] }>();
</script>

<template>
  <div :class="{ 'modal-backdrop workbench-modal-backdrop': active }" @mousedown.self="active && emit('close')">
    <slot />
  </div>
</template>

<style>
.modal-backdrop.workbench-modal-backdrop {
  box-sizing: border-box;
  align-items: center;
  padding: 28px;
  z-index: 80;
  background: #20252b40;
  backdrop-filter: blur(4px);
}
.workbench-modal-surface {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 16px;
  box-shadow: 0 24px 80px #18212b29, 0 4px 16px #18212b0d;
}
</style>
