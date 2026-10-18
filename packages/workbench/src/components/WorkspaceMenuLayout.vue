<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { ChevronRight, MoreHorizontal, Settings2 } from 'lucide-vue-next';
import type { WorkbenchActions } from '../runtime';

const props = defineProps<{ actions: WorkbenchActions }>();
const menuId = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const opened = ref(false);
const position = ref<{ left: string; top: string }>();

function close(restoreFocus = false) {
  opened.value = false;
  position.value = undefined;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function enabledItems() {
  return [...(panel.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
}
async function show(last = false) {
  opened.value = true;
  await nextTick();
  const row = trigger.value?.getBoundingClientRect();
  const parent = trigger.value?.closest('.workspace-dropdown')?.getBoundingClientRect();
  const menu = panel.value;
  if (!opened.value || !row || !parent || !menu) return;
  const { width, height } = menu.getBoundingClientRect();
  const edge = 8;
  let x = parent.right + 4;
  let y = row.top - 4;
  if (x + width > window.innerWidth - edge) {
    x = parent.left - width - 4;
    if (x < edge) {
      x = parent.left;
      y = row.bottom + 4;
    }
  }
  position.value = {
    left: `${Math.max(edge, Math.min(x, window.innerWidth - width - edge))}px`,
    top: `${Math.max(edge, Math.min(y, window.innerHeight - height - edge))}px`,
  };
  await nextTick();
  if (opened.value) {
    const items = enabledItems();
    (items[last ? items.length - 1 : 0] ?? menu).focus({ preventScroll: true });
  }
}
function triggerKeydown(event: KeyboardEvent) {
  if (!['ArrowRight', 'ArrowDown', 'ArrowUp'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  void show(event.key === 'ArrowUp');
}
function keydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (['Escape', 'ArrowLeft', 'Tab'].includes(event.key)) {
    if (event.key !== 'Tab') event.preventDefault();
    close(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = enabledItems();
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  }
}
function selected(event: MouseEvent) {
  const button = event.target instanceof Element ? event.target.closest('button') : null;
  if (button && !button.disabled) close();
}
function outside(event: Event) {
  const target = event.target;
  if (target instanceof Node && (trigger.value?.contains(target) || panel.value?.contains(target))) return;
  close();
}
function dismiss() { close(); }
function scroll(event: Event) {
  if (event.target instanceof Node && panel.value?.contains(event.target)) return;
  close();
}
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside);
  window.addEventListener('resize', dismiss);
  window.addEventListener('scroll', scroll, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside);
  window.removeEventListener('resize', dismiss);
  window.removeEventListener('scroll', scroll, true);
});
</script>

<template>
  <div class="workspace-menu-layout">
    <div class="menu-divider" />
    <slot name="settings">
      <button type="button" @click="props.actions.openSettings()"><Settings2 :size="16" />{{ t('设置') }}</button>
    </slot>
    <button ref="trigger" type="button" class="workspace-more-trigger"
      aria-haspopup="menu" :aria-expanded="opened" :aria-controls="opened ? menuId : undefined"
      @click="opened ? close(true) : show()" @keydown="triggerKeydown">
      <MoreHorizontal :size="16" /><span>{{ t('更多操作') }}</span><ChevronRight :size="13" />
    </button>
    <Teleport to="body">
      <div v-if="opened" :id="menuId" ref="panel"
        class="dropdown compact-action-menu workspace-more-menu"
        role="menu" :aria-label="t('更多工作区操作')" tabindex="-1"
        :style="{ ...position, visibility: position ? 'visible' : 'hidden' }"
        @keydown="keydown" @click="selected"><slot /></div>
    </Teleport>
    <div class="menu-divider" />
    <slot name="workspaces" />
  </div>
</template>

<style scoped>
.workspace-more-trigger > span { flex: 1; }
.workspace-more-trigger > svg:last-child { color: var(--muted); }
.workspace-more-trigger[aria-expanded='true'] { background: var(--hover); }
.workspace-more-menu {
  position: fixed;
  z-index: 100;
  width: 232px;
  max-height: min(360px, calc(100dvh - 16px));
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>
