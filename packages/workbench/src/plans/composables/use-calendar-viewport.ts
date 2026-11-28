import { onMounted, onUnmounted, ref, shallowRef, watch, type ComputedRef, type Ref } from 'vue';
import { localDayKey, visibleCalendarDays, weekDays, type CalendarViewMode } from '../calendar';
import { CALENDAR_HOUR_HEIGHT } from './use-calendar-scroll';

export interface IndexRange {
  start: number;
  end: number;
}

/**
 * Updates a buffered `[start, end]` index range with hysteresis:
 * - Only shifts when `[visStart, visEnd]` approaches within `triggerMargin` of the current buffer edges.
 * - While `preserveExisting` (e.g. active drag) is true, expands to include new items without pruning old ones.
 */
export function computeHysteresisRange(
  current: IndexRange | null,
  visStart: number,
  visEnd: number,
  total: number,
  overscan: number,
  triggerMargin: number,
  preserveExisting = false,
): IndexRange {
  if (total <= 0) return { start: 0, end: -1 };
  const clampedVisStart = Math.max(0, Math.min(total - 1, visStart));
  const clampedVisEnd = Math.max(clampedVisStart, Math.min(total - 1, visEnd));
  const targetStart = Math.max(0, clampedVisStart - overscan);
  const targetEnd = Math.min(total - 1, clampedVisEnd + overscan);

  if (!current || current.end < current.start || current.end >= total) {
    return { start: targetStart, end: targetEnd };
  }

  const nearStart = clampedVisStart < current.start + triggerMargin && current.start > 0;
  const nearEnd = clampedVisEnd > current.end - triggerMargin && current.end < total - 1;
  const outside = clampedVisStart < current.start || clampedVisEnd > current.end;

  if (!nearStart && !nearEnd && !outside) {
    return current;
  }

  if (preserveExisting) {
    return {
      start: Math.min(current.start, targetStart),
      end: Math.max(current.end, targetEnd),
    };
  }
  return { start: targetStart, end: targetEnd };
}

export interface CalendarViewportOptions {
  date: () => Date;
  mode: () => CalendarViewMode;
  timeline: ComputedRef<boolean>;
  timelineDays: Ref<Date[]>;
  timelineDayWidth: Ref<number>;
  scrollingWeeks: Ref<Date[]>;
  scrollingYears: Ref<number[]>;
  scroll: Ref<HTMLElement | undefined>;
  window: Window;
  isInteracting?: () => boolean;
}

export interface CalendarViewportState {
  timelineRenderRange: Ref<IndexRange>;
  timelineHourRange: Ref<IndexRange>;
  monthRenderRange: Ref<IndexRange>;
  yearRenderRange: Ref<IndexRange>;
  agendaScrollTop: Ref<number>;
  agendaViewportHeight: Ref<number>;
  dataWindow: Ref<[Date, Date]>;
  syncNow: () => void;
  scheduleSync: () => void;
}

const MONTH_WEEK_ESTIMATED_HEIGHT = 108;
const YEAR_SECTION_ESTIMATED_HEIGHT = 760;

function sameRange(a: IndexRange | null, b: IndexRange): boolean {
  return a !== null && a.start === b.start && a.end === b.end;
}

