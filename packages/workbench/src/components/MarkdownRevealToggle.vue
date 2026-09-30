<script setup lang="ts">
import { TextCursorInput } from 'lucide-vue-next';

defineProps<{ modelValue: boolean; source: boolean }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    class="icon-button markdown-reveal-toggle"
    aria-label="光标展开源码"
    :aria-pressed="modelValue"
    :disabled="source"
    :title="source
      ? '当前为完整源码模式；返回编辑后可切换光标展开源码'
      : modelValue
        ? '光标展开源码：已开启，点击关闭'
        : '光标展开源码：已关闭，点击开启'"
    @mousedown.prevent
    @click="$emit('update:modelValue', !modelValue)"
  >
    <TextCursorInput :size="17" />
  </button>
</template>

<style scoped>
.markdown-reveal-toggle[aria-pressed='true']:not(:disabled) {
  color: var(--green);
  background: var(--accent);
}
</style>
