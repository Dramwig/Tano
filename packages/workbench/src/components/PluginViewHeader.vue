<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { FolderOpen, ChevronLeft, ChevronRight, Minus, Plus, Maximize, Info, MoreHorizontal } from 'lucide-vue-next';
import type { PluginRuntimeState } from '../plugins/host';
import type { PluginInteraction, PluginWorkbenchView } from '../plugins/workbench';
import type { PluginJson } from '@tano/protocol';

const props = defineProps<{ view: PluginWorkbenchView; workspaceId: string; runtime?: PluginRuntimeState;
  execute: (interaction: PluginInteraction) => Promise<void> }>();
const header = computed(() => props.runtime?.status === 'running' ? props.runtime.views.find(view => view.id === props.view.id)?.header : undefined);
const icons = { open: FolderOpen, previous: ChevronLeft, next: ChevronRight, minus: Minus, plus: Plus, fit: Maximize, info: Info };
const error = ref('');
const uploading = ref(false);
const primary = computed(() => header.value?.actions.filter(item => !item.group) ?? []);
const groups = computed(() => {
  const result = new Map<string, NonNullable<typeof header.value>['actions']>();
  for (const item of header.value?.actions ?? []) if (item.group) result.set(item.group, [...(result.get(item.group) ?? []), item]);
  return [...result].map(([label, actions]) => ({ label, actions }));
});
const expanded = ref(false), trigger = ref<HTMLButtonElement>(), popover = ref<HTMLElement>();
const popoverId = useId(), position = ref({ left: '0px', top: '0px' });
function close(restoreFocus = false) {
  expanded.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function place() {
  if (!expanded.value || !trigger.value || !popover.value) return;
  const anchor = trigger.value.getBoundingClientRect(), bounds = popover.value.getBoundingClientRect();
  position.value = { left: `${Math.max(8, Math.min(anchor.right - bounds.width, innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - bounds.height - 8))}px` };
}
async function toggle() {
  if (expanded.value) { close(true); return; }
  expanded.value = true;
  await nextTick(); place();
  popover.value?.querySelector<HTMLElement>('input:not(:disabled), button:not(:disabled)')?.focus();
}
function outside(event: Event) {
  if (!event.composedPath().some(target => target === trigger.value || target === popover.value)) close();
}
function keyboard(event: KeyboardEvent) {
  if (expanded.value && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
}
let blurFrame = 0;
function blur() {
  blurFrame = requestAnimationFrame(() => { if (document.activeElement?.tagName === 'IFRAME') close(); });
}
onMounted(() => {
  window.addEventListener('pointerdown', outside, true); window.addEventListener('focusin', outside);
  window.addEventListener('keydown', keyboard); window.addEventListener('resize', place); window.addEventListener('blur', blur);
});
let generation = 0;
watch([() => props.workspaceId, () => props.view.key, () => props.runtime?.instanceId], () => { generation++; error.value = ''; uploading.value = false; close(); });
watch(header, async value => { if (!value) close(); await nextTick(); place(); });
onBeforeUnmount(() => {
  generation++; cancelAnimationFrame(blurFrame);
  window.removeEventListener('pointerdown', outside, true); window.removeEventListener('focusin', outside);
  window.removeEventListener('keydown', keyboard); window.removeEventListener('resize', place); window.removeEventListener('blur', blur);
});
function send(payload: PluginJson) {
  if (!props.runtime || props.runtime.status !== 'running') return Promise.reject(new Error('插件未运行'));
  return props.execute({ workspaceId: props.workspaceId, pluginId: props.view.pluginId, instanceId: props.runtime.instanceId,
    kind: 'message', name: props.view.id, payload });
}
async function action(id: string, dismiss = false) {
  if (dismiss) close(true);
  error.value = '';
  try { await send({ type: 'header-action', action: id }); } catch (cause) { error.value = String(cause); }
}
async function selectFile(event: Event, id: string) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0]; input.value = ''; if (!file) return;
  close(true);
  const request = ++generation;
  const transferId = crypto.randomUUID();
  let started = false;
  error.value = ''; uploading.value = true;
  try {
    if (!file.size || file.size > 50 * 1024 * 1024) throw new Error('文件大小须在 0 至 50 MiB 之间');
    await send({ type: 'header-file-start', action: id, name: file.name, transferId });
    if (request !== generation) return;
    started = true;
    const bytes = new Uint8Array(await file.arrayBuffer());
    for (let offset = 0; offset < bytes.length && request === generation; offset += 9000) {
      const chunk = btoa(String.fromCharCode(...bytes.subarray(offset, offset + 9000)));
      await send({ type: 'header-file', action: id, name: file.name, total: bytes.length, offset, chunk, transferId });
      // Keep large uploads below the plugin bridge's request rate limit.
      if (offset + 9000 < bytes.length) await new Promise(resolve => setTimeout(resolve, 16));
    }
  } catch (cause) {
    if (request === generation) {
      error.value = String(cause);
      if (started) await send({ type: 'header-file-error', transferId, error: String(cause).slice(0, 1000) }).catch(() => {});
    }
  }
  finally { if (request === generation) uploading.value = false; }
}
</script>
<template>
  <div v-if="header" class="plugin-view-header" role="toolbar" :aria-label="`${view.label}操作`">
    <span v-if="header.status && !header.statusAfter" class="plugin-view-position" aria-live="polite">{{ header.status }}</span>
    <template v-for="item in primary" :key="item.id">
      <label v-if="item.accept" class="plugin-header-file" :title="item.label" :class="{ disabled: item.disabled || uploading, 'text-action': !item.icon }">
        <component :is="icons[item.icon]" v-if="item.icon" :size="16" /><span v-else>{{ item.label }}</span>
        <input type="file" :aria-label="item.label" :accept="item.accept" :disabled="item.disabled || uploading" @change="selectFile($event, item.id)">
      </label>
      <button v-else type="button" :class="{ 'text-action': !item.icon }" :aria-label="item.label" :title="item.label" :disabled="item.disabled || uploading" @click="action(item.id)">
        <component :is="icons[item.icon]" v-if="item.icon" :size="16" /><span v-else>{{ item.label }}</span>
      </button>
      <span v-if="item.id === header.statusAfter && header.status" class="plugin-view-position" aria-live="polite">{{ header.status }}</span>
    </template>
    <button v-if="groups.length" ref="trigger" type="button" aria-label="预览操作" title="预览操作" aria-haspopup="dialog" :aria-controls="popoverId" :aria-expanded="expanded" @click="toggle" @keydown.down.prevent="!expanded && toggle()"><MoreHorizontal :size="19" /></button>
    <Teleport to="body">
      <div v-if="expanded && header" :id="popoverId" ref="popover" class="plugin-header-popover" :style="position" role="dialog" aria-label="预览操作" @keydown.stop="keyboard">
        <div class="plugin-header-heading"><span>{{ view.label }}</span><span>{{ header.status }}</span></div>
        <div v-for="group in groups" :key="group.label" class="plugin-header-group">
          <span class="plugin-header-group-label">{{ group.label }}</span>
          <template v-for="item in group.actions" :key="item.id">
            <label v-if="item.accept" class="plugin-header-file text-action" :title="item.label" :class="{ disabled: item.disabled || uploading }">
              <component :is="icons[item.icon]" v-if="item.icon" :size="16" /><span>{{ item.label }}</span>
              <input type="file" :aria-label="item.label" :accept="item.accept" :disabled="item.disabled || uploading" @change="selectFile($event, item.id)">
            </label>
            <button v-else type="button" :class="{ 'text-action': group.actions.length === 1 || !item.icon }" :aria-label="item.label" :title="item.label" :disabled="item.disabled || uploading" @click="action(item.id, group.actions.length === 1)">
              <component :is="icons[item.icon]" v-if="item.icon" :size="16" /><span v-if="group.actions.length === 1 || !item.icon">{{ item.label }}</span>
            </button>
          </template>
        </div>
      </div>
    </Teleport>
    <span v-if="error" role="alert" class="plugin-header-error" :title="error">{{ error }}</span>
  </div>
