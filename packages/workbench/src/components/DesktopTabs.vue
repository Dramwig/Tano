<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { FileText, GitFork, Plus, X, XCircle, PanelRightClose, SquarePen } from 'lucide-vue-next';
import { basename } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';

const store = useWorkspaceStore();
const emit = defineEmits<{ 'new-tab': []; 'new-document': [] }>();
const tabList = ref<HTMLElement>();
const contextMenuElement = ref<HTMLElement>();
const contextMenu = ref<{ tabId: string | null; x: number; y: number }>();
let contextTrigger: HTMLElement | null = null;
let blankTrack: HTMLElement | null = null;
const frozenTabWidths = ref<Record<string, number>>({});
const frozenStripWidth = ref<number>();
const pointerInsideTabList = ref(false);
const title = (path: string) => basename(path).replace(/\.(md|markdown)$/i, '');
const draggingId = ref('');
const dragPreview = ref<{
  path: string;
  dirty: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}>();
const dropTarget = ref<{ id: string; side: 'before' | 'after' }>();
let gesture:
  | {
      id: string;
      pointerId: number;
      element: HTMLElement;
      startX: number;
      startY: number;
      x: number;
      y: number;
      grabX: number;
      grabY: number;
      width: number;
      height: number;
      path: string;
      dirty: boolean;
    }
  | undefined;
let scrollFrame = 0;
let suppressClick = false;
let clickTimer: ReturnType<typeof setTimeout> | undefined;

function updateDropTarget() {
  const list = tabList.value;
  if (!gesture || !list) return;
  const bounds = list.getBoundingClientRect();
  dropTarget.value = undefined;
  if (
    gesture.y < bounds.top ||
    gesture.y > bounds.bottom ||
    gesture.x < bounds.left - 24 ||
    gesture.x > bounds.right + 24
  )
    return;
  const tabs = [...list.querySelectorAll<HTMLElement>('.desktop-tab')];
  const target = tabs.find((tab) => gesture!.x < tab.getBoundingClientRect().right) ?? tabs.at(-1);
  if (!target || target.dataset.id === gesture.id) return;
  const rect = target.getBoundingClientRect();
  dropTarget.value = {
    id: target.dataset.id!,
    side: gesture.x < rect.left + rect.width / 2 ? 'before' : 'after',
  };
}

function scrollWhileDragging() {
  const list = tabList.value;
  if (!gesture || !draggingId.value || !list) return;
  const bounds = list.getBoundingClientRect();
  if (
    gesture.y >= bounds.top &&
    gesture.y <= bounds.bottom &&
    gesture.x >= bounds.left - 24 &&
    gesture.x <= bounds.right + 24
  ) {
    if (gesture.x < bounds.left + 32) list.scrollLeft -= 10;
    else if (gesture.x > bounds.right - 32) list.scrollLeft += 10;
  }
  updateDropTarget();
  scrollFrame = requestAnimationFrame(scrollWhileDragging);
}

function startDrag(event: PointerEvent, id: string) {
  if (event.button !== 0 || !event.isPrimary || gesture) return;
  const element = event.currentTarget as HTMLElement;
  const doc = store.tabs.find((item) => item.id === id);
  const tab = element.closest<HTMLElement>('.desktop-tab');
  if (!doc || !tab) return;
  const rect = tab.getBoundingClientRect();
  gesture = {
    id,
    pointerId: event.pointerId,
    element,
    startX: event.clientX,
    startY: event.clientY,
    x: event.clientX,
    y: event.clientY,
    grabX: event.clientX - rect.left,
    grabY: event.clientY - rect.top,
    width: Math.max(160, rect.width),
    height: rect.height,
    path: doc.graph ? '关系图谱' : doc.blank ? '新标签页' : doc.path,
    dirty: !!doc.document && store.dirty(doc.document),
  };
  element.setPointerCapture(event.pointerId);
}

function moveDrag(event: PointerEvent) {
  if (!gesture || gesture.pointerId !== event.pointerId) return;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  if (!draggingId.value) {
    if (Math.hypot(gesture.x - gesture.startX, gesture.y - gesture.startY) < 6) return;
    draggingId.value = gesture.id;
    suppressClick = true;
    scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }
  dragPreview.value = {
    path: gesture.path,
    dirty: gesture.dirty,
    left: gesture.x - gesture.grabX,
    top: gesture.y - gesture.grabY,
    width: gesture.width,
    height: gesture.height,
  };
  event.preventDefault();
  updateDropTarget();
}

