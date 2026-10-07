<script setup lang="ts">
import { nextTick, onBeforeUnmount, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  compact: boolean;
  contentElement?: HTMLElement;
}>();
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
  // Vue has applied the final width. Animate only the position, so editors,
  // tables and pane observers don't have to reflow on every animation frame.
  const offset = left - content.getBoundingClientRect().left;
  if (Math.abs(offset) < 1) return;
  const animation = content.animate([
    { transform: `translateX(${offset}px)` },
    { transform: 'translateX(0)' },
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
    <aside v-show="open" class="sidebar" aria-label="工作区侧栏"
      :inert="!open || undefined" :aria-hidden="!open">
      <slot />
    </aside>
  </Transition>
</template>
