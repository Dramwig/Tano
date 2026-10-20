<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch, type Component } from 'vue';
import { ArrowLeft, BookOpen, Check, ChevronRight, File, FileText, Table2, FolderOpen, LockKeyhole } from 'lucide-vue-next';
import { basename, isMarkdown, isDataTableFilePath, isWorkspaceInternalPath, parentPath, type FileEntry } from '@tano/protocol';
import { butterflyPerchDirective, useButterflyController, type ButterflyPerch } from '../assistant/butterfly-vue';

const vButterflyPerch = butterflyPerchDirective(useButterflyController());

const props = defineProps<{
  workspaceId?: string;
  workspaceName: string;
  entries: FileEntry[];
  path?: string;
  pages?: { id: string; label: string; icon?: Component; current?: boolean; disabled?: boolean }[];
  demoLabel?: string | null;
  readOnly?: boolean;
  perch?: ButterflyPerch;
}>();
const emit = defineEmits<{ open: [file: FileEntry]; navigate: [id: string] }>();
const menuId = useId();
const root = ref<HTMLElement>();
const menu = ref<HTMLElement>();
const opened = ref(false);
const anchorKey = ref('');
const folder = ref('');
const position = ref({ left: '0px', top: '0px' });
let trigger: HTMLButtonElement | undefined;
const parts = computed(() => (props.path ?? '').split('/').filter(Boolean).map((name, index, all) => ({
  name,
  path: all.slice(0, index + 1).join('/'),
  current: index === all.length - 1,
})));
const children = computed(() => props.entries
  .filter(entry => !isWorkspaceInternalPath(entry.path) && parentPath(entry.path) === folder.value)
  .sort((a, b) => a.kind !== b.kind ? (a.kind === 'directory' ? -1 : 1)
    : a.name.localeCompare(b.name, 'zh-CN', { numeric: true })));
const folderLabel = computed(() => folder.value ? basename(folder.value) : props.workspaceName);
const fileLabel = (entry: FileEntry) => entry.kind === 'file' && (isMarkdown(entry.path) || isDataTableFilePath(entry.path))
  ? entry.name.replace(/(\.table\.json|\.(md|markdown))$/i, '') : entry.name;

function close(restoreFocus = false) {
  opened.value = false;
  if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
}
function placeMenu() {
  if (!opened.value || !trigger || !menu.value) return;
  const anchor = trigger.getBoundingClientRect();
  const bounds = menu.value.getBoundingClientRect();
  const edge = 8;
  position.value = {
    left: `${Math.max(edge, Math.min(anchor.left, window.innerWidth - bounds.width - edge))}px`,
    top: `${Math.max(edge, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - edge))}px`,
  };
}
function rows() {
  return [...(menu.value?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
}
async function focusEntry(path?: string, last = false) {
  await nextTick();
  if (!opened.value) return;
  placeMenu();
  const items = rows();
  const selected = path ? items.find(item => item.dataset.path === path) : undefined;
  (selected ?? (last ? items.at(-1) : items[0]) ?? menu.value)?.focus({ preventScroll: true });
  selected?.scrollIntoView?.({ block: 'nearest' });
}
function show(event: MouseEvent | KeyboardEvent, key: string, directory: string) {
  if (opened.value && anchorKey.value === key && event.type === 'click') {
    close(true);
    return;
  }
  trigger = event.currentTarget as HTMLButtonElement;
  anchorKey.value = key;
  folder.value = directory;
  opened.value = true;
  void focusEntry(props.path, event instanceof KeyboardEvent && event.key === 'ArrowUp');
}
function choose(entry: FileEntry) {
  if (entry.kind === 'directory') {
    folder.value = entry.path;
    void focusEntry(props.path);
  } else {
    close(true);
    emit('open', entry);
  }
}
function goBack() {
  if (!folder.value) return;
  const previous = folder.value;
  folder.value = parentPath(previous);
  void focusEntry(previous);
}
function menuKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  event.stopPropagation();
  if (event.key === 'Escape') {
    event.preventDefault();
    close(true);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (folder.value) goBack();
    else close(true);
  } else if (event.key === 'ArrowRight') {
    event.preventDefault();
    const path = (document.activeElement as HTMLElement)?.dataset.path;
    const entry = children.value.find(item => item.path === path && item.kind === 'directory');
    if (entry) choose(entry);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = rows();
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  } else if (event.key === 'Tab') {
    // Return to the trigger before the browser advances focus out of the menu.
    close(true);
  }
}
function outside(event: Event) {
  if (!root.value?.contains(event.target as Node) && !menu.value?.contains(event.target as Node)) close();
}
function onScroll(event: Event) {
  if (!menu.value?.contains(event.target as Node)) placeMenu();
}
watch(() => [props.workspaceId, props.path], () => close());
watch(children, async () => {
  if (!opened.value) return;
  if (folder.value && !props.entries.some(entry => entry.kind === 'directory' && entry.path === folder.value)) {
    close(true);
    return;
  }
  await nextTick();
  placeMenu();
  if (document.activeElement === document.body) void focusEntry();
});
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside);
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', onScroll, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside);
  window.removeEventListener('resize', placeMenu);
  window.removeEventListener('scroll', onScroll, true);
});
</script>

