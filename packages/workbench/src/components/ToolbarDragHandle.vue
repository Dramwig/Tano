<script setup lang="ts">
import { t } from '../i18n';
import { GripVertical } from 'lucide-vue-next';
const emit = defineEmits<{ start: [event: PointerEvent] }>();
</script>

<template>
  <button
    type="button"
    class="icon-button toolbar-drag-handle"
    :aria-label="t('拖动工具栏')"
    :title="t('拖动以调整工具栏位置，也可使用更多菜单切换')"
    @pointerdown.prevent.stop="emit('start', $event)"
    @mousedown.prevent
    @click.stop
  >
    <GripVertical :size="16" />
  </button>
</template>

<style scoped>
.icon-button.toolbar-drag-handle {
  position: relative;
  width: 10px;
  height: 24px;
  border-radius: 4px;
  cursor: grab;
  touch-action: none;
  user-select: none;
  flex-shrink: 0;
  color: color-mix(in srgb, var(--muted) 60%, transparent);
}
.toolbar-drag-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  top: 50%;
  width: 2px;
  height: 12px;
  border-radius: 1px;
  background: currentColor;
  transform: translate(-50%, -50%);
  opacity: 0;
}
.contextual-toolbar:hover .toolbar-drag-handle::after {
  opacity: 1;
}
.toolbar-drag-handle :deep(svg) {
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  opacity: 0;
}
.icon-button.toolbar-drag-handle:is(:hover, :focus-visible, :active) {
  color: var(--text-secondary);
}
.toolbar-drag-handle:is(:hover, :focus-visible, :active)::after,
.toolbar-drag-preview .toolbar-drag-handle::after {
  display: none;
}
.toolbar-drag-handle:is(:hover, :focus-visible, :active) :deep(svg),
.toolbar-drag-preview .toolbar-drag-handle :deep(svg) {
  opacity: 1;
}
.selection-format-toolbar[aria-orientation='horizontal'] .toolbar-drag-handle {
  margin-inline-end: -4px;
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-drag-handle {
  width: 24px;
  height: 10px;
  margin-block-end: -4px;
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-drag-handle::after {
  width: 12px;
  height: 2px;
}
.contextual-toolbar[aria-orientation='vertical'] .toolbar-drag-handle :deep(svg) {
  transform: translate(-50%, -50%) rotate(90deg);
}
.toolbar-drag-handle:active {
  cursor: grabbing;
}
@media (max-width: 700px) {
  .selection-format-toolbar[aria-orientation='horizontal'] .toolbar-drag-handle {
    margin-inline-end: -3px;
  }
}
</style>
