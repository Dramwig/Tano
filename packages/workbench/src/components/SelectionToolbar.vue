<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import type { DocumentFeatures } from '@tano/editor/runtime';
import EditorToolbar from './EditorToolbar.vue';
import { selectionToolbarPosition } from '../selection-toolbar-position';
import { dockedToolbarPosition, toolbarPaneBounds } from '../toolbar-docking';

const props = defineProps<{
  context: EditorSelectionContext;
  editorElement?: HTMLElement;
  features?: DocumentFeatures;
  enabledLevels?: readonly number[];
  mode?: 'selection' | 'left' | 'right';
  dragging?: boolean;
}>();
const emit = defineEmits<{ command: [name: string, value?: string] }>();
const panel = ref<HTMLElement>();
const visible = ref(false);
const vertical = ref(false);
let anchor: Range | null = null;
let dismissed: Range | null = null;
let pointerSelecting = false;
let composing = false;
let frame = 0;
let resizeObserver: ResizeObserver | undefined;
let mounted = false;

function editor() {
  return props.editorElement?.querySelector<HTMLElement>('.ProseMirror');
}
function sameRange(a: Range | null, b: Range) {
  return (
    a?.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
}
function hide() {
  visible.value = false;
}
function dismiss() {
  dismissed = anchor?.cloneRange() ?? null;
  hide();
}
function dismissAndFocus() {
  if (!props.mode || props.mode === 'selection') dismiss();
  editor()?.focus();
}
function position() {
  const element = panel.value;
  const content = editor();
  const bounds = toolbarPaneBounds(props.editorElement);
  if (!element || !content || !bounds) return hide();
  const { left, top, right, bottom } = bounds;
  element.style.maxWidth = `${Math.max(0, right - left)}px`;
  const docked = props.mode === 'left' || props.mode === 'right';
  const shouldBeVertical = docked && bottom - top >= 280;
  if (vertical.value !== shouldBeVertical) {
    vertical.value = shouldBeVertical;
    void nextTick(position);
    return;
  }
  const rect = element.getBoundingClientRect();
  if (docked) {
    const result = dockedToolbarPosition(
      bounds,
      props.mode as 'left' | 'right',
      rect.width,
      rect.height,
    );
    element.style.left = `${result.x}px`;
    element.style.top = `${result.y}px`;
    element.style.setProperty('--dock-menu-top', `${result.menuTop}px`);
    element.style.setProperty(
      '--selection-toolbar-width',
      `${vertical.value ? result.menuWidth : right - left}px`,
    );
    const above = result.y - top - 6;
    const below = bottom - result.y - rect.height - 6;
    element.dataset.menuSide = below >= above ? 'below' : 'above';
    element.style.setProperty(
      '--selection-menu-height',
      `${vertical.value ? result.menuHeight : Math.max(above, below)}px`,
    );
    return;
  }
  if (!anchor || !content.contains(anchor.commonAncestorContainer)) return hide();
  const result = selectionToolbarPosition(
    [...anchor.getClientRects()],
    { left, top, right, bottom },
    rect.width,
    rect.height,
  );
  if (!result) return hide();
  element.style.left = `${result.x}px`;
  element.style.top = `${result.y}px`;
  element.dataset.menuSide = result.menuSide;
  element.style.setProperty('--selection-toolbar-width', `${result.menuWidth}px`);
  // Match the chosen side, including in a short horizontal split.
  const availableHeight =
    result.menuSide === 'above' ? result.y - top - 6 : bottom - result.y - rect.height - 6;
  element.style.setProperty('--selection-menu-height', `${Math.max(0, availableHeight)}px`);
}
async function refresh() {
  if (!mounted || props.dragging) return;
  const content = editor();
  if (props.mode === 'left' || props.mode === 'right') {
    visible.value = !!content;
    await nextTick();
    if (visible.value) position();
    return;
  }
  if (pointerSelecting || composing) return;
  if (!content || !props.context.textSelected) return hide();
  // Inputs may replace the browser selection. ProseMirror retains its own range;
  // keep the original anchor while a link or formatting menu owns focus.
  if (visible.value && panel.value?.contains(document.activeElement)) return position();
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !content.contains(document.activeElement))
    return hide();
  const range = selection.getRangeAt(0);
  if (
    !content.contains(range.commonAncestorContainer) ||
    !range.toString() ||
    sameRange(dismissed, range)
  )
    return hide();
  dismissed = null;
  anchor = range.cloneRange();
  visible.value = true;
  await nextTick();
  if (visible.value) position();
}
function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = 0;
    void refresh();
  });
}
function pointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (panel.value?.contains(target)) return;
  if (props.mode === 'left' || props.mode === 'right') return;
  if (editor()?.contains(target)) {
    dismissed = null;
    pointerSelecting = true;
    hide();
  } else dismiss();
}
function pointerUp() {
  pointerSelecting = false;
  schedule();
}
function keydown(event: KeyboardEvent) {
  if (props.dragging) return;
  if (event.key === 'Escape' && visible.value) {
    // Nested menus consume Escape first; the next Escape dismisses the capsule.
    if (props.mode === 'left' || props.mode === 'right') return;
    dismiss();
    if (panel.value?.contains(document.activeElement)) editor()?.focus();
    event.preventDefault();
    event.stopPropagation();
  } else if (event.key === 'F10' && event.altKey && visible.value) {
    panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    event.preventDefault();
  }
}
function compositionStart() {
  composing = true;
  if (!props.mode || props.mode === 'selection') hide();
}
function compositionEnd() {
  composing = false;
  schedule();
}
function blur() {
  pointerSelecting = false;
  if (!props.mode || props.mode === 'selection') dismiss();
}
watch(() => props.context, schedule);
watch(
  () => [props.mode, props.dragging],
  () => {
    dismissed = null;
    schedule();
  },
);
watch(
  () => props.editorElement,
  (element, previous) => {
    if (previous) resizeObserver?.unobserve(previous);
    if (element) resizeObserver?.observe(element);
    schedule();
  },
);
onMounted(() => {
  mounted = true;
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', pointerUp);
  document.addEventListener('focusin', schedule);
  document.addEventListener('keydown', keydown);
  document.addEventListener('compositionstart', compositionStart);
  document.addEventListener('compositionend', compositionEnd);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('blur', blur);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(schedule);
    if (props.editorElement) resizeObserver.observe(props.editorElement);
  }
  schedule();
});
onBeforeUnmount(() => {
  mounted = false;
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  document.removeEventListener('selectionchange', schedule);
  document.removeEventListener('pointerdown', pointerDown, true);
  document.removeEventListener('pointerup', pointerUp);
  document.removeEventListener('pointercancel', pointerUp);
  document.removeEventListener('focusin', schedule);
  document.removeEventListener('keydown', keydown);
  document.removeEventListener('compositionstart', compositionStart);
  document.removeEventListener('compositionend', compositionEnd);
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('resize', schedule);
  window.removeEventListener('blur', blur);
  window.visualViewport?.removeEventListener('resize', schedule);
  window.visualViewport?.removeEventListener('scroll', schedule);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="visible"
      ref="panel"
      class="selection-toolbar"
      :class="{ 'docked-toolbar': vertical, 'toolbar-being-dragged': dragging }"
      :data-dock="mode === 'left' || mode === 'right' ? mode : undefined"
      :aria-label="mode === 'left' ? '左侧工具栏' : mode === 'right' ? '右侧工具栏' : '选区工具栏'"
      aria-keyshortcuts="Alt+F10 Escape"
    >
      <EditorToolbar
        compact
        :vertical="vertical"
        :dragging="dragging"
        :context="context"
        :features="features"
        :enabled-levels="enabledLevels"
        @dismiss="dismissAndFocus"
        @command="(name, value) => emit('command', name, value)"
      >
        <template #leading><slot name="leading" /></template>
        <template #preferences><slot name="preferences" /></template>
      </EditorToolbar>
    </div>
  </Teleport>
</template>

<style scoped>
.selection-toolbar {
  position: fixed;
  z-index: 35;
  width: max-content;
}
.selection-toolbar:not(.docked-toolbar)[data-menu-side='above']
  :deep(.selection-format-toolbar .dropdown),
.selection-toolbar:not(.docked-toolbar)[data-menu-side='above']
  :deep(.selection-format-toolbar .toolbar-input-panel) {
  top: auto;
  bottom: calc(100% + 6px);
}
.toolbar-being-dragged {
  opacity: 0;
}
.docked-toolbar :deep(.selection-format-toolbar .dropdown),
.docked-toolbar :deep(.selection-format-toolbar .toolbar-input-panel) {
  top: var(--dock-menu-top, 0px);
  bottom: auto;
  left: calc(100% + 8px);
}
.docked-toolbar[data-dock='right'] :deep(.selection-format-toolbar .dropdown),
.docked-toolbar[data-dock='right'] :deep(.selection-format-toolbar .toolbar-input-panel) {
  left: auto;
  right: calc(100% + 8px);
}
.selection-toolbar[data-dock='right']:not(.docked-toolbar) :deep(.dropdown),
.selection-toolbar[data-dock='right']:not(.docked-toolbar) :deep(.toolbar-input-panel) {
  left: auto;
  right: 0;
}
</style>