<template>
  <nav ref="root" class="breadcrumb" :aria-label="t('当前位置')">
    <button type="button" class="breadcrumb-trigger breadcrumb-workspace"
      :class="{ 'demo-badge breadcrumb-demo-badge': demoLabel }"
      :disabled="!workspaceId" :data-tooltip="demoLabel ? t('浏览器演示 · 数据仅保存在本浏览器') : workspaceName"
      :aria-label="t('浏览工作区：{0}', [workspaceName])" aria-haspopup="menu"
      :aria-expanded="opened && anchorKey === 'workspace'" :aria-controls="opened && anchorKey === 'workspace' ? menuId : undefined"
      @click="show($event, 'workspace', '')" @keydown.down.prevent.stop="show($event, 'workspace', '')"
      @keydown.up.prevent.stop="show($event, 'workspace', '')" @keydown.esc.stop.prevent="close(true)">
      <LockKeyhole v-if="demoLabel && readOnly" :size="14" /><BookOpen v-else :size="14" />
      <span class="breadcrumb-workspace-label">{{ demoLabel || workspaceName }}</span>
    </button>
    <slot />
    <template v-for="page in pages" :key="page.id">
      <ChevronRight :size="12" class="breadcrumb-separator" aria-hidden="true" />
      <component :is="page.current ? 'span' : 'button'" class="breadcrumb-trigger breadcrumb-page"
        :class="{ 'breadcrumb-current': page.current }" :type="page.current ? undefined : 'button'"
        :aria-current="page.current ? 'page' : undefined" :disabled="page.current ? undefined : page.disabled"
        :title="page.label" @click="!page.current && !page.disabled && emit('navigate', page.id)">
        <component :is="page.icon" v-if="page.icon" :size="14" aria-hidden="true" />
        <span>{{ page.label }}</span>
      </component>
    </template>
    <template v-for="part in parts" :key="part.path">
      <ChevronRight :size="12" class="breadcrumb-separator" aria-hidden="true" />
      <button type="button" class="breadcrumb-trigger" :class="{ 'breadcrumb-current': part.current }"
        v-butterfly-perch="part.current ? perch : undefined"
        :data-tooltip="part.path" :aria-label="part.current ? t('切换文件：{0}', [part.name]) : t('浏览目录：{0}', [part.path])"
        :aria-current="part.current ? 'page' : undefined" aria-haspopup="menu"
        :aria-expanded="opened && anchorKey === part.path" :aria-controls="opened && anchorKey === part.path ? menuId : undefined"
        @click="show($event, part.path, part.current ? parentPath(part.path) : part.path)"
        @keydown.down.prevent.stop="show($event, part.path, part.current ? parentPath(part.path) : part.path)"
        @keydown.up.prevent.stop="show($event, part.path, part.current ? parentPath(part.path) : part.path)"
        @keydown.esc.stop.prevent="close(true)">
        <component :is="part.current ? (isDataTableFilePath(part.path) ? Table2 : isMarkdown(part.path) ? FileText : File) : FolderOpen" :size="14" />
        <span>{{ part.current && (isMarkdown(part.path) || isDataTableFilePath(part.path)) ? part.name.replace(/(\.table\.json|\.(md|markdown))$/i, '') : part.name }}</span>
      </button>
    </template>
  </nav>
  <Teleport to="body">
    <div v-if="opened" :id="menuId" ref="menu" class="breadcrumb-menu" :style="position"
      role="menu" :aria-label="t('浏览目录：{0}', [folderLabel])" tabindex="-1" @keydown="menuKeydown">
      <div class="breadcrumb-menu-heading">
        <button v-if="folder" type="button" class="breadcrumb-menu-back" role="menuitem"
          :aria-label="t('返回上级目录')" :data-tooltip="t('返回上级目录')" @click="goBack"><ArrowLeft :size="15" /></button>
        <span :title="folder || workspaceName">{{ folderLabel }}</span>
      </div>
      <div class="breadcrumb-menu-list panel-scrollbar">
        <button v-for="entry in children" :key="entry.id" type="button" class="breadcrumb-menu-entry"
          :class="{ 'is-current': entry.path === path }" role="menuitem" :data-path="entry.path"
          :data-tooltip="entry.name" :aria-current="entry.path === path ? 'page' : undefined" @click="choose(entry)">
          <component :is="entry.kind === 'directory' ? FolderOpen : isDataTableFilePath(entry.path) ? Table2 : isMarkdown(entry.path) ? FileText : File" :size="17" :stroke-width="1.6" />
          <span>{{ fileLabel(entry) }}</span>
          <ChevronRight v-if="entry.kind === 'directory'" :size="14" class="breadcrumb-menu-trailing" />
          <Check v-else-if="entry.path === path" :size="14" class="breadcrumb-menu-trailing" />
        </button>
        <p v-if="!children.length" class="breadcrumb-menu-empty">{{ t('此目录为空') }}</p>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.breadcrumb { gap: 2px; }
