<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  compact: boolean;
  contentElement?: HTMLElement;
}>();
const emit = defineEmits<{ dismiss: [] }>();
const drawer = ref<HTMLElement>();
let returnFocus: HTMLElement | null = null;
function focusable() {
  return [...(drawer.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), a[href], [tabindex="0"]') ?? [])]
    .filter(element => element.getClientRects().length && !element.closest('[inert], [aria-hidden="true"]'));
}
function drawerKeydown(event: KeyboardEvent) {
  if (!props.compact) return;
  if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement)?.closest('[role="menu"]')) {
    event.preventDefault();
    event.stopPropagation();
    emit('dismiss');
  }
  if (event.key !== 'Tab') return;
  const elements = focusable();
  const first = elements[0], last = elements.at(-1);
  if (!first || (event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last)) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}
watch(() => props.open && props.compact, async (modal, previous, cleanup) => {
  let cancelled = false;
  cleanup(() => { cancelled = true; });
  if (modal) returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  await nextTick();
  if (cancelled) return;
  if (modal) (focusable()[0] ?? drawer.value)?.focus({ preventScroll: true });
  else if (previous) {
    // The opener is conditionally rendered, so reopening content may create a new node.
    const target = returnFocus?.isConnected ? returnFocus
      : props.contentElement?.querySelector<HTMLElement>(`[aria-label="${t('展开侧栏')}"]`);
    target?.focus({ preventScroll: true });
  }
}, { immediate: true });
let motion: Animation | undefined;

function cancelMotion() {
  motion?.cancel();
  motion = undefined;
}

watch(() => props.open, async (_, __, cleanup) => {
  const content = props.contentElement;
  // Read the current visual position before cancelling an interrupted slide.
  const left = content?.getBoundingClientRect().left;
  cancelMotion();
  let cancelled = false;
  cleanup(() => { cancelled = true; });
  await nextTick();
  if (cancelled || !content || left === undefined || props.compact ||
    typeof content.animate !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Keep the right edge anchored while the left edge moves. Translating the
  // whole column also moves right-aligned actions and the assistant launcher.
  // A layout margin lets the flex width and centered document follow the edge.
  const offset = left - content.getBoundingClientRect().left;
  if (Math.abs(offset) < 1) return;
  const animation = content.animate([
    { marginLeft: `${offset}px` },
    { marginLeft: '0px' },
  ], { duration: 200, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
  motion = animation;
  animation.onfinish = () => {
    if (motion === animation) motion = undefined;
  };
});
watch(() => props.compact, cancelMotion);
onBeforeUnmount(cancelMotion);
</script>

<template>
  <Transition name="sidebar">
    <aside ref="drawer" v-show="open" class="sidebar" :aria-label="t('工作区侧栏')" tabindex="-1"
      :role="compact ? 'dialog' : undefined" :aria-modal="compact && open || undefined" @keydown="drawerKeydown"
      :inert="!open || undefined" :aria-hidden="!open">
      <slot />
    </aside>
  </Transition>
</template>
