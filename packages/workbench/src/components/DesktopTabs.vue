<script setup lang="ts">
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../i18n';
import LoadingSkeleton from './LoadingSkeleton.vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { animate } from 'motion/mini';
import { springEasing } from '@tano/editor/motion';
import { ArrowLeft, ArrowRight, Bot, CalendarDays, GitFork, Puzzle, Plus, X, XCircle, PanelRightClose, PanelBottomClose, ExternalLink, Bug } from 'lucide-vue-next';
import { basename, isMarkdown, isDataTableFilePath } from '@tano/protocol';
import { documentTabLabel } from '../tab-label';
import { invoke } from '@tauri-apps/api/core';
import { cursorPosition } from '@tauri-apps/api/window';
import { isHTMLElement, isNode } from '@tano/editor/dom-realm';
import type { DetachedDropPoint } from '../windows/position';
import { finishedTabDrag, parseTabDragMeta, tabDockIndex, tabDragMetaType, type TabDragMeta } from '../tab-docking';
import { paneDropAt as hitTestPane } from '../pane-docking';
import { tabLayoutRect } from '../tab-layout';
import { TAB_DRAG_IMAGE_INSET, tabDragImage } from '../tab-drag-image';
import { settlingTabId } from '../tab-settle';
import type { PaneDrop } from '../pane-layout';
import { mobile, nativeOs } from '../platform';
import { useWorkspaceStore } from '../stores/workspace';
import type { DocumentTab } from '../stores/workspace';
import ButtonVisibilityGroup from './ButtonVisibilityGroup.vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
import ResourceIcon from './ResourceIcon.vue';
import { appearanceText } from '../document-appearance';
import { useWindowContext } from '../windows/context';
import { Database, FilePlus2 } from 'lucide-vue-next';

const store = useWorkspaceStore();
const windowContext = useWindowContext();
const { window, document } = windowContext;
const requestAnimationFrame = (callback: FrameRequestCallback) => window.requestAnimationFrame(callback);
const cancelAnimationFrame = (id: number) => window.cancelAnimationFrame(id);
const getComputedStyle = (element: Element, pseudo?: string | null) => window.getComputedStyle(element, pseudo);
const paneDropAt = (x: number, y: number) => hitTestPane(x, y, document);
const navigationItems = [
  { id: 'back', get label() { return t('后退'); } },
  { id: 'forward', get label() { return t('前进'); } },
];
const props = defineProps<{
  loading?: boolean;
  detachable?: boolean;
  paneId?: string;
  showNavigation?: boolean;
  fileDrag?: { workspaceId: string; ids: readonly string[] };
  assistantTab?: { id: string; title: string };
}>();
const paneTabs = computed(() => props.loading ? [] : props.paneId
  ? store.tabs.filter(tab => store.panes.find(pane => pane.id === props.paneId)?.tabs.includes(tab.id))
  : store.tabs);
const documentIcons = computed(() => Object.fromEntries(
  paneTabs.value.map(tab => [tab.id, tab.dataTable ? tab.dataTable.icon ?? '' : appearanceText(tab.document?.content ?? '', 'icon')]),
));
const selectedId = computed(() => props.paneId
  ? store.panes.find(pane => pane.id === props.paneId)?.activeId ?? '' : store.activeId);
const paneSlot = computed(() => store.paneDrop?.paneId === props.paneId ? store.paneDrop?.index : undefined);
function activatePane() { if (props.paneId) store.focusPane(props.paneId); }
function globalIndex(index: number) {
  const next = paneTabs.value[index], last = paneTabs.value.at(-1);
  return next ? store.tabs.findIndex(tab => tab.id === next.id)
    : last ? store.tabs.findIndex(tab => tab.id === last.id) + 1 : store.tabs.length;
}
let sourcePaneDrop: PaneDrop | undefined;
function clearSourcePaneDrop() {
  if (sourcePaneDrop && store.paneDrop === sourcePaneDrop) store.paneDrop = undefined;
  sourcePaneDrop = undefined;
}
function updatePaneDrop(x: number, y: number, id: string) {
  if (!props.paneId) return;
  const drop = paneDropAt(x, y);
  const source = store.panes.find(pane => pane.tabs.includes(id));
  clearSourcePaneDrop();
  if (drop && !(drop.side !== 'center' && source?.id === drop.paneId && source.tabs.length === 1)) {
    store.paneDrop = drop;
    sourcePaneDrop = store.paneDrop;
  }
}
// WebView content is clipped at the native window edge. A native drag image is not.
const nativeTabDrag = props.detachable && nativeOs === 'windows';
const emit = defineEmits<{ 'new-tab': []; 'new-document': []; 'detach-tab': [id: string, drop?: DetachedDropPoint, settled?: () => void]; 'files-dropped': [] }>();
const tabList = ref<HTMLElement>();
const contextMenuElement = ref<HTMLElement>();
const contextMenu = ref<{ tabId: string | null; x: number; y: number }>();
let contextTrigger: HTMLElement | null = null;
let blankTrack: HTMLElement | null = null;
const frozenTabWidths = ref<Record<string, number>>({});
const frozenStripWidth = ref<number>();
const pointerInsideTabList = ref(false);
const tabLayoutAnimating = ref(false);
const movingTabs = new Map<HTMLElement, { animation: ReturnType<typeof animate>; restore: () => void }>();
let tabMoveRevision = 0;
let tabLayoutMotion: Promise<void> | undefined;
let finishCancelledTabMove: (() => void) | undefined;
function cancelTabMoves() {
  tabMoveRevision++;
  finishCancelledTabMove?.();
  finishCancelledTabMove = undefined;
  for (const { animation, restore } of movingTabs.values()) { animation.cancel(); restore(); }
  movingTabs.clear();
  tabLayoutAnimating.value = false;
}
function releaseTabWidths() {
  frozenTabWidths.value = {};
  frozenStripWidth.value = undefined;
}
function moveTabElement(element: HTMLElement, keyframes: Record<string, (number | string)[]>, restore: () => void) {
  const animation = animate(element, keyframes, { duration: 0.32, ease: springEasing('snappy') });
  movingTabs.set(element, { animation, restore });
}
async function animateTabLayout(ids: string[], opening: boolean) {
  const list = tabList.value;
  if (!list) return;
  const strip = list.parentElement!;
  const stripWidth = strip.getBoundingClientRect().width;
  // Capture the visible layout so rapid opens/closes continue from this frame.
  const previous = new Map([...list.querySelectorAll<HTMLElement>('.desktop-tab')]
    .map(tab => [tab.dataset.id!, { box: tab.getBoundingClientRect(), opacity: Number(getComputedStyle(tab).opacity) }]));
  cancelTabMoves();
  const revision = tabMoveRevision;
  tabLayoutAnimating.value = true;
  if (opening) releaseTabWidths();
  else {
    frozenTabWidths.value = Object.fromEntries([...previous].map(([id, { box }]) => [id, box.width]));
    frozenStripWidth.value = ids.reduce((width, id) => width + (previous.get(id)?.box.width ?? 200), 42);
  }
  await nextTick();
  if (revision !== tabMoveRevision || tabList.value !== list) return;
  const targetStripWidth = strip.getBoundingClientRect().width;
  if (opening) {
    // Measure the final responsive widths, then use pixels throughout expansion.
    // Relative flex bases would resize existing tabs as the strip itself grows.
    frozenTabWidths.value = Object.fromEntries([...list.querySelectorAll<HTMLElement>('.desktop-tab')]
      .map(tab => [tab.dataset.id!, tab.getBoundingClientRect().width]));
    frozenStripWidth.value = targetStripWidth - reservedTabWidth.value;
    await nextTick();
    if (revision !== tabMoveRevision || tabList.value !== list) return;
  }
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  let finishCancelled!: () => void;
  const cancelled = new Promise<void>(resolve => { finishCancelled = resolve; });
  finishCancelledTabMove = finishCancelled;
  const inlineWidth = strip.style.width;
  if (!reduced && typeof strip.animate === 'function' && Math.abs(stripWidth - targetStripWidth) >= 0.5) {
    moveTabElement(strip, { width: [`${stripWidth}px`, `${targetStripWidth}px`] }, () => { strip.style.width = inlineWidth; });
  }
  for (const tab of list.querySelectorAll<HTMLElement>('.desktop-tab')) {
    const before = previous.get(tab.dataset.id!);
    if (reduced || typeof tab.animate !== 'function') continue;
    if (opening) {
      const width = frozenTabWidths.value[tab.dataset.id!]!;
      const fromWidth = before?.box.width ?? 0, opacity = before?.opacity ?? 0;
      if (Math.abs(fromWidth - width) < 0.5 && opacity === 1) continue;
      const flex = tab.style.flex, overflow = tab.style.overflow, inlineOpacity = tab.style.opacity;
      tab.style.overflow = 'clip';
      moveTabElement(tab, { flexBasis: [`${fromWidth}px`, `${width}px`], opacity: [opacity, 1] }, () => {
        tab.style.flex = flex; tab.style.overflow = overflow; tab.style.opacity = inlineOpacity;
      });
    } else {
      const offset = before ? before.box.left - tabLayoutRect(tab).left : 0;
      if (Math.abs(offset) < 0.5) continue;
      const transform = tab.style.transform;
      moveTabElement(tab, { transform: [`translateX(${offset}px)`, 'translateX(0px)'] }, () => { tab.style.transform = transform; });
    }
  }
  const movements = [...movingTabs];
  // Motion's finished promise does not settle when cancel() interrupts it.
  await Promise.race([Promise.allSettled(movements.map(([, { animation }]) => animation.finished)), cancelled]);
  if (finishCancelledTabMove === finishCancelled) finishCancelledTabMove = undefined;
  for (const [element, movement] of movements) {
    if (movingTabs.get(element) !== movement) continue;
    const { animation, restore } = movement;
    animation.cancel();
    restore();
    movingTabs.delete(element);
  }
  if (revision === tabMoveRevision) {
    if (opening) {
      releaseTabWidths();
      await nextTick();
      // Apply the responsive basis while CSS size transitions are still off.
      // Otherwise the browser batches it with re-enabling those transitions.
      list.getBoundingClientRect();
    }
    if (revision === tabMoveRevision) tabLayoutAnimating.value = false;
  }
}
const title = (path: string) => basename(path).replace(/\.(md|markdown)$/i, '');
const tabLabel = (tab: DocumentTab) => props.assistantTab?.id === tab.id ? props.assistantTab.title
  : documentTabLabel(tab);
