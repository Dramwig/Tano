<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ChevronLeft, ChevronRight, PanelLeft, Minus, Plus, MoveHorizontal, Info, FileText, MoreHorizontal } from 'lucide-vue-next';
import { t } from '../i18n';

const props = withDefaults(defineProps<{
  page: number; count: number; width?: number; height?: number; grid?: boolean; landscape?: boolean; continuous?: boolean;
  navigation?: string[]; navigationLabel?: string; note?: string; status?: string; format?: string; resetKey?: unknown; controlsTarget?: string;
}>(), { width: 794, height: 1123, navigationLabel: '页面', note: '', status: '', format: '' });
const emit = defineEmits<{ 'update:page': [page: number] }>();
const root = ref<HTMLElement>(), viewport = ref<HTMLElement>();
const sidebar = ref(false), information = ref(false), zoom = ref('auto');
const actionsOpen = ref(false), trigger = ref<HTMLButtonElement>(), actions = ref<HTMLElement>();
const actionsId = useId();
const actionsPosition = ref({ left: '0px', top: '0px' });
function closeActions(restoreFocus = false) {
  actionsOpen.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function placeActions() {
  if (!actionsOpen.value || !trigger.value || !actions.value) return;
  const anchor = trigger.value.getBoundingClientRect(), bounds = actions.value.getBoundingClientRect();
  actionsPosition.value = {
    left: `${Math.max(8, Math.min(anchor.right - bounds.width, window.innerWidth - bounds.width - 8))}px`,
    top: `${Math.max(8, Math.min(anchor.bottom + 6, window.innerHeight - bounds.height - 8))}px`,
  };
}
async function toggleActions() {
  if (actionsOpen.value) { closeActions(true); return; }
  actionsOpen.value = true;
  await nextTick(); placeActions();
  actions.value?.querySelector<HTMLElement>('button:not(:disabled), select')?.focus();
}
function outsideActions(event: Event) {
  const path = event.composedPath();
  if (!path.includes(trigger.value as EventTarget) && !path.includes(actions.value as EventTarget)) closeActions();
}
function actionsKeydown(event: KeyboardEvent) {
  if (props.controlsTarget && actionsOpen.value && event.key === 'Escape') { event.preventDefault(); closeActions(true); }
}
watch(information, async () => { await nextTick(); placeActions(); });
watch(() => props.page, async () => {
  await nextTick();
  // A page turn can disable the focused previous/next button. Keep keyboard
  // focus in the popover rather than dropping it onto the workbench body.
  if (actionsOpen.value && (document.activeElement === document.body || document.activeElement?.matches(':disabled'))) actions.value?.querySelector('select')?.focus();
});
const available = ref({ width: 850, height: 800 });
const contentWidth = computed(() => props.width);
const scale = computed(() => {
  if (props.grid) return Number(zoom.value) || 1;
  const width = Math.max(80, available.value.width - 48) / contentWidth.value;
  if (zoom.value === 'width') return width;
  if (zoom.value === 'page') return Math.min(width, Math.max(80, available.value.height - 48) / props.height);
  if (zoom.value === 'auto') return Math.min(1, width);
  return Number(zoom.value) || 1;
});
const zoomLevels = [.5, .75, 1, 1.25, 1.5, 2, 3];
function adjustZoom(direction: number) {
  zoom.value = String(Math.min(3, Math.max(.25, Math.round((scale.value + direction * .1) * 100) / 100)));
}
function move(page: number) {
  const target = Math.max(1, Math.min(props.count, page));
  if (props.continuous && viewport.value) {
    const element = viewport.value.querySelector<HTMLElement>(`[data-reader-page="${target}"]`);
    if (element) viewport.value.scrollTop += element.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top - 24;
  }
  emit('update:page', target);
}
let scrollFrame = 0;
function trackPage() {
  if (!props.continuous || !viewport.value) return;
  cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(() => {
    if (!viewport.value) return;
    const bounds = viewport.value.getBoundingClientRect();
    let current = 1, visibleHeight = -1;
    for (const element of viewport.value.querySelectorAll<HTMLElement>('[data-reader-page]')) {
      const pageBounds = element.getBoundingClientRect();
      if (pageBounds.top >= bounds.top + bounds.height) break;
      const visible = Math.min(pageBounds.bottom, bounds.top + bounds.height) - Math.max(pageBounds.top, bounds.top);
      if (visible > visibleHeight) { visibleHeight = visible; current = Number(element.dataset.readerPage); }
    }
    if (viewport.value.scrollHeight > viewport.value.clientHeight + 1 && viewport.value.scrollTop + viewport.value.clientHeight >= viewport.value.scrollHeight - 2) current = props.count;
    if (current !== props.page) emit('update:page', current);
  });
}
watch(scale, async (value, previous) => {
  if (!props.continuous || !viewport.value || !previous) return;
  const element = viewport.value.querySelector<HTMLElement>(`[data-reader-page="${props.page}"]`);
  if (!element) return;
  const offset = element.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top;
  const atBottom = viewport.value.scrollHeight > viewport.value.clientHeight + 1 && viewport.value.scrollTop + viewport.value.clientHeight >= viewport.value.scrollHeight - 2;
  await nextTick();
  if (viewport.value) {
    if (atBottom) viewport.value.scrollTop = viewport.value.scrollHeight;
    else viewport.value.scrollTop += element.getBoundingClientRect().top - viewport.value.getBoundingClientRect().top - offset * value / previous;
  }
});
function keyboard(event: KeyboardEvent) {
  if (props.grid || event.target !== viewport.value || event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); move(props.page + (event.key === 'ArrowRight' ? 1 : -1)); }
  if (event.key === 'Home') { event.preventDefault(); move(1); }
  if (event.key === 'End') { event.preventDefault(); move(props.count); }
}
watch(() => props.page, () => { if (!props.continuous && viewport.value) viewport.value.scrollTop = 0; });
watch(() => props.resetKey, () => { if (viewport.value) { viewport.value.scrollTop = 0; viewport.value.scrollLeft = 0; } });
let observer: ResizeObserver | undefined;
onMounted(() => {
  window.addEventListener('pointerdown', outsideActions, true);
  window.addEventListener('focusin', outsideActions);
  window.addEventListener('resize', placeActions);
  window.addEventListener('keydown', actionsKeydown);
  if (typeof ResizeObserver === 'undefined') return;
  observer = new ResizeObserver(() => {
    if (viewport.value) available.value = { width: viewport.value.clientWidth, height: viewport.value.clientHeight };
    placeActions();
  });
  if (viewport.value) observer.observe(viewport.value);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(scrollFrame);
  observer?.disconnect();
  window.removeEventListener('pointerdown', outsideActions, true);
  window.removeEventListener('focusin', outsideActions);
  window.removeEventListener('resize', placeActions);
  window.removeEventListener('keydown', actionsKeydown);
});
</script>

