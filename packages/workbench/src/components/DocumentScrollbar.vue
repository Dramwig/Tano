<script setup lang="ts">
import { t } from '../i18n';
import { computed, onBeforeUnmount, ref, watch } from 'vue';

const props = defineProps<{ scrollElement?: HTMLElement }>();
const track = ref<HTMLElement>();
const thumb = ref<HTMLElement>();
const viewport = ref(0);
const extent = ref(0);
const position = ref(0);
const dragging = ref(false);
const maximum = computed(() => Math.max(0, extent.value - viewport.value));
const thumbHeight = computed(() => Math.min(viewport.value, Math.max(24, viewport.value ** 2 / (extent.value || 1))));
const travel = computed(() => viewport.value - thumbHeight.value);
const thumbTop = computed(() => maximum.value ? position.value / maximum.value * travel.value : 0);
let gesture: { pointer: number; target: HTMLElement; y: number; position: number; scale: number } | undefined;

function measure() {
  const element = props.scrollElement;
  viewport.value = element?.clientHeight ?? 0;
  extent.value = element?.scrollHeight ?? 0;
  position.value = Math.max(0, Math.min(element?.scrollTop ?? 0, maximum.value));
}
function scrollTo(value: number) {
  const element = props.scrollElement;
  if (!element) return;
  element.scrollTop = Math.max(0, Math.min(value, maximum.value));
  measure();
}
function finish(event?: PointerEvent) {
  if (!gesture || (event && event.pointerId !== gesture.pointer)) return;
  const { target, pointer } = gesture;
  gesture = undefined;
  dragging.value = false;
  if (target.hasPointerCapture(pointer)) target.releasePointerCapture(pointer);
}
function start(event: PointerEvent) {
  if (event.button !== 0 || !event.isPrimary || gesture || !track.value) return;
  measure();
  if (!maximum.value || travel.value <= 0) return;
  event.preventDefault();
  const target = track.value;
  const scale = maximum.value / travel.value;
  if (event.target !== thumb.value) {
    scrollTo((event.clientY - target.getBoundingClientRect().top - thumbHeight.value / 2) * scale);
  }
  // Native Windows scrollbars snap back when the pointer leaves a horizontal
  // tolerance band. A captured DOM pointer keeps following vertical movement.
  gesture = { pointer: event.pointerId, target, y: event.clientY, position: position.value, scale };
  target.setPointerCapture(event.pointerId);
  dragging.value = true;
}
function move(event: PointerEvent) {
  if (!gesture || event.pointerId !== gesture.pointer) return;
  if (event.buttons === 0) return finish(event);
  event.preventDefault();
  scrollTo(gesture.position + (event.clientY - gesture.y) * gesture.scale);
}
function keyScroll(event: KeyboardEvent) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  measure();
  let next: number;
  switch (event.key) {
    case 'ArrowUp': next = position.value - 40; break;
    case 'ArrowDown': next = position.value + 40; break;
    case 'PageUp': next = position.value - viewport.value; break;
    case 'PageDown': next = position.value + viewport.value; break;
    case 'Home': next = 0; break;
    case 'End': next = maximum.value; break;
    default: return;
  }
  event.preventDefault();
  scrollTo(next);
}
function wheel(event: WheelEvent) {
  if (event.ctrlKey || !event.deltaY) return;
  measure();
  const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.value : 1;
  event.preventDefault();
  scrollTo(position.value + event.deltaY * unit);
}

watch(() => props.scrollElement, (element, _, cleanup) => {
  measure();
  if (!element) return;
  element.classList.add('document-layout-managed-scrollbar');
  element.addEventListener('scroll', measure, { passive: true });
  const observer = new ResizeObserver(measure);
  observer.observe(element);
  // The document main grows for edits, image loads, source mode and comments.
  for (const child of element.children) observer.observe(child);
  const blur = () => finish();
  window.addEventListener('blur', blur);
  cleanup(() => {
    finish();
    observer.disconnect();
    element.removeEventListener('scroll', measure);
    element.classList.remove('document-layout-managed-scrollbar');
    window.removeEventListener('blur', blur);
  });
}, { immediate: true, flush: 'post' });
onBeforeUnmount(() => finish());
</script>

<template>
  <div class="document-scrollbar" :class="{ 'is-dragging': dragging }">
    <div
      v-show="maximum > 0 && viewport > 0"
      ref="track"
      class="document-scrollbar-track"
      role="scrollbar"
      :aria-label="t('文档滚动条')"
      aria-orientation="vertical"
      :aria-controls="scrollElement?.id"
      :aria-valuemin="0"
      :aria-valuemax="Math.round(maximum)"
      :aria-valuenow="Math.round(position)"
      tabindex="0"
      @pointerdown.stop="start"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="finish"
      @lostpointercapture="finish"
      @mousedown.prevent
      @keydown="keyScroll"
      @wheel="wheel"
    >
      <div ref="thumb" class="document-scrollbar-thumb" :style="{ height: `${thumbHeight}px`, transform: `translateY(${thumbTop}px)` }" />
    </div>
  </div>
</template>

<style scoped>
.document-scrollbar { position: relative; flex: 0 0 12px; width: 12px; min-height: 0; }
.document-scrollbar-track { position: absolute; inset: 0; touch-action: none; user-select: none; }
.document-scrollbar-thumb { position: absolute; top: 0; left: 2px; width: 8px; border-radius: 6px; background: var(--scrollbar-thumb, var(--control-border)); }
.document-scrollbar-track:hover .document-scrollbar-thumb,
.document-scrollbar-track:focus-visible .document-scrollbar-thumb,
.document-scrollbar.is-dragging .document-scrollbar-thumb { background: var(--scrollbar-thumb-hover, var(--muted)); }
.document-scrollbar-track:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
@media (forced-colors: active) {
  .document-scrollbar-thumb { background: ButtonText; }
}
</style>
