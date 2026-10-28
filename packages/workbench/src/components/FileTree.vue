<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { flattenFileTree, indexFileTree } from '../file-tree-model';
import { treeRowHeight, useFileTreeViewport } from '../file-tree-viewport';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  File,
} from 'lucide-vue-next';
import {
  isDataTableFilePath,
  isMarkdown,
  parentPath,
  type FileEntry,
} from '@tano/protocol';
import FileTreeRename from './FileTreeRename.vue';
import DocumentFileIcon from './DocumentFileIcon.vue';
import LoadingSkeleton from './LoadingSkeleton.vue';

const props = withDefaults(
  defineProps<{
    entries: FileEntry[];
    loading?: boolean;
    documentIcons?: Readonly<Record<string, string>>;
    loadDocumentIcon?: (file: FileEntry, signal: AbortSignal) => Promise<string>;
    parent?: string;
    depth?: number;
    selectedIds?: ReadonlySet<string>;
    contextSelected?: string;
    draggedId?: string;
    dropTarget?: string | null;
    canDrag?: (file: FileEntry) => boolean;
    renamingId?: string;
    renameEntry?: (file: FileEntry, name: string) => Promise<void>;
  }>(),
  {
    parent: '',
    depth: 0,
    selectedIds: () => new Set<string>(),
    contextSelected: '',
    draggedId: '',
    dropTarget: null,
  },
);
const emit = defineEmits<{
  open: [file: FileEntry];
  prefetch: [file: FileEntry];
  select: [file: FileEntry, event: MouseEvent];
  context: [file: FileEntry, event: MouseEvent | KeyboardEvent];
  contextBlank: [parent: string, event: MouseEvent];
  dragStart: [file: FileEntry, event: DragEvent];
  dragEnd: [];
  dragOver: [folder: string, event: DragEvent];
  dragLeave: [folder: string, event: DragEvent];
  drop: [folder: string, event: DragEvent];
  renameFinished: [file: FileEntry];
}>();
const collapsed = ref(new Set<string>());
const expanded = ref(new Set<string>());
const hoverExpandDelay = 650;
let hoverExpandTimer: ReturnType<typeof setTimeout> | undefined;
let hoverExpandPath: string | null = null;
const largeTree = computed(() => props.entries.length > 500);
const isCollapsed = (path: string) =>
  largeTree.value ? !expanded.value.has(path) : collapsed.value.has(path);
const treeElement = ref<HTMLElement>();
const virtual = computed(() => !props.loading && props.depth === 0 && largeTree.value);
const folders = computed(() => indexFileTree(props.entries));
const rows = computed(() => props.loading ? [] : virtual.value
  ? flattenFileTree(folders.value, props.parent, props.depth, isCollapsed)
  : (folders.value.get(props.parent) ?? []).map((file, index, children) =>
      ({ file, depth: props.depth, position: index + 1, siblings: children.length })));
const { windowRows, focused, reveal, focus } = useFileTreeViewport(treeElement, virtual, rows,
  () => [props.renamingId, props.draggedId, props.contextSelected]);
const tabStop = computed(() => rows.value.some(row => row.file.id === focused.value) ? focused.value : rows.value[0]?.file.id);
function getVisibleIds(): string[] {
  return virtual.value ? rows.value.map(row => row.file.id)
    : [...(treeElement.value?.querySelectorAll<HTMLElement>('.tree-row[data-entry-id]') ?? [])].map(row => row.dataset.entryId!);
}
defineExpose({ getVisibleIds });
watch(() => props.renamingId, async id => {
  if (!id || !virtual.value) return;
  const file = props.entries.find(file => file.id === id);
  for (let path = file && parentPath(file.path); path; path = parentPath(path)) expanded.value.add(path);
  await nextTick();
  if (props.renamingId === id) reveal(id);
}, { flush: 'post' });

