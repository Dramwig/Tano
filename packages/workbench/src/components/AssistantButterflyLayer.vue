<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import AssistantButterfly from './AssistantButterfly.vue';
import type { ButterflyController } from '../assistant/butterfly';

const props = defineProps<{ controller: ButterflyController }>();
const state = props.controller.state;
let media: MediaQueryList | undefined;
const updateMotion = () => props.controller.setReducedMotion(media?.matches ?? false);
const visibility = () => { if (document.hidden) props.controller.cancel(); };
const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && state.visible) void props.controller.returnHome(); };
onMounted(() => {
  media = matchMedia('(prefers-reduced-motion: reduce)');
  updateMotion(); media.addEventListener('change', updateMotion);
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('keydown', escape);
});
onBeforeUnmount(() => {
  media?.removeEventListener('change', updateMotion);
  document.removeEventListener('visibilitychange', visibility);
  window.removeEventListener('keydown', escape);
  props.controller.cancel();
});
</script>

<template>
  <Teleport to="body">
    <div v-if="state.visible" class="assistant-butterfly-layer" aria-hidden="true" :data-phase="state.phase" :data-target="state.targetId">
      <div class="assistant-butterfly-actor" :style="{ transform: `translate3d(${state.x}px, ${state.y}px, 0) translate(-50%, -50%) rotate(${state.angle}deg)` }">
        <div class="assistant-butterfly-pose" :style="{ transform: `perspective(240px) rotateX(${state.pitch}deg) rotateY(${state.bank}deg) scale(${state.scale})` }">
          <AssistantButterfly :size="state.size" :motion="state.reducedMotion ? 'none' : state.phase === 'perched' ? 'perch' : 'fly'"
            :wing-pose="{ left: state.wingLeft, right: state.wingRight }" />
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.assistant-butterfly-layer { position: fixed; inset: 0; z-index: 40; pointer-events: none; overflow: hidden; }
.assistant-butterfly-actor { position: absolute; left: 0; top: 0; pointer-events: none; will-change: transform; }
.assistant-butterfly-pose { transform-origin: 50% 50%; will-change: transform; }
</style>