function finishDrag(commit = false) {
  if (!gesture) return;
  const current = gesture;
  gesture = undefined;
  if (commit && draggingId.value && dropTarget.value) {
    store.moveDocument(current.id, dropTarget.value.id, dropTarget.value.side);
  }
  cancelAnimationFrame(scrollFrame);
  draggingId.value = '';
  dragPreview.value = undefined;
  dropTarget.value = undefined;
  if (current.element.hasPointerCapture(current.pointerId)) {
    current.element.releasePointerCapture(current.pointerId);
  }
  // A drag's synthetic click must not switch the active document on release.
  clearTimeout(clickTimer);
  clickTimer = setTimeout(() => {
    suppressClick = false;
  }, 0);
}

function endDrag(event: PointerEvent) {
  if (gesture?.pointerId !== event.pointerId) return;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  updateDropTarget();
  finishDrag(true);
}

function onClick(event: MouseEvent) {
  if (!suppressClick) return;
  event.preventDefault();
  event.stopPropagation();
}

function closeTab(id: string) {
  const list = tabList.value;
  if (list && pointerInsideTabList.value) {
    const widths: Record<string, number> = {};
    list.querySelectorAll<HTMLElement>('.desktop-tab').forEach((tab) => {
      const width = tab.getBoundingClientRect().width;
      if (tab.dataset.id && width > 0) widths[tab.dataset.id] = width;
    });
    frozenTabWidths.value = widths;
    frozenStripWidth.value =
      Object.entries(widths).reduce(
        (total, [tabId, width]) => total + (tabId === id ? 0 : width),
        0,
      ) + 42;
  }
  store.close(id);
}

function closeContextMenu(restoreFocus = false) {
  contextMenu.value = undefined;
  if (restoreFocus) void nextTick(() => contextTrigger?.focus({ preventScroll: true }));
}

function openContextMenu(event: MouseEvent | KeyboardEvent, tabId: string | null) {
  event.preventDefault();
  const trigger = tabId
    ? (event.target as HTMLElement)
        .closest<HTMLElement>('.desktop-tab')
        ?.querySelector<HTMLElement>('.desktop-tab-switch')
    : (event.currentTarget as HTMLElement);
  if (!trigger) return;
  contextTrigger = tabId
    ? trigger
    : (tabList.value?.parentElement?.querySelector('.desktop-tab-add') ?? trigger);
  const rect = trigger.getBoundingClientRect();
  const x = event instanceof MouseEvent && event.clientX ? event.clientX : rect.left + 16;
  const y = event instanceof MouseEvent && event.clientY ? event.clientY : rect.bottom;
  contextMenu.value = { tabId, x: Math.max(8, x), y: Math.max(8, y) };
  void nextTick(() => {
    const menu = contextMenuElement.value;
    if (!menu || contextMenu.value?.tabId !== tabId) return;
    contextMenu.value.x = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
    contextMenu.value.y = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
  });
}

function onBlankTrackContext(event: MouseEvent) {
  openContextMenu(event, null);
}

function onOutsidePointer(event: PointerEvent) {
  if (contextMenu.value && !contextMenuElement.value?.contains(event.target as Node))
    closeContextMenu();
}

function onOutsideContext(event: MouseEvent) {
  if (
    contextMenu.value &&
    !event.defaultPrevented &&
    !contextMenuElement.value?.contains(event.target as Node)
  )
    closeContextMenu();
}

function onContextKeydown(event: KeyboardEvent) {
  if (!contextMenu.value) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    closeContextMenu(true);
    return;
  }
  if (event.key === 'Tab') {
    closeContextMenu();
    return;
  }
  if (!contextMenuElement.value?.contains(event.target as Node)) return;
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [
    ...(contextMenuElement.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ??
      []),
  ];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length;
  buttons[next]?.focus();
}

function dismissContextMenu() {
  closeContextMenu();
}

async function closeTabs(ids: string[]) {
  for (const id of ids) {
    await store.close(id);
    if (store.tabs.some((tab) => tab.id === id)) break;
  }
}

