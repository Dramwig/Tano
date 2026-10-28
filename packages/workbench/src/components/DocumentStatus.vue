<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { AlertCircle, Check, CircleDot, CloudUpload, Eye, LoaderCircle, LockKeyhole, RefreshCw, WifiOff } from 'lucide-vue-next';
import { t } from '../i18n';
import type { DocumentStatusItem } from '../document-status';

const props = defineProps<{ items: DocumentStatusItem[]; documentKey: string }>();
const icons = { error: AlertCircle, offline: WifiOff, pushing: CloudUpload, syncing: RefreshCw, saving: LoaderCircle, locked: LockKeyhole, preview: Eye, updated: CircleDot, saved: Check };
const primary = computed(() => props.items[0]);
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const opened = ref(false);
const pinned = ref(false);
const panelId = useId();
const position = ref({ left: '0px', top: '0px' });
let timer: ReturnType<typeof setTimeout> | undefined;
function cancelClose() { clearTimeout(timer); }
function close() { cancelClose(); opened.value = false; pinned.value = false; }
function place() {
  if (!opened.value || !trigger.value || !panel.value) return;
  const anchor = trigger.value.getBoundingClientRect(), bounds = panel.value.getBoundingClientRect();
  position.value = {
    left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8))}px`,
  };
}
async function show() { cancelClose(); opened.value = true; await nextTick(); place(); }
function leave() { cancelClose(); if (!pinned.value) timer = setTimeout(() => {
  if (!panel.value?.contains(document.activeElement)) close();
}, 160); }
function toggle() { if (pinned.value) close(); else { pinned.value = true; void show(); } }
function hover(event: PointerEvent) { if (event.pointerType !== 'touch') void show(); }
function outside(event: Event) {
  if (!trigger.value?.contains(event.target as Node) && !panel.value?.contains(event.target as Node)) close();
}
function escape(event: KeyboardEvent) {
  if (event.key !== 'Escape' || !opened.value) return;
  event.stopPropagation();
  if (panel.value?.contains(document.activeElement)) trigger.value?.focus();
  close();
}
watch(() => props.documentKey, close);
watch(() => props.items, async () => { if (!props.items.length) close(); await nextTick(); place(); });
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside);
  window.addEventListener('keydown', escape);
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
});
onBeforeUnmount(() => {
  cancelClose();
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside);
  window.removeEventListener('keydown', escape);
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
});
</script>

<template>
  <button v-if="primary" ref="trigger" type="button" class="document-status-trigger"
    :class="{ 'needs-attention': primary.kind === 'error' || primary.kind === 'offline', 'is-saved': primary.kind === 'saved' }"
    :aria-label="t('文章状态：{0}', [items.map(item => item.label).join('，')])"
    aria-haspopup="dialog" :aria-expanded="opened" :aria-controls="opened ? panelId : undefined"
    @pointerenter="hover" @pointerleave="leave" @focus="show" @blur="leave" @click="toggle">
    <component :is="icons[primary.kind]" :size="14" :stroke-width="1.6" aria-hidden="true"
      :class="{ spinning: primary.kind === 'syncing' || primary.kind === 'saving' }" />
  </button>
  <Teleport to="body">
    <section v-if="opened" :id="panelId" ref="panel" class="document-status-panel" :style="position"
      role="dialog" :aria-label="t('文章状态')" @pointerenter="cancelClose" @pointerleave="leave" @focusin="cancelClose">
      <div v-for="(item, index) in items" :key="`${item.kind}:${index}`" class="document-status-row">
        <component :is="icons[item.kind]" :size="16" :stroke-width="1.6" aria-hidden="true" />
        <div><strong>{{ item.label }}</strong><p>{{ item.detail }}</p></div>
      </div>
      <slot />
    </section>
  </Teleport>
</template>

<style scoped>
.document-status-trigger { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 24px; width: 24px; height: 26px; margin: 0; padding: 0; border-radius: 5px; color: var(--muted); }
.document-status-trigger:hover, .document-status-trigger[aria-expanded='true'] { background: var(--hover); color: var(--text); }
.document-status-trigger:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.document-status-trigger.needs-attention { color: var(--danger, #c4483d); }
/* The saved check is the one quiet brand-green mark in the chrome. */
.document-status-trigger.is-saved, .document-status-trigger.is-saved:hover, .document-status-trigger.is-saved[aria-expanded='true'] { color: var(--green); }
.document-status-panel { position: fixed; z-index: 90; box-sizing: border-box; width: 288px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow-y: auto; padding: 12px; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--text); box-shadow: 0 8px 28px #0002; }
.document-status-row { display: flex; align-items: flex-start; gap: 9px; }
.document-status-row + .document-status-row { margin-top: 12px; }
.document-status-row > svg { flex-shrink: 0; margin-top: 2px; color: var(--muted); }
.document-status-row strong { font-size: 13px; font-weight: 500; }
.document-status-row p { margin: 4px 0 0; font-size: 12px; line-height: 1.6; color: var(--muted); overflow-wrap: anywhere; white-space: normal; }
.spinning { animation: document-status-spin 1.2s linear infinite; }
@keyframes document-status-spin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .spinning { animation: none; } }
</style>
