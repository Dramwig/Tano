<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Ellipsis } from 'lucide-vue-next';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import type { DocumentFeatures } from '@tano/editor/runtime';
import type { ToolbarMode } from '../toolbar-preference';
import type { ShortcutBindings } from '../shortcuts';
import { toolbarModeLabels } from '../toolbar-preference';
import { useToolbarDrag } from '../use-toolbar-drag';
import { dockedToolbarPosition } from '../toolbar-docking';
import EditorToolbar from './EditorToolbar.vue';
import SelectionToolbar from './SelectionToolbar.vue';
import ToolbarDragHandle from './ToolbarDragHandle.vue';
import ToolbarModeOptions from './ToolbarModeOptions.vue';

const props = defineProps<{
  mode: ToolbarMode;
  active: boolean;
  editorElement?: HTMLElement;
  context: EditorSelectionContext;
  features?: DocumentFeatures;
  enabledLevels?: readonly number[];
  disabled?: boolean;
  source?: boolean;
  assistant?: boolean;
  assistantDisabled?: boolean;
  annotation?: boolean;
  todo?: boolean;
  shortcuts?: ShortcutBindings;
}>();
const emit = defineEmits<{
  command: [name: string, value?: string];
  'update:mode': [value: ToolbarMode];
  assistant: [];
  annotation: [];
  todo: [];
}>();
const menuOpen = ref(false);
const menuRoot = ref<HTMLElement>();
const menuTrigger = ref<HTMLButtonElement>();
function focusEditor() {
  if (props.active)
    props.editorElement
      ?.querySelector<HTMLElement>('.ProseMirror, .cm-content')
      ?.focus({ preventScroll: true });
}
const { drag, start, cancel } = useToolbarDrag(
  () => props.editorElement,
  (mode) => {
    void changeMode(mode);
  },
  focusEditor,
);
const previewPanel = ref<HTMLElement>();
const previewStatus = computed(() => {
  const target = drag.value?.target;
  if (!target) return '当前位置无法放置工具栏，松开或按 Esc 取消';
  if (target === 'selection')
    return props.context.textSelected ? '松开后随选区显示' : '松开后收起，选中文字时显示';
  return `松开后${toolbarModeLabels[target]}`;
});
const previewDocked = computed(
  () =>
    drag.value?.target === 'left' ||
    drag.value?.target === 'right' ||
    drag.value?.target === 'bottom',
);
const previewVertical = computed(
  () =>
    (drag.value?.target === 'left' || drag.value?.target === 'right') &&
    drag.value.bounds.bottom - drag.value.bounds.top >= 280,
);
const previewSplit = computed(() => !!props.editorElement?.closest('.workspace-panes-multiple'));
function positionPreview() {
  const current = drag.value;
  const panel = previewPanel.value;
  if (!current || !panel) return;
  const { bounds, target } = current;
  if (target === 'fixed') {
    const pane = props.editorElement?.closest<HTMLElement>('.document-layout') ?? props.editorElement;
    const content = pane?.querySelector<HTMLElement>('.document-main') ?? pane;
    const rect = content?.getBoundingClientRect();
    const paneRect = pane?.getBoundingClientRect();
    // Match the full fixed toolbar, including pane padding and the scrollbar gutter.
    panel.style.left = `${rect?.left ?? bounds.left}px`;
    panel.style.top = `${Math.max(paneRect?.top ?? bounds.top, window.visualViewport?.offsetTop ?? 0)}px`;
    panel.style.width = `${rect?.width ?? bounds.right - bounds.left}px`;
    panel.style.maxWidth = panel.style.width;
    return;
  }
  panel.style.width = 'max-content';
  panel.style.maxWidth = `${bounds.right - bounds.left}px`;
  // Measure the same controls rendered after docking; block and text selections have different heights.
  const rect = panel.getBoundingClientRect();
  // Follow the pointer until release. SelectionToolbar anchors to the saved range after committing.
  const position =
    target === 'left' || target === 'right' || target === 'bottom'
      ? dockedToolbarPosition(bounds, target, rect.width, rect.height)
      : {
          x: Math.max(bounds.left, Math.min(current.x + 14, bounds.right - rect.width)),
          y: Math.max(bounds.top, Math.min(current.y + 18, bounds.bottom - rect.height)),
        };
  panel.style.left = `${position.x}px`;
  panel.style.top = `${position.y}px`;
}
watch(
  [drag, previewPanel, () => props.context, () => props.features, () => props.enabledLevels],
  positionPreview,
  { flush: 'post' },
);
function startDrag(event: PointerEvent) {
  menuOpen.value = false;
  start(event);
}
function closeOutside(event: MouseEvent) {
  if (!menuRoot.value?.contains(event.target as Node)) menuOpen.value = false;
}
function escapeMenu() {
  menuOpen.value = false;
  menuTrigger.value?.focus();
}
watch(
  () => [props.mode, props.source, props.disabled, props.editorElement],
  () => {
    menuOpen.value = false;
    cancel();
  },
);
watch(
  () => props.active,
  (active) => {
    if (!active) {
      menuOpen.value = false;
      cancel();
    }
  },
);
onMounted(() => window.addEventListener('click', closeOutside));
onBeforeUnmount(() => window.removeEventListener('click', closeOutside));
async function changeMode(mode: ToolbarMode) {
  menuOpen.value = false;
  emit('update:mode', mode);
  await nextTick();
  // The mode switch removes its own button; return keyboard focus to this editor.
  focusEditor();
}
</script>

