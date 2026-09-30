<script setup lang="ts">
import { BookOpen, FlaskConical, Puzzle } from 'lucide-vue-next';
defineProps<{ id: string; compact?: boolean }>();
</script>

<template>
  <span class="plugin-icon" :class="{ reading: id === 'reading', compact }" aria-hidden="true">
    <FlaskConical v-if="id === 'research'" :size="27" :stroke-width="1.7" />
    <BookOpen v-else-if="id === 'reading'" :size="27" :stroke-width="1.7" />
    <Puzzle v-else :size="27" :stroke-width="1.7" />
  </span>
</template>

<style scoped>
.plugin-icon {
  display: grid;
  place-items: center;
  flex: none;
  width: 56px;
  height: 56px;
  border-radius: 13px;
  background: var(--accent);
  color: var(--green);
}
.plugin-icon.reading {
  background: var(--warning-bg);
  color: var(--warning);
}
.plugin-icon.compact {
  width: 40px;
  height: 40px;
  border-radius: 10px;
}
.plugin-icon.compact svg {
  width: 23px;
  height: 23px;
}
</style>