</template>
<style scoped>
.plugin-view-header { display:flex; align-items:center; gap:2px; flex:none; }
button,.plugin-header-file { display:inline-flex; align-items:center; justify-content:center; gap:8px; position:relative; width:28px; height:28px; padding:0; border:0; border-radius:5px; color:var(--muted); background:transparent; font:inherit; cursor:pointer; }
button:hover,.plugin-header-file:hover,button[aria-expanded=true] { background:var(--hover); color:var(--text); }
.text-action { width:auto; padding:0 6px; white-space:nowrap; }
button:disabled,.plugin-header-file.disabled { opacity:.4; cursor:default; }
.plugin-header-file input { position:absolute; inset:0; width:100%; height:100%; opacity:0; cursor:inherit; }
.plugin-header-file:focus-within,button:focus-visible { outline:2px solid var(--green); outline-offset:1px; }
.plugin-view-position { font-size:12px; min-width:36px; text-align:center; white-space:nowrap; color:var(--muted); }
.plugin-header-error { position:absolute; right:12px; top:100%; max-width:300px; background:var(--bg); color:var(--danger); padding:8px; z-index:10; }
.plugin-header-popover { position:fixed; z-index:1000; box-sizing:border-box; width:304px; max-width:calc(100vw - 16px); max-height:calc(100dvh - 16px); overflow:auto; padding:10px; border:1px solid var(--line); border-radius:8px; background:var(--paper); box-shadow:var(--overlay-shadow, 0 8px 28px #0002); color:var(--text); font:12px/1.4 var(--font-ui); }
.plugin-header-heading { display:flex; justify-content:space-between; padding:6px 6px 10px; margin-bottom:6px; border-bottom:1px solid var(--line); color:var(--muted); font-size:11px; }
.plugin-header-group { display:flex; align-items:center; gap:3px; padding:3px 0; }
.plugin-header-group-label { flex:1; color:var(--muted); padding-left:6px; }
@media(max-width:600px) { .plugin-view-header { gap:0; } .plugin-view-header > button { width:24px; } }
</style>
