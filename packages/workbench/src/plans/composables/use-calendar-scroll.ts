import { computed, nextTick, onMounted, onUnmounted, ref, watch, type ComputedRef, type Ref } from 'vue';
import {
  localDayKey,
  shiftCalendarDate,
  visibleCalendarDays,
  weekDays,
  type CalendarViewMode,
} from '../calendar';

export const CALENDAR_HOUR_HEIGHT = 56;
export const CALENDAR_AXIS_WIDTH = 52;

const ZOOM_MODES: CalendarViewMode[] = ['day', 'four-days', 'week', 'month', 'year'];

export interface CalendarScrollOptions {
  date: () => Date;
  mode: () => CalendarViewMode;
  loading?: () => boolean;
  scroll: Ref<HTMLElement | undefined>;
  window: Window;
  onVisibleMonth: (date: Date) => void;
  onVisibleYear: (date: Date) => void;
  onVisibleTimeline: (date: Date) => void;
  onSelectMode: (mode: CalendarViewMode) => void;
  /** Re-centres the calendar on the period under the pointer before zooming in. */
  onFocusDate?: (date: Date) => void;
  onBeforeViewChange: () => void;
  onScrolled: () => void;
  /** Runs before the new scale renders, while the previous layout is still in the DOM. */
  onBeforeModeChange?: (from: CalendarViewMode, to: CalendarViewMode) => void;
  /** Runs once the new scale is rendered and scrolled to the current date. */
  onModePositioned?: (from: CalendarViewMode, to: CalendarViewMode) => void;
}

export interface CalendarScrollState {
  timeline: ComputedRef<boolean>;
  timelineDays: Ref<Date[]>;
  timelineDayWidth: Ref<number>;
  timelineVisibleCount: ComputedRef<number>;
  scrollingWeeks: Ref<Date[]>;
  scrollingYears: Ref<number[]>;
  visibleWindow: ComputedRef<[Date, Date]>;
  onCalendarScroll: () => void;
  onCalendarWheel: (event: WheelEvent) => void;
  extendTimelineDays: (direction: -1 | 1) => Promise<void>;
  slideTimelineWindow: (direction: -1 | 1, stepPx: number) => Promise<void>;
  slideMonthWindow: (direction: -1 | 1, stepPx: number) => Promise<void>;
  slideYearWindow: (direction: -1 | 1, stepPx: number) => Promise<void>;
  setCustomScrollbarDragging: (dragging: boolean) => void;
}

