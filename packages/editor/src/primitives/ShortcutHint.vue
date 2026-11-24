<script setup lang="ts">
import { Delete } from 'lucide-vue-next';

defineProps<{ label: string }>();
</script>

<template>
  <span class="shortcut-hint" :aria-label="label">
    <template v-for="(part, index) in label.split(/\b(Backspace)\b/)" :key="index">
      <Delete v-if="part === 'Backspace'" class="shortcut-backspace" :size="15" :stroke-width="1.75" aria-hidden="true" />
      <template v-else>{{ part }}</template>
    </template>
  </span>
</template>

<style scoped>
.shortcut-hint { display: inline-flex; align-items: center; white-space: pre; vertical-align: middle; }
.shortcut-backspace { flex-shrink: 0; }
</style>
