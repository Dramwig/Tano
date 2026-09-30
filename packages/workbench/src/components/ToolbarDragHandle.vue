<script setup lang="ts">
import { GripVertical } from 'lucide-vue-next';
const emit = defineEmits<{ start: [event: PointerEvent] }>();
</script>

<template>
  <button
    type="button"
    class="icon-button toolbar-drag-handle"
    aria-label="拖动工具栏"
    title="拖动以调整工具栏位置，也可使用更多菜单切换"
    @pointerdown.prevent.stop="emit('start', $event)"
    @mousedown.prevent
    @click.stop
  >
    <GripVertical :size="16" />
  </button>
</template>

<style scoped>
.icon-button.toolbar-drag-handle {
  width: 18px;
  height: 24px;
  border-radius: 4px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--muted) 60%, transparent);
}
.icon-button.toolbar-drag-handle:is(:hover, :focus-visible, :active) {
  color: var(--text-secondary);
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-drag-handle {
  width: 24px;
  height: 18px;
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-drag-handle :deep(svg) {
  transform: rotate(90deg);
}
.toolbar-drag-handle:active {
  cursor: grabbing;
}
</style>
