import { nextTick, onBeforeUnmount, ref, watch, type ComputedRef, type Ref } from 'vue';
import { animate } from 'motion/mini';
import { springEasing } from '@tano/editor/motion';
import { tabLayoutRect } from '../tabs/tab-layout';
import type { DocumentTab, useWorkspaceStore } from '../stores/workspace';
import type { useWindowContext } from '../windows/context';

export type TabLayoutMotion = 'open' | 'close' | 'reflow';

export interface TabSnapLayout {
  offsets: Record<string, number>;
  width: number;
  left: number;
  incoming: boolean;
}

export interface DesktopTabLayoutOptions {
  windowContext: ReturnType<typeof useWindowContext>;
  tabList: Ref<HTMLElement | undefined>;
  paneTabs: ComputedRef<DocumentTab[]>;
  paneTabIds: ComputedRef<string[]>;
  selectedId: ComputedRef<string>;
  store: ReturnType<typeof useWorkspaceStore>;
}

export interface DesktopTabLayoutDragBinding {
  collapsedId: ComputedRef<string>;
  snapLayout: ComputedRef<TabSnapLayout | undefined>;
  reservedTabWidth: ComputedRef<number>;
  slotMotion: ComputedRef<boolean>;
  onIncomingStripChange: () => void;
}

