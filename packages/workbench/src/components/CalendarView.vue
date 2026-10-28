<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t, uiLocale } from '../i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId, watch } from 'vue';
import { calendarEvents, eventsOnDay, hasEventTime, localDayKey, monthDays, plannedEventsOnDay, planningEvents, shiftCalendarDate, visibleCalendarDays, weekDays } from '../calendar';
import type { CalendarViewMode } from '../calendar';
import type { ObjectRecord } from '../workspace-objects';
import { usePlanStore } from '../stores/plans';
import { planKey, planSourceLabel } from '../personal-plans';
import CalendarDayPopover from './CalendarDayPopover.vue';

const props = defineProps<{ date: Date; mode: CalendarViewMode; records?: ObjectRecord[]; loading?: boolean }>();
const emit = defineEmits<{
  'select-mode': [mode: CalendarViewMode];
  'select-date': [date: Date];
  'select-month': [date: Date];
  'select-event': [id: string];
  'visible-month': [date: Date];
  'visible-year': [date: Date];
  'visible-timeline': [date: Date];
}>();
const plans = usePlanStore();
const scroll = ref<HTMLElement>();
const events = computed(() => calendarEvents(props.records ?? plans.records));
const planned = computed(() => planningEvents(props.records ?? plans.records));
const dateOnly = computed(() => planned.value.filter(record => record.object.properties.allDay === true || (!hasEventTime(record) && record.object.properties.date)));
const dateOnlyEvents = (day: Date) => plannedEventsOnDay(dateOnly.value, day);
const hasVisibleDateOnly = computed(() => visibleCalendarDays(props.date, props.mode).some(day => dateOnlyEvents(day).length > 0));
const yearDay = shallowRef<{ date: Date; anchor: HTMLElement; scrollTop: number; scrollLeft: number }>();
const dayPopoverId = useId();
const yearDayKey = computed(() => yearDay.value && localDayKey(yearDay.value.date));
const yearDayRecords = (day: Date) => plannedEventsOnDay(planned.value, day);
function openYearDay(day: Date, event: MouseEvent) {
  yearDay.value = yearDayKey.value === localDayKey(day)
    ? undefined : {
      date: day, anchor: event.currentTarget as HTMLElement,
      scrollTop: scroll.value?.scrollTop ?? 0, scrollLeft: scroll.value?.scrollLeft ?? 0,
    };
}
const timeline = computed(() => props.mode === 'day' || props.mode === 'four-days' || props.mode === 'week');
const timelineDays = ref<Date[]>([]);
const timelineDayWidth = ref(120);
const timelineVisibleCount = computed(() => props.mode === 'week' ? 7 : props.mode === 'four-days' ? 4 : 1);
const scrollingWeeks = ref<Date[]>([]);
const scrollingYears = ref<number[]>([]);
const monthsForYear = (year: number) => Array.from({ length: 12 }, (_, month) => {
  const date = new Date(year, month, 1);
  return { date, days: monthDays(date) };
});
const agendaDates = computed(() => {
  const year = props.date.getFullYear();
  const month = props.date.getMonth();
  const length = new Date(year, month + 1, 0).getDate();
  return Array.from({ length }, (_, index) => new Date(year, month, index + 1))
    .filter(day => dayRecords(day).length > 0);
});
const weekdays = computed(() => uiLocale.value === 'en-US'
  ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  : ['一', '二', '三', '四', '五', '六', '日']);
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourHeight = 56;
const today = computed(() => localDayKey(new Date()));
const viewLabel = computed(() => ({
  day: t('日视图'), 'four-days': t('4 天视图'), week: t('周视图'),
  month: t('月视图'), year: t('年视图'), agenda: t('日程视图'),
})[props.mode]);
const monthKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}`;
const weekKey = localDayKey;
const weekOffset = (date: Date, weeks: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + weeks * 7);
let reportedMonthKey = '';
let extendingWeeks = false;
let reportedYear: number | undefined;
let extendingYears = false;
let positioningYear = false;
let reportedTimelineKey = '';
let extendingTimeline = false;
let positioningTimeline = false;
let timelineResizeObserver: ResizeObserver | undefined;

const dayOffset = (date: Date, days: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

function fillTimelineDays(date: Date) {
  const first = visibleCalendarDays(date, props.mode)[0]!;
  timelineDays.value = Array.from({ length: 42 }, (_, index) => dayOffset(first, index - 14));
}
async function scrollToTimelineDate(date: Date) {
  positioningTimeline = true;
  const first = visibleCalendarDays(date, props.mode)[0]!;
  let index = timelineDays.value.findIndex(day => localDayKey(day) === localDayKey(first));
  if (index < 0) {
    fillTimelineDays(date);
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
  const retainedIndex = timelineDays.value.findIndex(day => localDayKey(day) === anchorKey);
  if (retainedIndex >= 0) container.scrollLeft = retainedIndex * width + anchorOffset;
  extendingTimeline = false;
}
function onTimelineScroll() {
  const container = scroll.value;
  if (!timeline.value || !container || !timelineDays.value.length || positioningTimeline || extendingTimeline) return;
  const width = timelineDayWidth.value;
  const index = Math.min(timelineDays.value.length - 1, Math.max(0, Math.round(container.scrollLeft / width)));
  const visible = timelineDays.value[index]!;
  const date = visibleCalendarDays(visible, props.mode)[0]!;
  const key = localDayKey(date);
  if (key !== localDayKey(visibleCalendarDays(props.date, props.mode)[0]!)) {
    reportedTimelineKey = key;
    emit('visible-timeline', date);
  }
  const edgeDistance = Math.max(container.clientWidth, width * 2);
  if (container.scrollLeft < edgeDistance)
    void extendTimelineDays(-1);
  else if (container.scrollWidth - container.scrollLeft - container.clientWidth < edgeDistance)
    void extendTimelineDays(1);
}
const zoomModes: CalendarViewMode[] = ['day', 'four-days', 'week', 'month', 'year'];
let zoomDelta = 0;
let lastZoomWheel = -Infinity;
let lastZoomChange = -Infinity;
function onCalendarWheel(event: WheelEvent) {
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
    const index = zoomModes.indexOf(props.mode === 'agenda' ? 'month' : props.mode);
    const mode = zoomModes[Math.max(0, Math.min(zoomModes.length - 1, index + Math.sign(zoomDelta)))]!;
    zoomDelta = 0;
    if (mode !== props.mode) {
      lastZoomChange = now;
      emit('select-mode', mode);
    }
    return;
  }
  zoomDelta = 0;
  if (!timeline.value || !event.shiftKey || !scroll.value) return;
  event.preventDefault();
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
  scroll.value.scrollLeft += delta * Math.max(1, timelineDayWidth.value / 360);
}
async function resizeTimeline() {
  const container = scroll.value;
  if (!timeline.value || !container) return;
  const width = Math.max(90, (container.clientWidth - 64) / timelineVisibleCount.value);
  if (Math.abs(width - timelineDayWidth.value) < 0.5) return;
  const dayPosition = container.scrollLeft / timelineDayWidth.value;
  positioningTimeline = true;
  timelineDayWidth.value = width;
  await nextTick();
  container.scrollLeft = dayPosition * width;
  positioningTimeline = false;
}

function fillWeeks(date: Date) {
  const monday = weekDays(date)[0]!;
  scrollingWeeks.value = Array.from({ length: 37 }, (_, index) => weekOffset(monday, index - 18));
}
function weekRow(date: Date) {
  const key = weekKey(weekDays(date)[0]!);
  return [...scroll.value?.querySelectorAll<HTMLElement>('.calendar-month-week') ?? []]
    .find(row => row.dataset.week === key);
}
async function scrollToWeek(date: Date) {
  const key = weekKey(weekDays(date)[0]!);
  if (!scrollingWeeks.value.some(week => weekKey(week) === key)) fillWeeks(date);
  await nextTick();
  const container = scroll.value;
  const row = weekRow(date);
  if (!container || !row) return;
  container.scrollTop += row.getBoundingClientRect().top - container.getBoundingClientRect().top - 40;
}
async function extendWeeks(direction: -1 | 1) {
  if (extendingWeeks || !scroll.value || !scrollingWeeks.value.length) return;
  extendingWeeks = true;
  const container = scroll.value;
  const anchor = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')]
    .find(row => row.getBoundingClientRect().bottom > container.getBoundingClientRect().top + 80);
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
    .find(row => row.dataset.week === anchorKey);
  if (retained && anchorTop !== undefined)
    container.scrollTop += retained.getBoundingClientRect().top - anchorTop;
  extendingWeeks = false;
}
function onMonthScroll() {
  const container = scroll.value;
  if (props.mode !== 'month' || !container || !scrollingWeeks.value.length || extendingWeeks) return;
  const marker = container.getBoundingClientRect().top + 45;
  const row = [...container.querySelectorAll<HTMLElement>('.calendar-month-week')]
    .find(element => element.getBoundingClientRect().bottom > marker);
  const visible = scrollingWeeks.value.find(week => weekKey(week) === row?.dataset.week);
  const visibleMonth = visible && weekDays(visible).some(day => monthKey(day) === monthKey(props.date))
    ? props.date : visible;
  if (visibleMonth && monthKey(visibleMonth) !== monthKey(props.date)) {
    reportedMonthKey = monthKey(visibleMonth);
    emit('visible-month', new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1));
  }
  if (container.scrollTop < container.clientHeight)
    void extendWeeks(-1);
  else if (container.scrollHeight - container.scrollTop - container.clientHeight < container.clientHeight)
    void extendWeeks(1);
}
function fillYears(date: Date) {
  const year = date.getFullYear();
  scrollingYears.value = [year - 1, year, year + 1];
}
function yearSection(year: number) {
  return [...scroll.value?.querySelectorAll<HTMLElement>('.calendar-year-section') ?? []]
    .find(section => Number(section.dataset.year) === year);
}
async function scrollToYear(date: Date) {
  const year = date.getFullYear();
  positioningYear = true;
  if (!scrollingYears.value.includes(year)) fillYears(date);
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
    .find(section => section.getBoundingClientRect().bottom > container.getBoundingClientRect().top + 60);
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
function onYearScroll() {
  const container = scroll.value;
  if (props.mode !== 'year' || !container || !scrollingYears.value.length || extendingYears || positioningYear) return;
  const marker = container.getBoundingClientRect().top + 60;
  const section = [...container.querySelectorAll<HTMLElement>('.calendar-year-section')]
    .find(element => element.getBoundingClientRect().bottom > marker);
  const year = Number(section?.dataset.year);
  if (section && year !== props.date.getFullYear()) {
    reportedYear = year;
    emit('visible-year', shiftCalendarDate(props.date, 'year', year - props.date.getFullYear()));
  }
  const edgeDistance = Math.min(400, container.clientHeight / 2);
  if (container.scrollTop < edgeDistance)
    void extendYears(-1);
  else if (container.scrollHeight - container.scrollTop - container.clientHeight < edgeDistance)
    void extendYears(1);
}
function onCalendarScroll() {
  // Focusing a date can queue a scroll event before its click opens the panel.
  // Only dismiss for a scroll that actually moves the calendar after opening.
  if (yearDay.value && scroll.value && (
    yearDay.value.scrollTop !== scroll.value.scrollTop || yearDay.value.scrollLeft !== scroll.value.scrollLeft
  )) yearDay.value = undefined;
  if (timeline.value) onTimelineScroll();
  else if (props.mode === 'month') onMonthScroll();
  else if (props.mode === 'year') onYearScroll();
}
function monthShade(day: Date) {
  return (day.getFullYear() * 12 + day.getMonth()) % 2 === 1;
}

function dayRecords(day: Date) {
  return plannedEventsOnDay(planned.value, day);
}
function timedEvents(day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1).getTime();
  return eventsOnDay(events.value, day).filter(record => !record.object.properties.allDay).map((record) => {
    const from = Date.parse(String(record.object.properties.start));
    const to = Date.parse(String(record.object.properties.end));
    const visibleStart = Math.max(from, start);
    const visibleEnd = Math.min(Math.max(to, from + 30 * 60_000), end);
    const top = (visibleStart - start) / 3_600_000 * hourHeight;
    const point = from === to;
    const height = point ? 24 : Math.max(22, (visibleEnd - visibleStart) / 3_600_000 * hourHeight);
    return { record, top, height, point, time: eventTime(record) };
  });
}
function eventTime(record: ObjectRecord) {
  if (record.object.properties.allDay === true) return t('全天');
  if (!hasEventTime(record)) return t('仅日期');
  return new Date(String(record.object.properties.start)).toLocaleTimeString(uiLocale.value, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function weekday(day: Date) {
  return weekdays.value[(day.getDay() + 6) % 7];
}
async function positionTimeline() {
  await nextTick();
  if (!timeline.value && scroll.value) scroll.value.scrollLeft = 0;
  if (timeline.value) {
    const container = scroll.value;
    if (!container) return;
    timelineDayWidth.value = Math.max(90, (container.clientWidth - 64) / timelineVisibleCount.value);
    fillTimelineDays(props.date);
    await scrollToTimelineDate(props.date);
    container.scrollTop = hourHeight * 7;
  } else if (props.mode === 'month') {
    fillWeeks(props.date);
    await scrollToWeek(props.date);
  } else if (props.mode === 'year') {
    fillYears(props.date);
    await scrollToYear(props.date);
  } else if (scroll.value) scroll.value.scrollTop = 0;
}
onMounted(() => {
  void positionTimeline();
  if (scroll.value && typeof ResizeObserver !== 'undefined') {
    timelineResizeObserver = new ResizeObserver(() => { void resizeTimeline(); });
    timelineResizeObserver.observe(scroll.value);
  }
});
onUnmounted(() => timelineResizeObserver?.disconnect());
watch(() => props.mode, () => {
  yearDay.value = undefined;
  void positionTimeline();
});
watch(() => props.date, (date) => {
  yearDay.value = undefined;
  if (props.mode === 'month') {
    if (reportedMonthKey === monthKey(date)) {
      reportedMonthKey = '';
      return;
    }
    void scrollToWeek(date);
  } else if (props.mode === 'year') {
    if (reportedYear === date.getFullYear()) {
      reportedYear = undefined;
      return;
    }
    void scrollToYear(date);
  } else if (timeline.value) {
    const key = localDayKey(visibleCalendarDays(date, props.mode)[0]!);
    if (reportedTimelineKey === key) {
      reportedTimelineKey = '';
      return;
    }
    void scrollToTimelineDate(date);
  }
});
</script>

<template>
  <main
    ref="scroll"
    class="calendar-view"
    :class="{ 'calendar-view-timeline': timeline, 'calendar-view-month': mode === 'month', 'calendar-view-year': mode === 'year' }"
    :aria-label="t('日历{0}', [viewLabel])"
    @scroll.passive="onCalendarScroll"
    @wheel="onCalendarWheel"
  >
    <LoadingSkeleton v-if="loading" variant="document" :rows="6" />
    <div v-show="!loading" class="component-loading-content">
    <div
      v-if="timeline"
      class="calendar-view-inner"
      :style="{
        '--calendar-day-count': timelineDays.length,
        '--calendar-day-width': `${timelineDayWidth}px`,
        width: `${64 + timelineDays.length * timelineDayWidth}px`,
      }"
    >
      <div class="calendar-view-days">
        <span class="calendar-view-zone">GMT{{ -new Date().getTimezoneOffset() / 60 >= 0 ? '+' : '' }}{{ -new Date().getTimezoneOffset() / 60 }}</span>
        <div
          v-for="day in timelineDays"
          :key="localDayKey(day)"
          class="calendar-view-day-heading"
          :class="{ today: localDayKey(day) === today }"
        >
          <span>{{ uiLocale === 'zh-CN' ? '周' : '' }}{{ weekday(day) }}</span>
          <strong>{{ day.getDate() }}</strong>
        </div>
        <template v-if="hasVisibleDateOnly">
          <span class="calendar-view-date-label">{{ t('全天') }}</span>
          <div v-for="day in timelineDays" :key="`date-${localDayKey(day)}`" class="calendar-view-date-events">
            <button
              v-for="record in dateOnlyEvents(day)"
              :key="planKey(record)"
              type="button"
              class="calendar-view-date-event"
              :data-tooltip="`${planSourceLabel(record)} · ${record.object.name} · ${eventTime(record)}`"
              @click="emit('select-event', planKey(record))"
            >{{ record.object.name }}</button>
          </div>
        </template>
      </div>
      <div class="calendar-view-grid">
        <div class="calendar-view-hours" aria-hidden="true">
          <span v-for="hour in hours" :key="hour" :style="{ top: `${hour * hourHeight}px` }">{{ String(hour).padStart(2, '0') }}:00</span>
        </div>
        <div v-for="day in timelineDays" :key="localDayKey(day)" class="calendar-view-day-column">
          <button
            v-for="item in timedEvents(day)"
            :key="planKey(item.record)"
            type="button"
            class="calendar-view-event"
            :class="{ 'calendar-view-point': item.point }"
            :style="{ top: `${item.top}px`, height: `${item.height}px` }"
            :data-tooltip="`${planSourceLabel(item.record)} · ${item.record.object.name} · ${item.time}`"
            @click="emit('select-event', planKey(item.record))"
          >
            <strong>{{ item.record.object.name }}</strong>
            <span>{{ planSourceLabel(item.record) }} · {{ item.time }}</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'month'" class="calendar-month-view">
      <div class="calendar-month-weekdays" aria-hidden="true">
        <span v-for="name in weekdays" :key="name">{{ uiLocale === 'zh-CN' ? '周' : '' }}{{ name }}</span>
      </div>
      <div
        v-for="week in scrollingWeeks"
        :key="weekKey(week)"
        class="calendar-month-week"
        :data-week="weekKey(week)"
      >
        <div
          v-for="day in weekDays(week)"
          :key="localDayKey(day)"
          class="calendar-month-cell"
          :class="{ shaded: monthShade(day) }"
        >
          <button
            type="button"
            class="calendar-month-date"
            :class="{ today: localDayKey(day) === today, 'month-start': day.getDate() === 1 }"
            :aria-label="t('{0}，查看日视图', [localDayKey(day)])"
            @click="emit('select-date', day)"
          >{{ day.getDate() === 1 ? t('{0} 月 1 日', [day.getMonth() + 1]) : day.getDate() }}</button>
          <button
            v-for="record in dayRecords(day).slice(0, 3)"
            :key="planKey(record)"
            type="button"
            class="calendar-month-event"
            :data-tooltip="`${planSourceLabel(record)} · ${record.object.name} · ${eventTime(record)}`"
            @click="emit('select-event', planKey(record))"
          >{{ planSourceLabel(record) }} · {{ eventTime(record) }} {{ record.object.name }}</button>
          <span v-if="dayRecords(day).length > 3" class="calendar-month-more">{{ t('另有 {0} 项', [dayRecords(day).length - 3]) }}</span>
        </div>
      </div>
    </div>

    <div v-else-if="mode === 'year'" class="calendar-year-view">
      <section v-for="year in scrollingYears" :key="year" class="calendar-year-section" :data-year="year">
        <h2 class="calendar-year-heading">{{ year }}{{ uiLocale === 'zh-CN' ? ' 年' : '' }}</h2>
        <div class="calendar-year-grid">
          <section v-for="month in monthsForYear(year)" :key="month.date.getMonth()" class="calendar-year-month">
            <button type="button" class="calendar-year-month-title" @click="emit('select-month', month.date)">
              {{ month.date.toLocaleDateString(uiLocale, { month: 'long' }) }}
            </button>
            <div class="calendar-year-weekdays" aria-hidden="true">
              <span v-for="name in weekdays" :key="name">{{ name }}</span>
            </div>
            <div class="calendar-year-days">
              <template v-for="day in month.days" :key="localDayKey(day)">
                <span v-if="day.getMonth() !== month.date.getMonth()" aria-hidden="true" />
                <button
                  v-else
                  type="button"
                  :class="{ today: localDayKey(day) === today, selected: localDayKey(day) === yearDayKey }"
                  :aria-label="t('{0}，{1} 个事件', [localDayKey(day), yearDayRecords(day).length])"
                  aria-haspopup="dialog"
                  :aria-expanded="localDayKey(day) === yearDayKey"
                  :aria-controls="localDayKey(day) === yearDayKey ? dayPopoverId : undefined"
                  @click="openYearDay(day, $event)"
                >
                  <span class="calendar-year-date">{{ day.getDate() }}</span>
                  <i v-if="yearDayRecords(day).length" class="calendar-year-event-dot" aria-hidden="true" />
                </button>
              </template>
            </div>
          </section>
        </div>
      </section>
    </div>

    <div v-else class="calendar-agenda-view">
      <p v-if="!agendaDates.length" class="calendar-agenda-empty">{{ t('本月没有日程') }}</p>
      <section v-for="day in agendaDates" :key="localDayKey(day)" class="calendar-agenda-day">
        <time class="calendar-agenda-date" :datetime="localDayKey(day)">
          {{ day.toLocaleDateString(uiLocale, { month: 'short', day: 'numeric' }) }}
        </time>
        <div class="calendar-agenda-events">
          <button
            v-for="record in dayRecords(day)"
            :key="planKey(record)"
            type="button"
            @click="emit('select-event', planKey(record))"
          >
            <time>{{ eventTime(record) }}</time>
            <span>{{ record.object.name }} <small>{{ planSourceLabel(record) }}</small></span>
          </button>
        </div>
      </section>
    </div>
    </div>
  </main>
  <CalendarDayPopover
    v-if="mode === 'year' && yearDay"
    :id="dayPopoverId"
    :date="yearDay.date"
    :anchor="yearDay.anchor"
    :records="yearDayRecords(yearDay.date)"
    @close="yearDay = undefined"
    @select-event="emit('select-event', $event)"
  />
</template>

<style scoped>
.calendar-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--paper);
}
.calendar-view-timeline { overflow-anchor: none; }
.calendar-view-month,
.calendar-view-year { overflow-anchor: none; }
.calendar-view-days,
.calendar-view-grid {
  display: grid;
  grid-template-columns: 64px repeat(var(--calendar-day-count), var(--calendar-day-width));
}
.calendar-view-days {
  position: sticky;
  top: 0;
  z-index: 2;
  grid-template-rows: 70px;
  min-height: 70px;
  align-items: center;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
}
.calendar-view-zone {
  position: sticky;
  left: 0;
  z-index: 3;
  align-self: stretch;
  display: flex;
  align-items: flex-end;
  padding: 0 0 10px 9px;
  background: var(--paper);
  font-size: 10px;
  color: var(--muted);
}
.calendar-view-day-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  color: var(--text-secondary);
}
.calendar-view-day-heading span { font-size: 12px; }
.calendar-view-day-heading strong {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border-radius: 50%;
  font-size: 18px;
  font-weight: 500;
}
.calendar-view-day-heading.today { color: var(--green); }
.calendar-view-date-label {
  position: sticky;
  left: 0;
  z-index: 3;
  align-self: stretch;
  padding: 10px 9px;
  border-top: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: 10px;
}
.calendar-view-date-events {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  gap: 4px;
  max-height: 104px;
  overflow: auto;
  padding: 6px 4px;
  border-top: 1px solid var(--line);
  border-left: 1px solid var(--line);
}
.calendar-view-date-event {
  flex-shrink: 0;
  padding: 4px 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-radius: 4px;
  background: var(--accent);
  color: var(--text);
  text-align: left;
  font-size: 11px;
}
.calendar-view-date-event:hover { background: var(--hover); }
.calendar-view-date-event:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.calendar-view-day-heading.today strong,
.calendar-month-date.today,
.calendar-year-days button.today > .calendar-year-date { color: white; background: var(--green-fill); }
.calendar-view-grid { height: 1344px; }
.calendar-view-hours { position: sticky; left: 0; z-index: 1; background: var(--paper); }
.calendar-view-hours span {
  position: absolute;
  right: 9px;
  transform: translateY(-8px);
  font-size: 11px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.calendar-view-day-column {
  position: relative;
  border-left: 1px solid var(--line);
  background: repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent 56px);
}
.calendar-view-event {
  position: absolute;
  z-index: 1;
  left: 3px;
  width: calc(100% - 6px);
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  overflow: hidden;
  padding: 4px 6px;
  border-left: 3px solid var(--green);
  border-radius: 4px;
  background: color-mix(in srgb, var(--green) 17%, var(--paper));
  color: var(--text);
  text-align: left;
  font-size: 11px;
}
.calendar-view-event:hover,
.calendar-view-event:focus-visible { background: color-mix(in srgb, var(--green) 27%, var(--paper)); }
.calendar-view-event strong,
.calendar-view-event span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-view-event strong { font-size: 12px; font-weight: 500; }
.calendar-view-point { flex-direction: row; align-items: center; gap: 5px; padding: 2px 4px 2px 13px; border-left: 0; background: transparent; }
.calendar-view-point::before { content: ''; position: absolute; left: 3px; width: 5px; height: 5px; border-radius: 50%; background: var(--green); }
.calendar-view-point span { color: var(--muted); }
.calendar-month-view { min-width: 630px; }
.calendar-month-weekdays,
.calendar-month-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.calendar-month-weekdays {
  position: sticky;
  top: 0;
  z-index: 2;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
}
.calendar-month-weekdays span {
  padding: 12px 8px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.calendar-month-cell {
  min-height: 100px;
  padding: 7px 6px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  overflow: hidden;
}
.calendar-month-cell.shaded { background: var(--surface); }
.calendar-month-date,
.calendar-year-days button {
  display: grid;
  place-items: center;
  width: 27px;
  height: 27px;
  border-radius: 50%;
  font-variant-numeric: tabular-nums;
}
.calendar-month-date { margin: 0 0 5px auto; font-size: 12px; }
.calendar-month-date.month-start { width: auto; min-width: 27px; padding: 0 5px; font-weight: 500; }
.calendar-month-date:hover,
.calendar-year-days button:hover { background: var(--hover); }
.calendar-month-event {
  display: block;
  width: 100%;
  overflow: hidden;
  margin-top: 3px;
  padding: 3px 5px;
  border-radius: 4px;
  background: var(--accent);
  color: var(--text);
  font-size: 11px;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.calendar-month-event:hover { background: var(--hover); }
.calendar-month-more { display: block; padding: 4px; color: var(--muted); font-size: 11px; }
.calendar-year-heading {
  max-width: 1200px;
  margin: 0 auto;
  padding: 22px 28px 0;
  color: var(--text);
  font-size: 16px;
  font-weight: 600;
}
.calendar-year-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
  gap: 28px 22px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 28px;
}
.calendar-year-month { min-width: 0; }
.calendar-year-month-title { margin-bottom: 11px; color: var(--text); font-size: 15px; font-weight: 600; }
.calendar-year-month-title:hover { color: var(--text); }
.calendar-year-weekdays,
.calendar-year-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; }
.calendar-year-weekdays span { padding-bottom: 4px; color: var(--muted); font-size: 10px; }
.calendar-year-days button,
.calendar-year-days > span { width: 28px; height: 28px; margin: auto; font-size: 11px; }
.calendar-year-days button { position: relative; padding: 0; }
.calendar-year-date { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; }
.calendar-year-event-dot {
  position: absolute;
  bottom: 1px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--green);
}
.calendar-year-days button.selected { color: var(--green); background: var(--accent); }
.calendar-year-days button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.calendar-agenda-view { max-width: 900px; margin: 0 auto; padding: 28px 32px; }
.calendar-agenda-empty { padding: 60px 0; color: var(--muted); text-align: center; }
.calendar-agenda-day { display: flex; gap: 24px; padding: 18px 0; border-bottom: 1px solid var(--line); line-height: 20px; }
.calendar-agenda-date { display: flex; align-items: center; width: 120px; flex-shrink: 0; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; white-space: nowrap; }
.calendar-agenda-events { flex: 1; min-width: 0; }
.calendar-agenda-events button { display: flex; align-items: center; gap: 20px; width: 100%; padding: 10px 12px; border-radius: 6px; color: var(--text); text-align: left; }
.calendar-agenda-events button:hover { background: var(--hover); }
.calendar-agenda-events time { width: 46px; flex-shrink: 0; color: var(--muted); font-size: 12px; }
@media (max-width: 700px) {
  .calendar-year-heading { padding: 18px 18px 0; }
  .calendar-year-grid { padding: 18px; }
  .calendar-agenda-view { padding: 18px; }
  .calendar-agenda-day { gap: 10px; }
  .calendar-agenda-date { width: 88px; }
}
</style>
