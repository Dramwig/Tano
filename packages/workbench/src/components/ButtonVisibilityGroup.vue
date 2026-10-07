<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Check } from 'lucide-vue-next';

const props = withDefaults(
  defineProps<{
    items: readonly { id: string; label: string; separatorBefore?: boolean }[];
    preferenceKey: string;
    label: string;
    menuLabel: string;
    tag?: 'nav' | 'div' | 'header';
    groupClass?: string;
    active?: boolean;
  }>(),
  { tag: 'div', groupClass: 'button-visibility-group', active: true },
);
const emit = defineEmits<{ open: [] }>();
const preferenceChanged = 'tano:button-visibility-changed';
const navigation = ref<HTMLElement>();
const menuElement = ref<HTMLElement>();
const menu = ref<{ x: number; y: number } | null>(null);
let returnFocus: HTMLElement | null = null;

function readHiddenViews(): string[] {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(props.preferenceKey) ?? '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}
const hiddenViews = ref(readHiddenViews());
function isVisible(id: string) {
  return !hiddenViews.value.includes(id);
}
function closeMenu(restoreFocus = false) {
  menu.value = null;
  if (restoreFocus) {
    void nextTick(() => {
      const target = returnFocus?.isConnected ? returnFocus : navigation.value;
      target?.focus({ preventScroll: true });
    });
  }
}
function toggleVisibility(id: string) {
  hiddenViews.value = isVisible(id)
    ? [...hiddenViews.value, id]
    : hiddenViews.value.filter((value) => value !== id);
  try {
    window.localStorage.setItem(props.preferenceKey, JSON.stringify(hiddenViews.value));
  } catch {
    // Keep the preference for this session when device storage is unavailable.
  }
  window.dispatchEvent(
    new CustomEvent(preferenceChanged, {
      detail: { key: props.preferenceKey, hidden: hiddenViews.value },
    }),
  );
  closeMenu(true);
}
function openMenu(event: MouseEvent | KeyboardEvent) {
  event.preventDefault();
  emit('open');
  returnFocus =
    event.target instanceof HTMLElement
      ? (event.target.closest('button') ?? navigation.value ?? null)
      : (navigation.value ?? null);
  const rect = navigation.value!.getBoundingClientRect();
  const x = event instanceof MouseEvent ? event.clientX : rect.left;
  const y = event instanceof MouseEvent ? event.clientY : rect.bottom;
  menu.value = { x: Math.max(8, x), y: Math.max(8, y) };
  void nextTick(() => {
    const element = menuElement.value;
    if (!element || !menu.value) return;
    menu.value = {
      x: Math.max(8, Math.min(x, window.innerWidth - element.offsetWidth - 8)),
      y: Math.max(8, Math.min(y, window.innerHeight - element.offsetHeight - 8)),
    };
    element.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
  });
}
function navigationKeydown(event: KeyboardEvent) {
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) openMenu(event);
}
function menuKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === 'Tab') {
    closeMenu(true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...(menuElement.value?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}
function outsidePointer(event: Event) {
  if (!(event.target instanceof Node) || !menuElement.value?.contains(event.target)) closeMenu();
}
function outsideContext(event: MouseEvent) {
  if (
    !(event.target instanceof Node) ||
    (!navigation.value?.contains(event.target) && !menuElement.value?.contains(event.target))
  )
    closeMenu();
}
function dismissMenu() {
  closeMenu();
}
watch(() => props.active, (active) => { if (!active) closeMenu(); });
function syncPreference(event: StorageEvent) {
  if (event.key === props.preferenceKey || event.key === null)
    hiddenViews.value = readHiddenViews();
}
function syncLocalPreference(event: Event) {
  const { key, hidden } = (event as CustomEvent<{ key: string; hidden: string[] }>).detail;
  if (key === props.preferenceKey) hiddenViews.value = [...hidden];
}
onMounted(() => {
  window.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('contextmenu', outsideContext, true);
  window.addEventListener('scroll', dismissMenu, true);
  window.addEventListener('resize', dismissMenu);
  window.addEventListener('storage', syncPreference);
  window.addEventListener(preferenceChanged, syncLocalPreference);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outsidePointer, true);
  window.removeEventListener('contextmenu', outsideContext, true);
  window.removeEventListener('scroll', dismissMenu, true);
  window.removeEventListener('resize', dismissMenu);
  window.removeEventListener('storage', syncPreference);
  window.removeEventListener(preferenceChanged, syncLocalPreference);
});
</script>

<template>
  <component
    :is="tag"
    ref="navigation"
    :class="groupClass"
    :aria-label="label"
    :role="tag === 'div' ? 'group' : undefined"
    tabindex="0"
    @contextmenu.prevent="openMenu"
    @keydown="navigationKeydown"
  >
    <slot :is-visible="isVisible" />
  </component>
  <Teleport to="body">
    <div
      v-if="menu"
      ref="menuElement"
      class="dropdown compact-action-menu button-visibility-menu"
      role="menu"
      :aria-label="menuLabel"
      :style="{ left: `${menu.x}px`, top: `${menu.y}px` }"
      @contextmenu.stop.prevent
      @keydown.stop="menuKeydown"
    >
      <template v-for="(item, index) in items" :key="item.id">
        <div v-if="item.separatorBefore && index > 0" class="menu-divider" role="separator" />
        <button
          type="button"
          role="menuitemcheckbox"
          :aria-checked="isVisible(item.id)"
          @click="toggleVisibility(item.id)"
        >
          <span class="button-visibility-menu-check" aria-hidden="true">
            <Check v-if="isVisible(item.id)" :size="14" />
          </span>
          <span>{{ item.label }}</span>
        </button>
      </template>
    </div>
  </Teleport>
</template>

<style scoped>
.button-visibility-menu {
  position: fixed;
  z-index: 100;
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
}
.button-visibility-menu-check {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  flex: 0 0 14px;
}
.button-visibility-menu button > span:last-child {
  min-width: 0;
  white-space: normal;
  overflow-wrap: anywhere;
}
</style>
