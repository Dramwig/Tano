<script setup lang="ts">
import { t } from '../i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { layoutGeometry, mapLayout, newPane, panePreviewRects } from '../pane-layout';
import type { LayoutRect } from '../pane-layout';
import { useWorkspaceStore } from '../stores/workspace';

const props = withDefaults(defineProps<{ compact?: boolean; tabsEnabled?: boolean; loading?: boolean }>(), {
  tabsEnabled: true,
});
const store = useWorkspaceStore();
const documentForTab = (id: string) => typeof store.documentForTab === 'function'
  ? store.documentForTab(id)
  : store.documents.find(doc => doc.id === id);
const showTabs = computed(() => props.tabsEnabled);
// Retain saved layouts and drafts, but expose only the active page without tabs.
const singlePane = computed(() => props.compact || !showTabs.value);
const host = ref<HTMLElement>();
const contentWidth = ref<number>();
let resizeObserver: ResizeObserver | undefined;
onMounted(() => {
  if (!host.value || typeof ResizeObserver === 'undefined') return;
  resizeObserver = new ResizeObserver(([entry]) => { contentWidth.value = entry.contentRect.width; });
  resizeObserver.observe(host.value);
});
const committed = computed(() => layoutGeometry(store.layout));
const geometry = computed(() => {
  if (singlePane.value || !store.detachingTabId) return committed.value;
  const remaining = mapLayout(store.layout, pane =>
    pane.tabs.length === 1 && pane.tabs[0] === store.detachingTabId ? null : pane);
  // The last pane of a window stays visible until the transfer is acknowledged.
  return remaining ? layoutGeometry(remaining) : committed.value;
});
const loadingPane = newPane();
const visible = computed(() => props.loading
  ? [{ pane: loadingPane, rect: { left: 0, top: 0, width: 1, height: 1 } }]
  : singlePane.value
  ? geometry.value.panes.filter(({ pane }) => pane.id === store.activePaneId)
    .map(item => ({ ...item, rect: { left: 0, top: 0, width: 1, height: 1 } }))
  : geometry.value.panes);
const preview = computed(() => {
  const drop = store.paneDrop;
  if (singlePane.value || !drop || drop.side === 'center') return;
  const target = visible.value.find(({ pane }) => pane.id === drop.paneId);
  return target ? panePreviewRects(target.rect, drop.side) : undefined;
});
// Top tab strips use the full workspace width; the sidebar only narrows content.
const tabbarPanes = computed(() => [
  ...visible.value.map(item => ({
    ...item, hidden: false,
  })),
  // Keep departing editors mounted to flush drafts and restore on failure.
  // No hidden-pane geometry participates in hit tests or visible dividers.
  ...(!singlePane.value || props.loading ? committed.value.panes.filter(item =>
    !visible.value.some(({ pane }) => pane.id === item.pane.id) && (!props.loading || item.pane.tabs.length))
    .map(item => ({ ...item, hidden: true })) : []),
]);
const displayed = computed(() => tabbarPanes.value.map(item => ({
  ...item, topTabbar: item.rect.top === 0,
  rect: preview.value && item.pane.id === store.paneDrop?.paneId ? preview.value.content : item.rect,
})));
const visibleActivePaneId = computed(() => visible.value.some(({ pane }) => pane.id === store.activePaneId)
  ? store.activePaneId : visible.value[0]?.pane.id);