function rowKeydown(file: FileEntry, event: KeyboardEvent) {
  keyboardContext(file, event);
  if (!virtual.value || event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
  const index = rows.value.findIndex(row => row.file.id === file.id);
  let target: string | undefined;
  if (event.key === 'ArrowDown') target = rows.value[index + 1]?.file.id;
  else if (event.key === 'ArrowUp') target = rows.value[index - 1]?.file.id;
  else if (event.key === 'Home') target = rows.value[0]?.file.id;
  else if (event.key === 'End') target = rows.value.at(-1)?.file.id;
  else if (event.key === 'ArrowRight' && file.kind === 'directory') {
    if (isCollapsed(file.path)) toggle(file.path);
    else target = folders.value.get(file.path)?.[0]?.id;
  } else if (event.key === 'ArrowLeft') {
    if (file.kind === 'directory' && !isCollapsed(file.path)) toggle(file.path);
    else target = rows.value.find(row => row.file.path === parentPath(file.path))?.file.id;
  } else return;
  event.preventDefault();
  if (target) void focus(target);
}
function finishRename(file: FileEntry) {
  // Keep the row alive across removal of the editor, even if it was offscreen.
  // FileTreeRename restores focus for Enter/Escape; blur must keep the new target.
  if (virtual.value) focused.value = file.id;
  emit('renameFinished', file);
}
function toggle(path: string) {
  const toggled = largeTree.value ? expanded.value : collapsed.value;
  if (toggled.has(path)) toggled.delete(path);
  else toggled.add(path);
}
function cancelHoverExpand(path?: string) {
  if (path && hoverExpandPath !== path) return;
  if (hoverExpandTimer) clearTimeout(hoverExpandTimer);
  hoverExpandTimer = undefined;
  hoverExpandPath = null;
}
function treeDragOver(event: DragEvent) {
  cancelHoverExpand();
  emit('dragOver', props.parent, event);
}
function rowDragOver(file: FileEntry, event: DragEvent) {
  const folder = file.kind === 'directory' ? file.path : props.parent;
  emit('dragOver', folder, event);
  if (file.kind !== 'directory' || !props.draggedId || !isCollapsed(file.path)) return;
  if (hoverExpandPath === file.path) return;
  cancelHoverExpand();
  hoverExpandPath = file.path;
  hoverExpandTimer = setTimeout(() => {
    hoverExpandTimer = undefined;
    hoverExpandPath = null;
    if (props.draggedId && isCollapsed(file.path)) toggle(file.path);
  }, hoverExpandDelay);
}
function rowDragLeave(file: FileEntry, event: DragEvent) {
  const target = event.currentTarget as HTMLElement | null;
  if (target?.contains(event.relatedTarget as Node | null)) return;
  if (file.kind === 'directory') cancelHoverExpand(file.path);
  emit('dragLeave', file.kind === 'directory' ? file.path : props.parent, event);
}
function rowDrop(file: FileEntry, event: DragEvent) {
  if (file.kind === 'directory') cancelHoverExpand(file.path);
  emit('drop', file.kind === 'directory' ? file.path : props.parent, event);
}
watch(
  () => props.draggedId,
  (draggedId) => {
    if (!draggedId) cancelHoverExpand();
  },
);
let touchHold: { pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined;
let touchFileId: string | undefined;
let heldFileId: string | undefined;
function cancelTouchHold() {
  if (touchHold) clearTimeout(touchHold.timer);
  touchHold = undefined;
  window.removeEventListener('scroll', cancelTouchHold, true);
}
function startTouchHold(file: FileEntry, event: PointerEvent) {
  cancelTouchHold();
  heldFileId = undefined;
  touchFileId = event.pointerType === 'touch' ? file.id : undefined;
  if (!touchFileId || !event.isPrimary || event.button !== 0 || file.id === props.renamingId) return;
  const target = event.currentTarget as HTMLElement;
  const { clientX: x, clientY: y, pointerId: pointer } = event;
  touchHold = { pointer, x, y, timer: setTimeout(() => {
    if (!target.isConnected || file.id === props.renamingId || !props.entries.some(entry => entry.id === file.id)) {
      cancelTouchHold();
      return;
    }
    // Dispatch on the row so menu positioning and focus restoration keep their
    // normal context-menu target on both Android and iOS.
    target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y, button: 2 }));
  }, 550) };
  window.addEventListener('scroll', cancelTouchHold, true);
}
function moveTouchHold(event: PointerEvent) {
  if (touchHold && (event.pointerId !== touchHold.pointer ||
      Math.hypot(event.clientX - touchHold.x, event.clientY - touchHold.y) > 10)) cancelTouchHold();
}
function contextEntry(file: FileEntry, event: MouseEvent) {
  cancelTouchHold();
  if (heldFileId === file.id) return; // Some WebViews also emit their own long-press event.
  if (touchFileId === file.id) heldFileId = file.id;
  emit('context', file, event);
}
onBeforeUnmount(() => { cancelHoverExpand(); cancelTouchHold(); });
function keyboardContext(file: FileEntry, event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  emit('context', file, event);
}
function suppressHeldClick(file: FileEntry, event: MouseEvent) {
  if (heldFileId === file.id && event.detail !== 0) {
    event.preventDefault();
    event.stopPropagation();
    return true;
  }
  return false;
}
function clickEntry(file: FileEntry, event: MouseEvent) {
  if (suppressHeldClick(file, event)) return;
  if (file.id === props.renamingId) return;
  emit('select', file, event);
  if (event.shiftKey || event.ctrlKey || event.metaKey) {
    return;
  }
  if (file.kind === 'directory') toggle(file.path);
  else emit('open', file);
}
</script>

