<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId } from 'vue';
const props = defineProps<{ label: string; summary: string; failed?: boolean; checkedAt?: number; refreshing?: boolean }>();
const now = ref(Date.now());
const ageTimer = setInterval(() => { now.value = Date.now(); }, 30_000);
// Keep recent results at full contrast, then fade gently over the next hour.
const freshnessOpacity = computed(() => {
  if (props.refreshing || props.checkedAt == null) return 1;
  const age = Math.max(0, now.value - props.checkedAt - 5 * 60_000);
  return Math.max(0.55, 1 - age / (60 * 60_000) * 0.45);
});
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const panelId = useId();
const expanded = ref(false);
let closeTimer: ReturnType<typeof setTimeout> | undefined;
function keepOpen() { clearTimeout(closeTimer); }
function closePanel() {
  keepOpen();
  panel.value?.hidePopover?.();
  expanded.value = false;
}
function showPanel() {
  keepOpen();
  if (!trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect();
  panel.value.showPopover?.();
  expanded.value = true;
  const bounds = panel.value.getBoundingClientRect();
  panel.value.style.left = `${Math.max(12, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 12))}px`;
  panel.value.style.top = `${Math.max(12, Math.min(anchor.bottom + 8, window.innerHeight - bounds.height - 12))}px`;
}
function scheduleClose() {
  keepOpen();
  closeTimer = setTimeout(() => {
    if (document.activeElement !== trigger.value && !panel.value?.contains(document.activeElement)) closePanel();
  }, 150);
}

onBeforeUnmount(() => { clearTimeout(closeTimer); clearInterval(ageTimer); });
</script>
<template>
  <div class="connection-status">
    <button ref="trigger" type="button" class="connection-status-summary" :class="{ 'status-error': failed }" :style="{ '--freshness-opacity': freshnessOpacity }"
      :aria-controls="panelId" :aria-expanded="expanded" :aria-label="`${label}，${summary}`"
      @mouseenter="showPanel" @mouseleave="scheduleClose" @focus="showPanel" @blur="scheduleClose" @click="showPanel" @keydown.esc.stop.prevent="closePanel">
      <slot name="icon" /><span>{{ summary }}</span>
    </button>
    <div :id="panelId" ref="panel" popover="auto" class="connection-status-popover" role="region" :aria-label="label"
      @toggle="expanded = $event.newState === 'open'" @mouseenter="keepOpen" @mouseleave="scheduleClose" @focusout="scheduleClose" @keydown.esc.stop.prevent="closePanel">
      <header>{{ label }}</header><slot />
    </div>
  </div>
</template>
<style scoped>
.connection-status { flex: none; min-width: 0; max-width: 100%; }
.connection-status-summary { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 5px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--text); font-size: 12px; font-variant-numeric: tabular-nums; cursor: pointer; opacity: var(--freshness-opacity, 1); transition: opacity .3s; }
.connection-status-summary span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.connection-status-summary :deep(svg) { flex: none; }
.connection-status-summary:focus-visible, .connection-status-summary:hover, .connection-status-summary[aria-expanded='true'] { background: var(--hover); color: var(--text); opacity: 1; }
.connection-status-summary:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.connection-status-popover { position: fixed; inset: auto; margin: 0; box-sizing: border-box; width: 300px; max-width: calc(100vw - 24px); max-height: calc(100dvh - 24px); overflow: auto; padding: 14px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--text); box-shadow: 0 8px 28px #0002; font-size: 12px; overflow-wrap: anywhere; }
.connection-status-popover header { font-weight: 600; margin-bottom: 12px; }
.status-error { color: var(--danger); }
</style>