function dayOffset(d: Date, days: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

export function useCalendarViewport(options: CalendarViewportOptions): CalendarViewportState {
  const {
    date: getDate,
    mode: getMode,
    timeline,
    timelineDays,
    timelineDayWidth,
    scrollingWeeks,
    scrollingYears,
    scroll,
    window,
    isInteracting,
  } = options;

  const timelineRenderRange = shallowRef<IndexRange>({ start: 0, end: 41 });
  const timelineHourRange = shallowRef<IndexRange>({ start: 0, end: 24 });
  const monthRenderRange = shallowRef<IndexRange>({ start: 0, end: 36 });
  const yearRenderRange = shallowRef<IndexRange>({ start: 0, end: 2 });
  const agendaScrollTop = ref(0);
  const agendaViewportHeight = ref(800);

  const initialDate = getDate();
  const dataWindow = shallowRef<[Date, Date]>([
    new Date(initialDate.getFullYear(), initialDate.getMonth(), 1),
    new Date(initialDate.getFullYear(), initialDate.getMonth() + 1, 0),
  ]);

  let dataWindowKeys: [string, string] = [
    localDayKey(dataWindow.value[0]),
    localDayKey(dataWindow.value[1]),
  ];
  let dataTimelineRange: IndexRange | null = null;
  let dataMonthRange: IndexRange | null = null;
  let rafId: number | undefined;
  let resizeObserver: ResizeObserver | undefined;

  function setDataWindow(start: Date, end: Date, force = false) {
    const sk = localDayKey(start);
    const ek = localDayKey(end);
    if (!force && sk === dataWindowKeys[0] && ek === dataWindowKeys[1]) return;
    dataWindowKeys = [sk, ek];
    dataWindow.value = [start, end];
  }

  function syncTimeline(container: HTMLElement | undefined, preserve: boolean) {
    const days = timelineDays.value;
    const total = days.length;
    if (!total) return;

    const width = Math.max(1, timelineDayWidth.value);
    const mode = getMode();
    const visibleCols = mode === 'week' ? 7 : mode === 'four-days' ? 4 : 1;

    let visStart: number;
    let visEnd: number;
    if (container && container.clientWidth > 0) {
      visStart = Math.floor(container.scrollLeft / width);
      visEnd = Math.ceil((container.scrollLeft + container.clientWidth) / width);
    } else {
      // jsdom / pre-layout fallback: center on active date
      const firstKey = localDayKey(visibleCalendarDays(getDate(), mode)[0]!);
      const idx = Math.max(0, days.findIndex((d) => localDayKey(d) === firstKey));
      visStart = idx;
      visEnd = Math.min(total - 1, idx + visibleCols);
    }

    const nextRender = computeHysteresisRange(
      timelineRenderRange.value,
      visStart,
      visEnd,
      total,
      4, // overscan: 4 days on each side
      2, // trigger when within 2 days of buffer edge
      preserve,
    );
    if (!sameRange(timelineRenderRange.value, nextRender)) {
      timelineRenderRange.value = nextRender;
    }

    // Vertical hour window (used when a single day has many timed events)
    if (container && container.clientHeight > 0) {
      const visHourStart = Math.floor(container.scrollTop / CALENDAR_HOUR_HEIGHT);
      const visHourEnd = Math.ceil((container.scrollTop + container.clientHeight) / CALENDAR_HOUR_HEIGHT);
      const nextHour = computeHysteresisRange(
        timelineHourRange.value,
        visHourStart,
        visHourEnd,
        25,
        3, // ±3h overscan
        1,
        preserve,
      );
      if (!sameRange(timelineHourRange.value, nextHour)) {
        timelineHourRange.value = nextHour;
      }
    } else if (timelineHourRange.value.start !== 0 || timelineHourRange.value.end !== 24) {
      timelineHourRange.value = { start: 0, end: 24 };
    }

    // Data window: visible ± 14 days (hysteresis margin: 4 days)
    const nextData = computeHysteresisRange(
      dataTimelineRange,
      visStart,
      visEnd,
      total,
      14,
      4,
      preserve,
    );
    dataTimelineRange = nextData;
    const startDay = days[nextData.start]!;
    const endDay = days[nextData.end]!;
    setDataWindow(startDay, endDay);
  }

  function syncMonth(container: HTMLElement | undefined, preserve: boolean) {
    const weeks = scrollingWeeks.value;
    const total = weeks.length;
    if (!total) return;

    let visStart: number;
    let visEnd: number;
    if (container && container.clientHeight > 0) {
      const rowH = Math.max(80, container.scrollHeight / total || MONTH_WEEK_ESTIMATED_HEIGHT);
      visStart = Math.floor(container.scrollTop / rowH);
      visEnd = Math.ceil((container.scrollTop + container.clientHeight) / rowH);
    } else {
      const monthStart = new Date(getDate().getFullYear(), getDate().getMonth(), 1);
      const key = localDayKey(weekDays(monthStart)[0]!);
      const idx = Math.max(0, weeks.findIndex((w) => localDayKey(w) === key));
      visStart = idx;
      visEnd = Math.min(total - 1, idx + 6);
    }

    const nextRender = computeHysteresisRange(
      monthRenderRange.value,
      visStart,
      visEnd,
      total,
      3, // ±3 weeks overscan (~12 weeks mounted instead of 85)
      1,
      preserve,
    );
    if (!sameRange(monthRenderRange.value, nextRender)) {
      monthRenderRange.value = nextRender;
    }

    // Data window: visible ± 10 weeks (hysteresis margin: 3 weeks)
    const nextData = computeHysteresisRange(
      dataMonthRange,
      visStart,
      visEnd,
      total,
      10,
      3,
      preserve,
    );
    dataMonthRange = nextData;
    const firstWeek = weeks[nextData.start]!;
    const lastWeek = weeks[nextData.end]!;
    setDataWindow(firstWeek, dayOffset(lastWeek, 6));
  }

  function syncYear(container: HTMLElement | undefined, preserve: boolean) {
    const years = scrollingYears.value;
    const total = years.length;
    if (!total) return;

    let visStart: number;
    let visEnd: number;
    if (container && container.clientHeight > 0) {
      const secH = Math.max(300, container.scrollHeight / total || YEAR_SECTION_ESTIMATED_HEIGHT);
      visStart = Math.floor(container.scrollTop / secH);
      visEnd = Math.ceil((container.scrollTop + container.clientHeight) / secH);
    } else {
      const idx = Math.max(0, years.indexOf(getDate().getFullYear()));
      visStart = idx;
      visEnd = idx;
    }

    const nextRender = computeHysteresisRange(
      yearRenderRange.value,
      visStart,
      visEnd,
      total,
      1, // ±1 year overscan
      0,
      preserve,
    );
    if (!sameRange(yearRenderRange.value, nextRender)) {
      yearRenderRange.value = nextRender;
    }

    const startYear = years[nextRender.start]!;
    const endYear = years[nextRender.end]!;
    setDataWindow(new Date(startYear, 0, 1), new Date(endYear, 11, 31));
  }

  function syncAgenda(container: HTMLElement | undefined) {
    const current = getDate();
    setDataWindow(
      new Date(current.getFullYear(), current.getMonth(), 1),
      new Date(current.getFullYear(), current.getMonth() + 1, 0),
    );
    if (container && container.clientHeight > 0) {
      agendaScrollTop.value = container.scrollTop;
      agendaViewportHeight.value = container.clientHeight;
    }
  }

  function syncNow() {
    const container = scroll.value;
    const preserve = Boolean(isInteracting?.());
    const mode = getMode();
    if (timeline.value) syncTimeline(container, preserve);
    else if (mode === 'month') syncMonth(container, preserve);
    else if (mode === 'year') syncYear(container, preserve);
    else syncAgenda(container);
  }

  function scheduleSync() {
    if (rafId !== undefined) return;
    if (typeof window.requestAnimationFrame !== 'function') {
      syncNow();
      return;
    }
    rafId = window.requestAnimationFrame(() => {
      rafId = undefined;
      syncNow();
    });
  }

  // Reset hysteresis caches when the backing track changes length/start or mode switches.
  watch(
    [getMode, () => timelineDays.value[0]?.getTime(), () => timelineDays.value.length],
    () => {
      dataTimelineRange = null;
      syncNow();
    },
  );
  watch(
    [getMode, () => scrollingWeeks.value[0]?.getTime(), () => scrollingWeeks.value.length],
    () => {
      dataMonthRange = null;
      syncNow();
    },
  );
  watch(
    [getMode, () => scrollingYears.value[0], () => scrollingYears.value.length],
    () => {
      syncNow();
    },
  );
  watch(
    () => (getMode() === 'agenda' ? `${getDate().getFullYear()}-${getDate().getMonth()}` : ''),
    () => {
      if (getMode() === 'agenda') syncNow();
    },
  );

  onMounted(() => {
    syncNow();
    const ResizeObserverCtor = (window as Window & typeof globalThis).ResizeObserver;
    if (scroll.value && typeof ResizeObserverCtor !== 'undefined') {
      resizeObserver = new ResizeObserverCtor(() => scheduleSync());
      resizeObserver.observe(scroll.value);
    }
  });

  onUnmounted(() => {
    if (rafId !== undefined) {
      window.cancelAnimationFrame(rafId);
      rafId = undefined;
    }
    resizeObserver?.disconnect();
  });

  return {
    timelineRenderRange,
    timelineHourRange,
    monthRenderRange,
    yearRenderRange,
    agendaScrollTop,
    agendaViewportHeight,
    dataWindow,
    syncNow,
    scheduleSync,
  };
}
