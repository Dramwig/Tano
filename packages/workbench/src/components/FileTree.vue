<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import {
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  FileText,
  File,
  Bot,
} from 'lucide-vue-next';
import { isMarkdown, parentPath, isWorkspaceInternalPath, type FileEntry } from '@tano/protocol';

const props = withDefaults(
  defineProps<{
    entries: FileEntry[];
    parent?: string;
    depth?: number;
    selectedIds?: ReadonlySet<string>;
    contextSelected?: string;
    draggedId?: string;
    dropTarget?: string | null;
    canDrag?: (file: FileEntry) => boolean;
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
  select: [file: FileEntry, event: MouseEvent];
  context: [file: FileEntry, event: MouseEvent | KeyboardEvent];
  contextBlank: [parent: string, event: MouseEvent];
  dragStart: [file: FileEntry, event: DragEvent];
  dragEnd: [];
  dragOver: [folder: string, event: DragEvent];
  dragLeave: [folder: string, event: DragEvent];
  drop: [folder: string, event: DragEvent];
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
onBeforeUnmount(cancelHoverExpand);
function keyboardContext(file: FileEntry, event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  emit('context', file, event);
}
function clickEntry(file: FileEntry, event: MouseEvent) {
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
    :aria-label="depth === 0 ? '文件和文件夹' : undefined"
    @contextmenu.self.stop.prevent="emit('contextBlank', parent, $event)"
    @dragover="treeDragOver"
    @dragleave="emit('dragLeave', parent, $event)"
    @drop="emit('drop', parent, $event)"
  >
    <li v-for="file in children" :key="file.id">
      <button
        class="tree-row"
        role="treeitem"
        :class="{
          selected: selectedIds.has(file.id),
          'multi-selected': selectedIds.size > 1 && selectedIds.has(file.id),
          'context-target': file.id === contextSelected,
          dragging: file.id === draggedId,
          'drop-target': file.kind === 'directory' && file.path === dropTarget,
          attachment: file.kind === 'file' && !isMarkdown(file.path),
        }"
        :draggable="canDrag?.(file) ?? false"
        :style="{ paddingLeft: `${12 + depth * 17}px` }"
        :title="file.path"
        :data-entry-id="file.id"
        :aria-selected="selectedIds.has(file.id)"
        :aria-expanded="file.kind === 'directory' ? !isCollapsed(file.path) : undefined"
        @click="clickEntry(file, $event)"
        @contextmenu.prevent="emit('context', file, $event)"
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
          <component
            :is="
              file.kind === 'directory'
                ? isCollapsed(file.path)
                  ? Folder
                  : FolderOpen
                : file.name === 'AGENTS.md'
                  ? Bot
                  : isMarkdown(file.path)
                    ? FileText
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
        <span class="tree-label">{{ file.name.replace(/\.(md|markdown)$/i, '') }}</span>
        <span v-if="file.name === 'AGENTS.md'" class="agent-file-dot" />
      </button>
      <FileTree
        v-if="file.kind === 'directory' && !isCollapsed(file.path)"
        :entries="entries"
        :parent="file.path"
        :depth="depth + 1"
        :selected-ids="selectedIds"
        :context-selected="contextSelected"
        :dragged-id="draggedId"
        :drop-target="dropTarget"
        :can-drag="canDrag"
        @open="emit('open', $event)"
        @select="(entry, event) => emit('select', entry, event)"
        @context="(entry, event) => emit('context', entry, event)"
        @context-blank="(folder, event) => emit('contextBlank', folder, event)"
        @drag-start="(entry, event) => emit('dragStart', entry, event)"
        @drag-end="emit('dragEnd')"
        @drag-over="(folder, event) => emit('dragOver', folder, event)"
        @drag-leave="(folder, event) => emit('dragLeave', folder, event)"
        @drop="(folder, event) => emit('drop', folder, event)"
      />
    </li>
  </ul>
</template>
