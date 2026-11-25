<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();

import { isNode } from '@tano/editor/dom-realm';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import { useWorkspaceStore } from '../../stores/workspace';
import { useAssistantStore } from '../../assistant/store';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import PluginIcon from '../../plugins/components/PluginIcon.vue';
import { applyOverlayToWorkspaceViews } from '../../plugins/overlay-mapping';
import { Check, Ellipsis, FolderOpen, CalendarDays, Bot, Puzzle } from 'lucide-vue-next';
const store = useWorkspaceStore();
const assistant = useAssistantStore();
const props = defineProps<{ active: boolean; modelValue: string }>();
const emit = defineEmits<{ open: []; 'update:modelValue': [value: string] }>();
const views = computed(() => {
  const base = [
    { id: 'repository', label: t('文件'), icon: FolderOpen },
    ...(store.workspaceSettings.showPlan ? [{ id: 'events', label: t('事件与任务'), icon: CalendarDays }] : []),
    ...(assistant.available ? [{ id: 'assistant', label: t('助手'), icon: Bot }] : []),
    ...(store.workspaceSettings.showPlugins ? [{ id: 'plugin-views', label: t('插件'), icon: Puzzle }] : []),
    ...store.pluginViews.filter(view => view.location === 'sidebar').map(view => ({ id: `plugin-sidebar:${view.key}`, label: view.label, icon: PluginIcon, pluginId: view.pluginId })),
  ];
  const snapshot = store.overlaySnapshot;
  return applyOverlayToWorkspaceViews(base, snapshot?.hiddenSidebarItems, snapshot?.sidebarOrder);
});
type View = (typeof views.value)[number];
// Views are shown as one row of icon tabs. Plugin sidebars can add many entries, so anything past the
// row's capacity moves into a trailing "more" menu instead of wrapping or scrolling the sidebar header.
const MAX_TABS = 5;
const tabs = computed(() => views.value.length <= MAX_TABS ? views.value : views.value.slice(0, MAX_TABS - 1));
const overflow = computed(() => views.value.slice(tabs.value.length));
const selected = computed(() => views.value.find(view => view.id === props.modelValue) ?? views.value[0]);
const selectedInOverflow = computed(() => overflow.value.some(view => view.id === selected.value.id));
const pluginId = (view: View) => ('pluginId' in view ? String(view.pluginId) : undefined);

const menuId = useId();
const tablist = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const menuElement = ref<HTMLElement>();
const position = ref<{ left: number; top: number; width: number; maxHeight: number }>();
function close(restoreFocus = false) {
  position.value = undefined;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
async function open() {
  if (!trigger.value) return;
  emit('open');
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(240, window.innerWidth - 16);
  const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 48));
  position.value = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    top,
    width,
    maxHeight: Math.min(360, window.innerHeight - top - 8),
  };
  await nextTick();
  menuElement.value
    ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
    ?.focus({ preventScroll: true });
}
function toggle() {
  if (position.value) close();
  else void open();
}
function select(id: string, fromMenu = false) {
  if (fromMenu) close(true);
  if (id !== props.modelValue) emit('update:modelValue', id);
}
/** Roving focus across the tab row: arrows move, Enter/Space activate (manual activation). */
function tabKeydown(event: KeyboardEvent) {
  if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...(tablist.value?.querySelectorAll<HTMLButtonElement>(':scope > button') ?? [])];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0) return;
  event.preventDefault();
  const next =
    event.key === 'Home' ? 0
      : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === 'Tab') {
    close(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const buttons = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home' ? 0
        : event.key === 'End' ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}
function outside(event: Event) {
  if (isNode(event.target) && (trigger.value?.contains(event.target) || menuElement.value?.contains(event.target))) return;
  close();
}
function dismiss() {
  close();
}
watch(() => props.active, (active) => { if (!active) close(); });
watch(() => props.modelValue, dismiss);
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('click', outside, true);
  window.addEventListener('contextmenu', outside, true);
  window.addEventListener('scroll', outside, true);
  window.addEventListener('resize', dismiss);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('click', outside, true);
  window.removeEventListener('contextmenu', outside, true);
  window.removeEventListener('scroll', outside, true);
  window.removeEventListener('resize', dismiss);
});
</script>