const draggingId = ref('');
const capturingNativeDrag = ref(false);
const nativeOverlay = ref(false);
let nativeImage: { id: string; canvas: HTMLCanvasElement } | undefined;
let nativePositionId = '';
let unlistenNativePosition: (() => void) | undefined;
const outgoingId = ref('');
const dragPreview = ref<{
  id: string;
  path: string;
  dirty: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
}>();
const dropTarget = ref<{ id: string; side: 'before' | 'after' }>();
watch(finishedTabDrag, result => {
  if (result && incomingHover?.sourceLabel === result.sourceLabel && incomingHover.tabId === result.tabId) clearIncomingSlot();
});
const incomingSlot = ref<{ sourceLabel: string; tabId: string; width?: number; index?: number; drop?: PaneDrop }>();
const fileSlot = ref<{ index: number; x: number; y: number }>();
const fileHintStyle = computed(() => fileSlot.value ? {
  left: `${Math.max(8, Math.min(fileSlot.value.x + 16, window.innerWidth - 240))}px`,
  top: `${Math.max(8, Math.min(fileSlot.value.y + 24, window.innerHeight - 64))}px`,
} : undefined);
const dockSlotIndex = computed(() => fileSlot.value?.index ?? paneSlot.value ?? incomingSlot.value?.index);
const snapLayout = computed(() => {
  const tabs = paneTabs.value;
  const source = tabs.findIndex(tab => tab.id === draggingId.value);
  const target = dropTarget.value;
  const localSlot = target ? tabs.findIndex(tab => tab.id === target.id) + (target.side === 'after' ? 1 : 0) : undefined;
  const slot = dockSlotIndex.value ?? localSlot;
  if (slot === undefined) return;
  const elements = new Map([...(tabList.value?.querySelectorAll<HTMLElement>('.desktop-tab') ?? [])].map(el => [el.dataset.id, el]));
  const widths = tabs.map(tab => {
    const element = elements.get(tab.id);
    // Hundredths: measuring mid-animation yields float noise (199.99998),
    // which would change the offsets every frame and restart the slide.
    return element ? Math.round(tabLayoutRect(element).width * 100) / 100 : 200;
  });
  const width = source >= 0 ? widths[source]! : Math.max(28, Math.min(200, incomingSlot.value?.width ?? widths[0] ?? 180));
  const offsets: Record<string, number> = {};
  const before = widths.slice(0, slot).reduce((sum, value) => sum + value, 0);
  tabs.forEach((tab, index) => {
    offsets[tab.id] = source < 0 ? (index >= slot ? width : 0)
      : index === source ? before - widths.slice(0, source).reduce((sum, value) => sum + value, 0) - (slot > source ? width : 0)
      : source < slot && index > source && index < slot ? -width
      : source >= slot && index >= slot && index < source ? width : 0;
  });
  return { offsets, width, left: before, incoming: source < 0 };
});
const reservedTabWidth = computed(() => snapLayout.value?.incoming ? snapLayout.value.width : 0);
// Keep the slide transition for the whole hover, not only while a slot is
// open: leaving every slot must glide the shifted tabs back, not jump. It
// ends together with the drop, whose reorder must not animate a second time.
const slotReturn = ref(false);
const slotMotion = computed(() => !!draggingId.value || slotReturn.value || !!incomingSlot.value || !!fileSlot.value || paneSlot.value !== undefined);
// Slot motion is driven explicitly instead of by a CSS transition: every
// offset change (opening, moving or closing a slot) glides each tab from where
// it is drawn right now, so leaving a slot can never snap the tabs back.
const slotAnimations = new Map<HTMLElement, ReturnType<typeof animate>>();
const slotTargets = new Map<string, number>();
function drawnOffset(element: HTMLElement) {
  const values = getComputedStyle(element).transform.match(/^matrix\((.+)\)$/)?.[1]?.split(',').map(Number);
  return values?.[4] ?? 0;
}
function stopSlotAnimations() {
  for (const animation of slotAnimations.values()) animation.cancel();
  slotAnimations.clear();
}
watch(
  () => paneTabs.value.map(tab => `${tab.id}:${snapLayout.value?.offsets[tab.id] ?? 0}`).join('|'),
  () => {
    const list = tabList.value;
    const offsets = snapLayout.value?.offsets ?? {};
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      || document.documentElement.dataset.motion === 'reduced';
    // A committed drop reorders the DOM in the same update: nothing may slide.
    if (!list || !slotMotion.value || reduced || typeof HTMLElement.prototype.animate !== 'function') {
      stopSlotAnimations();
      slotTargets.clear();
      for (const tab of paneTabs.value) slotTargets.set(tab.id, offsets[tab.id] ?? 0);
      return;
    }
    for (const tab of list.querySelectorAll<HTMLElement>('.desktop-tab')) {
      const id = tab.dataset.id!;
      const to = offsets[id] ?? 0;
      const running = slotAnimations.get(tab);
      const from = running ? drawnOffset(tab) : slotTargets.get(id) ?? 0;
      running?.cancel();
      slotAnimations.delete(tab);
      slotTargets.set(id, to);
      if (Math.abs(from - to) < 0.5) continue;
      const animation = animate(tab, { transform: [`translateX(${from}px)`, `translateX(${to}px)`] },
        { duration: 0.34, ease: springEasing('snappy') });
      slotAnimations.set(tab, animation);
      void animation.finished.then(() => {
        if (slotAnimations.get(tab) !== animation) return;
        slotAnimations.delete(tab);
        animation.cancel();
      }, () => {});
    }
  },
  { flush: 'post' },
);
const draggedFiles = computed(() => {
  if (!props.fileDrag || props.fileDrag.workspaceId !== store.workspace?.id || store.busy) return [];
  const files = props.fileDrag.ids.map((id) => store.workspace!.files.find((file) => file.id === id));
  return files.every((file) => file?.kind === 'file' && (isMarkdown(file.path) || isDataTableFilePath(file.path))) ? files : [];
});
let fileScrollFrame = 0;
let incomingHover: TabDragMeta | undefined;
let incomingDropTimer: ReturnType<typeof setTimeout> | undefined;
let mounted = false;
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
let nativeDragging = false;
let nativeOutside = false;
let finishingDrag = false;
let suppressClick = false;
let clickTimer: ReturnType<typeof setTimeout> | undefined;