async function contextAction(
  action: 'new-tab' | 'new-document' | 'close' | 'close-others' | 'close-right' | 'close-all',
) {
  const tabId = contextMenu.value?.tabId;
  closeContextMenu();
  if (action === 'new-tab') return emit('new-tab');
  if (action === 'new-document') return emit('new-document');
  if (action === 'close' && tabId) return closeTab(tabId);
  const ids = store.tabs.map((tab) => tab.id);
  if (action === 'close-others' && tabId) {
    await closeTabs(ids.filter((id) => id !== tabId));
    if (store.tabs.some((tab) => tab.id === tabId)) store.activeId = tabId;
  } else if (action === 'close-right' && tabId) {
    await closeTabs(ids.slice(ids.indexOf(tabId) + 1));
  } else if (action === 'close-all') {
    await closeTabs(ids);
  }
}

onMounted(() => {
  blankTrack =
    tabList.value?.closest('.desktop-window-titlebar')?.querySelector('.desktop-window-drag') ??
    null;
  blankTrack?.addEventListener('contextmenu', onBlankTrackContext);
  window.addEventListener('pointerdown', onOutsidePointer, true);
  window.addEventListener('contextmenu', onOutsideContext);
  window.addEventListener('keydown', onContextKeydown, true);
  window.addEventListener('scroll', dismissContextMenu, true);
  window.addEventListener('resize', dismissContextMenu);
});

function onTabListPointerLeave() {
  pointerInsideTabList.value = false;
  frozenTabWidths.value = {};
  frozenStripWidth.value = undefined;
}

function onTabListPointerEnter() {
  pointerInsideTabList.value = true;
}

function onTabWheel(event: WheelEvent) {
  const list = tabList.value;
  if (!list || list.scrollWidth <= list.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  if (!delta) return;
  const multiplier =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? list.clientWidth
        : 1;
  const previous = list.scrollLeft;
  list.scrollLeft += delta * multiplier;
  if (list.scrollLeft !== previous) event.preventDefault();
}

onBeforeUnmount(() => {
  finishDrag();
  clearTimeout(clickTimer);
  blankTrack?.removeEventListener('contextmenu', onBlankTrackContext);
  window.removeEventListener('pointerdown', onOutsidePointer, true);
  window.removeEventListener('contextmenu', onOutsideContext);
  window.removeEventListener('keydown', onContextKeydown, true);
  window.removeEventListener('scroll', dismissContextMenu, true);
  window.removeEventListener('resize', dismissContextMenu);
});

watch(
  () => store.activeId,
  async () => {
    await nextTick();
    tabList.value
      ?.querySelector('.desktop-tab-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
);

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    finishDrag();
    return;
  }
  if (
    !(event.target instanceof HTMLElement) ||
    !event.target.classList.contains('desktop-tab-switch')
  )
    return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openContextMenu(event, event.target.closest<HTMLElement>('.desktop-tab')?.dataset.id ?? null);
    return;
  }
  const ids = store.tabs.map((tab) => tab.id);
  if (!ids.length) return;
  const current = ids.indexOf(store.activeId);
  let next = current;
  if (event.key === 'ArrowRight') next = (current + 1) % ids.length;
  else if (event.key === 'ArrowLeft') next = (current - 1 + ids.length) % ids.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = ids.length - 1;
  else return;
  event.preventDefault();
  store.activeId = ids[next];
  await nextTick();
  tabList.value?.querySelector<HTMLElement>('.desktop-tab-active .desktop-tab-switch')?.focus();
}
</script>

