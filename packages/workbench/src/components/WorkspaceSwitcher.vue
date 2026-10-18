<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Check, ChevronDown, ExternalLink } from 'lucide-vue-next';
import WorkspaceIcon from './WorkspaceIcon.vue';
import type { RecentWorkspace } from '@tano/protocol';
type WorkspaceEntry = Pick<RecentWorkspace, 'id' | 'name' | 'path' | 'icon'>;
import { useWorkspaceStore } from '../stores/workspace';
import { native } from '../adapter';
import { mobile } from '../platform';

const props = defineProps<{ active: boolean }>();
const emit = defineEmits<{
  open: [];
  context: [item: WorkspaceEntry, event: MouseEvent];
}>();
const store = useWorkspaceStore();
const menuId = useId();
const trigger = ref<HTMLButtonElement>();
const menuElement = ref<HTMLElement>();
const position = ref<{ left: number; top: number; width: number; maxHeight: number }>();
const workspaces = computed(() => {
  const current = store.workspace;
  if (!current) return store.recent;
  return [{ ...current, icon: store.workspaceSettings.icon }, ...store.recent.filter((item) => item.id !== current.id)];
});
const showPathTooltip = !store.isWeb && !store.isDemo && !mobile;
const localNative = native && !store.isWeb;

function close(restoreFocus = false) {
  position.value = undefined;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
async function open() {
  if (store.busy || !trigger.value) return;
  emit('open');
  const rect = trigger.value.getBoundingClientRect();
  const width = Math.min(280, window.innerWidth - 16);
  const top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - 48));
  position.value = {
    left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
    top,
    width,
    maxHeight: Math.min(360, window.innerHeight - top - 8),
  };
  void store.refreshWorkspaces();
  await nextTick();
  menuElement.value
    ?.querySelector<HTMLButtonElement>('[aria-checked="true"], button')
    ?.focus({ preventScroll: true });
}
function toggle() {
  if (position.value) close();
  else void open();
}
function select(id: string, path: string) {
  if (store.busy) return;
  close(true);
  if (id !== store.workspace?.id) void store.openWorkspace(path);
}
function reveal() {
  if (store.busy || !store.workspace) return;
  close(true);
  void store.reveal();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    close(true);
  } else if (event.key === 'Tab') {
    // Restore focus before the browser advances to the next sidebar control.
    close(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    event.stopPropagation();
    const buttons = [
      ...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}
function outside(event: Event) {
  if (
    event.target instanceof Node &&
    (trigger.value?.contains(event.target) || menuElement.value?.contains(event.target))
  )
    return;
  close();
}
function dismiss() {
  close();
}
watch(
  () => props.active,
  (active) => {
    if (!active) close();
  },
);
watch(() => [store.workspace?.id, store.busy], dismiss);
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
  <button
    ref="trigger"
    type="button"
    class="repository-switcher-trigger"
    :title="store.workspace?.name"
    :aria-label="t('切换仓库：{0}', [store.workspace?.name ?? t('仓库')])"
    aria-haspopup="menu"
    :aria-expanded="!!position"
    :aria-controls="menuId"
    :disabled="store.busy"
    @click="toggle"
    @keydown.down.prevent="open"
    @keydown.up.prevent="open"
  >
    <span>{{ store.workspace?.name ?? t('仓库') }}</span>
    <ChevronDown :size="12" :class="{ expanded: position }" aria-hidden="true" />
  </button>
  <Teleport to="body">
    <div
      v-if="position"
      :id="menuId"
      ref="menuElement"
      class="dropdown compact-action-menu repository-switcher-menu"
      role="menu"
      :aria-label="t('切换仓库')"
      :style="{
        left: `${position.left}px`,
        top: `${position.top}px`,
        width: `${position.width}px`,
        maxHeight: `${position.maxHeight}px`,
      }"
      @keydown="keydown"
    >
      <button
        v-for="item in workspaces"
        :key="item.id"
        type="button"
        role="menuitemradio"
        :aria-checked="item.id === store.workspace?.id"
        :title="showPathTooltip ? item.path : item.name"
        :disabled="store.busy"
        @mousedown.right.stop.prevent="emit('context', item, $event)"
        @contextmenu.stop.prevent="emit('context', item, $event)"
        @click="select(item.id, item.path)"
      >
        <span class="repository-workspace-icon"><WorkspaceIcon :icon="item.id === store.workspace?.id ? store.workspaceSettings.icon : item.icon" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" :size="15" /></span>
        <span class="repository-switcher-details">
          <span>{{ item.name }}</span>
          <small v-if="store.isDemo">{{ t('浏览器演示') }}</small>
        </span>
        <Check v-if="item.id === store.workspace?.id" :size="14" aria-hidden="true" />
      </button>
      <template v-if="store.workspace && localNative && !mobile">
        <div class="menu-divider" role="separator" />
        <button type="button" role="menuitem" :disabled="store.busy" @click="reveal">
          <ExternalLink :size="15" aria-hidden="true" />
          <span>{{ t('在资源管理器中显示') }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.repository-switcher-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-width: 0;
  min-height: 28px;
  margin-left: -4px;
  padding: 4px;
  border-radius: 5px;
  color: inherit;
  font-size: inherit;
  font-weight: inherit;
  text-align: left;
}
.repository-switcher-trigger:hover,
.repository-switcher-trigger[aria-expanded='true'] {
  background: var(--hover);
  color: var(--text);
}
.repository-switcher-trigger > span,
.repository-switcher-details > span,
.repository-switcher-details > small {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.repository-switcher-trigger > svg,
.repository-switcher-menu button > svg {
  flex-shrink: 0;
}
.repository-workspace-icon {
  display: grid;
  place-items: center;
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  border-radius: 4px;
}
.repository-switcher-trigger > svg.expanded {
  transform: rotate(180deg);
}
.repository-switcher-menu {
  position: fixed;
  z-index: 100;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.repository-switcher-menu button {
  min-height: 32px;
  padding: 6px 7px;
}
.repository-switcher-menu button[aria-checked='true'] {
  color: var(--green);
}
.repository-switcher-details {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.repository-switcher-details > small {
  color: var(--muted);
  font-size: 11px;
}
</style>
