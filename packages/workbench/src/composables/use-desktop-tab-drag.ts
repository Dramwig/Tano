import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import { isMarkdown, isDataTableFilePath, entryReferenceDragType } from '@tano/protocol';
import {
  nativeCursorPosition as cursorPosition,
  nativeInvoke as invoke,
} from '../platform/native-bridge';
import { isNode } from '@tano/editor/dom-realm';
import type { DetachedDropPoint } from '../windows/position';
import {
  finishedTabDrag,
  parseTabDragMeta,
  tabDockIndex,
  tabDragMetaType,
  type TabDragMeta,
} from '../tab-docking';
import { paneDropAt as hitTestPane } from '../pane-docking';
import { tabLayoutRect } from '../tab-layout';
import { TAB_DRAG_IMAGE_INSET, tabDragImage, tabDragImageReady } from '../tab-drag-image';
import { resolveTabRelease, type TabRelease } from '../tab-release';
import { useTabReleaseMotion } from '../use-tab-release-motion';
import type { PaneDrop } from '../pane-layout';
import { nativeOs } from '../platform';
import type { DocumentTab, useWorkspaceStore } from '../stores/workspace';
import type { useWindowContext } from '../windows/context';
import type { TabLayoutMotion, TabSnapLayout } from './use-desktop-tab-layout';

export interface DesktopTabDragProps {
  detachable?: boolean;
  paneId?: string;
  fileDrag?: { workspaceId: string; ids: readonly string[] };
}

export interface DesktopTabDragOptions {
  props: DesktopTabDragProps;
  store: ReturnType<typeof useWorkspaceStore>;
  windowContext: ReturnType<typeof useWindowContext>;
  tabList: Ref<HTMLElement | undefined>;
  blankTrack: Ref<HTMLElement | null>;
  paneTabs: ComputedRef<DocumentTab[]>;
  tabLabel: (tab: DocumentTab) => string;
  activatePane: () => void;
  tabLayoutAnimating: Ref<TabLayoutMotion | false>;
  cancelTabMoves: () => void;
  onDetachTab: (id: string, drop?: DetachedDropPoint, settled?: () => void) => void;
  onFilesDropped: () => void;
}

// Just outside the window (typically above its top edge), a pointer close to
// this strip still docks into it, so a small overshoot never tears a tab off.
const NEAR_STRIP = 48;
const NATIVE_DROP_WAIT = 160;