function updateDropTargetAt(x: number, y: number, id: string) {
  const list = tabList.value;
  if (!list) return;
  const bounds = list.getBoundingClientRect();
  dropTarget.value = undefined;
  if (
    y < bounds.top ||
    y > bounds.bottom ||
    x < bounds.left - 24 ||
    x > bounds.right + 24
  )
    return;
  const tabs = [...list.querySelectorAll<HTMLElement>('.desktop-tab')];
  const target = tabs.find((tab) => x < tabLayoutRect(tab).right) ?? tabs.at(-1);
  if (!target || target.dataset.id === id) return;
  const rect = tabLayoutRect(target);
  dropTarget.value = {
    id: target.dataset.id!,
    side: x < rect.left + rect.width / 2 ? 'before' : 'after',
  };
}
// Just outside the window (typically above its top edge), a pointer close to
// this strip still docks into it, so a small overshoot never tears a tab off.
const NEAR_STRIP = 48;
function stripPoint(x: number, y: number) {
  const list = tabList.value;
  if (!list) return;
  const outside = x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
  const bounds = list.getBoundingClientRect();
  if (!outside || x < bounds.left - 24 || x > bounds.right + 24 ||
      y < bounds.top - NEAR_STRIP || y > bounds.bottom) return;
  return { x: Math.max(bounds.left, Math.min(x, bounds.right - 1)), y: (bounds.top + bounds.bottom) / 2 };
}
function updateDropTarget() {
  if (gesture) {
    const near = stripPoint(gesture.x, gesture.y);
    const x = near?.x ?? gesture.x, y = near?.y ?? gesture.y;
    updateDropTargetAt(x, y, gesture.id);
    updatePaneDrop(x, y, gesture.id);
    // The preview stays under the pointer. Only the empty slot in the track
    // shows where the tab will land; it is placed there on release.
    if (dragPreview.value) dragPreview.value.top = gesture.y - gesture.grabY;
  }
}

// Release: fly the floating preview into its slot, then reveal the real tab.
// The target is re-measured every frame so scrolling, cross-pane growth and
// layout changes cannot leave it short of the slot. Interruptible by any drag.
const settlingPreview = ref(false);
let settleFrame = 0;
function stopSettling() {
  cancelAnimationFrame(settleFrame);
  settleFrame = 0;
  slotReturn.value = false;
  if (!settlingPreview.value) return;
  settlingPreview.value = false;
  if (settlingTabId.value === dragPreview.value?.id) settlingTabId.value = '';
  dragPreview.value = undefined;
}
function settlePreview(from: NonNullable<typeof dragPreview.value>) {
  stopSettling();
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    || document.documentElement.dataset.motion === 'reduced';
  if (reduced || typeof HTMLElement.prototype.animate !== 'function') return;
  dragPreview.value = { ...from };
  settlingPreview.value = true;
  settlingTabId.value = from.id;
  // RAF timestamps and performance.now must come from the same window.
  const startedAt = window.performance.now();
  // A short hop into a nearby slot is quick; a long return trip from an
  // invalid drop takes a little longer so it reads as one smooth glide.
  const home = [...document.querySelectorAll<HTMLElement>('.desktop-tab')].find(tab => tab.dataset.id === from.id)?.getBoundingClientRect();
  const distance = home ? Math.hypot(home.left - from.left, home.top - from.top) : 0;
  const duration = Math.min(460, 260 + distance * 0.18);
  const step = (now: number) => {
    const preview = dragPreview.value;
    const target = [...document.querySelectorAll<HTMLElement>('.desktop-tab')].find(tab => tab.dataset.id === from.id);
    if (!settlingPreview.value || !preview || !target) { stopSettling(); return; }
    const box = target.getBoundingClientRect();
    const t = Math.max(0, Math.min(1, (now - startedAt) / duration));
    // Critically damped feel without overshoot: the preview must not pass the slot.
    const p = 1 - (1 - t) ** 3;
    preview.left = from.left + (box.left - from.left) * p;
    preview.top = from.top + (box.top - from.top) * p;
    preview.width = from.width + (box.width - from.width) * p;
    preview.height = from.height + (box.height - from.height) * p;
    if (t >= 1) { stopSettling(); return; }
    settleFrame = requestAnimationFrame(step);
  };
  settleFrame = requestAnimationFrame(step);
}

function dockIndexAt(x: number, y: number, centerOffset: number) {
  const list = tabList.value;
  if (!list) return null;
  const rect = list.getBoundingClientRect();
  if (x < rect.left - 24 || x > rect.right + 24 || y < rect.top - 24 || y > rect.bottom + 24) return null;
  const centers = [...list.querySelectorAll<HTMLElement>('.desktop-tab')]
    .map((tab) => { const box = tabLayoutRect(tab); return box.left + box.width / 2; });
  return tabDockIndex(x + centerOffset, centers);
}

function isFileDropSurface(target: EventTarget | null) {
  return isNode(target) && !!(
    tabList.value?.parentElement?.contains(target) || blankTrack?.contains(target) ||
    tabList.value?.closest('.workspace-tabbar')?.contains(target)
  );
}

function fileIndexAt(x: number) {
  const bounds = tabList.value?.getBoundingClientRect();
  // The add button and trailing titlebar always append, including when tabs overflow.
  if (bounds && x > bounds.right) return paneTabs.value.length;
  if (bounds && x < bounds.left) return 0;
  const centers = [...(tabList.value?.querySelectorAll<HTMLElement>('.desktop-tab') ?? [])]
    .map((tab) => { const box = tabLayoutRect(tab); return box.left + box.width / 2; });
  return tabDockIndex(x, centers);
}

function clearFileSlot() {
  fileSlot.value = undefined;
  cancelAnimationFrame(fileScrollFrame);
  fileScrollFrame = 0;
}

function scrollWhileFileDragging() {
  const list = tabList.value;
  const slot = fileSlot.value;
  if (!list || !slot) return;
  const bounds = list.getBoundingClientRect();
  if (slot.x >= bounds.left && slot.x <= bounds.right) {
    if (slot.x < bounds.left + 32) list.scrollLeft -= 10;
    else if (slot.x > bounds.right - 32) list.scrollLeft += 10;
  }
  slot.index = fileIndexAt(slot.x);
  fileScrollFrame = requestAnimationFrame(scrollWhileFileDragging);
}

function fileDragOver(event: DragEvent) {
  if (!draggedFiles.value.length || !event.dataTransfer?.types.includes('application/x-tano-entry') ||
      !isFileDropSurface(event.target)) {
    clearFileSlot();
    return;
  }
  event.preventDefault();
  event.dataTransfer.dropEffect = 'copy';
  fileSlot.value = { index: fileIndexAt(event.clientX), x: event.clientX, y: event.clientY };
  if (!fileScrollFrame) fileScrollFrame = requestAnimationFrame(scrollWhileFileDragging);
}

function fileDragLeave(event: DragEvent) {
  if (!isFileDropSurface(event.relatedTarget)) clearFileSlot();
}