.breadcrumb > .breadcrumb-trigger {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  margin: 0;
  padding: 5px 6px;
  border-radius: 6px;
  color: inherit;
  font-size: inherit;
  text-align: left;
}
.breadcrumb > .breadcrumb-current { color: var(--text); }
.breadcrumb-trigger > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breadcrumb-trigger > svg, .breadcrumb-separator { flex-shrink: 0; }
button.breadcrumb-trigger:hover, .breadcrumb-trigger[aria-expanded='true'] { background: var(--hover); }
.breadcrumb-trigger:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.breadcrumb-menu {
  position: fixed;
  z-index: 75;
  display: flex;
  flex-direction: column;
  width: 280px;
  max-width: calc(100vw - 16px);
  max-height: min(380px, calc(100dvh - 16px));
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  box-shadow: 0 8px 28px #00000016, 0 2px 6px #00000008;
  color: var(--text);
  font-size: 13px;
}
.breadcrumb-menu-heading { display: flex; align-items: center; gap: 5px; min-height: 31px; padding: 2px 7px 5px; color: var(--muted); }
.breadcrumb-menu-heading > span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breadcrumb-menu-back { display: grid; place-items: center; flex-shrink: 0; width: 26px; height: 26px; margin-left: -4px; border-radius: 5px; }
.breadcrumb-menu-list {
  min-height: 0;
  margin-right: -4px;
  padding-right: 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.breadcrumb-menu-entry { display: flex; align-items: center; gap: 9px; width: 100%; min-height: 34px; padding: 7px 9px; border-radius: 7px; text-align: left; }
.breadcrumb-menu-entry > svg { flex-shrink: 0; color: var(--muted); }
.breadcrumb-menu-entry > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.breadcrumb-menu-trailing { margin-left: auto; }
.breadcrumb-menu-entry.is-current { background: var(--surface); }
.breadcrumb-menu-entry.is-current > .breadcrumb-menu-trailing { color: var(--green); }
.breadcrumb-menu-entry:hover, .breadcrumb-menu-back:hover { background: var(--hover); }
.breadcrumb-menu-entry:focus-visible, .breadcrumb-menu-back:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; background: var(--hover); }
.breadcrumb-menu-empty { margin: 0; padding: 20px 9px; color: var(--muted); text-align: center; }
@media (max-width: 700px) {
  .breadcrumb > .breadcrumb-workspace { flex-shrink: 0; }
  .breadcrumb-workspace:not(.breadcrumb-demo-badge) .breadcrumb-workspace-label { display: none; }
  .breadcrumb > .breadcrumb-trigger:not(.breadcrumb-workspace):not(.breadcrumb-current):not(.breadcrumb-page),
  .breadcrumb > .breadcrumb-separator { display: none; }
  .breadcrumb > .breadcrumb-separator:last-of-type { display: block; }
}
</style>
