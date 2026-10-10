<script setup lang="ts">
import { ref } from 'vue';

const props = withDefaults(defineProps<{
  size?: number | string;
  motion?: 'breathe' | 'fly' | 'perch' | 'none';
  wingPose?: { left: number; right: number };
  label?: string;
}>(), {
  size: 36,
  motion: 'breathe',
});
const fluttering = ref(false);
/** A single greeting layered over breathing; overlapping requests do not restart it. */
function flutter() {
  if (fluttering.value || props.motion !== 'breathe' || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  fluttering.value = true;
}
defineExpose({ flutter });
</script>

<template>
  <!-- The viewBox centers the visible wings around their optical center (16.2, 14). -->
  <svg
    class="assistant-butterfly"
    :class="[`assistant-butterfly--${motion}`, { 'assistant-butterfly--controlled': motion === 'fly' && wingPose,
      'assistant-butterfly--fluttering': fluttering && motion === 'breathe' }]"
    :width="size"
    :height="size"
    viewBox="0.2 -2 32 32"
    fill="none"
    stroke="currentColor"
    stroke-width="1.5"
    stroke-linecap="round"
    stroke-linejoin="round"
    :role="label ? 'img' : undefined"
    :aria-label="label"
    :aria-hidden="label ? undefined : true"
    focusable="false"
  >
    <g class="assistant-butterfly-wing assistant-butterfly-wing-left" :style="motion === 'fly' && wingPose ? { transform: `scaleX(${wingPose.left}) rotate(${(1 - wingPose.left) * 10}deg)` } : undefined">
      <g class="assistant-butterfly-flutter assistant-butterfly-flutter-left" @animationend="fluttering = false" @animationcancel="fluttering = false">
        <path d="M16 16.2C13.4 10.2 8.1 5.4 3.6 4.8C3.2 10.5 6 15.4 10.2 17.2C7 17.7 5.9 21 7.6 23.3C9.7 26 14.1 23 16 18.3" />
      </g>
    </g>
    <g class="assistant-butterfly-wing assistant-butterfly-wing-right" :style="motion === 'fly' && wingPose ? { transform: `scaleX(${wingPose.right}) rotate(${(wingPose.right - 1) * 10}deg)` } : undefined">
      <g class="assistant-butterfly-flutter assistant-butterfly-flutter-right" @animationend="fluttering = false" @animationcancel="fluttering = false">
        <path d="M16 16.2C18.3 9.5 23.1 3.8 28.4 3.6C29 9.8 26.1 15.1 21.8 17.2C25.3 17.6 26.8 20.6 24.8 23.1C22.6 25.8 18.1 22.8 16 18.3" />
      </g>
    </g>
  </svg>
</template>

<style scoped>
.assistant-butterfly {
  display: block;
  flex: none;
  color: var(--text, #24272b);
  user-select: none;
  pointer-events: none;
  transform-box: border-box;
  transform-origin: 50% 50%;
  transform: rotate(-6deg);
}
.assistant-butterfly-wing,
.assistant-butterfly-flutter {
  transform-origin: 16px 17px;
}
.assistant-butterfly--breathe {
  animation: butterfly-breathe 8s ease-in-out infinite;
}
.assistant-butterfly--breathe .assistant-butterfly-wing-left {
  animation: butterfly-left-breathe 8s ease-in-out infinite;
}
.assistant-butterfly--breathe .assistant-butterfly-wing-right {
  animation: butterfly-right-breathe 8s ease-in-out infinite;
}
@keyframes butterfly-breathe {
  0%, 100% { transform: rotate(-6deg) scale(0.985); }
  50% { transform: rotate(-6deg) scale(1.015); }
}
@keyframes butterfly-left-breathe {
  0%, 100% { transform: scaleX(.94) rotate(1deg); }
  50% { transform: scaleX(1) rotate(-1deg); }
}
@keyframes butterfly-right-breathe {
  0%, 100% { transform: scaleX(.94) rotate(-1deg); }
  50% { transform: scaleX(1) rotate(1deg); }
}
/* Inner groups leave the 8-second breathing phase untouched during the greeting. */
.assistant-butterfly--fluttering .assistant-butterfly-flutter-left { animation: butterfly-left-flutter 680ms ease-in-out 1; }
.assistant-butterfly--fluttering .assistant-butterfly-flutter-right { animation: butterfly-right-flutter 680ms ease-in-out 1; }
@keyframes butterfly-left-flutter {
  0%, 100% { transform: scaleX(1) rotate(0deg); }
  20% { transform: scaleX(.58) rotate(6deg); }
  54% { transform: scaleX(1.025) rotate(-1.5deg); }
  76% { transform: scaleX(.96) rotate(.5deg); }
}
@keyframes butterfly-right-flutter {
  0%, 100% { transform: scaleX(1) rotate(0deg); }
  20% { transform: scaleX(.58) rotate(-6deg); }
  54% { transform: scaleX(1.025) rotate(1.5deg); }
  76% { transform: scaleX(.96) rotate(-.5deg); }
}
.assistant-butterfly--fly .assistant-butterfly-wing-left { animation: butterfly-left-fly 420ms ease-in-out infinite; }
.assistant-butterfly--fly .assistant-butterfly-wing-right { animation: butterfly-right-fly 420ms ease-in-out infinite; }
.assistant-butterfly--controlled .assistant-butterfly-wing { animation: none; }
.assistant-butterfly--perch .assistant-butterfly-wing-left { animation: butterfly-left-perch 6s ease-in-out infinite; }
.assistant-butterfly--perch .assistant-butterfly-wing-right { animation: butterfly-right-perch 6s ease-in-out infinite; }
@keyframes butterfly-left-fly {
  0%, 100% { transform: scaleX(.46) rotate(7deg); }
  50% { transform: scaleX(1) rotate(-4deg); }
}
@keyframes butterfly-right-fly {
  0%, 100% { transform: scaleX(.46) rotate(-7deg); }
  50% { transform: scaleX(1) rotate(4deg); }
}
@keyframes butterfly-left-perch {
  0%, 100% { transform: scaleX(.84) rotate(1.6deg); }
  50% { transform: scaleX(.88) rotate(1.2deg); }
}
@keyframes butterfly-right-perch {
  0%, 100% { transform: scaleX(.84) rotate(-1.6deg); }
  50% { transform: scaleX(.88) rotate(-1.2deg); }
}
@media (prefers-reduced-motion: reduce) {
  .assistant-butterfly,
  .assistant-butterfly .assistant-butterfly-wing,
  .assistant-butterfly .assistant-butterfly-flutter {
    animation: none;
  }
}
</style>