function fileDrop(event: DragEvent) {
  const drag = props.fileDrag;
  if (!drag || !draggedFiles.value.length || !isFileDropSurface(event.target) ||
      !event.dataTransfer?.types.includes('application/x-tano-entry')) {
    clearFileSlot();
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  const index = globalIndex(fileIndexAt(event.clientX));
  activatePane();
  clearFileSlot();
  emit('files-dropped');
  void store.openFilesInNewTabsAt(drag.ids, index, drag.workspaceId);
}

function incomingDragOver(event: DragEvent) {
  if (!nativeTabDrag || nativeDragging || !store.workspace) return;
  const meta = parseTabDragMeta(event.dataTransfer?.types ?? []);
  if (!meta || meta.sourceLabel === windowContext.label || meta.workspaceId !== store.workspace.id) {
    clearIncomingSlot();
    return;
  }
  const drop = props.paneId ? paneDropAt(event.clientX, event.clientY) : undefined;
  const index = props.paneId ? (drop?.paneId === props.paneId ? drop.index : undefined)
    : dockIndexAt(event.clientX, event.clientY, meta.centerOffset);
  clearIncomingSlot();
  incomingHover = meta;
  if (props.paneId ? drop?.paneId !== props.paneId : index === null) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  incomingSlot.value = { ...incomingHover, width: meta.width, index: index ?? undefined, drop };
  if (drop) store.paneDrop = drop;
}

function clearIncomingSlot() {
  clearTimeout(incomingDropTimer);
  incomingDropTimer = undefined;
  // Every pane has a listener; only the owner may remove the shared preview.
  if (incomingSlot.value?.drop && store.paneDrop === incomingSlot.value.drop) store.paneDrop = undefined;
  incomingSlot.value = undefined;
  incomingHover = undefined;
}

function incomingDragLeave(event: DragEvent) {
  if (event.relatedTarget || !incomingHover || incomingDropTimer) return;
  // Child transitions may briefly emit dragleave; allow the next dragover to retain the slot.
  incomingDropTimer = setTimeout(clearIncomingSlot, 90);
}

function incomingDrop(event: DragEvent) {
  if (!incomingHover || !incomingSlot.value?.drop) return;
  event.preventDefault();
  const meta = incomingHover;
  const tab = store.tabs.find(tab => tab.id === meta.tabId);
  const landing = tab && {
    id: tab.id, path: tabLabel(tab), dirty: !!tab.document && store.dirty(tab.document),
    left: event.clientX - (meta.width / 2 - meta.centerOffset),
    top: event.clientY - (meta.grabY ?? 18),
    width: meta.width, height: meta.height ?? 32,
  };
  store.moveTabToWindow(meta.tabId, windowContext.id, incomingSlot.value.drop);
  clearIncomingSlot();
  // The destination owns landing so closing an emptied source cannot cancel it.
  void nextTick(() => {
    if (mounted && !gesture && landing && paneTabs.value.some(tab => tab.id === landing.id)) settlePreview(landing);
  });
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
  // A touch gesture scrolls the strip; mouse/trackpad dragging still docks tabs.
  if (event.pointerType === 'touch') return;
  stopSettling();
  // Activate before the native drag takes over, rather than waiting for click.
  store.activeId = id;
  if (nativeTabDrag) {
    const tab = (event.currentTarget as HTMLElement).closest<HTMLElement>('.desktop-tab');
    const doc = paneTabs.value.find(item => item.id === id);
    const canvas = tab && doc ? tabDragImage(tab, tabLabel(doc)) : undefined;
    nativeImage = canvas ? { id, canvas } : undefined;
    return;
  }
  const element = event.currentTarget as HTMLElement;
  const doc = paneTabs.value.find((item) => item.id === id);
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
    path: doc.graph ? '关系图谱' : doc.plugins ? '插件' : doc.calendar ? '计划' : doc.view ? doc.view.label : doc.blank ? '新标签页' : doc.path,
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
    cancelTabMoves();
    draggingId.value = gesture.id;
    suppressClick = true;
    scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }
  dragPreview.value = {
    id: gesture.id,
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

function notifyDragFinished(tabId: string) {
  finishedTabDrag.value = { sourceLabel: windowContext.label, tabId };
}

function finishDrag(commit = false, transferring = false) {
  if (!gesture) return;
  const current = gesture;
  if (nativeDragging && !transferring) notifyDragFinished(current.id);
  gesture = undefined;
  // Detached tabs leave the window; every other release (including cancel)
  // lands the preview in the tab's final slot.
  const landing = !transferring && draggingId.value && dragPreview.value ? { ...dragPreview.value } : undefined;
  const paneDrop = store.paneDrop === sourcePaneDrop ? sourcePaneDrop : undefined;
  // Nothing moves (cancel or no target): shifted tabs glide back with the preview.
  const moved = commit && !!draggingId.value && (!!paneDrop || !!dropTarget.value);
  clearSourcePaneDrop();
  if (commit && draggingId.value && paneDrop) {
    store.dockTab(current.id, paneDrop);
  } else if (commit && draggingId.value && dropTarget.value) {
    store.moveDocument(current.id, dropTarget.value.id, dropTarget.value.side);
  }
  cancelAnimationFrame(scrollFrame);
  nativeDragging = false;
  nativeOutside = false;
  finishingDrag = false;
  draggingId.value = '';
  capturingNativeDrag.value = false;
  nativeOverlay.value = false;
  nativeImage = undefined;
  nativePositionId = '';
  dragPreview.value = undefined;
  dropTarget.value = undefined;
  if (landing) settlePreview(landing);
  if (!moved && settlingPreview.value) slotReturn.value = true;
  if (current.pointerId >= 0 && current.element.hasPointerCapture(current.pointerId)) {
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
  if (finishingDrag) return;
  gesture.x = event.clientX;
  gesture.y = event.clientY;
  updateDropTarget();
  const bounds = tabList.value?.getBoundingClientRect();
  const withinStrip = bounds &&
    event.clientX >= bounds.left - 48 && event.clientX <= bounds.right + 48 &&
    event.clientY >= bounds.top - 36 && event.clientY <= bounds.bottom + 36;
  if (store.paneDrop || !props.detachable || !draggingId.value || withinStrip) finishDrag(true);
  else void finishAtSystemCursor();
}

async function finishAtSystemCursor(drop?: { x: number; y: number }) {
  if (!gesture || finishingDrag) return;
  finishingDrag = true;
  const current = gesture;
  try {
    const appWindow = windowContext.native!;
    const [cursor, origin, scale] = await Promise.all([
      drop ? Promise.resolve(drop) : cursorPosition(), appWindow.innerPosition(), appWindow.scaleFactor(),
    ]);
    if (gesture !== current) return;
    current.x = (cursor.x - origin.x) / scale;
    current.y = (cursor.y - origin.y) / scale;
    const near = stripPoint(current.x, current.y);
    if (nativeOutside && !near) {
      dropTarget.value = undefined;
      clearSourcePaneDrop();
    } else updateDropTarget();
    const bounds = tabList.value?.getBoundingClientRect();
    const withinWindow = current.x >= 0 && current.x < window.innerWidth &&
      current.y >= 0 && current.y < window.innerHeight;
    const withinStrip = withinWindow && bounds &&
      current.x >= bounds.left - 48 && current.x <= bounds.right + 48 &&
      current.y >= bounds.top - 36 && current.y <= bounds.bottom + 36;
    // Just outside the window but close to the strip still docks here.
    if (near || (withinWindow && !nativeOutside && (store.paneDrop || withinStrip))) {
      finishDrag(true);
      return;
    }
    // Released over this window's own content, away from any slot or split
    // edge: not a valid target, so the tab glides back to where it was.
    if (withinWindow && !nativeOutside) {
      finishDrag();
      return;
    }
    // Where the tab was let go, so it can glide back if it ends up staying.
    const released = {
      id: current.id, path: current.path, dirty: current.dirty,
      left: current.x - current.grabX, top: current.y - current.grabY,
      width: current.width, height: current.height,
    };
    finishDrag(false, true);
    outgoingId.value = current.id;
    emit('detach-tab', current.id, {
      x: cursor.x, y: cursor.y, grabX: current.grabX, grabY: current.grabY,
      width: current.width, insideSourceWindow: withinWindow,
    }, () => {
      notifyDragFinished(current.id);
      if (outgoingId.value === current.id) outgoingId.value = '';
      // Not moved (blocked view, unsaved changes, no other window took it).
      if (paneTabs.value.some(tab => tab.id === current.id) && !gesture) {
        void nextTick(() => { if (!gesture) settlePreview(released); });
      }
    });
  } catch (error) {
    finishDrag();
    store.report(error);
  }
}

function pointerInterrupted() {
  // Native HTML drag cancels the pointer stream when it takes ownership.
  // The gesture remains active until dragend or the host observes button release.
  if (nativeDragging) return;
  finishDrag();
}

async function watchNativeRelease(current: NonNullable<typeof gesture>) {
  try {
    const image = nativeImage?.id === current.id ? nativeImage.canvas : undefined;
    const scale = window.devicePixelRatio || 1;
    let preview;
    if (image) {
      // tabDragImage already paints at device pixels.
      const context = image.getContext('2d');
      if (context) {
        const bytes = context.getImageData(0, 0, image.width, image.height).data;
        let binary = '';
        for (const byte of bytes) binary += String.fromCharCode(byte);
        preview = { width: image.width, height: image.height, rgba: btoa(binary),
          // The bitmap has transparent room for the card's shadow.
          grabX: Math.round((current.grabX + TAB_DRAG_IMAGE_INSET.x) * scale),
          grabY: Math.round((current.grabY + TAB_DRAG_IMAGE_INSET.y) * scale) };
      }
    }
    // The topmost native overlay draws the card everywhere, so the source
    // window can never cover or clip it; the DOM copy only lands it on release.
    if (preview) nativeOverlay.value = true;
    const drop = await invoke<{ x: number; y: number; cancelled?: boolean; overSource?: boolean }>('tab_drag_release', { preview, dragId: nativePositionId, windowLabel: windowContext.label });
    if (gesture !== current || !nativeDragging) return;
    if (drop.cancelled) { finishDrag(); return; }
    // The host knows which window is really under the release point. A stray
    // dragleave must not turn an invalid drop on this window into a detach
    // (which collapses the tab and makes its neighbours jump).
    if (typeof drop.overSource === 'boolean') nativeOutside = !drop.overSource;
    // Let the browser finish its native drop dispatch before changing the tab tree.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const ownLayout = store.windowLayouts?.[windowContext.id];
    if (store.windowLayouts && (!ownLayout || !store.panes.some(pane => pane.tabs.includes(current.id) &&
      pane.id === props.paneId))) {
      finishDrag(false, true);
      notifyDragFinished(current.id);
      return;
    }
    if (gesture === current && nativeDragging) await finishAtSystemCursor(drop);
  } catch (error) {
    if (gesture !== current || !nativeDragging) return;
    finishDrag();
    store.report(error);
  }
}

function startNativeDrag(event: DragEvent, id: string) {
  if (!nativeTabDrag || !event.dataTransfer || gesture) {
    event.preventDefault();
    return;
  }
  stopSettling();
  cancelTabMoves();
  const element = event.currentTarget as HTMLElement;
  const tab = element.closest<HTMLElement>('.desktop-tab');
  const doc = paneTabs.value.find((item) => item.id === id);
  if (!tab || !doc) {
    event.preventDefault();
    return;
  }
  const rect = tab.getBoundingClientRect();
  const grabX = event.clientX - rect.left;
  const grabY = event.clientY - rect.top;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('application/x-tano-tab', id);
  if (store.workspace) event.dataTransfer.setData(tabDragMetaType({
    sourceLabel: windowContext.label, workspaceId: store.workspace.id, tabId: id,
    width: rect.width, centerOffset: rect.width / 2 - grabX, height: rect.height, grabY,
  }), '1');
  // The DOM preview owns in-window rendering and the native overlay owns
  // out-of-window rendering. Suppress Chromium's third, unsnapped ghost.
  const image = document.createElement('canvas');
  image.width = image.height = 1;
  image.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;';
  image.setAttribute('aria-hidden', 'true');
  document.body.append(image);
  event.dataTransfer.setDragImage(image, 0, 0);
  capturingNativeDrag.value = true;
  gesture = {
    id, pointerId: -1, element, startX: event.clientX, startY: event.clientY,
    x: event.clientX, y: event.clientY, grabX, grabY,
    width: rect.width, height: rect.height,
    path: doc.path, dirty: !!doc.document && store.dirty(doc.document),
  };
  nativeDragging = true;
  nativePositionId = crypto.randomUUID();
  nativeOutside = false;
  draggingId.value = id;
  const current = gesture;
  requestAnimationFrame(() => {
    image.remove();
    // WebView captures the native ghost after dragstart dispatch. Do not make
    // its source transparent until that capture has completed.
    if (gesture === current) capturingNativeDrag.value = false;
  });
  suppressClick = true;
  scrollFrame = requestAnimationFrame(scrollWhileDragging);
  void watchNativeRelease(gesture);
}

function nativeDragOver(event: DragEvent) {
  if (!nativeDragging || !gesture) return;
  nativeOutside = false;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  updateNativePosition(event.clientX, event.clientY);
}

function updateNativePosition(x: number, y: number) {
  if (!nativeDragging || !gesture) return;
  gesture.x = x;
  gesture.y = y;
  if (x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight) {
    // The native drag image owns this area.
    dragPreview.value = undefined;
    if (stripPoint(x, y)) { updateDropTarget(); return; }
    dropTarget.value = undefined;
    clearSourcePaneDrop();
    return;
  }
  // Native drag ghosts are owned by WebView/OS and can disappear over the
  // source window. Render the in-window preview explicitly, as for pointers.
  dragPreview.value = {
    id: gesture.id, path: gesture.path, dirty: gesture.dirty,
    left: gesture.x - gesture.grabX, top: gesture.y - gesture.grabY,
    width: gesture.width, height: gesture.height,
  };
  updateDropTarget();
}

function nativeDragLeave(event: DragEvent) {
  if (!nativeDragging || !gesture || event.relatedTarget) return;
  nativeOutside = true;
  dragPreview.value = undefined;
  // No dragover follows outside the WebView. Invalidate the last point so the
  // animation-frame hit test cannot keep a squeezed preview alive there.
  gesture.x = -1e6;
  gesture.y = -1e6;
  updateDropTarget();
}

function nativeDrop(event: DragEvent) {
  if (nativeDragging) event.preventDefault();
}

function nativeDragEnd() {
  // The source may lose its browser drag when layout/activation changes while
  // the OS mouse button is still down. Only tab_drag_release can commit this
  // Windows gesture: an early dragend must not consume its later outside drop.
}

function cancelDragOnEscape(event: KeyboardEvent) {
  if (event.key === 'Escape') { clearFileSlot(); clearIncomingSlot(); }
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    finishDrag();
  }
}

function onClick(event: MouseEvent) {
  if (!suppressClick) return;
  event.preventDefault();
  event.stopPropagation();
}

function closeTab(id: string) {
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
  const x = 'clientX' in event && event.clientX ? event.clientX : rect.left + 16;
  const y = 'clientY' in event && event.clientY ? event.clientY : rect.bottom;
  contextMenu.value = { tabId, x: Math.max(8, x), y: Math.max(8, y) };
  void nextTick(() => {
    const menu = contextMenuElement.value;
    if (!menu || contextMenu.value?.tabId !== tabId) return;
    contextMenu.value.x = Math.max(8, Math.min(x, window.innerWidth - menu.offsetWidth - 8));
    contextMenu.value.y = Math.max(8, Math.min(y, window.innerHeight - menu.offsetHeight - 8));
    // Window controls live in the browser top layer, above any z-index. Keep
    // menus below them when viewport clamping puts the menu in their column.
    const controls = document.querySelector<HTMLElement>('.desktop-window-actions');
    const controlsRect = controls?.getBoundingClientRect();
    if (controlsRect && contextMenu.value.x < controlsRect.right
      && contextMenu.value.x + menu.offsetWidth > controlsRect.left
      && contextMenu.value.y < controlsRect.bottom
      && contextMenu.value.y + menu.offsetHeight > controlsRect.top) {
      contextMenu.value.y = controlsRect.bottom + 8;
    }
    menu.style.maxHeight = `${Math.max(0, window.innerHeight - contextMenu.value.y - 8)}px`;
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
    if (paneTabs.value.some((tab) => tab.id === id)) break;
  }
}

async function contextAction(
  action: 'split-right' | 'split-bottom' | 'new-tab' | 'detach' | 'close' | 'close-others' | 'close-right' | 'close-all' | 'open-devtools',
) {
  const tabId = contextMenu.value?.tabId;
  closeContextMenu();
  if (action === 'open-devtools') return invoke<void>('open_devtools', { windowLabel: windowContext.label }).catch(store.report);
  activatePane();
  if ((action === 'split-right' || action === 'split-bottom') && tabId && props.paneId) {
    if (paneTabs.value.length === 1) store.createBlankTab();
    store.dockTab(tabId, { paneId: props.paneId, side: action === 'split-right' ? 'right' : 'bottom' });
    return;
  }
  if (action === 'new-tab') return emit('new-tab');
  if (action === 'detach' && tabId) return emit('detach-tab', tabId);
  if (action === 'close' && tabId) return closeTab(tabId);
  const ids = paneTabs.value.map((tab) => tab.id);
  if (action === 'close-others' && tabId) {
    await closeTabs(ids.filter((id) => id !== tabId));
    if (paneTabs.value.some((tab) => tab.id === tabId)) store.activeId = tabId;
  } else if (action === 'close-right' && tabId) {
    await closeTabs(ids.slice(ids.indexOf(tabId) + 1));
  } else if (action === 'close-all') {
    await closeTabs(ids);
  }
}

onMounted(() => {
  blankTrack =
    tabList.value?.closest('.workspace-tabbar')?.querySelector('.workspace-window-drag') ??
    tabList.value?.closest('.desktop-window-titlebar')?.querySelector('.desktop-window-drag') ??
    null;
  blankTrack?.addEventListener('contextmenu', onBlankTrackContext);
  window.addEventListener('dragover', fileDragOver, true);
  window.addEventListener('dragleave', fileDragLeave, true);
  window.addEventListener('drop', fileDrop, true);
  window.addEventListener('dragend', clearFileSlot, true);
  window.addEventListener('pointerdown', onOutsidePointer, true);
  if (props.detachable) window.addEventListener('pointerup', endDrag, true);
  window.addEventListener('contextmenu', onOutsideContext);
  window.addEventListener('keydown', onContextKeydown, true);
  window.addEventListener('keydown', cancelDragOnEscape, true);
  if (nativeTabDrag) {
    window.addEventListener('dragover', nativeDragOver, true);
    window.addEventListener('dragleave', nativeDragLeave, true);
    window.addEventListener('dragover', incomingDragOver, true);
    window.addEventListener('dragleave', incomingDragLeave, true);
    window.addEventListener('drop', nativeDrop, true);
    window.addEventListener('drop', incomingDrop, true);
    window.addEventListener('dragend', nativeDragEnd, true);
    mounted = true;
    void windowContext.native!.listen<{ dragId: string; x: number; y: number }>('tano-tab-drag-position', ({ payload }) => {
      if (payload.dragId === nativePositionId) updateNativePosition(payload.x, payload.y);
    }).then(unlisten => {
      if (mounted) unlistenNativePosition = unlisten;
      else unlisten();
    }).catch(store.report);
  }
  window.addEventListener('scroll', dismissContextMenu, true);
  window.addEventListener('resize', dismissContextMenu);
});

async function onTabListPointerLeave() {
  pointerInsideTabList.value = false;
  const revision = tabMoveRevision;
  while (tabLayoutMotion) await tabLayoutMotion;
  if (!pointerInsideTabList.value && revision === tabMoveRevision) releaseTabWidths();
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
  stopSlotAnimations();
  cancelTabMoves();
  finishDrag();
  stopSettling();
  clearFileSlot();
  window.removeEventListener('dragover', fileDragOver, true);
  window.removeEventListener('dragleave', fileDragLeave, true);
  window.removeEventListener('drop', fileDrop, true);
  window.removeEventListener('dragend', clearFileSlot, true);
  clearTimeout(clickTimer);
  blankTrack?.removeEventListener('contextmenu', onBlankTrackContext);
  window.removeEventListener('pointerdown', onOutsidePointer, true);
  window.removeEventListener('pointerup', endDrag, true);
  window.removeEventListener('contextmenu', onOutsideContext);
  window.removeEventListener('keydown', onContextKeydown, true);
  window.removeEventListener('keydown', cancelDragOnEscape, true);
  window.removeEventListener('dragover', nativeDragOver, true);
  window.removeEventListener('dragleave', nativeDragLeave, true);
  window.removeEventListener('dragover', incomingDragOver, true);
  window.removeEventListener('dragleave', incomingDragLeave, true);
  window.removeEventListener('drop', nativeDrop, true);
  window.removeEventListener('drop', incomingDrop, true);
  window.removeEventListener('dragend', nativeDragEnd, true);
  mounted = false;
  unlistenNativePosition?.();
  clearIncomingSlot();
  window.removeEventListener('scroll', dismissContextMenu, true);
  window.removeEventListener('resize', dismissContextMenu);
});

watch(
  selectedId,
  async (id) => {
    await nextTick();
    if (tabLayoutMotion) await tabLayoutMotion;
    const list = tabList.value;
    // During compression the new tab temporarily extends past the viewport.
    // Scrolling to that intermediate position moves every existing tab twice.
    const resizing = list?.getAnimations?.({ subtree: true }).filter(animation =>
      'transitionProperty' in animation && animation.transitionProperty === 'flex-basis') ?? [];
    if (resizing.length) await Promise.allSettled(resizing.map(animation => animation.finished));
    if (tabList.value !== list || selectedId.value !== id) return;
    list?.querySelector('.desktop-tab-active')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  },
);

watch(() => [paneTabs.value.map(tab => tab.id), reservedTabWidth.value] as const, ([ids, reserved], [previous, previousReserved]) => {
  if (incomingDropTimer) clearIncomingSlot();
  const closed = previous.some(id => !ids.includes(id) && !store.tabs.some(tab => tab.id === id));
  const opening = ids.some(id => !previous.includes(id));
  // Navigation replaces a tab's content ID without opening another slot.
  // Do not expand that replacement from zero as if it were a new tab.
  if (closed && opening && ids.length === previous.length) {
    cancelTabMoves();
    releaseTabWidths();
    return;
  }
  if (closed || opening || reserved !== previousReserved) {
    // Slot expansion and collapse use the same interruptible layout motion as opening a tab.
    const movement = animateTabLayout(ids, opening || !closed);
    tabLayoutMotion = movement;
    void movement.then(() => { if (tabLayoutMotion === movement) tabLayoutMotion = undefined; });
  }
});

watch(draggedFiles, (files) => {
  if (!files.length) clearFileSlot();
});

async function onTabKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && gesture) {
    event.preventDefault();
    finishDrag();
    return;
  }
  if (
    !isHTMLElement(event.target) ||
    !event.target.classList.contains('desktop-tab-switch')
  )
    return;
  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    openContextMenu(event, event.target.closest<HTMLElement>('.desktop-tab')?.dataset.id ?? null);
    return;
  }
  const ids = paneTabs.value.map((tab) => tab.id);
  if (!ids.length) return;
  const current = ids.indexOf(selectedId.value);
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
  <ButtonVisibilityGroup
    v-if="showNavigation !== false"
    v-slot="{ isVisible }"
    :items="navigationItems"
    preference-key="tano.preference.documentHiddenTools"
    group-class="topbar-navigation desktop-tab-navigation"
    :label="t('标签页导航')"
    :menu-label="t('导航按钮显示设置')"
    @open="contextMenu = undefined"
  >
    <button
      v-if="isVisible('back')"
      type="button"
      class="icon-button"
      :aria-label="t('后退')"
      :data-tooltip="t('后退')"
      :disabled="!store.canNavigateHistory(-1)"
      @click="store.navigateHistory(-1)"
    >
      <ArrowLeft :size="16" :stroke-width="1.6" />
    </button>
    <button
      v-if="isVisible('forward')"
      type="button"
      class="icon-button"
      :aria-label="t('前进')"
      :data-tooltip="t('前进')"
      :disabled="!store.canNavigateHistory(1)"
      @click="store.navigateHistory(1)"
    >
      <ArrowRight :size="16" :stroke-width="1.6" />
    </button>
  </ButtonVisibilityGroup>
  <nav
    class="desktop-tab-strip"
    :data-tab-pane-id="paneId"
    @pointerdown.capture="activatePane"
    :class="{ 'desktop-tab-strip-file-drop': fileSlot, 'desktop-tab-strip-inset': showNavigation === false }"
    :style="{
      '--desktop-tab-count': paneTabs.length,
      '--desktop-tab-reserved-width': `${reservedTabWidth}px`,
      width: frozenStripWidth === undefined ? undefined : `${frozenStripWidth + reservedTabWidth}px`,
    }"
    :aria-label="t('文档标签页')"
    @wheel="onTabWheel"
  >
    <div
      ref="tabList"
      class="desktop-tab-list"
      :class="{ 'desktop-tab-list-dragging': draggingId, 'desktop-tab-list-snapping': snapLayout, 'desktop-tab-list-slotting': slotMotion, 'desktop-tab-list-frozen': frozenStripWidth !== undefined, 'desktop-tab-list-animating': tabLayoutAnimating }"
      role="tablist"
      :aria-label="t('已打开的文档')"
      @keydown="onTabKeydown"
      @pointermove="moveDrag"
      @pointerenter="onTabListPointerEnter"
      @pointerleave="onTabListPointerLeave"
      @pointerup="endDrag"
      @pointercancel="pointerInterrupted"
      @lostpointercapture="pointerInterrupted"
      @click.capture="onClick"
      @contextmenu.self.prevent="openContextMenu($event, null)"
      @dragstart="!nativeTabDrag && $event.preventDefault()"
    >
      <LoadingSkeleton v-if="loading && !paneTabs.length" class="desktop-tabs-loading" :rows="1" />
      <div
        v-for="(doc, index) in paneTabs"
        :key="doc.id"
        :data-id="doc.id"
        class="desktop-tab"
        :class="{
          'desktop-tab-active': doc.id === selectedId,
          'desktop-tab-dragging': doc.id === draggingId,
          'desktop-tab-settling': doc.id === settlingTabId && doc.id !== draggingId,
          'desktop-tab-drag-capturing': doc.id === draggingId && capturingNativeDrag,
          'desktop-tab-outgoing': doc.id === outgoingId,
          'desktop-tab-drop-before': dockSlotIndex === undefined && dropTarget?.id === doc.id && dropTarget.side === 'before',
          'desktop-tab-drop-after': dockSlotIndex === undefined && dropTarget?.id === doc.id && dropTarget.side === 'after',
          'desktop-tab-dock-before': dockSlotIndex === index,
          'desktop-tab-dock-after': dockSlotIndex === paneTabs.length && index === paneTabs.length - 1,
        }"
        :style="{
          flex: frozenTabWidths[doc.id] !== undefined ? `0 0 ${frozenTabWidths[doc.id]}px` : undefined,
          transform: snapLayout ? `translateX(${snapLayout.offsets[doc.id] ?? 0}px)` : undefined,
        }"
        @contextmenu.stop.prevent="openContextMenu($event, doc.id)"
      >
        <button
          class="desktop-tab-switch"
          type="button"
          role="tab"
          :aria-selected="doc.id === selectedId"
          :tabindex="doc.id === selectedId ? 0 : -1"
          :data-tooltip="assistantTab?.id === doc.id ? assistantTab.title : doc.blank || doc.graph || doc.plugins || doc.calendar || doc.view ? tabLabel(doc) : doc.path"
          :draggable="nativeTabDrag"
          @pointerdown="startDrag($event, doc.id)"
          @dragstart.stop="startNativeDrag($event, doc.id)"
          @click="store.activeId = doc.id"
        >
          <Bot v-if="assistantTab?.id === doc.id" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <ResourceIcon v-else-if="doc.directory" :path="doc.path" kind="directory" class="desktop-tab-icon" :size="15" />
          <GitFork v-else-if="doc.graph" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <Puzzle v-else-if="doc.plugins" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <CalendarDays v-else-if="doc.calendar" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <Puzzle v-else-if="doc.pluginView" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <component :is="doc.view.icon" v-else-if="doc.view" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <span v-else-if="!doc.blank && documentIcons[doc.id]" class="desktop-tab-icon desktop-tab-document-icon" aria-hidden="true">
            <WorkspaceIcon :icon="documentIcons[doc.id]" :size="15" />
          </span>
          <Database v-else-if="doc.workspaceView?.view.database" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <FilePlus2 v-else-if="doc.blank" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
          <ResourceIcon v-else :path="doc.path" class="desktop-tab-icon" :size="15" />
          <span class="desktop-tab-label">{{ tabLabel(doc) }}</span>
          <span
            v-if="doc.dataTable?.dirty || doc.document && store.dirty(doc.document)"
            class="desktop-tab-dirty"
            :aria-label="t('有未保存的修改')"
          />
        </button>
        <button
          class="desktop-tab-close"
          type="button"
          :aria-label="t('关闭 {0}', [tabLabel(doc)])"
          :data-tooltip="t('关闭 {0}', [tabLabel(doc)])"
          @click="closeTab(doc.id)"
        >
          <X :size="13" />
        </button>
        <span v-if="doc.id === selectedId" class="desktop-tab-corners" aria-hidden="true">
          <span class="desktop-tab-corner-outline-left" />
          <span class="desktop-tab-corner-outline-right" />
        </span>
      </div>
      <div v-if="snapLayout?.incoming" class="desktop-tab-incoming-slot" :class="{ 'desktop-tab-dock-empty': !paneTabs.length }"
        :style="{ width: `${snapLayout.width}px`, transform: `translateX(${snapLayout.left}px)` }" aria-hidden="true" />
    </div>
    <button
      class="desktop-tab-add"
      type="button"
      :aria-label="t('新标签页')"
      :data-tooltip="t('新标签页')"
      :disabled="!store.workspace || store.busy"
      @click="activatePane(); emit('new-tab')"
    >
      <Plus :size="17" :stroke-width="1.6" />
    </button>
  </nav>
  <Teleport :to="windowContext.overlays">
    <div
      v-if="fileSlot"
      class="desktop-tab-file-drop-hint"
      :style="fileHintStyle"
      role="status"
    >
      <strong>{{ draggedFiles.length === 1 ? title(draggedFiles[0]!.path) : t('{0} 个文档', [draggedFiles.length]) }}</strong>
      <span>{{ t('在此处作为新标签页打开') }}</span>
    </div>
    <div v-surface-motion="'DesktopTabs:0'"
      v-if="contextMenu"
      ref="contextMenuElement"
      class="dropdown compact-action-menu desktop-tab-context-menu"
      role="menu"
      :aria-label="contextMenu.tabId ? t('标签页操作') : t('标签栏操作')"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
    >
      <template v-if="contextMenu.tabId">
        <button type="button" role="menuitem" @click="contextAction('close')">
          <X :size="15" />{{ t('关闭标签页') }}
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="paneTabs.length <= 1"
          @click="contextAction('close-others')"
        >
          <XCircle :size="15" />{{ t('关闭其他标签页') }}
        </button>
        <button
          type="button"
          role="menuitem"
          :disabled="
            paneTabs.findIndex((tab) => tab.id === contextMenu?.tabId) === paneTabs.length - 1
          "
          @click="contextAction('close-right')"
        >
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M9 3v18m3-12 6 6m0-6-6 6" />
          </svg>{{ t('关闭右侧标签页') }}
        </button>
        <template v-if="paneId">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('split-right')"><PanelRightClose :size="15" />{{ t('向右分屏') }}</button>
          <button type="button" role="menuitem" @click="contextAction('split-bottom')"><PanelBottomClose :size="15" />{{ t('向下分屏') }}</button>
        </template>
        <template v-if="detachable">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('detach')">
            <ExternalLink :size="15" />{{ t('在新窗口中打开') }}
          </button>
        </template>
      </template>
      <template v-else>
        <button type="button" role="menuitem" @click="contextAction('new-tab')">
          <Plus :size="15" />{{ t('新建标签页') }}
        </button>
        <div class="menu-divider" role="separator" />
        <button
          type="button"
          role="menuitem"
          :disabled="!paneTabs.length"
          @click="contextAction('close-all')"
        >
          <XCircle :size="15" />{{ t('关闭全部标签页') }}
        </button>
        <template v-if="nativeOs && !mobile">
          <div class="menu-divider" role="separator" />
          <button type="button" role="menuitem" @click="contextAction('open-devtools')">
            <Bug :size="15" />{{ t('打开调试窗口') }}
          </button>
        </template>
      </template>
    </div>
  </Teleport>
  <Teleport :to="windowContext.overlays">
    <div
      v-if="dragPreview"
      class="desktop-tab-drag-preview"
      :class="{ 'desktop-tab-drag-preview-settling': settlingPreview, 'desktop-tab-drag-preview-overlaid': nativeOverlay && !settlingPreview }"
      :style="{
        left: `${dragPreview.left}px`,
        top: `${dragPreview.top}px`,
        width: `${dragPreview.width}px`,
        height: `${dragPreview.height}px`,
      }"
      aria-hidden="true"
    >
      <FilePlus2 v-if="paneTabs.find(tab => tab.id === dragPreview?.id)?.blank" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
      <span v-else-if="documentIcons[dragPreview.id]" class="desktop-tab-icon desktop-tab-document-icon">
        <WorkspaceIcon :icon="documentIcons[dragPreview.id]" :size="15" />
      </span>
      <Database v-else-if="paneTabs.find(tab => tab.id === dragPreview?.id)?.workspaceView?.view.database" class="desktop-tab-icon" :size="15" :stroke-width="1.6" />
      <ResourceIcon v-else :path="dragPreview.path" :kind="paneTabs.find(tab => tab.id === dragPreview?.id)?.directory ? 'directory' : 'file'" class="desktop-tab-icon" :size="15" />
      <span class="desktop-tab-label">{{ paneTabs.find(tab => tab.id === dragPreview?.id) ? tabLabel(paneTabs.find(tab => tab.id === dragPreview?.id)!) : title(dragPreview.path) }}</span>
      <span v-if="dragPreview.dirty" class="desktop-tab-dirty" />
    </div>
  </Teleport>