<template>
  <nav
    class="desktop-tab-strip"
    :style="{
      '--desktop-tab-count': store.tabs.length,
      width: frozenStripWidth === undefined ? undefined : `${frozenStripWidth}px`,
    }"
    aria-label="文档标签页"
    @wheel="onTabWheel"
  >
    <div
      ref="tabList"
      class="desktop-tab-list"
      :class="{ 'desktop-tab-list-dragging': draggingId }"
      role="tablist"
      aria-label="已打开的文档"
      @keydown="onTabKeydown"
      @pointermove="moveDrag"
      @pointerenter="onTabListPointerEnter"
      @pointerleave="onTabListPointerLeave"
      @pointerup="endDrag"
      @pointercancel="finishDrag()"
      @lostpointercapture="finishDrag()"
      @click.capture="onClick"
      @contextmenu.self.prevent="openContextMenu($event, null)"
      @dragstart.prevent
    >
      <div
        v-for="doc in store.tabs"
        :key="doc.id"
        :data-id="doc.id"
        class="desktop-tab"
        :class="{
          'desktop-tab-active': doc.id === store.activeId,
          'desktop-tab-dragging': doc.id === draggingId,
          'desktop-tab-drop-before': dropTarget?.id === doc.id && dropTarget.side === 'before',
          'desktop-tab-drop-after': dropTarget?.id === doc.id && dropTarget.side === 'after',
        }"
        :style="frozenTabWidths[doc.id] ? { flex: `0 0 ${frozenTabWidths[doc.id]}px` } : undefined"
        @contextmenu.stop.prevent="openContextMenu($event, doc.id)"
      >
        <button
          class="desktop-tab-switch"
          type="button"
          role="tab"
          :aria-selected="doc.id === store.activeId"
          :tabindex="doc.id === store.activeId ? 0 : -1"
          :title="doc.graph ? '关系图谱' : doc.blank ? '新标签页' : doc.path"
          @pointerdown="startDrag($event, doc.id)"
          @click="store.activeId = doc.id"
        >
          <GitFork v-if="doc.graph" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <FileText v-else-if="!doc.blank" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <span class="desktop-tab-label">{{ doc.graph ? '关系图谱' : doc.blank ? '新标签页' : title(doc.path) }}</span>
          <span
            v-if="doc.document && store.dirty(doc.document)"
            class="desktop-tab-dirty"
            aria-label="有未保存的修改"
          />
        </button>
        <button
          class="desktop-tab-close"
          type="button"
          :aria-label="`关闭 ${doc.graph ? '关系图谱' : doc.blank ? '新标签页' : title(doc.path)}`"
          :title="`关闭 ${doc.graph ? '关系图谱' : doc.blank ? '新标签页' : title(doc.path)}`"
          @click="closeTab(doc.id)"
        >
          <X :size="13" />
        </button>
      </div>
    </div>
    <button
      class="desktop-tab-add"
      type="button"
      aria-label="新标签页"
      title="新标签页"
      :disabled="!store.workspace || store.busy"
      @click="emit('new-tab')"
    >
      <Plus :size="17" :stroke-width="1.6" />
    </button>
  </nav>
  <Teleport to="body">
    <div
      v-if="contextMenu"
      ref="contextMenuElement"
      class="dropdown compact-action-menu desktop-tab-context-menu"
      role="menu"
      :aria-label="contextMenu.tabId ? '标签页操作' : '标签栏操作'"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <template v-if="contextMenu.tabId">
        <button type="button" role="menuitem" @click="contextAction('close')">
          <X :size="15" />关闭标签页
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="store.tabs.length <= 1"
          @click="contextAction('close-others')"
        >
          <XCircle :size="15" />关闭其他标签页
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="
            store.tabs.findIndex((tab) => tab.id === contextMenu?.tabId) === store.tabs.length - 1
          "
          @click="contextAction('close-right')"
        >
          <PanelRightClose :size="15" />关闭右侧标签页
        </button>
      </template>
      <template v-else>
        <button type="button" role="menuitem" @click="contextAction('new-tab')">
          <Plus :size="15" />新建标签页
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="store.workspace?.readOnly || store.busy"
          @click="contextAction('new-document')"
        >
          <SquarePen :size="15" />新建文档
        </button>
        <div class="menu-divider" role="separator" />
        <button
          type="button"
          role="menuitem"
          :disabled="!store.tabs.length"
          @click="contextAction('close-all')"
        >
          <XCircle :size="15" />关闭全部标签页
        </button>
      </template>
    </div>
  </Teleport>
  <Teleport to="body">
    <div
      v-if="dragPreview"
      class="desktop-tab-drag-preview"
      :style="{
        left: `${dragPreview.left}px`,
        top: `${dragPreview.top}px`,
        width: `${dragPreview.width}px`,
        height: `${dragPreview.height}px`,
      }"
      aria-hidden="true"
    >
      <FileText class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
      <span class="desktop-tab-label">{{ title(dragPreview.path) }}</span>
      <span v-if="dragPreview.dirty" class="desktop-tab-dirty" />
    </div>
  </Teleport>
</template>