export function useDesktopTabDrag(options: DesktopTabDragOptions) {
  const {
    props,
    store,
    windowContext,
    tabList,
    blankTrack,
    paneTabs,
    tabLabel,
    activatePane,
    tabLayoutAnimating,
    cancelTabMoves,
    onDetachTab,
    onFilesDropped,
  } = options;
  const { window, document } = windowContext;
  const requestAnimationFrame = (callback: FrameRequestCallback) =>
    window.requestAnimationFrame(callback);
  const cancelAnimationFrame = (id: number) => window.cancelAnimationFrame(id);
  const getComputedStyle = (element: Element, pseudo?: string | null) =>
    window.getComputedStyle(element, pseudo);
  const paneDropAt = (x: number, y: number) => hitTestPane(x, y, document);

  const paneSlot = computed(() =>
    store.paneDrop?.paneId === props.paneId ? store.paneDrop?.index : undefined,
  );
  // WebView content is clipped at the native window edge. A native drag image is not.
  const nativeTabDrag = props.detachable && nativeOs === 'windows';

  function globalIndex(index: number) {
    const next = paneTabs.value[index];
    const last = paneTabs.value.at(-1);
    return next
      ? store.tabs.findIndex((tab) => tab.id === next.id)
      : last
        ? store.tabs.findIndex((tab) => tab.id === last.id) + 1
        : store.tabs.length;
  }

  let sourcePaneDrop: PaneDrop | undefined;
  function clearSourcePaneDrop() {
    if (sourcePaneDrop && store.paneDrop === sourcePaneDrop) store.paneDrop = undefined;
    sourcePaneDrop = undefined;
  }
  function updatePaneDrop(x: number, y: number, id: string) {
    if (!props.paneId) return;
    const drop = paneDropAt(x, y);
    const source = store.panes.find((pane) => pane.tabs.includes(id));
    clearSourcePaneDrop();
    if (drop && !(drop.side !== 'center' && source?.id === drop.paneId && source.tabs.length === 1)) {
      store.paneDrop = drop;
      sourcePaneDrop = store.paneDrop;
    }
  }

  const draggingId = ref('');
  const nativeOverlay = ref(false);
  let nativeImage:
    | { id: string; canvas: HTMLCanvasElement; encoded: Promise<string | undefined> }
    | undefined;
  // The native overlay is the only renderer of the dragged card. While it is on
  // its way (bitmap encoding, host window creation) the DOM card stays hidden
  // instead of showing a second, slightly different copy; a timer falls back to
  // the DOM card if the host never confirms.
  const overlayPending = ref(false);
  let overlayFallback: ReturnType<typeof setTimeout> | undefined;

  function makeNativeImage(id: string, canvas: HTMLCanvasElement) {
    // Encoded while the pointer is still down, so the overlay can appear on the
    // very first drag frame instead of after a per-byte string conversion.
    const encoded = tabDragImageReady(canvas)
      .then(() => {
        const data = canvas.getContext('2d')?.getImageData(0, 0, canvas.width, canvas.height).data;
        if (!data) return undefined;
        let binary = '';
        for (let i = 0; i < data.length; i += 0x8000) {
          binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        }
        return btoa(binary);
      })
      .catch(() => undefined);
    return { id, canvas, encoded };
  }

  let nativePositionId = '';
  let unlistenNativePosition: (() => void) | undefined;
  let unlistenOverlayReady: (() => void) | undefined;
  const outgoingId = ref('');
  const sourceAway = ref(false);
  const sourceWidth = ref(0);
  const collapsedId = computed(() => {
    const id = outgoingId.value || (sourceAway.value ? draggingId.value : '');
    return paneTabs.value.some((tab) => tab.id === id) ? id : '';
  });

  let referenceInserted = false;
  function referenceDropAccepted() {
    if (gesture) referenceInserted = true;
  }
  function referencePayload(id: string) {
    const tab = paneTabs.value.find((tab) => tab.id === id);
    // A tab stands for its file: a document, or an attachment previewed in it.
    const fileId = tab?.document?.id ?? tab?.attachment?.id;
    const target = store.referenceTargets?.find((target) => target.id === fileId || target.id === id);
    return target ? JSON.stringify({ workspace: target.workspace, ids: [target.id] }) : undefined;
  }
  /**
   * Offer the tab's file to whatever accepts references under the release point.
   * Illegal tabs (no file) and track/pane drops never produce a drop, so those
   * releases stay ordinary returns, reorders or docks.
   */
  function dropReferenceAt(id: string, x: number, y: number) {
    const payload = referencePayload(id);
    if (!payload || sourcePaneDrop || dropTarget.value) return;
    const transfer = new DataTransfer();
    transfer.setData(entryReferenceDragType, payload);
    document.elementFromPoint(x, y)?.dispatchEvent(
      new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        dataTransfer: transfer,
      }),
    );
  }
  function releaseIntent(outside = false): TabRelease {
    return resolveTabRelease({
      source: { id: draggingId.value, paneId: props.paneId, tabs: paneTabs.value.map((tab) => tab.id) },
      reference: referenceInserted,
      outside,
      detachable: !!props.detachable,
      paneDrop: store.paneDrop === sourcePaneDrop ? sourcePaneDrop : undefined,
      target: dropTarget.value,
    });
  }

  const {
    preview: dragPreview,
    previewStyle,
    previewOpacity,
    settling: settlingPreview,
    returningSlot: slotReturn,
    referenceReveal,
    settle: settlePreview,
    cancel: stopSettling,
  } = useTabReleaseMotion(windowContext);
  const dropTarget = ref<{ id: string; side: 'before' | 'after' }>();
  watch(finishedTabDrag, (result) => {
    if (
      result &&
      incomingHover?.sourceLabel === result.sourceLabel &&
      incomingHover.tabId === result.tabId
    ) {
      clearIncomingSlot();
    }
  });
  const incomingSlot = ref<{
    sourceLabel: string;
    tabId: string;
    width?: number;
    index?: number;
    drop?: PaneDrop;
  }>();
  const fileSlot = ref<{ index: number; x: number; y: number }>();
  const fileHintStyle = computed(() =>
    fileSlot.value
      ? {
          left: `${Math.max(8, Math.min(fileSlot.value.x + 16, window.innerWidth - 240))}px`,
          top: `${Math.max(8, Math.min(fileSlot.value.y + 24, window.innerHeight - 64))}px`,
        }
      : undefined,
  );
  const dockSlotIndex = computed(
    () => fileSlot.value?.index ?? paneSlot.value ?? incomingSlot.value?.index,
  );
  const snapLayout = computed<TabSnapLayout | undefined>(() => {
    const tabs = paneTabs.value;
    const source = tabs.findIndex((tab) => tab.id === draggingId.value);
    const target = dropTarget.value;
    const localSlot = target
      ? tabs.findIndex((tab) => tab.id === target.id) + (target.side === 'after' ? 1 : 0)
      : undefined;
    const slot = dockSlotIndex.value ?? localSlot;
    if (slot === undefined) return;
    const elements = new Map(
      [...(tabList.value?.querySelectorAll<HTMLElement>('.desktop-tab') ?? [])].map((el) => [
        el.dataset.id,
        el,
      ]),
    );
    const widths = tabs.map((tab) => {
      const element = elements.get(tab.id);
      // Hundredths: measuring mid-animation yields float noise (199.99998),
      // which would change the offsets every frame and restart the slide.
      return element ? Math.round(tabLayoutRect(element).width * 100) / 100 : 200;
    });
    const width =
      source >= 0
        ? widths[source]!
        : Math.max(28, Math.min(200, incomingSlot.value?.width ?? widths[0] ?? 180));
    const offsets: Record<string, number> = {};
    const before = widths.slice(0, slot).reduce((sum, value) => sum + value, 0);
    tabs.forEach((tab, index) => {
      offsets[tab.id] =
        source < 0
          ? index >= slot
            ? width
            : 0
          : index === source
            ? before -
              widths.slice(0, source).reduce((sum, value) => sum + value, 0) -
              (slot > source ? width : 0)
            : source < slot && index > source && index < slot
              ? -width
              : source >= slot && index >= slot && index < source
                ? width
                : 0;
    });
    return { offsets, width, left: before, incoming: source < 0 };
  });
  const reservedTabWidth = computed(() => (snapLayout.value?.incoming ? snapLayout.value.width : 0));
  // Keep the slide transition for the whole hover, not only while a slot is
  // open: leaving every slot must glide the shifted tabs back, not jump. It
  // ends together with the drop, whose reorder must not animate a second time.
  const slotMotion = computed(
    () =>
      !!draggingId.value ||
      slotReturn.value ||
      !!incomingSlot.value ||
      !!fileSlot.value ||
      paneSlot.value !== undefined,
  );
  const draggedFiles = computed(() => {
    if (!props.fileDrag || props.fileDrag.workspaceId !== store.workspace?.id || store.busy) {
      return [];
    }
    const files = props.fileDrag.ids.map((id) =>
      store.workspace!.files.find((file) => file.id === id),
    );
    return files.every(
      (file) => file?.kind === 'file' && (isMarkdown(file.path) || isDataTableFilePath(file.path)),
    )
      ? files
      : [];
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
  // The OS drop reaches the page asynchronously to the host's button-release
  // signal. Track it so a reference drop is neither missed nor inserted twice.
  let nativeDropSeen = false;
  let nativeDropSignal: (() => void) | undefined;
  let swallowLateDrop = false;
  let finishingDrag = false;
  let suppressClick = false;
  let clickTimer: ReturnType<typeof setTimeout> | undefined;

  function updateDropTargetAt(x: number, y: number, id: string) {
    const list = tabList.value;
    dropTarget.value = undefined;
    if (!list || !overStrip(x, y)) return;
    // Same pointer-based rule as the pane hit test (pane-docking.ts), so the
    // reorder target and the pane slot never disagree. Past the last tab: append.
    const tabs = [...list.querySelectorAll<HTMLElement>('.desktop-tab')];
    const target = tabs.find((tab) => x < tabLayoutRect(tab).right) ?? tabs.at(-1);
    if (!target || target.dataset.id === id) return;
    const rect = tabLayoutRect(target);
    dropTarget.value = {
      id: target.dataset.id!,
      side: x < rect.left + rect.width / 2 ? 'before' : 'after',
    };
  }

  function stripPoint(x: number, y: number) {
    const list = tabList.value;
    if (!list) return;
    const outside = x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
    const bounds = list.getBoundingClientRect();
    if (
      !outside ||
      x < bounds.left - 24 ||
      x > bounds.right + 24 ||
      y < bounds.top - NEAR_STRIP ||
      y > bounds.bottom
    ) {
      return;
    }
    return {
      x: Math.max(bounds.left, Math.min(x, bounds.right - 1)),
      y: (bounds.top + bounds.bottom) / 2,
    };
  }

  /**
   * The tab bar is the whole row the tabs sit in, not just the (frozen, possibly
   * narrow) list: a card anywhere along that row inserts, past the last tab it appends.
   */
  function overStrip(x: number, y: number) {
    const list = tabList.value;
    if (!list) return false;
    const rows = list.getBoundingClientRect();
    if (y < rows.top || y > rows.bottom) return false;
    if (x >= rows.left - 24 && x <= rows.right + 24) return true;
    const row = list
      .closest<HTMLElement>('.workspace-tabbar, .desktop-window-titlebar')
      ?.getBoundingClientRect();
    return !!row && row.width > 0 && x >= row.left && x <= row.right;
  }

  function updateDropTarget() {
    if (gesture) {
      const near = stripPoint(gesture.x, gesture.y);
      const x = near?.x ?? gesture.x;
      const y = near?.y ?? gesture.y;
      updateDropTargetAt(x, y, gesture.id);
      updatePaneDrop(x, y, gesture.id);
      // One rule: the slot is held only while the pointer is over this tab strip.
      // Anywhere else (content area, another pane, outside the window) it
      // collapses at once, so neighbours never depend on a 32px split band.
      sourceAway.value = !overStrip(x, y);
      // The preview stays under the pointer. Only the empty slot in the track
      // shows where the tab will land; it is placed there on release.
      if (dragPreview.value) dragPreview.value.top = gesture.y - gesture.grabY;
    }
  }

  function dockIndexAt(x: number, y: number, centerOffset: number) {
    const list = tabList.value;
    if (!list) return null;
    const rect = list.getBoundingClientRect();
    if (
      x < rect.left - 24 ||
      x > rect.right + 24 ||
      y < rect.top - 24 ||
      y > rect.bottom + 24
    ) {
      return null;
    }
    const centers = [...list.querySelectorAll<HTMLElement>('.desktop-tab')].map((tab) => {
      const box = tabLayoutRect(tab);
      return box.left + box.width / 2;
    });
    return tabDockIndex(x + centerOffset, centers);
  }

  function isFileDropSurface(target: EventTarget | null) {
    return (
      isNode(target) &&
      !!(
        tabList.value?.parentElement?.contains(target) ||
        blankTrack.value?.contains(target) ||
        tabList.value?.closest('.workspace-tabbar')?.contains(target)
      )
    );
  }

  function fileIndexAt(x: number) {
    const bounds = tabList.value?.getBoundingClientRect();
    // The add button and trailing titlebar always append, including when tabs overflow.
    if (bounds && x > bounds.right) return paneTabs.value.length;
    if (bounds && x < bounds.left) return 0;
    const centers = [...(tabList.value?.querySelectorAll<HTMLElement>('.desktop-tab') ?? [])].map(
      (tab) => {
        const box = tabLayoutRect(tab);
        return box.left + box.width / 2;
      },
    );
    return tabDockIndex(x, centers);
  }

  function clearFileSlot() {
    fileSlot.value = undefined;
    cancelAnimationFrame(fileScrollFrame);
    fileScrollFrame = 0;
  }

  /** Scroll range of the laid-out tabs alone, ignoring slot transforms. */
  function realScrollRange(list: HTMLElement, bounds = list.getBoundingClientRect()) {
    const tabs = [...list.querySelectorAll<HTMLElement>('.desktop-tab')].filter(
      (tab) => !tab.classList.contains('desktop-tab-away'),
    );
    const last = tabs.at(-1);
    if (!last) return 0;
    const padding = parseFloat(getComputedStyle(list).paddingRight) || 0;
    const contentRight = tabLayoutRect(last).right - bounds.left + list.scrollLeft + padding;
    return Math.max(0, Math.ceil(contentRight - list.clientWidth));
  }

  function scrollWhileFileDragging() {
    const list = tabList.value;
    const slot = fileSlot.value;
    if (!list || !slot) return;
    const bounds = list.getBoundingClientRect();
    // Same guard as scrollWhileDragging: the reserved slot spacer and a strip
    // that is still resizing look like overflow. Scrolling into them pushed the
    // first tab under the navigation buttons and widened the visible gap.
    if (slot.x >= bounds.left && slot.x <= bounds.right && !tabLayoutAnimating.value) {
      const maxScroll = realScrollRange(list, bounds);
      if (slot.x < bounds.left + 32) list.scrollLeft = Math.max(0, list.scrollLeft - 10);
      else if (slot.x > bounds.right - 32 && list.scrollLeft < maxScroll) {
        list.scrollLeft = Math.min(maxScroll, list.scrollLeft + 10);
      }
    }
    // A slot that was already scrolled into before must not stay there.
    const maxScroll = realScrollRange(list, bounds);
    if (list.scrollLeft > maxScroll) list.scrollLeft = maxScroll;
    slot.index = fileIndexAt(slot.x);
    fileScrollFrame = requestAnimationFrame(scrollWhileFileDragging);
  }

  function fileDragOver(event: DragEvent) {
    if (
      !draggedFiles.value.length ||
      !event.dataTransfer?.types.includes('application/x-tano-entry') ||
      !isFileDropSurface(event.target)
    ) {
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
    if (
      !drag ||
      !draggedFiles.value.length ||
      !isFileDropSurface(event.target) ||
      !event.dataTransfer?.types.includes('application/x-tano-entry')
    ) {
      clearFileSlot();
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const index = globalIndex(fileIndexAt(event.clientX));
    activatePane();
    clearFileSlot();
    onFilesDropped();
    void store.openFilesInNewTabsAt(drag.ids, index, drag.workspaceId);
  }

  function incomingDragOver(event: DragEvent) {
    if (!nativeTabDrag || nativeDragging || !store.workspace) return;
    const meta = parseTabDragMeta(event.dataTransfer?.types ?? []);
    if (
      !meta ||
      meta.sourceLabel === windowContext.label ||
      meta.workspaceId !== store.workspace.id
    ) {
      clearIncomingSlot();
      return;
    }
    const drop = props.paneId ? paneDropAt(event.clientX, event.clientY) : undefined;
    const index = props.paneId
      ? drop?.paneId === props.paneId
        ? drop.index
        : undefined
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
    if (incomingSlot.value?.drop && store.paneDrop === incomingSlot.value.drop) {
      store.paneDrop = undefined;
    }
    incomingSlot.value = undefined;
    incomingHover = undefined;
  }

  function onIncomingStripChange() {
    if (incomingDropTimer) clearIncomingSlot();
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
    const tab = store.tabs.find((tab) => tab.id === meta.tabId);
    const landing = tab && {
      id: tab.id,
      path: tabLabel(tab),
      dirty: !!tab.document && store.dirty(tab.document),
      left: event.clientX - (meta.width / 2 - meta.centerOffset),
      top: event.clientY - (meta.grabY ?? 18),
      width: meta.width,
      height: meta.height ?? 32,
    };
    store.moveTabToWindow(meta.tabId, windowContext.id, incomingSlot.value.drop);
    clearIncomingSlot();
    // The destination owns landing so closing an emptied source cannot cancel it.
    void nextTick(() => {
      if (mounted && !gesture && landing && paneTabs.value.some((tab) => tab.id === landing.id)) {
        settlePreview(landing);
      }
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
      // Scroll only across real tab overflow. The slot offsets are transforms,
      // and a slot opened at the end translates the source past the edge, which
      // the browser counts as scrollable overflow: scrolling into it slid every
      // tab left, then snapped back when the slot closed and the overflow vanished.
      // Nor while the strip is resizing for the source leaving/returning: its
      // width is transiently short of the tabs (trace: 398px for three 178px
      // tabs), which looked like overflow, scrolled every tab left, and snapped
      // back to 0 once the strip had grown.
      if (!tabLayoutAnimating.value) {
        const maxScroll = realScrollRange(list, bounds);
        if (gesture.x < bounds.left + 32) list.scrollLeft = Math.max(0, list.scrollLeft - 10);
        else if (gesture.x > bounds.right - 32 && list.scrollLeft < maxScroll) {
          list.scrollLeft = Math.min(maxScroll, list.scrollLeft + 10);
        }
      }
    }
    updateDropTarget();
    scrollFrame = requestAnimationFrame(scrollWhileDragging);
  }

  function startDrag(event: PointerEvent, id: string) {
    if (event.button !== 0 || !event.isPrimary || gesture || outgoingId.value) return;
    // A touch gesture scrolls the strip; mouse/trackpad dragging still docks tabs.
    if (event.pointerType === 'touch') return;
    stopSettling();
    // Pointer down prepares dragging. The click handler owns tab activation.
    if (nativeTabDrag) {
      const tab = (event.currentTarget as HTMLElement).closest<HTMLElement>('.desktop-tab');
      const doc = paneTabs.value.find((item) => item.id === id);
      const canvas = tab && doc ? tabDragImage(tab, tabLabel(doc)) : undefined;
      nativeImage = canvas ? makeNativeImage(id, canvas) : undefined;
      return;
    }
    const element = event.currentTarget as HTMLElement;
    const doc = paneTabs.value.find((item) => item.id === id);
    const tab = element.closest<HTMLElement>('.desktop-tab');
    if (!doc || !tab) return;
    const rect = tab.getBoundingClientRect();
    sourceWidth.value = rect.width;
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
      path: doc.graph
        ? '关系图谱'
        : doc.plugins
          ? '插件'
          : doc.calendar
            ? '计划'
            : doc.view
              ? doc.view.label
              : doc.blank
                ? '新标签页'
                : doc.path,
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

  /** End input ownership before applying a release or starting its presentation. */
  function clearGesture() {
    const current = gesture;
    if (!current) return;
    gesture = undefined;
    clearSourcePaneDrop();
    cancelAnimationFrame(scrollFrame);
    nativeDragging = false;
    nativeOutside = false;
    nativeDropSeen = false;
    nativeDropSignal = undefined;
    finishingDrag = false;
    sourceAway.value = false;
    referenceInserted = false;
    draggingId.value = '';
    nativeOverlay.value = false;
    overlayPending.value = false;
    clearTimeout(overlayFallback);
    nativeImage = undefined;
    nativePositionId = '';
    dragPreview.value = undefined;
    dropTarget.value = undefined;
    if (current.pointerId >= 0 && current.element.hasPointerCapture(current.pointerId)) {
      current.element.releasePointerCapture(current.pointerId);
    }
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => {
      suppressClick = false;
    }, 0);
  }

  /** Apply the resolved operation once, then hand its presentation to the motion owner. */
  function finishDrag(result: TabRelease = { kind: 'return' }) {
    const current = gesture;
    if (!current) return;
    const native = nativeDragging;
    const landing =
      result.kind !== 'detach' && draggingId.value && dragPreview.value
        ? { ...dragPreview.value }
        : undefined;
    clearGesture();
    if (native && result.kind !== 'detach') notifyDragFinished(current.id);
    try {
      if (result.kind === 'dock') store.dockTab(current.id, result.drop);
      else if (result.kind === 'reorder') {
        store.moveDocument(current.id, result.target.id, result.target.side);
      }
    } catch (error) {
      store.report(error);
      result = { kind: 'return' };
    }
    if (landing) {
      settlePreview(landing, {
        mode: result.kind === 'reference' ? 'reference' : 'return',
        returnSlot: result.kind === 'return' || result.kind === 'reference',
      });
    }
  }

  function detachReleasedTab(current: NonNullable<typeof gesture>, point: DetachedDropPoint) {
    const released = {
      id: current.id,
      path: current.path,
      dirty: current.dirty,
      left: current.x - current.grabX,
      top: current.y - current.grabY,
      width: current.width,
      height: current.height,
    };
    finishDrag({ kind: 'detach' });
    outgoingId.value = current.id;
    onDetachTab(current.id, point, () => {
      notifyDragFinished(current.id);
      if (outgoingId.value === current.id) outgoingId.value = '';
      if (mounted && paneTabs.value.some((tab) => tab.id === current.id) && !gesture) {
        void nextTick(() => {
          if (mounted && !gesture) settlePreview(released);
        });
      }
    });
  }

  function endDrag(event: PointerEvent) {
    if (gesture?.pointerId !== event.pointerId) return;
    if (finishingDrag) return;
    gesture.x = event.clientX;
    gesture.y = event.clientY;
    updateDropTarget();
    if (!draggingId.value) {
      // Pointer capture routes pointerup back here even after leaving the button.
      const bounds = gesture.element.getBoundingClientRect();
      suppressClick =
        event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom;
      finishDrag();
      return;
    }
    dropReferenceAt(gesture.id, event.clientX, event.clientY);
    const outside =
      event.clientX < 0 ||
      event.clientY < 0 ||
      event.clientX >= window.innerWidth ||
      event.clientY >= window.innerHeight;
    if (outside && props.detachable && !stripPoint(event.clientX, event.clientY)) {
      void finishAtSystemCursor();
    } else {
      finishDrag(releaseIntent());
    }
  }

  async function finishAtSystemCursor(drop?: { x: number; y: number }) {
    if (!gesture || finishingDrag) return;
    finishingDrag = true;
    const current = gesture;
    try {
      const appWindow = windowContext.native!;
      const [cursor, origin, scale] = await Promise.all([
        drop ? Promise.resolve(drop) : cursorPosition(),
        appWindow.innerPosition(),
        appWindow.scaleFactor(),
      ]);
      if (gesture !== current) return;
      current.x = (cursor.x - origin.x) / scale;
      current.y = (cursor.y - origin.y) / scale;
      const near = stripPoint(current.x, current.y);
      if (nativeOutside && !near) {
        dropTarget.value = undefined;
        clearSourcePaneDrop();
      } else {
        updateDropTarget();
      }
      const withinWindow =
        current.x >= 0 &&
        current.x < window.innerWidth &&
        current.y >= 0 &&
        current.y < window.innerHeight;
      // No OS drop arrived over this window: deliver the reference ourselves, as
      // for captured pointer drags, and swallow the OS drop if it still shows up.
      if (nativeDragging && !nativeDropSeen && !referenceInserted && withinWindow && !near) {
        dropReferenceAt(current.id, current.x, current.y);
        if (referenceInserted) {
          swallowLateDrop = true;
          setTimeout(() => {
            swallowLateDrop = false;
          }, 1500);
        }
      }
      const result = releaseIntent(!near && (nativeOutside || !withinWindow));
      if (result.kind !== 'detach') {
        finishDrag(result);
        return;
      }
      detachReleasedTab(current, {
        x: cursor.x,
        y: cursor.y,
        grabX: current.grabX,
        grabY: current.grabY,
        width: current.width,
        insideSourceWindow: withinWindow,
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
      const source = nativeImage?.id === current.id ? nativeImage : undefined;
      const image = source?.canvas;
      const scale = window.devicePixelRatio || 1;
      let preview;
      if (image && source) {
        // The overlay is the single renderer: hide the DOM card from the first
        // frame so two different-looking copies never alternate.
        overlayPending.value = true;
        clearTimeout(overlayFallback);
        overlayFallback = setTimeout(() => {
          overlayPending.value = false;
        }, 500);
        // tabDragImage already paints at device pixels; the icon is decoded and
        // the bitmap encoded before the drag started, so this normally resolves at once.
        const rgba = await Promise.race([
          source.encoded,
          new Promise<undefined>((resolve) => setTimeout(resolve, 150)),
        ]);
        if (gesture !== current || !nativeDragging) return;
        if (rgba) {
          preview = {
            width: image.width,
            height: image.height,
            rgba,
            // The bitmap has transparent room for the card's shadow.
            grabX: Math.round((current.grabX + TAB_DRAG_IMAGE_INSET.x) * scale),
            grabY: Math.round((current.grabY + TAB_DRAG_IMAGE_INSET.y) * scale),
          };
        } else {
          overlayPending.value = false;
        }
      }
      // The topmost native overlay draws the card everywhere, so the source
      // window can never cover or clip it; the DOM copy only lands it on release.
      // The host confirms with `tano-tab-drag-overlay-ready`; if that never
      // arrives the fallback timer above restores the DOM card.
      const drop = await invoke<{
        x: number;
        y: number;
        cancelled?: boolean;
        overSource?: boolean;
      }>('tab_drag_release', {
        preview,
        dragId: nativePositionId,
        windowLabel: windowContext.label,
      });
      if (gesture !== current || !nativeDragging) return;
      if (drop.cancelled) {
        finishDrag();
        return;
      }
      // The host knows which window is really under the release point. A stray
      // dragleave must not turn an invalid drop on this window into a detach
      // (which collapses the tab and makes its neighbours jump).
      if (typeof drop.overSource === 'boolean') nativeOutside = !drop.overSource;
      // Let the browser finish its native drop dispatch before changing the tab tree.
      // Released over this window, the drop may still be in flight: wait for it
      // (briefly) so an inserted reference is known before the release resolves.
      if (!nativeOutside && !nativeDropSeen) {
        await new Promise<void>((resolve) => {
          const done = () => {
            clearTimeout(timer);
            if (nativeDropSignal === done) nativeDropSignal = undefined;
            resolve();
          };
          const timer = setTimeout(done, NATIVE_DROP_WAIT);
          nativeDropSignal = done;
        });
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
      const ownLayout = store.windowLayouts?.[windowContext.id];
      if (
        store.windowLayouts &&
        (!ownLayout ||
          !store.panes.some((pane) => pane.tabs.includes(current.id) && pane.id === props.paneId))
      ) {
        finishDrag({ kind: 'detach' });
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
    if (!nativeTabDrag || !event.dataTransfer || gesture || outgoingId.value) {
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
    sourceWidth.value = rect.width;
    const grabX = event.clientX - rect.left;
    const grabY = event.clientY - rect.top;
    event.dataTransfer.effectAllowed = 'copyMove';
    const payload = referencePayload(id);
    if (payload) event.dataTransfer.setData(entryReferenceDragType, payload);
    if (nativeImage?.id !== id) {
      const canvas = tabDragImage(tab, tabLabel(doc));
      nativeImage = canvas ? makeNativeImage(id, canvas) : undefined;
    }
    event.dataTransfer.setData('application/x-tano-tab', id);
    if (store.workspace) {
      event.dataTransfer.setData(
        tabDragMetaType({
          sourceLabel: windowContext.label,
          workspaceId: store.workspace.id,
          tabId: id,
          width: rect.width,
          centerOffset: rect.width / 2 - grabX,
          height: rect.height,
          grabY,
        }),
        '1',
      );
    }
    // The DOM preview owns in-window rendering and the native overlay owns
    // out-of-window rendering. Suppress Chromium's third, unsnapped ghost.
    const image = document.createElement('canvas');
    image.width = image.height = 1;
    image.style.cssText = 'position:fixed;left:0;top:0;pointer-events:none;';
    image.setAttribute('aria-hidden', 'true');
    document.body.append(image);
    event.dataTransfer.setDragImage(image, 0, 0);
    // The ghost is this blank 1px canvas, not the source tab, so the tab can
    // go transparent in the same frame as dragstart. Keeping it visible until the
    // next animation frame (the old `capturingNativeDrag` window) left a ghost of
    // the tab in its slot that then vanished.
    gesture = {
      id,
      pointerId: -1,
      element,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      grabX,
      grabY,
      width: rect.width,
      height: rect.height,
      path: doc.path,
      dirty: !!doc.document && store.dirty(doc.document),
    };
    nativeDragging = true;
    nativePositionId = crypto.randomUUID();
    nativeOutside = false;
    draggingId.value = id;
    requestAnimationFrame(() => {
      image.remove();
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
      sourceAway.value = !stripPoint(x, y);
      // The native drag image owns this area.
      dragPreview.value = undefined;
      if (stripPoint(x, y)) {
        updateDropTarget();
        return;
      }
      dropTarget.value = undefined;
      clearSourcePaneDrop();
      return;
    }
    // Native drag ghosts are owned by WebView/OS and can disappear over the
    // source window. Render the in-window preview explicitly, as for pointers.
    dragPreview.value = {
      id: gesture.id,
      path: gesture.path,
      dirty: gesture.dirty,
      left: gesture.x - gesture.grabX,
      top: gesture.y - gesture.grabY,
      width: gesture.width,
      height: gesture.height,
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
    if (swallowLateDrop && event.dataTransfer?.types.includes(entryReferenceDragType)) {
      // Already inserted by the fallback above; a second insertion would duplicate it.
      swallowLateDrop = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!nativeDragging) return;
    event.preventDefault();
    nativeDropSeen = true;
    nativeDropSignal?.();
  }

  function nativeDragEnd() {
    // The source may lose its browser drag when layout/activation changes while
    // the OS mouse button is still down. Only tab_drag_release can commit this
    // Windows gesture: an early dragend must not consume its later outside drop.
  }

  function cancelDragOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      clearFileSlot();
      clearIncomingSlot();
    }
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

  function hasActiveGesture() {
    return !!gesture;
  }

  watch(draggedFiles, (files) => {
    if (!files.length) clearFileSlot();
  });

  onMounted(() => {
    window.addEventListener('tano-entry-reference-inserted', referenceDropAccepted);
    window.addEventListener('dragover', fileDragOver, true);
    window.addEventListener('dragleave', fileDragLeave, true);
    window.addEventListener('drop', fileDrop, true);
    window.addEventListener('dragend', clearFileSlot, true);
    if (props.detachable) window.addEventListener('pointerup', endDrag, true);
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
      void windowContext.native!
        .listen<{ dragId: string; x: number; y: number }>('tano-tab-drag-position', ({ payload }) => {
          if (payload.dragId === nativePositionId) updateNativePosition(payload.x, payload.y);
        })
        .then((unlisten) => {
          if (mounted) unlistenNativePosition = unlisten;
          else unlisten();
        })
        .catch(store.report);
      void windowContext.native!
        .listen<{ dragId: string }>('tano-tab-drag-overlay-ready', ({ payload }) => {
          if (payload.dragId === nativePositionId && nativeDragging && gesture) {
            nativeOverlay.value = true;
          }
        })
        .then((unlisten) => {
          if (mounted) unlistenOverlayReady = unlisten;
          else unlisten();
        })
        .catch(store.report);
    }
  });

  onBeforeUnmount(() => {
    window.removeEventListener('tano-entry-reference-inserted', referenceDropAccepted);
    if (nativeDragging && gesture) notifyDragFinished(gesture.id);
    clearGesture();
    clearFileSlot();
    window.removeEventListener('dragover', fileDragOver, true);
    window.removeEventListener('dragleave', fileDragLeave, true);
    window.removeEventListener('drop', fileDrop, true);
    window.removeEventListener('dragend', clearFileSlot, true);
    clearTimeout(clickTimer);
    window.removeEventListener('pointerup', endDrag, true);
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
    unlistenOverlayReady?.();
    clearIncomingSlot();
  });

  return {
    nativeTabDrag,
    draggingId,
    nativeOverlay,
    overlayPending,
    outgoingId,
    sourceWidth,
    collapsedId,
    dragPreview,
    previewStyle,
    previewOpacity,
    settlingPreview,
    referenceReveal,
    dropTarget,
    fileSlot,
    fileHintStyle,
    dockSlotIndex,
    snapLayout,
    reservedTabWidth,
    slotMotion,
    draggedFiles,
    startDrag,
    moveDrag,
    endDrag,
    pointerInterrupted,
    startNativeDrag,
    onClick,
    finishDrag,
    hasActiveGesture,
    onIncomingStripChange,
  };
}