export function useDesktopTabLayout(options: DesktopTabLayoutOptions) {
  const { windowContext, tabList, paneTabs, paneTabIds, selectedId, store } = options;
  const { window, document } = windowContext;
  const getComputedStyle = (element: Element, pseudo?: string | null) =>
    window.getComputedStyle(element, pseudo);

  const frozenTabWidths = ref<Record<string, number>>({});
  const frozenStripWidth = ref<number>();
  const pointerInsideTabList = ref(false);
  const tabLayoutAnimating = ref<TabLayoutMotion | false>(false);
  const movingTabs = new Map<
    HTMLElement,
    { animation: ReturnType<typeof animate>; restore: () => void }
  >();
  let tabMoveRevision = 0;
  let tabLayoutMotion: Promise<void> | undefined;
  let finishCancelledTabMove: (() => void) | undefined;

  const slotAnimations = new Map<HTMLElement, ReturnType<typeof animate>>();
  const slotTargets = new Map<string, number>();

  let dragBinding: DesktopTabLayoutDragBinding | undefined;

  function drawnOffset(element: HTMLElement) {
    const values = getComputedStyle(element)
      .transform.match(/^matrix\((.+)\)$/)?.[1]
      ?.split(',')
      .map(Number);
    return values?.[4] ?? 0;
  }

  function stopSlotAnimations() {
    for (const animation of slotAnimations.values()) animation.cancel();
    slotAnimations.clear();
  }

  function cancelTabMoves() {
    tabMoveRevision++;
    finishCancelledTabMove?.();
    finishCancelledTabMove = undefined;
    for (const { animation, restore } of movingTabs.values()) {
      animation.cancel();
      restore();
    }
    movingTabs.clear();
    tabLayoutAnimating.value = false;
  }

  function releaseTabWidths() {
    frozenTabWidths.value = {};
    frozenStripWidth.value = undefined;
  }

  function moveTabElement(
    element: HTMLElement,
    keyframes: Record<string, (number | string)[]>,
    restore: () => void,
  ) {
    const animation = animate(element, keyframes, {
      duration: 0.32,
      ease: springEasing('snappy'),
    });
    movingTabs.set(element, { animation, restore });
  }

  async function animateTabLayout(ids: string[], mode: TabLayoutMotion) {
    const opening = mode === 'open';
    const list = tabList.value;
    if (!list) return;
    const strip = list.parentElement!;
    const stripWidth = strip.getBoundingClientRect().width;
    // Capture the visible layout so rapid opens/closes continue from this frame.
    const previous = new Map(
      [...list.querySelectorAll<HTMLElement>('.desktop-tab')].map((tab) => [
        tab.dataset.id!,
        { box: tab.getBoundingClientRect(), opacity: Number(getComputedStyle(tab).opacity) },
      ]),
    );
    cancelTabMoves();
    if (mode === 'reflow') stopSlotAnimations();
    const revision = tabMoveRevision;
    tabLayoutAnimating.value = mode;
    if (opening) releaseTabWidths();
    else {
      frozenTabWidths.value = Object.fromEntries(
        [...previous].map(([id, { box }]) => [id, box.width]),
      );
      frozenStripWidth.value = ids.reduce(
        (width, id) => width + (previous.get(id)?.box.width ?? 200),
        42,
      );
    }
    await nextTick();
    if (revision !== tabMoveRevision || tabList.value !== list) return;
    const targetStripWidth = strip.getBoundingClientRect().width;
    if (opening) {
      // Measure the final responsive widths, then use pixels throughout expansion.
      // Relative flex bases would resize existing tabs as the strip itself grows.
      frozenTabWidths.value = Object.fromEntries(
        [...list.querySelectorAll<HTMLElement>('.desktop-tab')].map((tab) => [
          tab.dataset.id!,
          tab.getBoundingClientRect().width,
        ]),
      );
      frozenStripWidth.value = targetStripWidth - (dragBinding?.reservedTabWidth.value ?? 0);
      await nextTick();
      if (revision !== tabMoveRevision || tabList.value !== list) return;
    }
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    let finishCancelled!: () => void;
    const cancelled = new Promise<void>((resolve) => {
      finishCancelled = resolve;
    });
    finishCancelledTabMove = finishCancelled;
    const inlineWidth = strip.style.width;
    if (
      !reduced &&
      typeof strip.animate === 'function' &&
      Math.abs(stripWidth - targetStripWidth) >= 0.5
    ) {
      moveTabElement(
        strip,
        { width: [`${stripWidth}px`, `${targetStripWidth}px`] },
        () => {
          strip.style.width = inlineWidth;
        },
      );
    }
    const collapsedId = dragBinding?.collapsedId.value ?? '';
    const snapLayout = dragBinding?.snapLayout.value;
    for (const tab of list.querySelectorAll<HTMLElement>('.desktop-tab')) {
      const before = previous.get(tab.dataset.id!);
      if (reduced || typeof tab.animate !== 'function' || tab.dataset.id === collapsedId) continue;
      if (opening) {
        const width = frozenTabWidths.value[tab.dataset.id!]!;
        const fromWidth = before?.box.width ?? 0;
        const opacity = before?.opacity ?? 0;
        if (Math.abs(fromWidth - width) < 0.5 && opacity === 1) continue;
        const flex = tab.style.flex;
        const overflow = tab.style.overflow;
        const inlineOpacity = tab.style.opacity;
        tab.style.overflow = 'clip';
        moveTabElement(
          tab,
          { flexBasis: [`${fromWidth}px`, `${width}px`], opacity: [opacity, 1] },
          () => {
            tab.style.flex = flex;
            tab.style.overflow = overflow;
            tab.style.opacity = inlineOpacity;
          },
        );
      } else {
        const targetOffset = mode === 'reflow' ? snapLayout?.offsets[tab.dataset.id!] ?? 0 : 0;
        const offset = before ? before.box.left - tabLayoutRect(tab).left : targetOffset;
        if (Math.abs(offset - targetOffset) < 0.5) continue;
        const transform = tab.style.transform;
        moveTabElement(
          tab,
          { transform: [`translateX(${offset}px)`, `translateX(${targetOffset}px)`] },
          () => {
            tab.style.transform = transform;
          },
        );
      }
    }
    const movements = [...movingTabs];
    // Motion's finished promise does not settle when cancel() interrupts it.
    await Promise.race([
      Promise.allSettled(movements.map(([, { animation }]) => animation.finished)),
      cancelled,
    ]);
    if (finishCancelledTabMove === finishCancelled) finishCancelledTabMove = undefined;
    for (const [element, movement] of movements) {
      if (movingTabs.get(element) !== movement) continue;
      const { animation, restore } = movement;
      animation.cancel();
      restore();
      movingTabs.delete(element);
    }
    if (revision === tabMoveRevision) {
      if (mode === 'close' && !pointerInsideTabList.value) {
        // Expand from the measured frozen widths through the same pixel motion
        // used on open. Clearing them here would jump while transitions are off.
        await animateTabLayout(paneTabIds.value, 'open');
        return;
      }
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

  function startTabLayout(ids: string[], mode: TabLayoutMotion) {
    const movement = animateTabLayout(ids, mode);
    tabLayoutMotion = movement;
    void movement.then(() => {
      if (tabLayoutMotion === movement) tabLayoutMotion = undefined;
    });
  }

  function bindDragState(binding: DesktopTabLayoutDragBinding) {
    dragBinding = binding;
    const { collapsedId, snapLayout, reservedTabWidth, slotMotion, onIncomingStripChange } =
      binding;

    watch(
      [
        () => paneTabs.value.map((tab) => tab.id).join('|'),
        () => paneTabs.value.map((tab) => snapLayout.value?.offsets[tab.id] ?? 0).join('|'),
      ],
      ([ids], [previousIds]) => {
        const list = tabList.value;
        const offsets = snapLayout.value?.offsets ?? {};
        const reduced =
          window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ||
          document.documentElement.dataset.motion === 'reduced';
        // Leaving an incoming slot clears its hover state before this watcher runs.
        // Keep its return motion when the tabs are unchanged; a committed drop
        // changes the DOM order and must not replay the old slot offsets.
        const returning =
          ids === previousIds && [...slotTargets.values()].some((offset) => offset !== 0);
        if (
          !list ||
          tabLayoutAnimating.value === 'reflow' ||
          (!slotMotion.value && !returning) ||
          reduced ||
          typeof HTMLElement.prototype.animate !== 'function'
        ) {
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
          const animation = animate(
            tab,
            { transform: [`translateX(${from}px)`, `translateX(${to}px)`] },
            { duration: 0.34, ease: springEasing('snappy') },
          );
          slotAnimations.set(tab, animation);
          void animation.finished.then(
            () => {
              if (slotAnimations.get(tab) !== animation) return;
              slotAnimations.delete(tab);
              animation.cancel();
            },
            () => {},
          );
        }
      },
      { flush: 'post' },
    );

    watch(
      [
        paneTabIds,
        reservedTabWidth,
        collapsedId,
        () => paneTabs.value.map((tab) => snapLayout.value?.offsets[tab.id] ?? 0).join('|'),
      ],
      (
        [ids, reserved, collapsed, offsets],
        [previous, previousReserved, previousCollapsed, previousOffsets],
      ) => {
        const removed = previous.some((id) => !ids.includes(id));
        const closed = previous.some(
          (id) => !ids.includes(id) && !store.tabs.some((tab) => tab.id === id),
        );
        const opening = ids.some((id) => !previous.includes(id));
        if (removed || opening || reserved !== previousReserved) onIncomingStripChange();
        // Navigation replaces a tab's content ID without opening another slot.
        // Do not expand that replacement from zero as if it were a new tab.
        if (closed && opening && ids.length === previous.length) {
          cancelTabMoves();
          releaseTabWidths();
          return;
        }
        const reflow =
          collapsed !== previousCollapsed ||
          (tabLayoutAnimating.value === 'reflow' && offsets !== previousOffsets);
        if (removed || opening || reserved !== previousReserved || reflow) {
          // Source occupancy changes share measured layout motion with real tab removal.
          // Capture before Vue updates the flow, including an interrupted hover animation.
          const mode = reflow ? 'reflow' : opening || !removed ? 'open' : 'close';
          startTabLayout(
            ids.filter((id) => id !== collapsed),
            mode,
          );
        }
      },
    );
  }

  async function onTabListPointerLeave() {
    pointerInsideTabList.value = false;
    while (tabLayoutMotion) await tabLayoutMotion;
    if (!pointerInsideTabList.value && frozenStripWidth.value !== undefined) {
      startTabLayout(paneTabIds.value, 'open');
    }
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

  watch(selectedId, async (id) => {
    await nextTick();
    if (tabLayoutMotion) await tabLayoutMotion;
    const list = tabList.value;
    // During compression the new tab temporarily extends past the viewport.
    // Scrolling to that intermediate position moves every existing tab twice.
    const resizing =
      list
        ?.getAnimations?.({ subtree: true })
        .filter(
          (animation) =>
            'transitionProperty' in animation && animation.transitionProperty === 'flex-basis',
        ) ?? [];
    if (resizing.length) await Promise.allSettled(resizing.map((animation) => animation.finished));
    if (tabList.value !== list || selectedId.value !== id) return;
    list?.querySelector('.desktop-tab-active')?.scrollIntoView({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  onBeforeUnmount(() => {
    stopSlotAnimations();
    cancelTabMoves();
  });

  return {
    frozenTabWidths,
    frozenStripWidth,
    tabLayoutAnimating,
    cancelTabMoves,
    stopSlotAnimations,
    bindDragState,
    onTabListPointerEnter,
    onTabListPointerLeave,
    onTabWheel,
  };
}