<style>
.desktop-tab-strip {
  display: flex;
  width: calc(var(--desktop-tab-count) * 200px + 42px);
  max-width: 100%;
  min-width: 0;
  height: 100%;
  align-items: stretch;
}
.desktop-tab-list {
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.desktop-tab-list::-webkit-scrollbar {
  display: none;
}
.desktop-tab-dragging {
  opacity: 0.45;
}
.desktop-tab-context-menu {
  position: fixed;
  z-index: 1001;
}
.desktop-tab-drag-preview {
  position: fixed;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  padding: 0 16px;
  border: 1px solid var(--line);
  border-radius: 5px;
  background: var(--paper);
  box-shadow: 0 6px 18px rgb(0 0 0 / 16%);
  color: var(--text);
  font-size: 13px;
  pointer-events: none;
  user-select: none;
}
.desktop-tab-drop-before::after,
.desktop-tab-drop-after::after {
  content: '';
  position: absolute;
  z-index: 1;
  top: 6px;
  bottom: 6px;
  width: 2px;
  border-radius: 1px;
  background: var(--green);
  pointer-events: none;
}
.desktop-tab-drop-before::after {
  left: 0;
}
.desktop-tab-drop-after::after {
  right: 0;
}
.desktop-tab {
  --desktop-tab-close-mask: var(--sidebar);
  position: relative;
  container-type: inline-size;
  display: flex;
  align-items: center;
  flex: 1 1 200px;
  min-width: 28px;
  max-width: 200px;
  height: 100%;
  border-right: 1px solid color-mix(in srgb, var(--line) 65%, transparent);
  box-shadow: inset 0 -1px var(--line);
  color: var(--text-secondary);
  transition:
    background 0.15s,
    color 0.15s;
}
.desktop-tab:hover {
  --desktop-tab-close-mask: color-mix(in srgb, var(--paper) 55%, var(--sidebar));
  background: var(--desktop-tab-close-mask);
}
.desktop-tab-active,
.desktop-tab-active:hover {
  --desktop-tab-close-mask: var(--paper);
  background: var(--paper);
  color: var(--text);
  box-shadow: none;
}
.desktop-tab-switch {
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: center;
  gap: 9px;
  flex: 1;
  min-width: 0;
  height: 100%;
  padding: 0 0 0 16px;
  text-align: left;
  font-size: 13px;
}
.desktop-tab-icon {
  flex: 0 0 15px;
  color: var(--muted);
}
.desktop-tab-active .desktop-tab-icon {
  color: var(--green);
}
.desktop-tab-active .desktop-tab-label {
  font-weight: 500;
}
.desktop-tab-label {
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
.desktop-tab-dirty {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--green);
}
.desktop-tab-close,
.desktop-tab-add {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: var(--muted);
}
.desktop-tab-close {
  position: absolute;
  z-index: 2;
  top: 50%;
  right: 0;
  width: 40px;
  transform: translateY(-50%);
  background: var(--desktop-tab-close-mask);
  opacity: 0;
  pointer-events: none;
  transition:
    opacity 0.15s,
    background 0.15s,
    color 0.15s;
}
.desktop-tab-close::before {
  content: '';
  position: absolute;
  z-index: 0;
  top: 0;
  right: 100%;
  width: 44px;
  height: 100%;
  background: linear-gradient(90deg, transparent, var(--desktop-tab-close-mask));
  pointer-events: none;
}
.desktop-tab:hover .desktop-tab-close,
.desktop-tab-close:focus-visible {
  opacity: 1;
  pointer-events: auto;
}
.desktop-tab-close:hover,
.desktop-tab-add:not(:disabled):hover {
  color: var(--text);
}
.desktop-tab-add:not(:disabled):hover {
  background: var(--hover);
}
.desktop-tab-add {
  align-self: center;
  width: 28px;
  height: 28px;
  margin: 0 7px;
}
.desktop-tab-switch:focus-visible,
.desktop-tab-close:focus-visible,
.desktop-tab-add:focus-visible {
  outline-offset: -3px;
}
@container (max-width: 80px) {
  .desktop-tab-switch {
    justify-content: center;
    gap: 0;
    padding: 0;
  }
  .desktop-tab-label,
  .desktop-tab-dirty,
  .desktop-tab-close::before {
    display: none;
  }
  .desktop-tab-close {
    right: 50%;
    width: 24px;
    transform: translate(50%, -50%);
  }
  @media (hover: hover) {
    .desktop-tab:hover .desktop-tab-close:not(:hover):not(:focus-visible) {
      opacity: 0;
    }
    .desktop-tab:hover .desktop-tab-close:hover {
      opacity: 1;
    }
  }
}
@container (max-width: 32px) {
  .desktop-tab-close {
    width: 18px;
    height: 18px;
  }
}
@media (hover: none) {
  .desktop-tab-close {
    opacity: 1;
    pointer-events: auto;
  }
}
</style>
