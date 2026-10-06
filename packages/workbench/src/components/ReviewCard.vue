<script setup lang="ts">
import './review-card.css';
import { nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { animate } from 'motion/mini';

const props = withDefaults(defineProps<{ expanded: boolean; label?: string; framed?: boolean }>(), { framed: true });
const emit = defineEmits<{ activate: [] }>();
const card = ref<HTMLElement>();
let movement: ReturnType<typeof animate> | undefined;
let revision = 0;
watch(() => props.framed && props.expanded, async selected => {
  const element = card.value;
  if (!element) return;
  const current = getComputedStyle(element).translate || '0px 0px';
  const version = ++revision;
  movement?.stop();
  movement = undefined;
  element.style.removeProperty('translate');
  await nextTick();
  if (version !== revision || typeof element.animate !== 'function' ||
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Independent translate keeps the rail's vertical transform animation intact.
  const animation = animate(element, { translate: [current, selected ? '-12px 0px' : '0px 0px'] },
    { duration: 0.28, ease: [0.22, 1, 0.36, 1] });
  movement = animation;
  await animation.finished;
  if (version !== revision) return;
  animation.stop();
  movement = undefined;
  element.style.removeProperty('translate');
});
onBeforeUnmount(() => { revision++; movement?.stop(); });
function activate() { if (props.framed && !props.expanded) emit('activate'); }
</script>

<template>
  <div ref="card" :class="{ 'review-card': framed, 'is-expanded': framed && expanded }"
    :tabindex="framed && !expanded ? 0 : undefined" :aria-label="label"
    :aria-expanded="framed ? expanded : undefined" @click="activate"
    @keydown.enter.self.prevent="activate" @keydown.space.self.prevent="activate">
    <slot />
  </div>
</template>