<template>
  <ul
    ref="treeElement"
    class="file-tree"
    :class="{ 'file-tree-virtual': virtual }"
    :style="virtual ? { height: `${rows.length * treeRowHeight}px` } : undefined"
    :role="depth === 0 ? 'tree' : 'group'"
    :aria-label="depth === 0 ? t('文件和文件夹') : undefined"
    @contextmenu.self.stop.prevent="emit('contextBlank', parent, $event)"
    @dragover="treeDragOver"
    @dragleave="emit('dragLeave', parent, $event)"
    @drop="emit('drop', parent, $event)"
  >
    <li v-if="loading" role="none"><LoadingSkeleton variant="tree" :rows="6" :label="t('正在加载…')" /></li>
    <li v-for="{ file, depth: rowDepth, position, siblings, index } in windowRows" :key="file.id"
      :class="{ 'file-tree-virtual-row': virtual }"
      :style="virtual ? { top: `${index * treeRowHeight}px`, height: `${treeRowHeight}px` } : undefined"
      role="none">
      <component
        :is="file.id === renamingId ? 'div' : 'button'"
        class="tree-row"
        role="treeitem"
        :class="{
          selected: selectedIds.has(file.id),
          'multi-selected': selectedIds.size > 1 && selectedIds.has(file.id),
          'context-target': file.id === contextSelected,
          dragging: file.id === draggedId,
          'drop-target': file.kind === 'directory' && file.path === dropTarget,
          attachment:
            file.kind === 'file' && !isMarkdown(file.path) && !isDataTableFilePath(file.path),
        }"
        :draggable="file.id !== renamingId && (canDrag?.(file) ?? false)"
        :style="{ paddingLeft: `${4 + rowDepth * 17}px`, '--tree-depth': rowDepth }"
        :title="file.path"
        :data-entry-id="file.id"
        :aria-selected="selectedIds.has(file.id)"
        :aria-level="rowDepth + 1"
        :aria-posinset="position"
        :aria-setsize="siblings"
        :tabindex="virtual && file.id !== renamingId ? (file.id === tabStop ? 0 : -1) : undefined"
        :aria-expanded="file.kind === 'directory' ? !isCollapsed(file.path) : undefined"
        @click="clickEntry(file, $event)"
        @mousedown="suppressHeldClick(file, $event)"
        @pointerdown="startTouchHold(file, $event)"
        @pointermove="moveTouchHold"
        @pointerup="cancelTouchHold"
        @pointercancel="cancelTouchHold"
        @pointerleave="cancelTouchHold"
        @pointerenter="emit('prefetch', file)"
        @focus="focused = file.id; emit('prefetch', file)"
        @contextmenu.prevent="contextEntry(file, $event)"
        @keydown="rowKeydown(file, $event)"
        @dragstart="emit('dragStart', file, $event)"
        @dragend="emit('dragEnd')"
        @dragover="rowDragOver(file, $event)"
        @dragleave="rowDragLeave(file, $event)"
        @drop="rowDrop(file, $event)"
      >
        <span
          class="tree-icon"
          :class="{ 'tree-icon-expandable': file.kind === 'directory' }"
          aria-hidden="true"
        >
          <DocumentFileIcon
            v-if="file.kind === 'file' && (isMarkdown(file.path) || isDataTableFilePath(file.path))"
            :file="file" :icon="documentIcons?.[file.id]" :load="isMarkdown(file.path) ? loadDocumentIcon : undefined"
          />
          <component v-else
            :is="
              file.kind === 'directory'
                ? isCollapsed(file.path)
                  ? Folder
                  : FolderOpen
                : File
            "
            :size="16"
            :stroke-width="1.6"
            class="tree-item-icon"
          />
          <component
            :is="isCollapsed(file.path) ? ChevronRight : ChevronDown"
            v-if="file.kind === 'directory'"
            :size="13"
            class="tree-chevron"
          />
        </span>
        <FileTreeRename
          v-if="file.id === renamingId && renameEntry"
          :file="file"
          :rename="renameEntry"
          @finish="finishRename(file)"
        />
        <span v-else class="tree-label">{{
          file.name.replace(/(\.table\.json|\.(md|markdown))$/i, '')
        }}</span>
        <span v-if="file.name === 'AGENTS.md'" class="agent-file-dot" />
      </component>
      <FileTree
        v-if="!virtual && file.kind === 'directory' && !isCollapsed(file.path)"
        :entries="entries"
        :document-icons="documentIcons"
        :load-document-icon="loadDocumentIcon"
        :parent="file.path"
        :depth="depth + 1"
        :selected-ids="selectedIds"
        :context-selected="contextSelected"
        :dragged-id="draggedId"
        :drop-target="dropTarget"
        :can-drag="canDrag"
        :renaming-id="renamingId"
        :rename-entry="renameEntry"
        @open="emit('open', $event)"
        @prefetch="emit('prefetch', $event)"
        @select="(entry, event) => emit('select', entry, event)"
        @context="(entry, event) => emit('context', entry, event)"
        @context-blank="(folder, event) => emit('contextBlank', folder, event)"
        @drag-start="(entry, event) => emit('dragStart', entry, event)"
        @drag-end="emit('dragEnd')"
        @drag-over="(folder, event) => emit('dragOver', folder, event)"
        @drag-leave="(folder, event) => emit('dragLeave', folder, event)"
        @drop="(folder, event) => emit('drop', folder, event)"
        @rename-finished="emit('renameFinished', $event)"
      />
    </li>
  </ul>
</template>

<style>
.file-tree-virtual { position: relative; overflow-anchor: none; }
.file-tree-virtual-row { position: absolute; left: 0; right: 0; display: flow-root; }
</style>