</template>

<style>
.desktop-tab-navigation:has(.icon-button) {
  position: relative;
  padding-inline: 6px;
}
.desktop-sidebar-toggle:not(.desktop-sidebar-toggle-hidden) + .desktop-tab-navigation:has(.icon-button) {
  padding-inline-start: 2px;
}
.desktop-tab-strip {
  display: flex;
  /* Motion measures this final width, then expands with pixel tab bases. */
  width: calc(var(--desktop-tab-count) * 200px + var(--desktop-tab-reserved-width, 0px) + 42px);
  max-width: 100%;
  min-width: 0;
  height: 100%;
  align-items: stretch;
}
.desktop-tab-strip-inset {
  margin-inline-start: 12px;
  max-width: calc(100% - 12px);
}
.desktop-tab-strip-file-drop .desktop-tab-list {
  min-width: 4px;
}
.desktop-tab-file-drop-hint {
  position: fixed;
  z-index: 1000;
  display: grid;
  gap: 3px;
  max-width: min(224px, calc(100vw - 16px));
  padding: 8px 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  box-shadow: 0 4px 12px rgb(0 0 0 / 12%);
  color: var(--text-secondary);
  font-size: 12px;
  pointer-events: none;
}
.desktop-tab-file-drop-hint strong {
  overflow: hidden;
  color: var(--text);
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.desktop-tab-list {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  /* Keep both edge tabs' lower curves inside the scroll viewport without
     shifting the tabs or the adjacent navigation and add buttons. */
  padding-inline: 8px;
  margin-inline: -8px;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}
.desktop-tab-list::-webkit-scrollbar {
  display: none;
}
.desktop-tab-list::after {
  content: '';
  flex: 0 0 var(--desktop-tab-reserved-width, 0px);
}
.desktop-tab-dragging {
  background: transparent;
}
/* Keep the native draggable rendered and hit-testable throughout the OS drag.
   Hiding its visibility can interrupt WebView's drag lifecycle before release. */
.desktop-tab-dragging:not(.desktop-tab-drag-capturing) > * { opacity: 0; }
.desktop-tab-outgoing {
  flex: 0 0 0 !important;
  min-width: 0 !important;
  max-width: 0 !important;
  overflow: hidden;
  border: 0;
  opacity: 0;
  pointer-events: none;
}
.desktop-tab-incoming-slot {
  position: absolute;
  top: 4px;
  bottom: 0;
  left: 8px;
  border-radius: 8px 8px 0 0;
  background: transparent;
  pointer-events: none;
  transition: transform var(--motion-spring) var(--ease-spring), width var(--motion-spring) var(--ease-spring-smooth);
}
.desktop-tab-context-menu {
  position: fixed;
  z-index: 1001;
  box-sizing: border-box;
  overflow-y: auto;
}
.desktop-tab-drag-preview {
  position: fixed;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  padding: 0 16px;
  border: 0;
  /* Floating: a lifted card, visibly not part of the track. */
  border-radius: 8px;
  background: var(--paper);
  box-shadow: 0 0 0 1px var(--line), 0 8px 22px rgb(0 0 0 / 12%), 0 2px 6px rgb(0 0 0 / 6%);
  color: var(--text);
  font-size: 13px;
  pointer-events: none;
  user-select: none;
  animation: desktop-tab-lift var(--motion-spring, 0.32s) var(--ease-spring-smooth, ease-out) both;
  transition: border-radius 0.24s ease-out, box-shadow 0.24s ease-out;
}
/* Landing: morph back into a docked tab shape while flying into the slot. */
.desktop-tab-drag-preview-overlaid { visibility: hidden; }
.desktop-tab-drag-preview-settling {
  border-radius: 8px 8px 0 0;
  box-shadow: 0 0 0 0 transparent, 0 0 0 transparent, 0 0 0 transparent;
}
@keyframes desktop-tab-lift {
  from { box-shadow: 0 0 0 0 transparent, 0 0 0 transparent, 0 0 0 transparent; border-radius: 8px 8px 0 0; }
}
/* The reserved slot is plain empty space: the gap itself marks the drop point. */
.desktop-tab.desktop-tab-dragging,
.desktop-tab.desktop-tab-dragging:hover,
.desktop-tab.desktop-tab-settling,
.desktop-tab.desktop-tab-settling:hover {
  --desktop-tab-close-mask: var(--sidebar);
  background: transparent;
  box-shadow: none;
}
.desktop-tab-settling > * { opacity: 0; }
.desktop-tab-settling .desktop-tab-close { visibility: hidden; }
.desktop-tab {
  --desktop-tab-close-mask: var(--sidebar);
  position: relative;
  container-type: inline-size;
  display: flex;
  align-items: center;
  /* Keep a responsive basis outside the measured open/close animations. */
  flex: 0 0 calc((100% - var(--desktop-tab-reserved-width, 0px)) / max(1, var(--desktop-tab-count)));
  min-width: 28px;
  max-width: 200px;
  height: calc(100% - 4px);
  margin-top: 4px;
  border-radius: 8px 8px 0 0;
  color: var(--text-secondary);
  transition:
    flex-basis var(--motion-spring) var(--ease-spring-smooth),
    background 0.15s,
    color 0.15s;
}
.desktop-tab-list-slotting .desktop-tab {
  transition: flex-basis var(--motion-spring) var(--ease-spring-smooth), background 0.15s, color 0.15s;
}
.desktop-tab-list-frozen .desktop-tab,
.desktop-tab-list-animating .desktop-tab {
  transition: background 0.15s, color 0.15s;
}
.desktop-tab-list-frozen .desktop-tab { min-width: 0; }
.desktop-tab-navigation:has(.icon-button)::before,
.desktop-tab::before {
  content: '';
  position: absolute;
  z-index: 3;
  inset: 4px 0 8px;
  border-right: 1px solid var(--line);
  border-radius: 0;
  pointer-events: none;
}
.desktop-tab-navigation::before {
  margin-top: 4px;
}
.desktop-tab-navigation:has(+ .desktop-tab-strip .desktop-tab:first-child.desktop-tab-active)::before,
.desktop-tab:has(+ .desktop-tab-active)::before,
.desktop-tab:last-of-type::before,
.desktop-tab-dragging::before,
.desktop-tab-native-drag-image .desktop-tab::before {
  border-right-color: transparent;
}
.desktop-tab:hover {
  --desktop-tab-close-mask: color-mix(in srgb, var(--paper) 55%, var(--sidebar));
  background: var(--desktop-tab-close-mask);
}
.desktop-tab-active,
.desktop-tab-active:hover {
  --desktop-tab-close-mask: var(--paper);
  z-index: 1;
  background: var(--paper);
  color: var(--text);
}
.desktop-tab-active::before {
  inset: 0;
  border: 0;
  border-radius: inherit;
}
.desktop-tab-corners {
  position: absolute;
  z-index: 3;
  inset: 0;
  pointer-events: none;
}
.desktop-tab-native-drag-image .desktop-tab-corners {
  display: none;
}
.desktop-tab-corners::before,
.desktop-tab-corners::after {
  content: '';
  position: absolute;
  bottom: 0;
  width: 8px;
  height: 8px;
}
.desktop-tab-corners::before {
  left: -8px;
  background: radial-gradient(circle at top left, transparent 7.5px, var(--paper) 8px);
}
.desktop-tab-corners::after {
  right: -8px;
  background: radial-gradient(circle at top right, transparent 7.5px, var(--paper) 8px);
}
.desktop-tab-corners > span {
  position: absolute;
  bottom: 0;
  width: 8px;
  height: 8px;
  border-bottom: 0;
}
.desktop-tab-corner-outline-left {
  left: -8px;
  border-right: 0;
  border-bottom-right-radius: 8px;
}
.desktop-tab-corner-outline-right {
  right: -8px;
  border-left: 0;
  border-bottom-left-radius: 8px;
}
.desktop-tab-switch {
  touch-action: none;
  user-select: none;
  display: flex;
  align-items: center;
  gap: clamp(0px, calc((100cqw - 28px) / 10), 8px);
  flex: 1;
  min-width: 0;
  height: 100%;
  /* Center content in the strip despite the tab's 4px top inset. */
  padding: 0 6px 4px clamp(6px, 8cqw, 12px);
  text-align: left;
  font-size: 13px;
  line-height: 18px;
}
.desktop-tab-icon {
  flex: 0 0 15px;
  color: var(--muted);
}
.desktop-tab-document-icon {
  display: grid;
  place-items: center;
  width: 15px;
  height: 15px;
  overflow: hidden;
  border-radius: 3px;
}
.desktop-tab-label {
  font-weight: 400;
  min-width: 0;
  overflow: hidden;
  text-overflow: clip;
  white-space: nowrap;
}
.desktop-tab-dirty {
  width: 6px;
  height: 6px;
  flex-shrink: 0;
  border-radius: 50%;
  background: var(--text);
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
  top: calc(50% - 2px);
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
@container (max-width: 40px) {
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
@media (prefers-reduced-motion: reduce) {
  .desktop-tab-strip, .desktop-tab, .desktop-tab-list-slotting .desktop-tab, .desktop-tab-incoming-slot { transition: none; }
  .desktop-tab-drag-preview { animation: none; transition: none; }
}
@media (hover: none) {
  .desktop-tab-close {
    opacity: 1;
    pointer-events: auto;
  }
}
/* The placeholder has no actions, even when native dragging retains :hover
   or keyboard focus on the source tab. Never hide the draggable switch. */
.desktop-tab.desktop-tab-dragging .desktop-tab-close,
.desktop-tab-native-drag-image .desktop-tab-close {
  visibility: hidden;
  pointer-events: none;
}
</style>

<style scoped>
.desktop-tabs-loading { width: 160px; flex: 0 0 160px; align-self: center; }
.desktop-tabs-loading :deep(.tano-skeleton-list) { padding: 0 12px; gap: 0; }
.desktop-tabs-loading :deep(.tano-skeleton-bar) { height: 12px; margin: 0; width: 100%; }
</style>
