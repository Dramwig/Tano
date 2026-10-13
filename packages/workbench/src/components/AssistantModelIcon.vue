<script setup lang="ts">
import { computed } from 'vue';
import { Terminal } from 'lucide-vue-next';
import { modelIcon } from '../assistant/model-icons';

const props = withDefaults(defineProps<{ model: string; size?: number }>(), { size: 16 });
const icon = computed(() => modelIcon(props.model));
</script>

<template>
  <span class="assistant-model-icon" :data-model-brand="icon?.brand ?? (model === 'cli-default' ? 'cli' : 'unknown')" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <!-- Only bundled, reviewed SVGs enter v-html; model names never become markup. -->
    <span v-if="icon" class="assistant-model-brand-svg" v-html="icon.svg" />
    <Terminal v-else-if="model === 'cli-default'" :size="size" />
  </span>
</template>

<style scoped>
.assistant-model-icon { display: inline-flex; align-items: center; justify-content: center; flex: none; line-height: 0; }
.assistant-model-brand-svg { display: inline-flex; width: 100%; height: 100%; }
.assistant-model-icon :deep(svg) { display: block; width: 100%; height: 100%; }
</style>