<template>
  <EditorToolbar
    v-if="mode === 'fixed'"
    class="switchable-toolbar"
    :class="{ 'toolbar-being-dragged': drag }"
    :context="context"
    :features="features"
    :enabled-levels="enabledLevels"
    :disabled="disabled"
    :source="source"
    :dragging="!!drag"
    :assistant="assistant"
    :assistant-disabled="assistantDisabled"
    :annotation="annotation"
    :todo="todo"
    @todo="emit('todo')"
    @assistant="emit('assistant')"
    @annotation="emit('annotation')"
    @command="(name, value) => emit('command', name, value)"
  >
    <template #leading><ToolbarDragHandle @start="startDrag" /></template>
    <template #trailing>
      <div ref="menuRoot" class="menu-wrap" @keydown.esc.stop.prevent="escapeMenu">
        <button
          ref="menuTrigger"
          type="button"
          class="icon-button"
          aria-label="更多"
          title="更多"
          :aria-expanded="menuOpen"
          @mousedown.prevent
          @click="menuOpen = !menuOpen"
        >
          <Ellipsis :size="17" />
        </button>
        <div v-if="menuOpen" class="dropdown compact-action-menu toolbar-mode-menu">
          <ToolbarModeOptions :mode="mode" @select="changeMode" />
        </div>
      </div>
      <slot name="trailing" />
    </template>
  </EditorToolbar>
  <template v-else>
    <div v-if="$slots.trailing" class="editor-toolbar editor-utility-bar">
      <slot name="trailing" />
    </div>
    <SelectionToolbar
      :shortcuts="shortcuts"
      v-if="active && !disabled && !source"
      :editor-element="editorElement"
      :context="context"
      :features="features"
      :enabled-levels="enabledLevels"
      :mode="mode"
      :dragging="!!drag"
      :assistant="assistant"
      :assistant-disabled="assistantDisabled"
      :annotation="annotation"
      :todo="todo"
      @todo="emit('todo')"
      @assistant="emit('assistant')"
      @annotation="emit('annotation')"
      @command="(name, value) => emit('command', name, value)"
    >
      <template #leading><ToolbarDragHandle @start="startDrag" /></template>
      <template #preferences><ToolbarModeOptions :mode="mode" @select="changeMode" /></template>
    </SelectionToolbar>
  </template>
  <Teleport to="body">
    <template v-if="drag">
      <div
        ref="previewPanel"
        class="toolbar-drag-preview"
        :class="{
          'toolbar-dock-preview': previewDocked || drag.target === 'fixed',
          'toolbar-drag-ghost': !previewDocked && drag.target !== 'fixed',
          'toolbar-preview-split': previewSplit,
          'toolbar-preview-inactive': !drag.target || (drag.target === 'selection' && !context.textSelected),
        }"
        :data-target="drag.target"
      >
        <div aria-hidden="true" inert>
          <EditorToolbar
            :compact="drag.target !== 'fixed'"
            :vertical="previewVertical"
            :class="{ 'switchable-toolbar': drag.target === 'fixed' }"
            :context="context"
            :features="features"
            :enabled-levels="enabledLevels"
            :disabled="disabled"
            :source="source"
            :assistant="assistant"
            :assistant-disabled="assistantDisabled"
            :annotation="annotation"
            :todo="todo"
          >
            <template #leading><ToolbarDragHandle /></template>
            <template v-if="drag.target !== 'fixed'" #preferences>
              <ToolbarModeOptions :mode="drag.target ?? mode" />
            </template>
            <template v-if="drag.target === 'fixed'" #trailing>
              <div class="menu-wrap">
                <button type="button" class="icon-button" aria-label="更多">
                  <Ellipsis :size="17" />
                </button>
              </div>
              <slot name="trailing" />
            </template>
          </EditorToolbar>
        </div>
      </div>
      <span class="toolbar-drag-status" role="status">{{ previewStatus }}</span>
    </template>
  </Teleport>
</template>

<style scoped>
.toolbar-being-dragged {
  opacity: 0;
}
.toolbar-drag-preview {
  position: fixed;
  z-index: 38;
  width: max-content;
  pointer-events: none;
  user-select: none;
}
.toolbar-preview-split :deep(.editor-toolbar) {
  height: auto;
  min-height: 44px;
  flex-wrap: wrap;
  padding: 6px 10px;
  white-space: nowrap;
}
.toolbar-preview-split :deep(.editor-toolbar > *) {
  flex-shrink: 0;
}
.toolbar-preview-inactive {
  opacity: 0.55;
}
.toolbar-drag-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.toolbar-mode-menu {
  top: calc(100% + 6px);
  left: 0;
}
@media (max-width: 700px) {
  .toolbar-mode-menu {
    left: auto;
    right: 0;
  }
  .switchable-toolbar {
    height: auto;
    min-height: 44px;
    flex-wrap: wrap;
    padding-block: 6px;
  }
}
</style>
