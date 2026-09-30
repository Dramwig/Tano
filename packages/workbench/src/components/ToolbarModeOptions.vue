<script setup lang="ts">
import { PanelLeft, PanelRight, Pin, TextCursorInput } from 'lucide-vue-next';
import { toolbarModeLabels } from '../toolbar-preference';
import type { ToolbarMode } from '../toolbar-preference';

defineProps<{ mode: ToolbarMode }>();
const emit = defineEmits<{ select: [mode: ToolbarMode] }>();
// Keep the existing pin action at the very bottom of the selection menu.
const options = [
  { mode: 'selection', icon: TextCursorInput },
  { mode: 'left', icon: PanelLeft },
  { mode: 'right', icon: PanelRight },
  { mode: 'fixed', icon: Pin },
] as const;
</script>

<template>
  <template v-for="option in options" :key="option.mode">
    <button
      v-if="option.mode !== mode"
      type="button"
      :aria-label="toolbarModeLabels[option.mode]"
      @mousedown.prevent
      @click="emit('select', option.mode)"
    >
      <component :is="option.icon" :size="16" />{{ toolbarModeLabels[option.mode] }}
    </button>
  </template>
</template>
