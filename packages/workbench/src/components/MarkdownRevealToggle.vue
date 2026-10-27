<script setup lang="ts">
import { t } from '../i18n';

defineProps<{ modelValue: boolean; source: boolean }>();
defineEmits<{ 'update:modelValue': [value: boolean] }>();
</script>

<template>
  <button
    type="button"
    class="icon-button markdown-reveal-toggle"
    :aria-label="t('光标展开源码')"
    :aria-pressed="modelValue"
    :disabled="source"
    :data-tooltip="source
      ? t('当前为完整源码模式；返回编辑后可切换光标展开源码')
      : modelValue
        ? t('光标展开源码：已开启，点击关闭')
        : t('光标展开源码：已关闭，点击开启')"
    @mousedown.prevent
    @click="$emit('update:modelValue', !modelValue)"
  >
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
      <path d="m6 8-4 4 4 4M18 8l4 4-4 4M10 4h4M10 20h4" />
      <path v-if="modelValue" d="M12 4v16" />
      <path v-else d="M12 4v5M12 15v5M3 3l18 18" />
    </svg>
  </button>
</template>
