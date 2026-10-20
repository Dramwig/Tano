<script setup lang="ts">
import { t } from '../i18n';
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { GripVertical } from 'lucide-vue-next';
import type { ToolbarMode } from '../toolbar-preference';
import { announceToolbarMenuOpen, isAnotherToolbarMenu, toolbarMenuOpenEvent } from '../toolbar-menu';
import ToolbarModeOptions from './ToolbarModeOptions.vue';

const props = defineProps<{ mode?: ToolbarMode; open?: boolean }>();
const emit = defineEmits<{
  start: [event: PointerEvent];
  'update:open': [value: boolean];
  select: [mode: ToolbarMode];
}>();
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
function close() {
  if (props.open) emit('update:open', false);
}
function toggle() {
  if (!props.mode) return;
  // A real pointer tap is opened from pointerup as well. Do not let a
  // compatibility click immediately close that menu in WebViews.
  if (props.open) return;
  emit('update:open', true);
}
function pointerup(event: PointerEvent) {
  // useToolbarDrag prevents the event when it is committing a real drag.
  if (!event.defaultPrevented && props.mode && !props.open) toggle();
}
function outside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) close();
}
function keydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.open) return;
  event.preventDefault();
  event.stopPropagation();
  close();
  trigger.value?.focus();
}
function closeOtherMenu(event: Event) {
  if (isAnotherToolbarMenu(event, root.value)) close();
}
watch(() => props.open, (open) => {
  if (open) announceToolbarMenuOpen(root.value);
});
onMounted(() => {
  window.addEventListener('click', outside);
  window.addEventListener(toolbarMenuOpenEvent, closeOtherMenu);
});
onBeforeUnmount(() => {
  window.removeEventListener('click', outside);
  window.removeEventListener(toolbarMenuOpenEvent, closeOtherMenu);
});
</script>

<template>
  <div ref="root" class="toolbar-drag-handle-wrap" @keydown="keydown">
    <button
      ref="trigger"
      type="button"
      class="icon-button toolbar-drag-handle"
      :aria-label="t('拖动工具栏')"
      :data-tooltip="t('拖动以调整工具栏位置，也可点击打开停靠选项')"
      :aria-expanded="mode ? open : undefined"
      :aria-haspopup="mode ? 'menu' : undefined"
      @pointerdown.prevent.stop="emit('start', $event)"
      @pointerup="pointerup"
      @mousedown.prevent
      @click.stop="toggle"
    >
      <GripVertical :size="16" />
    </button>
    <div v-if="mode && open" class="dropdown compact-action-menu toolbar-dock-menu" role="menu" :aria-label="t('工具栏停靠位置')">
      <ToolbarModeOptions :mode="mode" @select="emit('select', $event)" />
    </div>
  </div>
</template>

<style scoped>
.toolbar-drag-handle-wrap {
  position: relative;
  display: flex;
  flex-shrink: 0;
}
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
.toolbar-dock-menu {
  top: calc(100% + 6px);
  left: 0;
  width: 128px !important;
  min-width: 128px;
  z-index: 40;
}
.toolbar-dock-menu button {
  justify-content: flex-start;
}
@media (max-width: 700px) {
  .selection-format-toolbar[aria-orientation='horizontal'] .toolbar-drag-handle {
    margin-inline-end: -3px;
  }
  .toolbar-dock-menu {
    left: auto;
    right: 0;
  }
}
.selection-format-toolbar :deep(.toolbar-dock-menu) {
  width: 128px !important;
  min-width: 128px;
}
.selection-format-toolbar[aria-orientation='horizontal'] :deep(.toolbar-drag-handle-wrap) {
  /* Match the formatting menu: position against the whole toolbar so the
     upward and downward gaps share the same baseline. */
  position: static;
}
</style>