<template>
  <div ref="tablist" class="workspace-view-tabs" role="tablist" :aria-label="t('侧边栏视图')" @keydown="tabKeydown">
    <button
      v-for="item in tabs"
      :key="item.id"
      type="button"
      role="tab"
      class="workspace-view-tab"
      :aria-selected="item.id === selected.id"
      :tabindex="item.id === selected.id ? 0 : -1"
      :aria-label="item.label"
      :data-tooltip="item.id === selected.id ? undefined : item.label"
      @click="select(item.id)"
    >
      <component :is="item.icon" :id="pluginId(item)" :size="16" :stroke-width="1.7" aria-hidden="true" />
      <span aria-hidden="true"><span>{{ item.label }}</span></span>
    </button>
    <button
      v-if="overflow.length"
      ref="trigger"
      type="button"
      role="tab"
      class="workspace-view-tab"
      :aria-selected="selectedInOverflow"
      :tabindex="selectedInOverflow ? 0 : -1"
      :aria-label="selectedInOverflow ? selected.label : t('更多')"
      :data-tooltip="selectedInOverflow ? undefined : t('更多')"
      aria-haspopup="menu"
      :aria-expanded="!!position"
      :aria-controls="menuId"
      @click="toggle"
      @keydown.down.prevent="open"
    >
      <component
        :is="selectedInOverflow ? selected.icon : Ellipsis"
        :id="selectedInOverflow ? pluginId(selected) : undefined"
        :size="16"
        :stroke-width="1.7"
        aria-hidden="true"
      />
      <span aria-hidden="true"><span>{{ selectedInOverflow ? selected.label : '' }}</span></span>
    </button>
  </div>
  <Teleport :to="document.body">
    <div v-surface-motion="'WorkspaceViewSwitcher:0'"
      v-if="position"
      :id="menuId"
      ref="menuElement"
      class="dropdown compact-action-menu workspace-view-menu"
      role="menu"
      :aria-label="t('侧边栏视图')"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
      }"
      @keydown="menuKeydown"
    >
      <button v-for="item in overflow" :key="item.id" type="button" role="menuitemradio"
        :aria-checked="item.id === modelValue" @click="select(item.id, true)">
        <component :is="item.icon" :id="pluginId(item)" :size="15" aria-hidden="true" />
        <span class="workspace-view-menu-label">{{ item.label }}</span>
        <Check v-if="item.id === modelValue" :size="14" aria-hidden="true" />
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
:deep(.plugin-icon) { width: 16px; height: 16px; }
.workspace-view-tabs {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  margin-left: -4px;
}
.workspace-view-tab {
  display: inline-flex;
  align-items: center;
  flex: 0 0 auto;
  min-width: 28px;
  height: 28px;
  padding: 0 6px;
  border-radius: 7px;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  white-space: nowrap;
  transition: background-color 160ms ease, color 160ms ease;
}
.workspace-view-tab > svg,
.workspace-view-tab > :deep(.plugin-icon) {
  flex-shrink: 0;
}
/* The active tab reveals its label so the current view is always named, while inactive tabs stay icon-only. */
.workspace-view-tab > span {
  display: grid;
  grid-template-columns: 0fr;
  overflow: hidden;
  margin-left: 0;
  opacity: 0;
  transition:
    grid-template-columns var(--motion-spring) var(--ease-spring-smooth),
    margin-left var(--motion-spring) var(--ease-spring-smooth),
    opacity var(--motion-base) var(--ease-standard);
}
/* Clip (no ellipsis) so the label slides out cleanly while the column animates open. */
.workspace-view-tab > span > span {
  min-width: 0;
  overflow: hidden;
}
.workspace-view-tab:hover,
.workspace-view-tab[aria-expanded='true'] {
  background: var(--hover);
  color: var(--text);
}
.workspace-view-tab[aria-selected='true'] {
  background: var(--hover);
  color: var(--text);
}
.workspace-view-tab[aria-selected='true'] > span {
  grid-template-columns: 1fr;
  margin-left: 6px;
  opacity: 1;
}
.workspace-view-tab:focus-visible {
  outline: 2px solid var(--text-secondary);
  outline-offset: -2px;
}
.workspace-view-menu {
  position: fixed;
  z-index: 100;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.workspace-view-menu button {
  min-height: 32px;
  padding: 6px 7px;
}
.workspace-view-menu button > svg {
  flex-shrink: 0;
}
.workspace-view-menu button[aria-checked='true'] {
  color: var(--green);
}
.workspace-view-menu-label {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .workspace-view-tab > span { transition: none; }
}
</style>