const rectStyle = (rect: LayoutRect) => ({ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` });
const tabbarStyle = (rect: LayoutRect) => ({
  left: contentWidth.value === undefined ? `${rect.left * 100}%` : `${rect.left * contentWidth.value}px`,
  ...(rect.left + rect.width >= 1 - 1e-6 ? { right: '0' } : {
    width: contentWidth.value === undefined ? `${rect.width * 100}%` : `${rect.width * contentWidth.value}px`,
  }),
});
function focusPaneFromPointer(event: PointerEvent, paneId: string) {
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('.document-scrollbar')) return;
  if (target instanceof HTMLElement && target.classList.contains('document-layout')) {
    const rect = target.getBoundingClientRect();
    const scrollbarWidth = target.offsetWidth - target.clientWidth;
    // Native scrollbar drags must keep the current DOM and active pane stable.
    // WebView2 can otherwise cancel the drag when focusPane synchronously updates
    // the pane tree on the initial pointerdown.
    if (scrollbarWidth > 0 && event.clientX >= rect.right - scrollbarWidth) return;
  }
  store.focusPane(paneId);
}
type Divider = ReturnType<typeof layoutGeometry>['dividers'][number];
let resizing: { divider: Divider; pointer: number; target: HTMLElement; bounds: DOMRect } | undefined;
const isResizing = ref(false);
function startResize(event: PointerEvent, divider: Divider) {
  if (event.button !== 0 || !host.value) return;
  const target = event.currentTarget as HTMLElement;
  resizing = { divider, pointer: event.pointerId, target, bounds: host.value.getBoundingClientRect() };
  isResizing.value = true;
  target.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveResize(event: PointerEvent) {
  if (!resizing || resizing.pointer !== event.pointerId) return;
  const { divider, bounds } = resizing;
  const horizontal = divider.axis === 'horizontal';
  const size = horizontal ? bounds.width * divider.parent.width : bounds.height * divider.parent.height;
  const offset = horizontal ? event.clientX - bounds.left - bounds.width * divider.parent.left
    : event.clientY - bounds.top - bounds.height * divider.parent.top;
  const minimum = Math.min(.4, (horizontal ? 180 : 100) / size);
  store.resizeSplit(divider.id, Math.max(minimum, Math.min(1 - minimum, offset / size)));
}
function endResize() {
  const current = resizing;
  resizing = undefined;
  isResizing.value = false;
  if (current?.target.hasPointerCapture(current.pointer)) current.target.releasePointerCapture(current.pointer);
}
function resizeKey(event: KeyboardEvent, divider: Divider) {
  const keys = divider.axis === 'horizontal' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown'];
  if (!keys.includes(event.key) && event.key !== 'Home') return;
  event.preventDefault();
  store.resizeSplit(divider.id, event.key === 'Home' ? .5 : divider.ratio + (event.key === keys[0] ? -.05 : .05));
}
onBeforeUnmount(() => { endResize(); resizeObserver?.disconnect(); });
</script>

<template>
  <div class="workspace-layout">
    <div v-if="!singlePane && showTabs && $slots.tabs" class="workspace-pane-tabbars">
      <div v-for="{ pane, rect, hidden } in tabbarPanes.filter(item => item.rect.top === 0)" :key="pane.id"
        v-show="!hidden" class="workspace-pane-tabbar" :inert="hidden"
        :class="{ 'workspace-pane-top-right': rect.left + rect.width >= 1 - 1e-6 }"
        :style="tabbarStyle(rect)"
        @pointerdown.capture="focusPaneFromPointer($event, pane.id)" @focusin="store.focusPane(pane.id)">
        <slot name="tabs" :pane="pane" :rect="rect" />
      </div>
    </div>
    <div class="workspace-body">
      <div ref="host" class="workspace-panes" :class="{ 'workspace-panes-multiple': !singlePane && (visible.length > 1 || !!preview), 'workspace-panes-resizing': isResizing }">
        <!-- Hit regions keep their committed bounds while the visible pane makes
             room for the preview, so a stationary edge drag cannot oscillate. -->
        <div v-for="{ pane, rect } in visible" :key="`hit:${pane.id}`" class="pane-dock-region"
          :data-dock-pane-id="pane.id" :style="rectStyle(rect)" aria-hidden="true" />
        <section
          v-for="{ pane, rect, hidden, topTabbar } in displayed" :key="pane.id" v-show="!hidden" class="workspace-pane" :inert="hidden"
          :class="{ 'workspace-pane-active': !hidden && pane.id === visibleActivePaneId, 'workspace-pane-top': rect.top === 0, 'workspace-pane-external-tabs': !singlePane && showTabs && topTabbar && !!$slots.tabs }"
          :data-pane-id="pane.id" :style="rectStyle(rect)" :aria-label="showTabs ? t('文档标签组') : t('文档内容')"
          @pointerdown.capture="focusPaneFromPointer($event, pane.id)" @focusin="store.focusPane(pane.id)"
        >
          <slot v-if="!singlePane && showTabs && !topTabbar" name="tabs" :pane="pane" :rect="rect" />
          <slot :pane="pane" :rect="rect" :document="documentForTab(pane.activeId)"
            :tab="store.tabs.find(tab => tab.id === pane.activeId)" />
        </section>
        <div v-if="preview && store.paneDrop" class="pane-dock-preview" :class="`pane-dock-${store.paneDrop.side}`"
          :style="rectStyle(preview.preview)" aria-hidden="true">
          <span>{{ ({ center: t('合并到标签组'), left: t('向左分屏'), right: t('向右分屏'), top: t('向上分屏'), bottom: t('向下分屏') })[store.paneDrop.side] }}</span>
        </div>
        <template v-if="!singlePane">
          <div v-for="divider in geometry.dividers" :key="divider.id" class="pane-divider"
            :class="`pane-divider-${divider.axis}`" :style="rectStyle(divider.rect)"
            role="separator" tabindex="0" :aria-label="divider.axis === 'horizontal' ? t('调整左右分屏大小') : t('调整上下分屏大小')"
            :aria-orientation="divider.axis === 'horizontal' ? 'vertical' : 'horizontal'"
            :aria-valuenow="Math.round(divider.ratio * 100)" :aria-valuemin="10" :aria-valuemax="90"
            @pointerdown="startResize($event, divider)" @pointermove="moveResize" @pointerup="endResize"
            @pointercancel="endResize" @lostpointercapture="endResize" @keydown="resizeKey($event, divider)"
            @dblclick="store.resizeSplit(divider.id, .5)" />
        </template>
      </div>
      <slot name="sidebar" />
    </div>
  </div>
</template>

<style scoped>
.workspace-layout { display: flex; flex-direction: column; flex: 1; min-width: 0; min-height: 0; }
.workspace-pane-tabbars { position: relative; flex: 0 0 var(--workbench-tabbar-height); background: var(--sidebar); }
.workspace-pane-tabbar { position: absolute; top: 0; height: 100%; min-width: 0; }
.workspace-pane-tabbar + .workspace-pane-tabbar::before { content: ''; position: absolute; z-index: 1; top: 0; bottom: 0; left: 0; border-left: 1px solid var(--line); pointer-events: none; }
.workspace-body { display: flex; flex: 1; min-width: 0; min-height: 0; }
.workspace-panes { position: relative; flex: 1; min-width: 0; min-height: 0; overflow: hidden; }
.workspace-pane { --workspace-pane-tabbar-height: var(--workbench-tabbar-height); --inspector-top: calc(var(--workspace-pane-tabbar-height) + var(--topbar-height) + 44px + 16px); position: absolute; display: flex; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; background: var(--paper); }
.workspace-pane-external-tabs { --workspace-pane-tabbar-height: 0px; }
.workspace-panes-multiple .workspace-pane { container-type: size; }
.workspace-panes-multiple .workspace-pane-active { box-shadow: inset 0 2px var(--green); }
.pane-divider { position: absolute; z-index: 12; touch-action: none; }
.pane-divider-horizontal { width: 7px !important; transform: translateX(-50%); cursor: col-resize; }
.pane-divider-vertical { height: 7px !important; transform: translateY(-50%); cursor: row-resize; }
/* Draw each internal boundary once, without adding to pane box dimensions or
   doubling the sidebar's existing border when a preview becomes visible. */
.pane-divider::before { content: ''; position: absolute; background: var(--line); pointer-events: none; }
.pane-divider-horizontal::before { top: 0; bottom: 0; left: 3px; width: 1px; }
.pane-divider-vertical::before { left: 0; right: 0; top: 3px; height: 1px; }
/* Match the sidebar's thin highlight while preserving the wider drag target. */
.pane-divider::after { content: ''; position: absolute; background: transparent; pointer-events: none; transition: background 120ms ease; }
.pane-divider-horizontal::after { top: 0; bottom: 0; left: calc(50% - 1px); width: 2px; }
.pane-divider-vertical::after { left: 0; right: 0; top: calc(50% - 1px); height: 2px; }
.pane-divider:hover::after, .pane-divider:focus-visible::after, .pane-divider:active::after { background: var(--text-secondary); }
.pane-divider:focus-visible { outline: none; }
.workspace-panes-resizing { user-select: none; }
.workspace-panes-resizing :deep(.document-layout) { pointer-events: none; }
.pane-dock-region { position: absolute; pointer-events: none; }
.pane-dock-preview { position: absolute; z-index: 20; pointer-events: none; border-radius: 7px; background: color-mix(in srgb, var(--green) 20%, var(--paper)); display: grid; place-items: center; }
.pane-dock-preview span { padding: 6px 10px; border-radius: 6px; background: var(--paper); color: var(--green); font-size: 12px; }
.workspace-panes-multiple :deep(.editor-scroll) {
  --document-inset-start: clamp(18px, 5cqw, 60px);
  --document-inset-end: clamp(18px, 5cqw, 60px);
  padding: 28px var(--document-inset-end) 50px var(--document-inset-start);
}
.workspace-panes-multiple :deep(.editor-scroll:has(.document-cover)) { padding-top: 0; }
.workspace-panes-multiple :deep(.document-title-input),
.workspace-panes-multiple :deep(.document-title-mirror) { font-size: clamp(24px, 5cqw, 36px); }
.workspace-panes-multiple :deep(.editor-toolbar) { height: auto; min-height: 44px; flex-wrap: wrap; padding: 6px 10px; white-space: nowrap; }
.workspace-panes-multiple :deep(.editor-toolbar > *) { flex-shrink: 0; }
.workspace-panes-multiple :deep(.blank-tab-actions) { white-space: normal; }
.workspace-panes .workspace-pane :deep(.topbar) { padding-inline: 8px; gap: 6px; }
/* Navigation keeps its normal height and alignment in every docking mode.
   Its bottom gutter already separates the rows; do not add a second one. */
@media (pointer: fine) and (min-width: 701px) {
  .workspace-pane {
    --topbar-height: 36px;
  }
  .workspace-pane:has(.switchable-toolbar) {
    --inspector-top: calc(var(--workspace-pane-tabbar-height) + var(--topbar-height) + 33px + 16px);
  }
  .workspace-pane :deep(.editor-toolbar.switchable-toolbar) {
    height: auto;
    min-height: 33px;
    padding-block: 0 3px;
  }
}
.workspace-panes-multiple :deep(.breadcrumb) { gap: 5px; }
.workspace-panes-multiple :deep(.document-dropdown) { max-height: calc(100cqh - 100px); overflow-y: auto; overscroll-behavior: contain; }
.workspace-panes-multiple :deep(.calendar-topbar-controls) { min-width: 0; flex-wrap: wrap; }
.workspace-panes-multiple :deep(.topbar:has(.calendar-topbar-controls)) { height: auto; min-height: var(--topbar-height); flex-wrap: wrap; padding-block: 6px; }
.workspace-panes-multiple :deep(.topbar:has(.calendar-topbar-controls) .topbar-right) { flex-shrink: 1; min-width: 0; flex-wrap: wrap; }
@container (max-width: 560px) {
  .workspace-panes-multiple :deep(.breadcrumb:has(.breadcrumb-current) .breadcrumb-workspace),
  .workspace-panes-multiple :deep(.breadcrumb:has(.breadcrumb-current) .breadcrumb-workspace + svg),
  .workspace-panes-multiple :deep(.breadcrumb:has(.breadcrumb-current) .breadcrumb-demo-badge + svg) { display: none; }
  .workspace-panes-multiple :deep(.topbar-right) { gap: 2px; }
  .workspace-panes-multiple :deep(.topbar-right > .demo-badge),
  .workspace-panes-multiple :deep(.topbar-right > .local-badge) { margin-right: 0; font-size: 10px; }
  .workspace-panes-multiple :deep(.calendar-topbar-period) { display: none; }
}
</style>
