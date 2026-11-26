<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { Check, Folder, Search } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import {
  buildAccountFolderTree,
  buildMoveTargetSections,
  type MailFolderTreeNode,
} from '../mail-folders';
import { folderIcon, localizedFolderLabel } from '../mail-folder-ui';
import type { MailFolder } from '../types';

const props = defineProps<{
  open: boolean;
  anchorRect: DOMRect | null;
  folders: readonly MailFolder[];
  currentFolderId: string;
  busy?: boolean;
}>();

const emit = defineEmits<{
  select: [folderId: string];
  close: [restoreFocus?: boolean];
}>();

const panelRef = ref<HTMLElement>();
const searchRef = ref<HTMLInputElement>();
const query = ref('');
const highlightedIndex = ref(0);
const panelStyle = ref<Record<string, string>>({});

const showSearch = computed(() => props.folders.length > 5);

const tree = computed(() => buildAccountFolderTree(props.folders));

function labelOf(node: MailFolderTreeNode): string {
  return localizedFolderLabel(node.specialUse, node.label);
}

const sections = computed(() => buildMoveTargetSections(tree.value, query.value, labelOf));

const selectableIds = computed(() => {
  const ids: string[] = [];
  for (const list of [sections.value.primary, sections.value.secondary]) {
    for (const node of list) {
      if (node.folder && node.folder.id !== props.currentFolderId) {
        ids.push(node.folder.id);
      }
    }
  }
  return ids;
});

const hasAnyRows = computed(
  () => sections.value.primary.length > 0 || sections.value.secondary.length > 0,
);

function updatePosition() {
  const rect = props.anchorRect;
  if (!rect) return;
  const margin = 8;
  const width = 248;
  const panelHeight = panelRef.value?.offsetHeight ?? 320;
  const vw = window.innerWidth;
  const vh = window.innerHeight;

  let left = rect.right - width;
  if (left < margin) left = Math.min(rect.left, vw - width - margin);
  left = Math.max(margin, Math.min(left, vw - width - margin));

  const spaceBelow = vh - rect.bottom - margin;
  const spaceAbove = rect.top - margin;
  let top = rect.bottom + 6;
  let maxHeight = Math.min(340, Math.max(160, spaceBelow - 6));
  if (spaceBelow < Math.min(panelHeight, 220) && spaceAbove > spaceBelow) {
    maxHeight = Math.min(340, Math.max(160, spaceAbove - 6));
    top = Math.max(margin, rect.top - Math.min(panelHeight, maxHeight) - 6);
  }

  panelStyle.value = {
    top: `${Math.round(top)}px`,
    left: `${Math.round(left)}px`,
    width: `${width}px`,
    maxHeight: `${Math.round(maxHeight)}px`,
  };
}

function onDocumentPointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (!target || panelRef.value?.contains(target)) return;
  emit('close', false);
}

function onViewportChange(event: Event) {
  if (event.type === 'scroll' && panelRef.value?.contains(event.target as Node | null)) {
    return;
  }
  emit('close', false);
}

function attachListeners() {
  document.addEventListener('pointerdown', onDocumentPointerDown, true);
  window.addEventListener('resize', onViewportChange);
  window.addEventListener('scroll', onViewportChange, true);
}

function detachListeners() {
  document.removeEventListener('pointerdown', onDocumentPointerDown, true);
  window.removeEventListener('resize', onViewportChange);
  window.removeEventListener('scroll', onViewportChange, true);
}

watch(
  () => [props.open, props.anchorRect] as const,
  async ([isOpen]) => {
    if (!isOpen) {
      detachListeners();
      query.value = '';
      highlightedIndex.value = 0;
      return;
    }
    query.value = '';
    highlightedIndex.value = 0;
    attachListeners();
    updatePosition();
    await nextTick();
    updatePosition();
    if (showSearch.value) {
      searchRef.value?.focus({ preventScroll: true });
    } else {
      panelRef.value?.focus({ preventScroll: true });
    }
  },
  { immediate: true },
);

watch(selectableIds, (ids) => {
  if (highlightedIndex.value >= ids.length) {
    highlightedIndex.value = Math.max(0, ids.length - 1);
  }
});

onBeforeUnmount(detachListeners);

function isHighlighted(folderId: string): boolean {
  return selectableIds.value[highlightedIndex.value] === folderId;
}

function highlightFolder(folderId: string) {
  const idx = selectableIds.value.indexOf(folderId);
  if (idx >= 0) highlightedIndex.value = idx;
}

function pick(folderId: string) {
  if (props.busy || folderId === props.currentFolderId) return;
  emit('select', folderId);
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    emit('close', true);
    return;
  }
  const ids = selectableIds.value;
  if (!ids.length) return;
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value + 1) % ids.length;
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    highlightedIndex.value = (highlightedIndex.value - 1 + ids.length) % ids.length;
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const targetId = ids[highlightedIndex.value];
    if (targetId) pick(targetId);
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && anchorRect"
      ref="panelRef"
      class="mail-move-popover"
      :style="panelStyle"
      role="dialog"
      :aria-label="t('移动到文件夹')"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <div v-if="showSearch" class="mail-move-search">
        <Search :size="13" aria-hidden="true" />
        <input
          ref="searchRef"
          v-model="query"
          type="text"
          :placeholder="t('筛选文件夹…')"
          :aria-label="t('筛选文件夹…')"
        />
      </div>
      <div v-else class="mail-move-heading">{{ t('移动到文件夹') }}</div>

      <div class="mail-move-list" role="listbox" :aria-label="t('移动到文件夹')">
        <p v-if="!hasAnyRows" class="mail-move-empty">{{ t('没有匹配的文件夹') }}</p>
        <template
          v-for="(sectionRows, sectionIdx) in [sections.primary, sections.secondary]"
          :key="sectionIdx"
        >
          <div
            v-if="sectionIdx === 1 && sections.primary.length && sectionRows.length"
            class="mail-move-divider"
            role="separator"
          />
          <template v-for="node in sectionRows" :key="node.key">
            <div
              v-if="!node.folder"
              class="mail-move-group"
              :style="{ '--depth': node.depth }"
              :title="node.fullPath"
            >
              <Folder :size="14" aria-hidden="true" />
              <span>{{ labelOf(node) }}</span>
            </div>
            <button
              v-else
              type="button"
              class="mail-move-option"
              role="option"
              :class="{
                current: node.folder.id === currentFolderId,
                highlighted: isHighlighted(node.folder.id),
              }"
              :style="{ '--depth': node.depth }"
              :disabled="busy || node.folder.id === currentFolderId"
              :aria-selected="node.folder.id === currentFolderId"
              :title="node.fullPath"
              @mouseenter="highlightFolder(node.folder.id)"
              @click="pick(node.folder.id)"
            >
              <component :is="folderIcon(node.specialUse)" :size="14" aria-hidden="true" />
              <span class="mail-move-option-text">
                <span class="mail-move-option-name">{{ labelOf(node) }}</span>
                <span
                  v-if="sections.filtered && node.fullPath !== labelOf(node)"
                  class="mail-move-option-path"
                >
                  {{ node.fullPath }}
                </span>
              </span>
              <Check
                v-if="node.folder.id === currentFolderId"
                :size="13"
                class="mail-move-check"
                :aria-label="t('当前文件夹')"
              />
            </button>
          </template>
        </template>
      </div>
    </div>
  </Teleport>
</template>
