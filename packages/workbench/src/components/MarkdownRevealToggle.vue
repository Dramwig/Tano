<script setup lang="ts">
import { t } from '../i18n';
import { Eye, EyeOff } from 'lucide-vue-next';

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
    <Eye v-if="modelValue" :size="17" />
    <EyeOff v-else :size="17" />
  </button>
</template>