export function useCalendarScroll(options: CalendarScrollOptions): CalendarScrollState {
  const { date: getDate, mode: getMode, scroll, window } = options;
  const ResizeObserverCtor = (window as Window & typeof globalThis).ResizeObserver;

  const timeline = computed(() => {
    const mode = getMode();
    return mode === 'day' || mode === 'four-days' || mode === 'week';
  });
  const timelineDays = ref<Date[]>([]);
  const timelineDayWidth = ref(120);
  const timelineVisibleCount = computed(() => {
    const mode = getMode();
    return mode === 'week' ? 7 : mode === 'four-days' ? 4 : 1;
  });
  const scrollingWeeks = ref<Date[]>([]);
  const scrollingYears = ref<number[]>([]);

  const visibleWindow = computed<[Date, Date]>(() => {
    if (timeline.value && timelineDays.value.length) {
      return [timelineDays.value[0]!, timelineDays.value.at(-1)!];
    }
    if (getMode() === 'month' && scrollingWeeks.value.length) {
      const last = scrollingWeeks.value.at(-1)!;
      return [scrollingWeeks.value[0]!, new Date(last.getFullYear(), last.getMonth(), last.getDate() + 6)];
    }
    if (getMode() === 'year' && scrollingYears.value.length) {
      return [new Date(scrollingYears.value[0]!, 0, 1), new Date(scrollingYears.value.at(-1)!, 11, 31)];
    }
    const current = getDate();
    return [
      new Date(current.getFullYear(), current.getMonth(), 1),
      new Date(current.getFullYear(), current.getMonth() + 1, 0),
    ];
  });

  const monthKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;
  const weekKey = localDayKey;
  const weekOffset = (d: Date, weeks: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + weeks * 7);
  const dayOffset = (d: Date, days: number) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);

  let reportedMonthKey = '';
  let extendingWeeks = false;
  let reportedYear: number | undefined;
  let extendingYears = false;
  let positioningYear = false;
  let reportedTimelineKey = '';
  let extendingTimeline = false;
  let positioningTimeline = false;
  let timelineResizeObserver: ResizeObserver | undefined;

  const supportsScrollEnd = 'onscrollend' in window;
  let lastHorizontalWheelAt = -Infinity;
  let lastVerticalWheelAt = -Infinity;
  let scrollbarDragging = false;
  let customScrollbarDragging = false;
  let lastCustomScrollbarEndAt = -Infinity;
  let pendingEdgeCheck = false;
  let scrollSettleTimer: ReturnType<typeof setTimeout> | undefined;

  function setCustomScrollbarDragging(dragging: boolean) {
    customScrollbarDragging = dragging;
    if (!dragging) lastCustomScrollbarEndAt = performance.now();
    clearPendingEdgeExtend();
  }

  function isCustomScrollbarActiveOrSettling(): boolean {
    return customScrollbarDragging || performance.now() - lastCustomScrollbarEndAt < 400;
  }

  let focusedZoomKey = '';
  let zoomDelta = 0;
  let lastZoomWheel = -Infinity;
  let lastZoomChange = -Infinity;

  function clearPendingEdgeExtend() {
    pendingEdgeCheck = false;
    if (scrollSettleTimer !== undefined) {
      clearTimeout(scrollSettleTimer);
      scrollSettleTimer = undefined;
    }
  }

  function timelineEdgeDirection(container: HTMLElement): -1 | 1 | 0 {
    const width = timelineDayWidth.value;
    const edgeDistance = Math.min(width * 1.5, Math.max(48, container.clientWidth * 0.2));
    if (container.scrollLeft < edgeDistance) return -1;
    if (container.scrollWidth - container.scrollLeft - container.clientWidth < edgeDistance) return 1;
    return 0;
  }

  function monthEdgeDirection(container: HTMLElement): -1 | 1 | 0 {
    const edgeDistance = Math.min(240, Math.max(48, container.clientHeight * 0.35));
    if (container.scrollTop < edgeDistance) return -1;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < edgeDistance) return 1;
    return 0;
  }

  function yearEdgeDirection(container: HTMLElement): -1 | 1 | 0 {
    const edgeDistance = Math.min(240, Math.max(48, container.clientHeight * 0.35));
    if (container.scrollTop < edgeDistance) return -1;
    if (container.scrollHeight - container.scrollTop - container.clientHeight < edgeDistance) return 1;
    return 0;
  }

  function isScrollbarPointerEvent(container: HTMLElement, event: MouseEvent): boolean {
    if (event.target !== container) return false;
    const rect = container.getBoundingClientRect();
    const contentBottom = rect.top + container.clientTop + container.clientHeight;
    const contentRight = rect.left + container.clientLeft + container.clientWidth;
    const hasHorizontalBar = rect.bottom - contentBottom > 1;
    const hasVerticalBar = rect.right - contentRight > 1;
    return (hasHorizontalBar && event.clientY >= contentBottom)
      || (hasVerticalBar && event.clientX >= contentRight);
  }

  function flushPendingEdgeExtend() {
    if (!pendingEdgeCheck || scrollbarDragging || isCustomScrollbarActiveOrSettling()) {
      clearPendingEdgeExtend();
      return;
    }
    clearPendingEdgeExtend();
    const container = scroll.value;
    if (!container) return;
    if (timeline.value) {
      if (positioningTimeline || extendingTimeline || !timelineDays.value.length) return;
      const direction = timelineEdgeDirection(container);
      if (direction !== 0) void extendTimelineDays(direction);
    } else if (getMode() === 'month') {
      if (extendingWeeks || !scrollingWeeks.value.length) return;
      const direction = monthEdgeDirection(container);
      if (direction !== 0) void extendWeeks(direction);
    } else if (getMode() === 'year') {
      if (extendingYears || positioningYear || !scrollingYears.value.length) return;
      const direction = yearEdgeDirection(container);
      if (direction !== 0) void extendYears(direction);
    }
  }

  function scheduleEdgeExtend(axis: 'horizontal' | 'vertical', direction: -1 | 1) {
    if (isCustomScrollbarActiveOrSettling()) {
      clearPendingEdgeExtend();
      return;
    }
    const lastWheelAt = axis === 'horizontal' ? lastHorizontalWheelAt : lastVerticalWheelAt;
    const isWheelScroll = !scrollbarDragging && performance.now() - lastWheelAt <= 150;
    if (isWheelScroll) {
      clearPendingEdgeExtend();
      if (timeline.value) void extendTimelineDays(direction);
      else if (getMode() === 'month') void extendWeeks(direction);
      else if (getMode() === 'year') void extendYears(direction);
      return;
    }
    // Defer edge extension during native scrollbar thumb drags until scrollend / release:
    // mutating scrollLeft mid-drag fights the browser's thumb position and causes runaway loops.
    pendingEdgeCheck = true;
    if (!supportsScrollEnd) {
      if (scrollSettleTimer !== undefined) clearTimeout(scrollSettleTimer);
      scrollSettleTimer = setTimeout(() => {
        scrollSettleTimer = undefined;
        flushPendingEdgeExtend();
      }, 150);
    }
  }

  function onContainerMouseDown(event: MouseEvent) {
    const container = scroll.value;
    if (container && isScrollbarPointerEvent(container, event)) {
      scrollbarDragging = true;
    }
  }

  function onContainerScrollEnd() {
    scrollbarDragging = false;
    flushPendingEdgeExtend();
  }

  function onScrollbarRelease() {
    if (!scrollbarDragging) return;
    scrollbarDragging = false;
    flushPendingEdgeExtend();
  }

  function fillTimelineDays(d: Date) {
    const first = visibleCalendarDays(d, getMode())[0]!;
    timelineDays.value = Array.from({ length: 42 }, (_, index) => dayOffset(first, index - 14));
  }

  async function scrollToTimelineDate(d: Date) {
    clearPendingEdgeExtend();
    positioningTimeline = true;
    const first = visibleCalendarDays(d, getMode())[0]!;
    let index = timelineDays.value.findIndex((day) => localDayKey(day) === localDayKey(first));
    if (index < 0) {
      fillTimelineDays(d);
      index = 14;
    }
    await nextTick();
    if (scroll.value) scroll.value.scrollLeft = index * timelineDayWidth.value;
    positioningTimeline = false;
  }

  async function extendTimelineDays(direction: -1 | 1) {
    const container = scroll.value;
    if (extendingTimeline || !container || !timelineDays.value.length) return;
    extendingTimeline = true;
    const width = timelineDayWidth.value;
    const anchorIndex = Math.min(timelineDays.value.length - 1, Math.floor(container.scrollLeft / width));
    const anchorKey = localDayKey(timelineDays.value[anchorIndex]!);
    const anchorOffset = container.scrollLeft - anchorIndex * width;
    const edge = direction < 0 ? timelineDays.value[0]! : timelineDays.value.at(-1)!;
    const additions = Array.from({ length: 14 }, (_, index) => dayOffset(edge, direction * (index + 1)));
    const expanded = direction < 0
      ? [...additions.reverse(), ...timelineDays.value]
      : [...timelineDays.value, ...additions];
    timelineDays.value = direction < 0 ? expanded.slice(0, 70) : expanded.slice(-70);
    await nextTick();
    const retainedIndex = timelineDays.value.findIndex((day) => localDayKey(day) === anchorKey);
    if (retainedIndex >= 0) container.scrollLeft = retainedIndex * width + anchorOffset;
    extendingTimeline = false;
  }

  /** Slides the fixed-width timeline window by `stepPx` without changing its total span. */
  async function slideTimelineWindow(direction: -1 | 1, stepPx: number) {
    const container = scroll.value;
    if (extendingTimeline || !container || !timelineDays.value.length || stepPx <= 0) return;
    const width = timelineDayWidth.value;
    const maxScroll = Math.max(0, container.scrollWidth - container.clientWidth);
    if (direction < 0) {
      if (container.scrollLeft >= stepPx) {
        container.scrollLeft -= stepPx;
        return;
      }
      const deficit = stepPx - container.scrollLeft;
      const days = Math.max(1, Math.ceil(deficit / width));
      extendingTimeline = true;
      const count = timelineDays.value.length;
      const edge = timelineDays.value[0]!;
      const additions = Array.from({ length: days }, (_, index) => dayOffset(edge, -(index + 1)));
      timelineDays.value = [...additions.reverse(), ...timelineDays.value].slice(0, count);
      await nextTick();
      container.scrollLeft = Math.min(maxScroll, Math.max(0, days * width - deficit));
      extendingTimeline = false;
      return;
    }
    const remaining = maxScroll - container.scrollLeft;
    if (remaining >= stepPx) {
      container.scrollLeft += stepPx;
      return;
    }
    const deficit = stepPx - remaining;
    const days = Math.max(1, Math.ceil(deficit / width));
    extendingTimeline = true;
    const count = timelineDays.value.length;
    const edge = timelineDays.value.at(-1)!;
    const additions = Array.from({ length: days }, (_, index) => dayOffset(edge, index + 1));
    timelineDays.value = [...timelineDays.value, ...additions].slice(-count);
    await nextTick();
    container.scrollLeft = Math.min(maxScroll, Math.max(0, maxScroll - (days * width - deficit)));
    extendingTimeline = false;
  }

  function onTimelineScroll() {
    const container = scroll.value;
    if (!timeline.value || !container || !timelineDays.value.length || positioningTimeline || extendingTimeline) return;
    const width = timelineDayWidth.value;
    const index = Math.min(timelineDays.value.length - 1, Math.max(0, Math.round(container.scrollLeft / width)));
    const visible = timelineDays.value[index]!;
    const mode = getMode();
    const d = visibleCalendarDays(visible, mode)[0]!;
    const key = localDayKey(d);
    if (key !== localDayKey(visibleCalendarDays(getDate(), mode)[0]!)) {
      reportedTimelineKey = key;
      options.onVisibleTimeline(d);
    }
    if (customScrollbarDragging) return;
    const direction = timelineEdgeDirection(container);
    if (direction !== 0) scheduleEdgeExtend('horizontal', direction);
    else clearPendingEdgeExtend();
  }

  function onCalendarWheel(event: WheelEvent) {
    const mode = getMode();
    if (event.ctrlKey) {
      // Keep browser zoom disabled here, even at the smallest/largest calendar scale.
      event.preventDefault();
      event.stopPropagation();
      if (!event.deltaY || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const now = performance.now();
      if (now - lastZoomWheel > 200 || Math.sign(zoomDelta) !== Math.sign(event.deltaY)) zoomDelta = 0;
      lastZoomWheel = now;
      if (now - lastZoomChange < 200) return;
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scroll.value?.clientHeight || 800 : 1;
      zoomDelta += event.deltaY * unit;
      if (Math.abs(zoomDelta) < 40) return;
      // The agenda lists one month, so zoom from the same scale as the month grid.
      const index = ZOOM_MODES.indexOf(mode === 'agenda' ? 'month' : mode);
      const nextMode = ZOOM_MODES[Math.max(0, Math.min(ZOOM_MODES.length - 1, index + Math.sign(zoomDelta)))]!;
      zoomDelta = 0;
      if (nextMode !== mode) {
        lastZoomChange = now;
        const focus = ZOOM_MODES.indexOf(nextMode) < index ? zoomFocusDate(event, mode, nextMode) : undefined;
        if (focus && options.onFocusDate) {
          // The mode watcher positions the new scale on this date; skip the date watcher's scroll.
          focusedZoomKey = localDayKey(focus);
          options.onFocusDate(focus);
        }
        options.onSelectMode(nextMode);
      }
      return;
    }
    zoomDelta = 0;
    if (Math.abs(event.deltaX) > 0) lastHorizontalWheelAt = performance.now();
    if (!event.shiftKey && Math.abs(event.deltaY) > 0) lastVerticalWheelAt = performance.now();
    if (!timeline.value || !event.shiftKey || !scroll.value) return;
    lastHorizontalWheelAt = performance.now();
    event.preventDefault();
    const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
    scroll.value.scrollLeft += delta * Math.max(1, timelineDayWidth.value / 360);
  }

  /** Day (or month, from the year scale) under the pointer, mapped to the finer scale's start date. */
  function zoomFocusDate(event: WheelEvent, from: CalendarViewMode, to: CalendarViewMode): Date | undefined {
    const container = scroll.value;
    if (!container) return undefined;
    const contains = (element: HTMLElement, x: boolean, y: boolean) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && (!x || (event.clientX >= rect.left && event.clientX < rect.right))
        && (!y || (event.clientY >= rect.top && event.clientY < rect.bottom));
    };
    const target = event.target instanceof Element ? event.target : undefined;
    if (from === 'year') {
      const month = target?.closest<HTMLElement>('.calendar-year-month[data-month]')
        ?? [...container.querySelectorAll<HTMLElement>('.calendar-year-month[data-month]')]
          .find(element => contains(element, true, true));
      const [year, monthNumber] = (month?.dataset.month ?? '').split('-').map(Number);
      return year && monthNumber ? new Date(year, monthNumber - 1, 1) : undefined;
    }
    const selector = from === 'month' ? '.calendar-month-cell[data-day]' : '.calendar-view-day-column[data-day]';
    // Timeline headings and the hour gutter carry no day, so fall back to the column under the pointer.
    const cell = target?.closest<HTMLElement>(`${from === 'month' ? '.calendar-month-cell' : '[data-day]'}[data-day]`)
      ?? [...container.querySelectorAll<HTMLElement>(selector)]
        .find(element => contains(element, true, from === 'month'));
    const key = cell?.dataset.day;
    if (!key) return undefined;
    const [year, month, day] = key.split('-').map(Number);
    const focus = new Date(year!, month! - 1, day!);
    if (to !== 'four-days') return focus;
    // Keep the four-day window inside the pointer's week while still showing that day.
    const sunday = weekDays(focus)[6]!;
    return focus.getTime() > dayOffset(sunday, -3).getTime() ? dayOffset(sunday, -3) : focus;
  }

  async function resizeTimeline() {
    const container = scroll.value;
    if (!timeline.value || !container) return;
    const width = Math.max(90, (container.clientWidth - CALENDAR_AXIS_WIDTH) / timelineVisibleCount.value);
    if (Math.abs(width - timelineDayWidth.value) < 0.5) return;
    const dayPosition = container.scrollLeft / timelineDayWidth.value;
    positioningTimeline = true;
    timelineDayWidth.value = width;
    await nextTick();
    container.scrollLeft = dayPosition * width;
    positioningTimeline = false;
  }

  function fillWeeks(d: Date) {
    const monday = weekDays(d)[0]!;
    scrollingWeeks.value = Array.from({ length: 37 }, (_, index) => weekOffset(monday, index - 18));
  }

  function weekRow(d: Date) {
    const key = weekKey(weekDays(d)[0]!);
    return [...(scroll.value?.querySelectorAll<HTMLElement>('.calendar-month-week') ?? [])]
      .find((row) => row.dataset.week === key);
  }

  async function scrollToWeek(d: Date) {
    // Month navigation lands on the week holding the 1st, so the whole month is
    // in view and the dominant-month check in onMonthScroll agrees with it.
    const monthStart = new Date(d.getFullYear(), d.getMonth(), 1);
    const key = weekKey(weekDays(monthStart)[0]!);
    if (!scrollingWeeks.value.some((week) => weekKey(week) === key)) fillWeeks(monthStart);
    await nextTick();
    const container = scroll.value;
    const row = weekRow(monthStart);
    if (!container || !row) return;
    container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 40;
  }

  async function extendWeeks(direction: -1 | 1) {
    if (extendingWeeks || !scroll.value || !scrollingWeeks.value.length) return;
    extendingWeeks = true;
    const container = scroll.value;
    const anchor = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')]
      .find((row) => row.getBoundingClientRect().bottom > container.getBoundingClientRect().top + 80);
    const anchorKey = anchor?.dataset.week;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const edge = direction < 0 ? scrollingWeeks.value[0]! : scrollingWeeks.value.at(-1)!;
    const additions = Array.from({ length: 8 }, (_, index) => weekOffset(edge, direction * (index + 1)));
    const expanded = direction < 0
      ? [...additions.reverse(), ...scrollingWeeks.value]
      : [...scrollingWeeks.value, ...additions];
    scrollingWeeks.value = direction < 0 ? expanded.slice(0, 85) : expanded.slice(-85);
    await nextTick();
    const retained = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')]
      .find((row) => row.dataset.week === anchorKey);
    if (retained && anchorTop !== undefined)
      container.scrollTop += retained.getBoundingClientRect().top - anchorTop;
    extendingWeeks = false;
  }

  /** Slides the fixed-height month week window by `stepPx` without changing its total span. */
  async function slideMonthWindow(direction: -1 | 1, stepPx: number) {
    const container = scroll.value;
    if (extendingWeeks || !container || !scrollingWeeks.value.length || stepPx <= 0) return;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (direction < 0 && container.scrollTop >= stepPx) {
      container.scrollTop -= stepPx;
      return;
    }
    if (direction > 0 && maxScroll - container.scrollTop >= stepPx) {
      container.scrollTop += stepPx;
      return;
    }
    extendingWeeks = true;
    const rows = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')];
    const anchor = direction < 0 ? rows[0] : rows.at(-1);
    const anchorKey = anchor?.dataset.week;
    const anchorTop = anchor?.getBoundingClientRect().top;
    const rowHeight = Math.max(60, anchor?.offsetHeight || 120);
    const deficit = direction < 0 ? stepPx - container.scrollTop : stepPx - (maxScroll - container.scrollTop);
    const shiftWeeks = Math.max(1, Math.ceil(deficit / rowHeight));
    const count = scrollingWeeks.value.length;
    const edge = direction < 0 ? scrollingWeeks.value[0]! : scrollingWeeks.value.at(-1)!;
    const additions = Array.from({ length: shiftWeeks }, (_, index) => weekOffset(edge, direction * (index + 1)));
    const expanded = direction < 0
      ? [...additions.reverse(), ...scrollingWeeks.value]
      : [...scrollingWeeks.value, ...additions];
    scrollingWeeks.value = direction < 0 ? expanded.slice(0, count) : expanded.slice(-count);
    await nextTick();
    const retained = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')]
      .find((row) => row.dataset.week === anchorKey);
    const nextMaxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (retained && anchorTop !== undefined) {
      const nextTop = container.scrollTop + (retained.getBoundingClientRect().top - anchorTop) + direction * stepPx;
      container.scrollTop = Math.min(nextMaxScroll, Math.max(0, nextTop));
    } else {
      container.scrollTop = direction < 0 ? Math.max(0, shiftWeeks * rowHeight - deficit) : Math.max(0, nextMaxScroll - (shiftWeeks * rowHeight - deficit));
    }
    extendingWeeks = false;
  }

  function onMonthScroll() {
    const container = scroll.value;
    if (getMode() !== 'month' || !container || !scrollingWeeks.value.length || extendingWeeks) return;
    const weeks = scrollingWeeks.value;
    const total = weeks.length;
    const headerHeight = 40;
    const scrollHeight = Math.max(total * 108, container.scrollHeight - headerHeight);
    const rowHeight = scrollHeight / total;
    const viewTop = Math.max(0, container.scrollTop);
    const viewBottom = viewTop + Math.max(rowHeight, container.clientHeight - headerHeight);
    const firstIdx = Math.max(0, Math.floor(viewTop / rowHeight));
    const lastIdx = Math.min(total - 1, Math.ceil(viewBottom / rowHeight));

    const area = new Map<string, { month: Date; size: number }>();
    for (let i = firstIdx; i <= lastIdx; i++) {
      const week = weeks[i]!;
      const rowTop = i * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const size = Math.min(rowBottom, viewBottom) - Math.max(rowTop, viewTop);
      if (size <= 0) continue;
      for (const day of weekDays(week)) {
        const key = monthKey(day);
        const entry = area.get(key) ?? { month: day, size: 0 };
        entry.size += size;
        area.set(key, entry);
      }
    }
    const current = getDate();
    let visibleMonth: Date | undefined;
    let best = (area.get(monthKey(current))?.size ?? 0) * 1.15;
    for (const { month, size } of area.values())
      if (size > best) { best = size; visibleMonth = month; }
    if (visibleMonth && monthKey(visibleMonth) !== monthKey(current)) {
      reportedMonthKey = monthKey(visibleMonth);
      options.onVisibleMonth(new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1));
    }
    if (customScrollbarDragging) return;
    const direction = monthEdgeDirection(container);
    if (direction !== 0) scheduleEdgeExtend('vertical', direction);
    else clearPendingEdgeExtend();
  }

  function fillYears(d: Date) {
    const year = d.getFullYear();
    scrollingYears.value = [year - 1, year, year + 1];
  }

  function yearSection(year: number) {
    return [...(scroll.value?.querySelectorAll<HTMLElement>('.calendar-year-section') ?? [])]
      .find((section) => Number(section.dataset.year) === year);
  }

  async function scrollToYear(d: Date) {
    const year = d.getFullYear();
    positioningYear = true;
    if (!scrollingYears.value.includes(year)) fillYears(d);
    await nextTick();
    const container = scroll.value;
    const section = yearSection(year);
    if (container && section)
      container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
    positioningYear = false;
  }

  async function extendYears(direction: -1 | 1) {
    if (extendingYears || !scroll.value || !scrollingYears.value.length) return;
    extendingYears = true;
    const container = scroll.value;
    const anchor = [...container.querySelectorAll<HTMLElement>('.calendar-year-section')]
      .find((section) => section.getBoundingClientRect().bottom > container.getBoundingClientRect().top + 60);
    const anchorYear = Number(anchor?.dataset.year);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const nextYear = direction < 0 ? scrollingYears.value[0]! - 1 : scrollingYears.value.at(-1)! + 1;
    const expanded = direction < 0
      ? [nextYear, ...scrollingYears.value]
      : [...scrollingYears.value, nextYear];
    scrollingYears.value = direction < 0 ? expanded.slice(0, 5) : expanded.slice(-5);
    await nextTick();
    const retained = yearSection(anchorYear);
    if (retained && anchorTop !== undefined)
      container.scrollTop += retained.getBoundingClientRect().top - anchorTop;
    extendingYears = false;
  }

  /** Slides the fixed-height year window by `stepPx` without changing its total span. */
  async function slideYearWindow(direction: -1 | 1, stepPx: number) {
    const container = scroll.value;
    if (extendingYears || !container || !scrollingYears.value.length || stepPx <= 0) return;
    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (direction < 0 && container.scrollTop >= stepPx) {
      container.scrollTop -= stepPx;
      return;
    }
    if (direction > 0 && maxScroll - container.scrollTop >= stepPx) {
      container.scrollTop += stepPx;
      return;
    }
    extendingYears = true;
    const sections = [...container.querySelectorAll<HTMLElement>('.calendar-year-section')];
    const anchor = direction < 0 ? sections[0] : sections.at(-1);
    const anchorYear = Number(anchor?.dataset.year);
    const anchorTop = anchor?.getBoundingClientRect().top;
    const count = scrollingYears.value.length;
    const nextYear = direction < 0 ? scrollingYears.value[0]! - 1 : scrollingYears.value.at(-1)! + 1;
    scrollingYears.value = direction < 0
      ? [nextYear, ...scrollingYears.value].slice(0, count)
      : [...scrollingYears.value, nextYear].slice(-count);
    await nextTick();
    const retained = yearSection(anchorYear);
    const nextMaxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (retained && anchorTop !== undefined) {
      const nextTop = container.scrollTop + (retained.getBoundingClientRect().top - anchorTop) + direction * stepPx;
      container.scrollTop = Math.min(nextMaxScroll, Math.max(0, nextTop));
    } else {
      const sectionHeight = Math.max(400, anchor?.offsetHeight || 720);
      const deficit = direction < 0 ? stepPx - container.scrollTop : stepPx - (maxScroll - container.scrollTop);
      container.scrollTop = direction < 0 ? Math.max(0, sectionHeight - deficit) : Math.max(0, nextMaxScroll - (sectionHeight - deficit));
    }
    extendingYears = false;
  }

  function onYearScroll() {
    const container = scroll.value;
    if (getMode() !== 'year' || !container || !scrollingYears.value.length || extendingYears || positioningYear) return;
    const marker = container.getBoundingClientRect().top + 60;
    const section = [...container.querySelectorAll<HTMLElement>('.calendar-year-section')]
      .find((element) => element.getBoundingClientRect().bottom > marker);
    const year = Number(section?.dataset.year);
    const current = getDate();
    if (section && year !== current.getFullYear()) {
      reportedYear = year;
      options.onVisibleYear(shiftCalendarDate(current, 'year', year - current.getFullYear()));
    }
    if (customScrollbarDragging) return;
    const direction = yearEdgeDirection(container);
    if (direction !== 0) scheduleEdgeExtend('vertical', direction);
    else clearPendingEdgeExtend();
  }

  function onCalendarScroll() {
    options.onScrolled();
    if (timeline.value) onTimelineScroll();
    else if (getMode() === 'month') onMonthScroll();
    else if (getMode() === 'year') onYearScroll();
  }

  async function positionTimeline() {
    prepareScale();
    await nextTick();
    placeScale();
  }

  onMounted(() => {
    void positionTimeline();
    if (scroll.value) {
      scroll.value.addEventListener('mousedown', onContainerMouseDown);
      if (supportsScrollEnd) scroll.value.addEventListener('scrollend', onContainerScrollEnd);
      if (typeof ResizeObserverCtor !== 'undefined') {
        timelineResizeObserver = new ResizeObserverCtor(() => { void resizeTimeline(); });
        timelineResizeObserver.observe(scroll.value);
      }
    }
    window.addEventListener('mouseup', onScrollbarRelease);
    window.addEventListener('pointerup', onScrollbarRelease);
    window.addEventListener('blur', onScrollbarRelease);
  });

  onUnmounted(() => {
    clearPendingEdgeExtend();
    scroll.value?.removeEventListener('mousedown', onContainerMouseDown);
    if (supportsScrollEnd) scroll.value?.removeEventListener('scrollend', onContainerScrollEnd);
    window.removeEventListener('mouseup', onScrollbarRelease);
    window.removeEventListener('pointerup', onScrollbarRelease);
    window.removeEventListener('blur', onScrollbarRelease);
    timelineResizeObserver?.disconnect();
  });

  /**
   * Scale changes are laid out in one render and positioned synchronously right after it:
   * shared-element morphs measure their destination as soon as the DOM updates, so the new
   * scale must already be filled, sized and scrolled into place by then.
   */
  function prepareScale() {
    const current = getDate();
    if (timeline.value) {
      const container = scroll.value;
      if (container) timelineDayWidth.value = Math.max(90, (container.clientWidth - CALENDAR_AXIS_WIDTH) / timelineVisibleCount.value);
      // Keep the rendered days when they already cover the new range: columns then stay in
      // place (and morph) instead of all shifting under a new list.
      const first = localDayKey(visibleCalendarDays(current, getMode())[0]!);
      const index = timelineDays.value.findIndex((day) => localDayKey(day) === first);
      if (index < 7 || index > timelineDays.value.length - 14) fillTimelineDays(current);
    } else if (getMode() === 'month') {
      fillWeeks(current);
    } else if (getMode() === 'year') {
      fillYears(current);
    }
  }

  function placeScale() {
    const container = scroll.value;
    if (!container || options.loading?.()) return;
    const current = getDate();
    if (!timeline.value) container.scrollLeft = 0;
    if (timeline.value) {
      positioningTimeline = true;
      const first = localDayKey(visibleCalendarDays(current, getMode())[0]!);
      const index = Math.max(0, timelineDays.value.findIndex((day) => localDayKey(day) === first));
      container.scrollLeft = index * timelineDayWidth.value;
      container.scrollTop = CALENDAR_HOUR_HEIGHT * 7;
      positioningTimeline = false;
    } else if (getMode() === 'month') {
      const row = weekRow(new Date(current.getFullYear(), current.getMonth(), 1));
      if (row) container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 40;
    } else if (getMode() === 'year') {
      positioningYear = true;
      const section = yearSection(current.getFullYear());
      if (section) container.scrollTop += section.getBoundingClientRect().top - container.getBoundingClientRect().top - 12;
      positioningYear = false;
    } else {
      container.scrollTop = 0;
    }
  }

  watch(getMode, (to, from) => {
    clearPendingEdgeExtend();
    options.onBeforeViewChange();
    options.onBeforeModeChange?.(from, to);
    prepareScale();
  });
  // Post-flush: the new scale is in the DOM but has not been measured by the morph yet.
  watch(getMode, (to, from) => {
    placeScale();
    if (getMode() === to) options.onModePositioned?.(from, to);
  }, { flush: 'post' });

  // When CalendarView mounts while loading, v-show hides the calendar body so initial
  // scroll positioning is skipped/clamped; reposition once content becomes visible.
  watch(
    () => Boolean(options.loading?.()),
    (loading, wasLoading) => {
      if (wasLoading && !loading) void positionTimeline();
    },
    { flush: 'post' },
  );

  watch(getDate, (nextDate) => {
    options.onBeforeViewChange();
    if (customScrollbarDragging || performance.now() - lastCustomScrollbarEndAt < 100) return;
    if (focusedZoomKey) {
      const focused = focusedZoomKey === localDayKey(nextDate);
      focusedZoomKey = '';
      if (focused) return;
    }
    const mode = getMode();
    if (mode === 'month') {
      if (reportedMonthKey === monthKey(nextDate)) {
        reportedMonthKey = '';
        return;
      }
      void scrollToWeek(nextDate);
    } else if (mode === 'year') {
      if (reportedYear === nextDate.getFullYear()) {
        reportedYear = undefined;
        return;
      }
      void scrollToYear(nextDate);
    } else if (timeline.value) {
      const key = localDayKey(visibleCalendarDays(nextDate, mode)[0]!);
      if (reportedTimelineKey === key) {
        reportedTimelineKey = '';
        return;
      }
      void scrollToTimelineDate(nextDate);
    }
  });

  return {
    timeline,
    timelineDays,
    timelineDayWidth,
    timelineVisibleCount,
    scrollingWeeks,
    scrollingYears,
    visibleWindow,
    onCalendarScroll,
    onCalendarWheel,
    extendTimelineDays,
    slideTimelineWindow,
    slideMonthWindow,
    slideYearWindow,
    setCustomScrollbarDragging,
  };
}