<template>
  <div ref="root" class="document-reader" :class="{ 'reader-grid': grid, 'reader-landscape': landscape, 'reader-continuous': continuous }">
    <Teleport :to="controlsTarget ?? 'body'" :disabled="!controlsTarget" defer>
      <button v-if="controlsTarget" ref="trigger" type="button" class="reader-actions-trigger icon-button" :aria-label="t('预览操作')" :data-tooltip="t('预览操作')" aria-haspopup="dialog" :aria-controls="actionsId" :aria-expanded="actionsOpen" @click="toggleActions" @keydown.down.prevent="!actionsOpen && toggleActions()"><MoreHorizontal :size="19" /></button>
    </Teleport>
    <Teleport to="body" :disabled="!controlsTarget">
    <header v-if="!controlsTarget || actionsOpen" :id="actionsId" ref="actions" class="reader-toolbar" :class="{ 'reader-actions-popover': controlsTarget }" :style="controlsTarget ? actionsPosition : undefined" :role="controlsTarget ? 'dialog' : undefined" :aria-label="controlsTarget ? t('预览操作') : undefined" @keydown.stop="actionsKeydown">
      <div class="reader-tools reader-leading">
        <button v-if="navigation" :aria-label="t('切换页面导航')" :title="t('切换页面导航')" :aria-expanded="sidebar" @click="sidebar = !sidebar"><PanelLeft :size="16" /></button>
        <span class="reader-format">{{ format }}</span>
      </div>
      <div v-if="controlsTarget" class="reader-position"><span>{{ status }}</span><span>{{ Math.round(scale * 100) }}%</span></div>
      <nav v-if="!grid" class="reader-tools reader-pagination" :aria-label="t('预览翻页')">
        <span v-if="controlsTarget" class="reader-control-label">{{ t('预览页码') }}</span>
        <button :disabled="page <= 1" :aria-label="t('上一页')" :title="t('上一页')" @click="move(page - 1)"><ChevronLeft :size="16" /></button>
        <select :value="page" :aria-label="t('预览页码')" @change="move(Number(($event.target as HTMLSelectElement).value))"><option v-for="index in count" :key="index" :value="index">{{ index }} / {{ count }}</option></select>
        <button :disabled="page >= count" :aria-label="t('下一页')" :title="t('下一页')" @click="move(page + 1)"><ChevronRight :size="16" /></button>
      </nav>
      <span v-if="!grid" class="reader-separator" />
      <div class="reader-tools reader-zoom">
        <span v-if="controlsTarget" class="reader-control-label">{{ t('预览缩放') }}</span>
        <button :aria-label="t('缩小')" :title="t('缩小')" :disabled="scale <= .25" @click="adjustZoom(-1)"><Minus :size="16" /></button>
        <select v-model="zoom" :aria-label="t('预览缩放')">
          <option value="auto">{{ grid ? '100%' : t('自动缩放') }}</option>
          <template v-if="!grid"><option value="width">{{ t('适合宽度') }}</option><option value="page">{{ t('适合页面') }}</option></template>
          <option v-if="!['auto', 'width', 'page'].includes(zoom) && !zoomLevels.includes(Number(zoom))" :value="zoom">{{ Math.round(scale * 100) }}%</option>
          <option v-for="level in zoomLevels" :key="level" :value="String(level)">{{ level * 100 }}%</option>
        </select>
        <button :aria-label="t('放大')" :title="t('放大')" :disabled="scale >= 3" @click="adjustZoom(1)"><Plus :size="16" /></button>
        <button v-if="!grid" class="reader-fit" :aria-label="t('适合宽度')" :title="t('适合宽度')" :aria-pressed="zoom === 'width'" @click="zoom = 'width'"><MoveHorizontal :size="16" /></button>
      </div>
      <div class="reader-tools reader-trailing"><button v-if="note" :aria-label="t('预览说明')" :title="t('预览说明')" :aria-expanded="information" @click="information = !information"><Info :size="16" /><span v-if="controlsTarget">{{ t('预览说明') }}</span></button></div>
      <div v-if="controlsTarget && information" class="reader-information" role="note">{{ note }}</div>
    </header>
    </Teleport>
    <div v-if="!controlsTarget && information" class="reader-information" role="note">{{ note }}</div>
    <div class="reader-body">
      <aside v-if="sidebar && navigation" class="reader-navigation" :aria-label="t(navigationLabel)">
        <div class="reader-navigation-heading">{{ t(navigationLabel) }}</div>
        <button v-for="(label, index) in navigation" :key="index" class="reader-page-link" :class="{ selected: page === index + 1 }" :aria-current="page === index + 1 ? 'page' : undefined" @click="move(index + 1)">
          <slot name="thumbnail" :index="index"><FileText :size="16" /></slot>
          <span class="reader-page-index">{{ index + 1 }}</span><span class="reader-page-title">{{ label }}</span>
        </button>
      </aside>
      <div ref="viewport" class="reader-viewport" tabindex="0" :aria-label="t('阅读区域')" @keydown="keyboard" @scroll.passive="trackPage">
        <div class="reader-content"><slot :scale="scale" :content-width="contentWidth" /></div>
      </div>
    </div>
    <div v-if="$slots.tabs" class="reader-tabs"><slot name="tabs" /></div>
  </div>
