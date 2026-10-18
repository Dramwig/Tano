<script setup lang="ts">
import { t } from '../i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Table2,
  File,
} from 'lucide-vue-next';
import {
  isDataTableFilePath,
  isMarkdown,
  parentPath,
  isWorkspaceInternalPath,
  type FileEntry,
} from '@tano/protocol';
import FileTreeRename from './FileTreeRename.vue';
import DocumentFileIcon from './DocumentFileIcon.vue';

const props = withDefaults(
  defineProps<{
    entries: FileEntry[];
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
const children = computed(() =>
  props.entries
    .filter((f) => !isWorkspaceInternalPath(f.path) && parentPath(f.path) === props.parent)
    .sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
      if (a.path === '开始使用.md') return -1;
      if (b.path === '开始使用.md') return 1;
      return a.name.localeCompare(b.name, 'zh-CN', { numeric: true });
    }),
);
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
    class="file-tree"
    :role="depth === 0 ? 'tree' : 'group'"
    :aria-label="depth === 0 ? t('文件和文件夹') : undefined"
    @contextmenu.self.stop.prevent="emit('contextBlank', parent, $event)"
    @dragover="treeDragOver"
    @dragleave="emit('dragLeave', parent, $event)"
    @drop="emit('drop', parent, $event)"
  >
    <li v-for="file in children" :key="file.id">
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
        :style="{ paddingLeft: `${4 + depth * 17}px` }"
        :title="file.path"
        :data-entry-id="file.id"
        :aria-selected="selectedIds.has(file.id)"
        :aria-expanded="file.kind === 'directory' ? !isCollapsed(file.path) : undefined"
        @click="clickEntry(file, $event)"
        @mousedown="suppressHeldClick(file, $event)"
        @pointerdown="startTouchHold(file, $event)"
        @pointermove="moveTouchHold"
        @pointerup="cancelTouchHold"
        @pointercancel="cancelTouchHold"
        @pointerleave="cancelTouchHold"
        @pointerenter="emit('prefetch', file)"
        @focus="emit('prefetch', file)"
        @contextmenu.prevent="contextEntry(file, $event)"
        @keydown="keyboardContext(file, $event)"
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
            v-if="file.kind === 'file' && isMarkdown(file.path)"
            :file="file" :icon="documentIcons?.[file.id]" :load="loadDocumentIcon"
          />
          <component v-else
            :is="
              file.kind === 'directory'
                ? isCollapsed(file.path)
                  ? Folder
                  : FolderOpen
                : isDataTableFilePath(file.path)
                  ? Table2
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
          @finish="emit('renameFinished', file)"
        />
        <span v-else class="tree-label">{{
          file.name.replace(/(\.table\.json|\.(md|markdown))$/i, '')
        }}</span>
        <span v-if="file.name === 'AGENTS.md'" class="agent-file-dot" />
      </component>
      <FileTree
        v-if="file.kind === 'directory' && !isCollapsed(file.path)"
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