</template>

<style scoped>
.document-reader { display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; color: var(--text); background: var(--paper); font: 12px/1.4 var(--font-ui, sans-serif); container-type: inline-size; }
.reader-toolbar { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; min-height: 42px; padding: 0 12px; border-bottom: 1px solid var(--line); background: var(--surface); }
.reader-tools { display: flex; align-items: center; gap: 3px; min-width: 0; }
.reader-leading, .reader-trailing { flex: 1; } .reader-trailing { justify-content: flex-end; }
.reader-format { color: var(--muted); font-size: 11px; font-weight: 600; letter-spacing: .04em; padding: 0 6px; }
button, select { color: inherit; font: inherit; border-radius: 3px; }
button { display: inline-flex; justify-content: center; align-items: center; width: 28px; height: 28px; flex-shrink: 0; padding: 0; border: 0; background: transparent; cursor: pointer; }
button:hover:not(:disabled), button[aria-expanded=true], button[aria-pressed=true] { background: var(--hover, #e9edf2); }
button:disabled { opacity: .3; cursor: default; }
button:focus-visible, select:focus-visible, .reader-viewport:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
select { max-width: 110px; height: 26px; padding: 0 5px; background: var(--paper); border: 1px solid var(--line); }
.reader-pagination select { min-width: 64px; }
.reader-separator { width: 1px; height: 18px; background: var(--line); margin: 0 4px; }
.reader-information { flex: 0 0 auto; padding: 10px 16px; color: var(--muted); border-bottom: 1px solid var(--line); line-height: 1.6; }
.reader-body { display: flex; flex: 1; min-height: 0; min-width: 0; position: relative; }
.reader-navigation { flex: 0 0 176px; overflow: auto; border-right: 1px solid var(--line); background: var(--surface); padding: 0 8px 12px; }
.reader-navigation-heading { padding: 16px 8px 12px; color: var(--muted); font-size: 11px; }
.reader-page-link { width: 100%; height: auto; min-height: 38px; justify-content: flex-start; gap: 8px; padding: 9px 8px; margin-bottom: 3px; text-align: left; border-left: 2px solid transparent; }
.reader-page-link.selected { background: color-mix(in srgb, var(--green) 12%, transparent); border-left-color: var(--green); }
.reader-page-link svg { flex-shrink: 0; } .reader-page-index { color: var(--muted); font-variant-numeric: tabular-nums; } .reader-page-title { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.reader-viewport { flex: 1; min-width: 0; min-height: 0; overflow: auto; overscroll-behavior: contain; background: color-mix(in srgb, var(--paper) 89%, #59677c); scrollbar-gutter: stable; }
.reader-content { box-sizing: border-box; min-width: 100%; width: max-content; min-height: 100%; padding: 24px; }
.reader-landscape .reader-content { display: flex; }
.reader-continuous .reader-content { display: flex; flex-direction: column; gap: 24px; align-items: center; justify-content: flex-start; }
.reader-continuous .reader-content > * { flex-shrink: 0; }
.reader-continuous .reader-viewport { overflow-anchor: none; }
.reader-grid .reader-content { padding: 0; } .reader-grid .reader-viewport { background: var(--paper); }
.reader-tabs { flex: 0 0 auto; display: flex; align-items: stretch; overflow-x: auto; min-height: 34px; border-top: 1px solid var(--line); background: var(--surface); }
.reader-grid .reader-tabs { background: var(--paper); }
.reader-position { display: flex; justify-content: space-between; gap: 12px; padding: 0 6px; color: var(--muted); font-size: 11px; }
@container (max-width: 580px) { .reader-toolbar { padding: 0 6px; gap: 3px; } .reader-format, .reader-fit, .reader-separator { display: none; } .reader-leading, .reader-trailing { flex: 0 0 auto; } .reader-pagination { margin-left: auto; } .reader-zoom { margin-right: auto; } .reader-tools { gap: 0; } select { max-width: 90px; } .reader-navigation { position: absolute; z-index: 2; top: 0; bottom: 0; left: 0; width: 176px; box-shadow: 4px 0 12px #0002; } }
@container (max-width: 380px) { .reader-toolbar { gap: 2px; overflow-x: auto; } .reader-toolbar button { width: 24px; } .reader-pagination select { min-width: 56px; } .reader-zoom select { width: 80px; } }
.reader-actions-trigger { color: var(--text-secondary); }
.reader-actions-popover { position: fixed; z-index: 1000; box-sizing: border-box; display: flex; flex-direction: column; align-items: stretch; gap: 8px; width: 304px; max-width: calc(100vw - 16px); max-height: calc(100dvh - 16px); overflow: auto; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: var(--overlay-shadow, 0 8px 28px #0002); color: var(--text); font: 12px/1.4 var(--font-ui); }
.reader-actions-popover .reader-tools { flex: 0 0 auto; }
.reader-actions-popover .reader-leading { flex-direction: row-reverse; justify-content: space-between; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
.reader-actions-popover .reader-control-label { flex: 1; color: var(--muted); white-space: nowrap; }
.reader-actions-popover .reader-pagination select { width: 110px; }
.reader-actions-popover .reader-separator { display: none; }
.reader-actions-popover .reader-trailing { justify-content: flex-start; }
.reader-actions-popover .reader-trailing:empty { display: none; }
.reader-actions-popover .reader-trailing button { width: 100%; justify-content: flex-start; gap: 8px; padding: 0 6px; }
.reader-actions-popover .reader-information { padding: 6px; border: 0; }
</style>
