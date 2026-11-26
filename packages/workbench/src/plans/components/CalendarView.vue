<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();
const ResizeObserver = (window as Window & typeof globalThis).ResizeObserver;
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import LoadingSkeleton from '../../shell/components/LoadingSkeleton.vue';
import { t, uiLocale } from '../../i18n/i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId, watch } from 'vue';
import { CalendarDays, Circle, CircleCheck, Flag, FolderOpen, ListTodo, Plus, Search, X } from 'lucide-vue-next';
import { isPlanCompletionLocked, withPlanCompleted } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import {
  calendarDayEntries,
  calendarEvents,
  filterCalendarRecords,
  hasEventTime,
  isCheckableEvent,
  isEventCompleted,
  isEventOverdue,
  localDayKey,
  monthDays,
  planningEvents,
  shiftCalendarDate,
  visibleCalendarDays,
  weekDays,
} from '../calendar';
import type { CalendarDayEntry, CalendarFilter, CalendarViewMode } from '../calendar';
import {
  formatMinutesLabel,
  MIN_DURATION_MINUTES,
  minutesFromOffsetY,
  moveRecordToDay,
  moveRecordToSlot,
  PLAN_DRAG_MIME,
  planDateFromSlot,
  resizeRecordEnd,
  selectionRangeFromOffsets,
  snapMinutes,
} from '../calendar-interaction';
import { layoutDayTimedEvents } from '../timeline-layout';
import type { TimedEventBlock } from '../timeline-layout';
import type { ObjectRecord } from '../../objects/workspace-objects';
import { usePlanStore } from '../../stores/plans';
import type { PlanScope } from '../../stores/plans';
import { planKey, planSourceLabel, sourcePlanKey } from '../personal-plans';
import { expandRecurringPlans, isVirtualOccurrence } from '../recurrence';
import { writePlanDate } from '../plan-date';
import type { PlanDateValue } from '../plan-date';
import PlanDateField from './PlanDateField.vue';
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
const filter = ref<CalendarFilter>({ kind: 'all', showCompleted: true, query: '' });
const pending = ref<string[]>([]);
const interactionError = ref('');
const nowMinutes = ref(currentMinutes());
let nowTimer: ReturnType<typeof setInterval> | undefined;

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

const rawPlanned = computed(() => planningEvents(props.records ?? plans.records));
const visibleWindow = computed<[Date, Date]>(() => {
  if (timeline.value && timelineDays.value.length) {
    return [timelineDays.value[0]!, timelineDays.value.at(-1)!];
  }
  if (props.mode === 'month' && scrollingWeeks.value.length) {
    const last = scrollingWeeks.value.at(-1)!;
    return [scrollingWeeks.value[0]!, new Date(last.getFullYear(), last.getMonth(), last.getDate() + 6)];
  }
  if (props.mode === 'year' && scrollingYears.value.length) {
    return [new Date(scrollingYears.value[0]!, 0, 1), new Date(scrollingYears.value.at(-1)!, 11, 31)];
  }
  return [
    new Date(props.date.getFullYear(), props.date.getMonth(), 1),
    new Date(props.date.getFullYear(), props.date.getMonth() + 1, 0),
  ];
});
const expandedPlanned = computed(() =>
  expandRecurringPlans(rawPlanned.value, visibleWindow.value[0], visibleWindow.value[1]),
);
const planned = computed(() => filterCalendarRecords(expandedPlanned.value, filter.value));
const events = computed(() => calendarEvents(planned.value));

const canCreateWorkspace = computed(() => Boolean(plans.workspaceWritable));
const canCreatePersonal = computed(() => Boolean(plans.personalWritable));
const canCreate = computed(
  () => typeof plans.create === 'function' && (canCreateWorkspace.value || canCreatePersonal.value),
);

const bannerEntries = (day: Date) =>
  calendarDayEntries(planned.value, day).filter((entry) => entry.kind !== 'timed');
const hasVisibleBanner = computed(() =>
  visibleCalendarDays(props.date, props.mode).some((day) => bannerEntries(day).length > 0),
);
// The all-day row is shared by every rendered day, including the buffered
// days off screen. Size it from the days in view so a busy day two weeks away
// does not leave a tall empty band; busier cells scroll inside themselves.
const BANNER_ITEM_HEIGHT = 22;
const BANNER_GAP = 3;
const bannerRowHeight = computed(() => {
  const most = Math.max(0, ...visibleCalendarDays(props.date, props.mode).map((day) => bannerEntries(day).length));
  // Show half of a fourth row so an overflowing cell reads as scrollable.
  const rows = Math.min(3.5, Math.max(1, most));
  return Math.round(12 + rows * BANNER_ITEM_HEIGHT + Math.max(0, Math.ceil(rows) - 1) * BANNER_GAP);
});
const dayPopover = shallowRef<{ date: Date; anchor: HTMLElement; scrollTop: number; scrollLeft: number }>();
const dayPopoverId = useId();
const dayPopoverKey = computed(() => dayPopover.value && localDayKey(dayPopover.value.date));
const dayPopoverEntries = (day: Date) => calendarDayEntries(planned.value, day);

function openDayPopover(day: Date, event: MouseEvent) {
  dayPopover.value = dayPopoverKey.value === localDayKey(day)
    ? undefined
    : {
        date: day,
        anchor: event.currentTarget as HTMLElement,
        scrollTop: scroll.value?.scrollTop ?? 0,
        scrollLeft: scroll.value?.scrollLeft ?? 0,
      };
}

function canEditRecord(record: ObjectRecord) {
  if (isVirtualOccurrence(record)) return false;
  return typeof plans.canEdit === 'function' ? plans.canEdit(record) : false;
}
function canDragRecord(record: ObjectRecord) {
  return (
    canEditRecord(record) &&
    typeof plans.update === 'function' &&
    !pending.value.includes(planKey(record))
  );
}
function canToggleComplete(record: ObjectRecord) {
  return (
    isCheckableEvent(record) &&
    !isPlanCompletionLocked(record.object) &&
    canEditRecord(record) &&
    typeof plans.update === 'function' &&
    !pending.value.includes(planKey(record))
  );
}
async function updateRecordObject(record: ObjectRecord, next: WorkspaceObject) {
  const key = planKey(record);
  if (!canEditRecord(record) || typeof plans.update !== 'function' || pending.value.includes(key)) return;
  pending.value.push(key);
  interactionError.value = '';
  try {
    await plans.update(record, next);
  } catch (reason) {
    interactionError.value = String(reason);
  } finally {
    pending.value = pending.value.filter((id) => id !== key);
  }
}
function toggleComplete(record: ObjectRecord) {
  if (!canToggleComplete(record)) return;
  return updateRecordObject(record, withPlanCompleted(record.object, !isEventCompleted(record)));
}

// --- Direct Manipulation: Quick-Create Dialog ---
interface QuickCreateDraft {
  name: string;
  checkable: boolean;
  planDate: PlanDateValue;
  scope: PlanScope;
}
const createDraft = ref<QuickCreateDraft>();
const createSaving = ref(false);
const createError = ref('');
const createNameInput = ref<HTMLInputElement>();
const createScopeId = useId();

async function openQuickCreate(planDate: PlanDateValue, checkable = false) {
  if (!canCreate.value || createSaving.value) return;
  const preferred: PlanScope = plans.defaultScope === 'personal' ? 'personal' : 'workspace';
  const scope: PlanScope =
    preferred === 'personal'
      ? (canCreatePersonal.value ? 'personal' : 'workspace')
      : (canCreateWorkspace.value ? 'workspace' : 'personal');
  createError.value = '';
  createDraft.value = { name: '', checkable, planDate, scope };
  await nextTick();
  createNameInput.value?.focus();
}
function closeQuickCreate() {
  if (createSaving.value) return;
  createDraft.value = undefined;
  createError.value = '';
}
async function submitQuickCreate() {
  const draft = createDraft.value;
  if (!draft || createSaving.value || !draft.name.trim() || typeof plans.create !== 'function') return;
  createSaving.value = true;
  createError.value = '';
  try {
    const properties = writePlanDate({ checkable: draft.checkable, completed: false }, draft.planDate);
    await plans.create(
      {
        type: 'event',
        name: draft.name.trim(),
        description: '',
        archived: false,
        properties,
      },
      draft.scope,
      plans.workspaceId,
    );
    createDraft.value = undefined;
  } catch (reason) {
    createError.value = String(reason);
  } finally {
    createSaving.value = false;
  }
}

// --- Direct Manipulation: Timeline Slot Selection (Click / Drag-to-Create) ---
interface SlotSelection {
  day: Date;
  dayKey: string;
  anchorY: number;
  currentY: number;
  column: HTMLElement;
}
const slotSelect = ref<SlotSelection>();
const slotPreview = computed(() => {
  if (!slotSelect.value) return undefined;
  const range = selectionRangeFromOffsets(slotSelect.value.anchorY, slotSelect.value.currentY, hourHeight);
  return {
    dayKey: slotSelect.value.dayKey,
    top: (range.startMinutes / 60) * hourHeight,
    height: Math.max(22, ((range.endMinutes - range.startMinutes) / 60) * hourHeight),
    label: `${formatMinutesLabel(range.startMinutes)} – ${formatMinutesLabel(range.endMinutes)}`,
    ...range,
  };
});

function startSlotSelection(day: Date, event: PointerEvent) {
  if (event.button !== 0 || !canCreate.value || event.target !== event.currentTarget || resizing.value) return;
  const column = event.currentTarget as HTMLElement;
  const rect = column.getBoundingClientRect();
  const y = Math.max(0, Math.min(rect.height || 24 * hourHeight, event.clientY - rect.top));
  slotSelect.value = { day, dayKey: localDayKey(day), anchorY: y, currentY: y, column };
  window.addEventListener('pointermove', moveSlotSelection);
  window.addEventListener('pointerup', endSlotSelection);
  window.addEventListener('pointercancel', cancelSlotSelection);
}
function moveSlotSelection(event: PointerEvent) {
  if (!slotSelect.value) return;
  const rect = slotSelect.value.column.getBoundingClientRect();
  slotSelect.value.currentY = Math.max(0, Math.min(rect.height || 24 * hourHeight, event.clientY - rect.top));
}
function cleanupSlotListeners() {
  window.removeEventListener('pointermove', moveSlotSelection);
  window.removeEventListener('pointerup', endSlotSelection);
  window.removeEventListener('pointercancel', cancelSlotSelection);
}
function cancelSlotSelection() {
  cleanupSlotListeners();
  slotSelect.value = undefined;
}
function endSlotSelection() {
  const current = slotSelect.value;
  const preview = slotPreview.value;
  cleanupSlotListeners();
  slotSelect.value = undefined;
  if (!current || !preview) return;
  void openQuickCreate(planDateFromSlot(current.day, preview.startMinutes, preview.endMinutes), false);
}

// --- Direct Manipulation: Bottom-Edge Resize ---
interface ResizeState {
  record: ObjectRecord;
  key: string;
  day: Date;
  dayKey: string;
  startY: number;
  startMinutes: number;
  initialEndMinutes: number;
  previewEndMinutes: number;
}
const resizing = ref<ResizeState>();

function startResize(item: TimedEventBlock, day: Date, event: PointerEvent) {
  if (event.button !== 0 || !canDragRecord(item.record) || item.point) return;
  const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const startMinutes = Math.max(0, Math.round((item.visibleStart - dayStart) / 60_000));
  const initialEndMinutes = Math.max(startMinutes + MIN_DURATION_MINUTES, Math.round((item.visibleEnd - dayStart) / 60_000));
  resizing.value = {
    record: item.record,
    key: planKey(item.record),
    day,
    dayKey: localDayKey(day),
    startY: event.clientY,
    startMinutes,
    initialEndMinutes,
    previewEndMinutes: initialEndMinutes,
  };
  window.addEventListener('pointermove', moveResize);
  window.addEventListener('pointerup', endResize);
  window.addEventListener('pointercancel', cancelResize);
}
function moveResize(event: PointerEvent) {
  if (!resizing.value) return;
  const deltaMinutes = ((event.clientY - resizing.value.startY) / hourHeight) * 60;
  resizing.value.previewEndMinutes = Math.max(
    resizing.value.startMinutes + MIN_DURATION_MINUTES,
    Math.min(24 * 60, snapMinutes(resizing.value.initialEndMinutes + deltaMinutes)),
  );
}
function cleanupResizeListeners() {
  window.removeEventListener('pointermove', moveResize);
  window.removeEventListener('pointerup', endResize);
  window.removeEventListener('pointercancel', cancelResize);
}
function cancelResize() {
  cleanupResizeListeners();
  resizing.value = undefined;
}
function endResize() {
  const state = resizing.value;
  cleanupResizeListeners();
  resizing.value = undefined;
  if (!state || state.previewEndMinutes === state.initialEndMinutes) return;
  const next = resizeRecordEnd(state.record.object, state.day, state.previewEndMinutes);
  void updateRecordObject(state.record, next);
}

// --- Direct Manipulation: Drag Move & Sidebar Drop Timeblocking ---
const draggingKey = ref<string>();
const dropTarget = ref<{ zone: 'timeline' | 'day'; dayKey: string; minutes?: number }>();

function allEditablePool(): readonly ObjectRecord[] {
  const fromStore = typeof plans.recordsFor === 'function' ? plans.recordsFor('all') : [];
  if (fromStore.length) return fromStore;
  return props.records ?? plans.records;
}
function resolveDraggedRecord(event: DragEvent): ObjectRecord | undefined {
  const key = event.dataTransfer?.getData(PLAN_DRAG_MIME) || draggingKey.value;
  if (!key) return undefined;
  return allEditablePool().find((record) => planKey(record) === key);
}
function hasPlanDrag(event: DragEvent) {
  const types = event.dataTransfer?.types;
  return Boolean(draggingKey.value || (types && [...types].includes(PLAN_DRAG_MIME)));
}
function onEventDragStart(record: ObjectRecord, event: DragEvent) {
  if (!canDragRecord(record) || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  const key = planKey(record);
  draggingKey.value = key;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData(PLAN_DRAG_MIME, key);
  event.dataTransfer.setData('text/plain', record.object.name);
}
function onEventDragEnd() {
  draggingKey.value = undefined;
  dropTarget.value = undefined;
}
function onTimelineDragOver(day: Date, event: DragEvent) {
  if (!hasPlanDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const minutes = minutesFromOffsetY(event.clientY - rect.top, hourHeight);
  dropTarget.value = { zone: 'timeline', dayKey: localDayKey(day), minutes };
}
function onTimelineDrop(day: Date, event: DragEvent) {
  const record = resolveDraggedRecord(event);
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const minutes = minutesFromOffsetY(event.clientY - rect.top, hourHeight);
  draggingKey.value = undefined;
  dropTarget.value = undefined;
  if (!record || !canDragRecord(record)) return;
  const next = moveRecordToSlot(record.object, day, minutes);
  void updateRecordObject(record, next);
}
function onDayDragOver(day: Date, event: DragEvent) {
  if (!hasPlanDrag(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
  dropTarget.value = { zone: 'day', dayKey: localDayKey(day) };
}
function onDayDrop(day: Date, event: DragEvent) {
  const record = resolveDraggedRecord(event);
  draggingKey.value = undefined;
  dropTarget.value = undefined;
  if (!record || !canDragRecord(record)) return;
  const next = moveRecordToDay(record.object, day);
  void updateRecordObject(record, next);
}
function onDragLeave(event: DragEvent) {
  const related = event.relatedTarget as Node | null;
  if (!related || !(event.currentTarget as HTMLElement).contains(related)) {
    dropTarget.value = undefined;
  }
}

function itemClasses(record: ObjectRecord, kind?: CalendarDayEntry['kind']) {
  const checkable = isCheckableEvent(record);
  const completed = isEventCompleted(record);
  const overdue = isEventOverdue(record, today.value);
  return {
    'is-task': checkable,
    'is-schedule': !checkable,
    'is-completed': completed,
    'is-overdue': overdue,
    'is-due': kind === 'due',
    'is-timed': kind === 'timed',
    'is-personal': record.source?.scope === 'personal',
    'is-synced': !!record.object.properties.syncConnection,
    'is-draggable': kind !== 'due' && canDragRecord(record),
    'is-dragging': draggingKey.value === planKey(record),
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
    .filter((day) => dayEntries(day).length > 0);
});
const weekdays = computed(() => uiLocale.value === 'zh-CN' ? ['一', '二', '三', '四', '五', '六', '日']
  : Array.from({ length: 7 }, (_, index) => new Intl.DateTimeFormat(uiLocale.value, { weekday: 'short' }).format(new Date(2024, 0, 1 + index))));
const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourHeight = 56;
const today = computed(() => localDayKey(new Date()));
const nowLineTop = computed(() => `${(nowMinutes.value / 60) * hourHeight}px`);
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
  // Month navigation lands on the week holding the 1st, so the whole month is
  // in view and the dominant-month check in onMonthScroll agrees with it.
  const monthStart = new Date(date.getFullYear(), date.getMonth(), 1);
  const key = weekKey(weekDays(monthStart)[0]!);
  if (!scrollingWeeks.value.some(week => weekKey(week) === key)) fillWeeks(monthStart);
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
  // The month in view is the one with the most on-screen day area. A week that
  // straddles two months no longer decides it on its own.
  const bounds = container.getBoundingClientRect();
  const viewTop = bounds.top + (container.querySelector<HTMLElement>('.calendar-month-weekdays')?.offsetHeight ?? 0);
  const area = new Map<string, { month: Date; size: number }>();
  for (const row of container.querySelectorAll<HTMLElement>('.calendar-month-week')) {
    const rect = row.getBoundingClientRect();
    const size = Math.min(rect.bottom, bounds.bottom) - Math.max(rect.top, viewTop);
    if (size <= 0) continue;
    const week = scrollingWeeks.value.find(item => weekKey(item) === row.dataset.week);
    if (!week) continue;
    for (const day of weekDays(week)) {
      const key = monthKey(day);
      const entry = area.get(key) ?? { month: day, size: 0 };
      entry.size += size;
      area.set(key, entry);
    }
  }
  // A little hysteresis keeps the label from flickering when two months
  // share the screen almost evenly.
  let visibleMonth: Date | undefined;
  let best = (area.get(monthKey(props.date))?.size ?? 0) * 1.15;
  for (const { month, size } of area.values())
    if (size > best) { best = size; visibleMonth = month; }
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
  if (dayPopover.value && scroll.value && (
    dayPopover.value.scrollTop !== scroll.value.scrollTop || dayPopover.value.scrollLeft !== scroll.value.scrollLeft
  )) dayPopover.value = undefined;
  if (timeline.value) onTimelineScroll();
  else if (props.mode === 'month') onMonthScroll();
  else if (props.mode === 'year') onYearScroll();
}

// Alternate months get a faint fill. Keep it clearly lighter than the sidebar
// (--sidebar) so the first column never reads as part of it.
function monthShade(day: Date) {
  return (day.getFullYear() * 12 + day.getMonth()) % 2 === 1;
}

function dayEntries(day: Date) {
  return calendarDayEntries(planned.value, day);
}
function clockLabel(value: unknown) {
  return new Date(String(value)).toLocaleTimeString(uiLocale.value, { hour: '2-digit', minute: '2-digit', hour12: false });
}
function timedEvents(day: Date) {
  return layoutDayTimedEvents(events.value, day, hourHeight).map((block) => {
    const { start, end } = block.record.object.properties;
    const time = entryTime({ record: block.record, kind: 'timed' });
    return {
      ...block,
      time: block.point || !end || Date.parse(String(end)) === Date.parse(String(start))
        ? time
        : `${time} – ${clockLabel(end)}`,
      // Short blocks put the time beside the title instead of below it.
      compact: !block.point && block.height < 44,
    };
  });
}
function timedEventStyle(item: TimedEventBlock, day: Date) {
  const widthPct = 100 / item.columnCount;
  const leftPct = item.column * widthPct;
  let height = item.height;
  if (resizing.value && resizing.value.key === planKey(item.record) && resizing.value.dayKey === localDayKey(day)) {
    height = Math.max(22, ((resizing.value.previewEndMinutes - resizing.value.startMinutes) / 60) * hourHeight);
  }
  return {
    top: `${item.top}px`,
    height: `${height}px`,
    left: `calc(${leftPct}% + 2px)`,
    width: `calc(${widthPct}% - 4px)`,
  };
}
function entryTime(entry: CalendarDayEntry) {
  if (entry.kind === 'due') return t('截止');
  const { record } = entry;
  if (record.object.properties.allDay === true) return t('全天');
  if (!hasEventTime(record)) return t('仅日期');
  return new Date(String(record.object.properties.start)).toLocaleTimeString(uiLocale.value, {
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}
function entryTooltip(entry: CalendarDayEntry, time = entryTime(entry)) {
  const suffix = isEventOverdue(entry.record, today.value)
    ? ` · ${t('逾期')}`
    : isEventCompleted(entry.record)
      ? t(' · 已完成')
      : '';
  return `${entry.record.object.name} · ${time} · ${planSourceLabel(entry.record)}${suffix}`;
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
  nowTimer = setInterval(() => { nowMinutes.value = currentMinutes(); }, 60_000);
  if (scroll.value && typeof ResizeObserver !== 'undefined') {
    timelineResizeObserver = new ResizeObserver(() => { void resizeTimeline(); });
    timelineResizeObserver.observe(scroll.value);
  }
});
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
  cleanupSlotListeners();
  cleanupResizeListeners();
  timelineResizeObserver?.disconnect();
});
watch(() => props.mode, () => {
  dayPopover.value = undefined;
  void positionTimeline();
});
watch(() => props.date, (date) => {
  dayPopover.value = undefined;
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
  <div class="calendar-shell">
    <div class="calendar-filter-bar" role="region" :aria-label="t('日历筛选')">
      <div class="calendar-filter-kinds" role="group" :aria-label="t('筛选')">
        <button
          v-for="option in ([
            { value: 'all', label: t('全部') },
            { value: 'task', label: t('任务') },
            { value: 'event', label: t('日程') },
          ] as const)"
          :key="option.value"
          type="button"
          :aria-pressed="filter.kind === option.value"
          @click="filter.kind = option.value"
        >{{ option.label }}</button>
      </div>
      <label class="calendar-filter-completed">
        <input v-model="filter.showCompleted" type="checkbox" />
        <span>{{ t('显示已完成') }}</span>
      </label>
      <label class="calendar-filter-search">
        <Search :size="13" aria-hidden="true" />
        <input
          v-model="filter.query"
          type="search"
          :aria-label="t('搜索事项…')"
          :placeholder="t('搜索事项…')"
          maxlength="100"
        />
      </label>
    </div>
    <p v-if="interactionError" class="calendar-error-banner" role="alert">
      <span>{{ interactionError }}</span>
      <button type="button" :aria-label="t('关闭')" @click="interactionError = ''"><X :size="14" /></button>
    </p>
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
        <div
          class="calendar-view-days"
          :class="{ 'has-banner': hasVisibleBanner || draggingKey }"
          :style="{ '--calendar-banner-height': `${bannerRowHeight}px` }"
        >
          <span class="calendar-view-zone">GMT{{ -new Date().getTimezoneOffset() / 60 >= 0 ? '+' : '' }}{{ -new Date().getTimezoneOffset() / 60 }}</span>
          <div
            v-for="day in timelineDays"
            :key="localDayKey(day)"
            class="calendar-view-day-heading"
            :class="{ today: localDayKey(day) === today }"
          >
            <span>{{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ weekday(day) }}</span>
            <strong>{{ day.getDate() }}</strong>
          </div>
          <template v-if="hasVisibleBanner || draggingKey">
            <span class="calendar-view-date-label">{{ t('全天') }}</span>
            <div
              v-for="day in timelineDays"
              :key="`date-${localDayKey(day)}`"
              class="calendar-view-date-events"
              :class="{ 'is-drop-target': dropTarget?.zone === 'day' && dropTarget.dayKey === localDayKey(day) }"
              :data-day="localDayKey(day)"
              @dragover="onDayDragOver(day, $event)"
              @dragleave="onDragLeave"
              @drop.prevent="onDayDrop(day, $event)"
            >
              <div
                v-for="entry in bannerEntries(day)"
                :key="`${planKey(entry.record)}:${entry.kind}`"
                class="calendar-view-date-event"
                :class="itemClasses(entry.record, entry.kind)"
                :draggable="entry.kind !== 'due' && canDragRecord(entry.record)"
                :data-tooltip="entryTooltip(entry)"
                @dragstart="onEventDragStart(entry.record, $event)"
                @dragend="onEventDragEnd"
              >
                <button
                  v-if="isCheckableEvent(entry.record)"
                  type="button"
                  class="calendar-inline-check"
                  :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
                  :disabled="!canToggleComplete(entry.record)"
                  @click.stop="toggleComplete(entry.record)"
                >
                  <CircleCheck v-if="isEventCompleted(entry.record)" :size="12" aria-hidden="true" />
                  <Circle v-else :size="12" aria-hidden="true" />
                </button>
                <Flag v-if="entry.kind === 'due'" :size="11" class="calendar-due-flag" aria-hidden="true" />
                <button
                  type="button"
                  class="calendar-item-trigger"
                  @click="emit('select-event', sourcePlanKey(entry.record))"
                >{{ entry.record.object.name }}</button>
              </div>
            </div>
          </template>
        </div>
        <div class="calendar-view-grid">
          <div class="calendar-view-hours" aria-hidden="true">
            <span v-for="hour in hours" :key="hour" :style="{ top: `${hour * hourHeight}px` }">{{ String(hour).padStart(2, '0') }}:00</span>
          </div>
          <div
            v-for="day in timelineDays"
            :key="localDayKey(day)"
            class="calendar-view-day-column"
            :class="{ 'is-creatable': canCreate, 'is-today': localDayKey(day) === today }"
            :data-day="localDayKey(day)"
            @pointerdown="startSlotSelection(day, $event)"
            @dragover="onTimelineDragOver(day, $event)"
            @dragleave="onDragLeave"
            @drop.prevent="onTimelineDrop(day, $event)"
          >
            <div v-if="localDayKey(day) === today" class="calendar-now-line" :style="{ top: nowLineTop }" aria-hidden="true" />
            <div
              v-if="slotPreview && slotPreview.dayKey === localDayKey(day)"
              class="calendar-slot-preview"
              :style="{ top: `${slotPreview.top}px`, height: `${slotPreview.height}px` }"
              aria-hidden="true"
            >{{ slotPreview.label }}</div>
            <div
              v-if="dropTarget?.zone === 'timeline' && dropTarget.dayKey === localDayKey(day) && dropTarget.minutes !== undefined"
              class="calendar-drop-indicator"
              :style="{ top: `${(dropTarget.minutes / 60) * hourHeight}px` }"
              aria-hidden="true"
            ><span>{{ formatMinutesLabel(dropTarget.minutes) }}</span></div>
            <div
              v-for="item in timedEvents(day)"
              :key="planKey(item.record)"
              class="calendar-view-event"
              :class="[
                { 'calendar-view-point': item.point, 'is-compact': item.compact, 'is-resizing': resizing?.key === planKey(item.record) },
                itemClasses(item.record, 'timed'),
              ]"
              :style="timedEventStyle(item, day)"
              :draggable="canDragRecord(item.record) && !resizing"
              :data-tooltip="entryTooltip({ record: item.record, kind: 'timed' }, item.time)"
              @dragstart="onEventDragStart(item.record, $event)"
              @dragend="onEventDragEnd"
            >
              <button
                v-if="isCheckableEvent(item.record)"
                type="button"
                class="calendar-inline-check"
                :aria-label="`${isEventCompleted(item.record) ? t('标记未完成') : t('完成')}：${item.record.object.name}`"
                :disabled="!canToggleComplete(item.record)"
                @click.stop="toggleComplete(item.record)"
              >
                <CircleCheck v-if="isEventCompleted(item.record)" :size="12" aria-hidden="true" />
                <Circle v-else :size="12" aria-hidden="true" />
              </button>
              <button
                type="button"
                class="calendar-view-event-body"
                @click="emit('select-event', sourcePlanKey(item.record))"
              >
                <strong>{{ item.record.object.name }}</strong>
                <span>{{ item.time }}</span>
              </button>
              <div
                v-if="!item.point && canDragRecord(item.record)"
                class="calendar-event-resize-handle"
                role="separator"
                :aria-label="t('调整时长')"
                @pointerdown.stop.prevent="startResize(item, day, $event)"
              />
            </div>
          </div>
        </div>
      </div>

      <div v-else-if="mode === 'month'" class="calendar-month-view">
        <div class="calendar-month-weekdays" aria-hidden="true">
          <span v-for="name in weekdays" :key="name">{{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ name }}</span>
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
            :class="{
              shaded: monthShade(day),
              'is-drop-target': dropTarget?.zone === 'day' && dropTarget.dayKey === localDayKey(day),
            }"
            :data-day="localDayKey(day)"
            @dblclick.self="openQuickCreate({ date: localDayKey(day), time: '', end: '' }, false)"
            @dragover="onDayDragOver(day, $event)"
            @dragleave="onDragLeave"
            @drop.prevent="onDayDrop(day, $event)"
          >
            <div class="calendar-month-cell-header">
              <button
                v-if="canCreate"
                type="button"
                class="calendar-month-add"
                :aria-label="t('为 {0} 添加事件', [localDayKey(day)])"
                @click.stop="openQuickCreate({ date: localDayKey(day), time: '', end: '' }, false)"
              ><Plus :size="12" aria-hidden="true" /></button>
              <button
                type="button"
                class="calendar-month-date"
                :class="{ today: localDayKey(day) === today, 'month-start': day.getDate() === 1 }"
                :aria-label="t('{0}，查看日视图', [localDayKey(day)])"
                @click="emit('select-date', day)"
              >{{ day.getDate() === 1 ? t('{0} 月 1 日', [day.getMonth() + 1]) : day.getDate() }}</button>
            </div>
            <div
              v-for="entry in dayEntries(day).slice(0, 3)"
              :key="`${planKey(entry.record)}:${entry.kind}`"
              class="calendar-month-event"
              :class="itemClasses(entry.record, entry.kind)"
              :draggable="entry.kind !== 'due' && canDragRecord(entry.record)"
              :data-tooltip="entryTooltip(entry)"
              @dragstart="onEventDragStart(entry.record, $event)"
              @dragend="onEventDragEnd"
            >
              <button
                v-if="isCheckableEvent(entry.record)"
                type="button"
                class="calendar-inline-check"
                :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
                :disabled="!canToggleComplete(entry.record)"
                @click.stop="toggleComplete(entry.record)"
              >
                <CircleCheck v-if="isEventCompleted(entry.record)" :size="11" aria-hidden="true" />
                <Circle v-else :size="11" aria-hidden="true" />
              </button>
              <Flag v-if="entry.kind === 'due'" :size="10" class="calendar-due-flag" aria-hidden="true" />
              <button
                type="button"
                class="calendar-item-trigger"
                @click="emit('select-event', sourcePlanKey(entry.record))"
              ><time v-if="entry.kind === 'timed'" class="calendar-item-time">{{ entryTime(entry) }}</time>{{ entry.record.object.name }}</button>
            </div>
            <button
              v-if="dayEntries(day).length > 3"
              type="button"
              class="calendar-month-more"
              aria-haspopup="dialog"
              :aria-expanded="localDayKey(day) === dayPopoverKey"
              :aria-controls="localDayKey(day) === dayPopoverKey ? dayPopoverId : undefined"
              @click="openDayPopover(day, $event)"
            >{{ t('另有 {0} 项', [dayEntries(day).length - 3]) }}</button>
          </div>
        </div>
      </div>

      <div v-else-if="mode === 'year'" class="calendar-year-view">
        <section v-for="year in scrollingYears" :key="year" class="calendar-year-section" :data-year="year">
          <h2 class="calendar-year-heading">{{ new Date(year, 0, 1).toLocaleDateString(uiLocale, { year: 'numeric' }) }}</h2>
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
                    :class="{ today: localDayKey(day) === today, selected: localDayKey(day) === dayPopoverKey }"
                    :aria-label="t('{0}，{1} 个事件', [localDayKey(day), dayPopoverEntries(day).length])"
                    aria-haspopup="dialog"
                    :aria-expanded="localDayKey(day) === dayPopoverKey"
                    :aria-controls="localDayKey(day) === dayPopoverKey ? dayPopoverId : undefined"
                    @click="openDayPopover(day, $event)"
                  >
                    <span class="calendar-year-date">{{ day.getDate() }}</span>
                    <i v-if="dayPopoverEntries(day).length" class="calendar-year-event-dot" aria-hidden="true" />
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
          <time
            class="calendar-agenda-date"
            :class="{ today: localDayKey(day) === today }"
            :datetime="localDayKey(day)"
            :aria-label="day.toLocaleDateString(uiLocale, { month: 'short', day: 'numeric', weekday: 'long' })"
          >
            <strong>{{ day.getDate() }}</strong>
            <span>{{ day.toLocaleDateString(uiLocale, { month: 'short' }) }} · {{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ weekday(day) }}</span>
          </time>
          <div class="calendar-agenda-events">
            <div
              v-for="entry in dayEntries(day)"
              :key="`${planKey(entry.record)}:${entry.kind}`"
              class="calendar-agenda-row"
              :class="itemClasses(entry.record, entry.kind)"
            >
              <button
                v-if="isCheckableEvent(entry.record)"
                type="button"
                class="calendar-inline-check"
                :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
                :disabled="!canToggleComplete(entry.record)"
                @click.stop="toggleComplete(entry.record)"
              >
                <CircleCheck v-if="isEventCompleted(entry.record)" :size="15" aria-hidden="true" />
                <Circle v-else :size="15" aria-hidden="true" />
              </button>
              <span v-else class="calendar-agenda-marker" aria-hidden="true" />
              <button
                type="button"
                class="calendar-agenda-item"
                @click="emit('select-event', sourcePlanKey(entry.record))"
              >
                <time>{{ entryTime(entry) }}</time>
                <span>
                  <Flag v-if="entry.kind === 'due'" :size="12" class="calendar-due-flag" aria-hidden="true" />
                  {{ entry.record.object.name }}
                  <small>{{ planSourceLabel(entry.record) }}<template v-if="isEventOverdue(entry.record, today)"> · {{ t('逾期') }}</template></small>
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>
      </div>
    </main>
  </div>
  <Teleport :to="document.body">
    <div
      v-if="createDraft"
      v-surface-motion="'CalendarView:create'"
      class="calendar-create-backdrop"
      @mousedown.self="closeQuickCreate"
    >
      <section
        class="calendar-create-dialog"
        role="dialog"
        aria-modal="true"
        :aria-label="t('新建事件')"
        @keydown.esc.stop.prevent="closeQuickCreate"
      >
        <header>
          <h2>{{ t('新建事件') }}</h2>
          <button type="button" class="calendar-create-close" :aria-label="t('关闭')" :disabled="createSaving" @click="closeQuickCreate"><X :size="16" /></button>
        </header>
        <form @submit.prevent="submitQuickCreate">
          <input
            ref="createNameInput"
            v-model="createDraft.name"
            class="calendar-create-title"
            :aria-label="t('事件名称')"
            :placeholder="t('记下一件事…')"
            autocomplete="off"
            required
            maxlength="200"
            :disabled="createSaving"
          />
          <div class="calendar-create-properties">
            <div class="calendar-create-row calendar-create-time">
              <span class="calendar-create-label"><CalendarDays :size="15" aria-hidden="true" />{{ t('时间安排') }}</span>
              <PlanDateField
                v-model="createDraft.planDate"
                :default-date="localDayKey(date)"
                :required="!createDraft.checkable"
                :disabled="createSaving"
                compact
              />
            </div>
            <div class="calendar-create-row">
              <span class="calendar-create-label"><ListTodo :size="15" aria-hidden="true" />{{ t('类型') }}</span>
              <label class="calendar-create-checkable">
                <input v-model="createDraft.checkable" type="checkbox" :disabled="createSaving" />
                <span>{{ t('需要完成') }}</span>
              </label>
            </div>
            <div class="calendar-create-row">
              <label class="calendar-create-label" :for="createScopeId"><FolderOpen :size="15" aria-hidden="true" />{{ t('保存到') }}</label>
              <select :id="createScopeId" v-model="createDraft.scope" class="calendar-create-scope" :disabled="createSaving">
                <option value="workspace" :disabled="!canCreateWorkspace">{{ t('工作区') }}</option>
                <option value="personal" :disabled="!canCreatePersonal">{{ t('个人') }}</option>
              </select>
            </div>
          </div>
          <p v-if="createError" class="calendar-create-error" role="alert">{{ createError }}</p>
          <footer>
            <button type="button" :disabled="createSaving" @click="closeQuickCreate">{{ t('取消') }}</button>
            <button type="submit" class="calendar-create-submit" :disabled="createSaving || !createDraft.name.trim()">
              {{ createSaving ? t('保存中…') : t('创建') }}
            </button>
          </footer>
        </form>
      </section>
    </div>
  </Teleport>
  <CalendarDayPopover
    v-if="(mode === 'year' || mode === 'month') && dayPopover"
    :id="dayPopoverId"
    :date="dayPopover.date"
    :anchor="dayPopover.anchor"
    :records="dayPopoverEntries(dayPopover.date).map(entry => entry.record)"
    :entries="dayPopoverEntries(dayPopover.date)"
    :can-edit="canEditRecord"
    :pending="pending"
    @close="dayPopover = undefined"
    @select-event="emit('select-event', $event)"
    @toggle-complete="toggleComplete"
  />
</template>

<style scoped>
/* ---- Calendar palette -----------------------------------------------------
   Items read their colour from --tone: workspace items use the product ink,
   personal items a quiet blue, deadlines amber, overdue the danger colour.
   Fills and seams are mixed from the tone so every theme stays consistent. */
.calendar-shell {
  --cal-ink: var(--text);
  --cal-personal: #3d6cc9;
  --cal-due: #b7791f;
  --cal-overdue: var(--danger, #c24141);
  --cal-radius: 6px;
  --cal-today: color-mix(in srgb, var(--text) 2.5%, transparent);
  --cal-lift: 0 1px 2px rgb(15 15 15 / 0.06), 0 6px 16px -6px rgb(15 15 15 / 0.18);
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: var(--paper);
}
:root[data-theme='dark'] .calendar-shell {
  --cal-personal: #86a6ea;
  --cal-due: #d9b26a;
  --cal-today: color-mix(in srgb, var(--text) 3.5%, transparent);
  --cal-lift: 0 1px 2px rgb(0 0 0 / 0.3), 0 8px 20px -6px rgb(0 0 0 / 0.55);
}
:where(.calendar-view-event, .calendar-view-date-event, .calendar-month-event, .calendar-agenda-row) {
  --tone: var(--cal-ink);
}
.is-personal { --tone: var(--cal-personal); }
.is-due { --tone: var(--cal-due); }
.is-overdue { --tone: var(--cal-overdue); }

/* ---- Filter bar -------------------------------------------------------- */
.calendar-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  font-size: 12px;
}
.calendar-filter-kinds {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
}
.calendar-filter-kinds button {
  min-height: 24px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--muted);
}
.calendar-filter-kinds button:hover { color: var(--text); background: color-mix(in srgb, var(--hover) 70%, transparent); }
.calendar-filter-kinds button[aria-pressed='true'] {
  background: var(--paper);
  color: var(--text);
  font-weight: 500;
  box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgb(15 15 15 / 0.08);
}
.calendar-filter-completed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px 0 6px;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--motion-quick) var(--ease-standard), color var(--motion-quick) var(--ease-standard);
}
.calendar-filter-completed:hover { background: var(--hover); color: var(--text); }
.calendar-filter-completed input,
.calendar-create-checkable input {
  appearance: none;
  position: relative;
  flex: none;
  width: 14px;
  height: 14px;
  margin: 0;
  border: 1.5px solid var(--control-border);
  border-radius: 4px;
  background: var(--paper);
  cursor: pointer;
  transition: background-color var(--motion-quick) var(--ease-standard), border-color var(--motion-quick) var(--ease-standard);
}
.calendar-filter-completed input::after,
.calendar-create-checkable input::after {
  content: '';
  position: absolute;
  left: 3.5px;
  top: 0.5px;
  width: 3.5px;
  height: 7px;
  border: solid var(--on-accent, #fff);
  border-width: 0 1.5px 1.5px 0;
  rotate: 45deg;
  scale: 0.4;
  opacity: 0;
  transition: scale var(--motion-spring) var(--ease-spring-bouncy), opacity var(--motion-quick) var(--ease-standard);
}
.calendar-filter-completed input:checked,
.calendar-create-checkable input:checked { border-color: var(--green-fill); background: var(--green-fill); }
.calendar-filter-completed input:checked::after,
.calendar-create-checkable input:checked::after { scale: 1; opacity: 1; }
.calendar-filter-completed:hover input:not(:checked),
.calendar-create-checkable:hover input:not(:checked, :disabled) { border-color: var(--text-secondary); }
.calendar-filter-completed input:focus-visible,
.calendar-create-checkable input:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 2px; }
.calendar-filter-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--muted);
  cursor: text;
  transition: border-color var(--motion-base) var(--ease-standard), background-color var(--motion-base) var(--ease-standard), box-shadow var(--motion-base) var(--ease-standard);
}
.calendar-filter-search:hover { border-color: var(--control-border); }
.calendar-filter-search:focus-within {
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background: var(--paper);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text-secondary);
}
.calendar-filter-search input {
  width: 140px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: width var(--motion-spring) var(--ease-spring-smooth);
}
.calendar-filter-search input:focus,
.calendar-filter-search input:not(:placeholder-shown) { width: 200px; }
.calendar-filter-search input:focus-visible { outline: none; }
.calendar-error-banner {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 0;
  padding: 6px 14px;
  border-bottom: 1px solid var(--line);
  background: color-mix(in srgb, var(--danger, #c24141) 10%, var(--paper));
  color: var(--danger, #c24141);
  font-size: 12px;
  animation: tano-rise-in var(--motion-spring) var(--ease-spring-smooth);
}
.calendar-error-banner button {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  color: inherit;
}
.calendar-error-banner button:hover { background: color-mix(in srgb, var(--danger, #c24141) 14%, transparent); color: inherit; }

/* ---- Scroll container ---------------------------------------------------- */
.calendar-view {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--paper);
}
.calendar-view-timeline { overflow-anchor: none; }
.calendar-view-month,
.calendar-view-year { overflow-anchor: none; }
/* Switching between views fades the new layout in instead of snapping. */
.calendar-view-inner,
.calendar-month-view,
.calendar-year-view,
.calendar-agenda-view { animation: tano-fade-in var(--motion-base) var(--ease-standard); }

/* ---- Shared item pieces -------------------------------------------------- */
.calendar-inline-check {
  flex: none;
  display: grid;
  place-items: center;
  width: 16px;
  height: 16px;
  padding: 0;
  border-radius: 50%;
  color: color-mix(in srgb, var(--tone, var(--text)) 55%, var(--muted));
}
.calendar-inline-check:hover:not(:disabled) {
  color: var(--tone, var(--text));
  background: color-mix(in srgb, var(--tone, var(--text)) 12%, transparent);
}
/* Checks sit inside draggable items, which the global press motion skips. */
.calendar-inline-check:active:not(:disabled) { scale: 0.86; }
.calendar-inline-check:disabled { opacity: 0.45; cursor: not-allowed; }
.is-completed .calendar-inline-check { color: var(--tone, var(--text)); }
.calendar-due-flag { flex: none; color: var(--cal-due); }
.is-overdue .calendar-due-flag { color: var(--cal-overdue); }
.calendar-item-trigger {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
  color: inherit;
  font: inherit;
}
.calendar-item-trigger:hover { color: inherit; }
.calendar-item-time {
  margin-right: 5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.is-draggable { cursor: grab; }
.is-draggable:active { cursor: grabbing; }
.is-dragging { opacity: 0.38; }
.is-completed .calendar-item-trigger,
.is-completed .calendar-view-event-body strong,
.is-completed .calendar-agenda-item span {
  color: var(--muted);
  text-decoration: line-through;
  text-decoration-color: color-mix(in srgb, var(--muted) 70%, transparent);
}

/* ---- Timeline (day / 4 days / week) ------------------------------------- */
.calendar-view-days,
.calendar-view-grid {
  display: grid;
  grid-template-columns: 64px repeat(var(--calendar-day-count), var(--calendar-day-width));
}
.calendar-view-days {
  position: sticky;
  top: 0;
  z-index: 4;
  grid-template-rows: 70px;
  min-height: 70px;
  align-items: center;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  transition: grid-template-rows var(--motion-spring) var(--ease-spring-smooth);
}
.calendar-view-days.has-banner { grid-template-rows: 70px var(--calendar-banner-height, auto); }
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
  align-self: stretch;
  color: var(--text-secondary);
}
.calendar-view-day-heading span { font-size: 12px; color: var(--muted); }
.calendar-view-day-heading strong {
  display: grid;
  place-items: center;
  min-width: 32px;
  height: 32px;
  padding: 0 4px;
  border-radius: 16px;
  font-size: 18px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
}
.calendar-view-day-heading.today span { color: var(--text); font-weight: 500; }
.calendar-view-day-heading.today strong,
.calendar-month-date.today,
.calendar-year-days button.today > .calendar-year-date {
  color: var(--on-accent, white);
  background: var(--green-fill);
}
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
  gap: 3px;
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  padding: 6px 4px;
  border-top: 1px solid var(--line);
  border-left: 1px solid var(--line);
  transition: background-color var(--motion-quick) var(--ease-standard), box-shadow var(--motion-quick) var(--ease-standard);
}
.calendar-view-date-events::-webkit-scrollbar { display: none; }
.calendar-view-date-events.is-drop-target,
.calendar-month-cell.is-drop-target {
  background: color-mix(in srgb, var(--text) 5%, var(--paper));
  box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--text) 45%, transparent);
}

/* All-day chips in the timeline header and every chip in the month grid. */
.calendar-view-date-event,
.calendar-month-event {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 5px;
  box-sizing: border-box;
  height: 22px;
  padding: 0 7px 0 5px;
  border-radius: 5px;
  background: color-mix(in srgb, var(--tone) 8%, var(--paper));
  color: var(--text);
  font-size: 11px;
  line-height: 22px;
  transition:
    background-color var(--motion-quick) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard);
}
.calendar-view-date-event:not(:has(.calendar-inline-check, .calendar-due-flag)),
.calendar-month-event:not(:has(.calendar-inline-check, .calendar-due-flag)) { padding-left: 8px; }
.calendar-view-date-event:hover,
.calendar-month-event:hover,
.calendar-view-date-event:focus-within,
.calendar-month-event:focus-within { background: color-mix(in srgb, var(--tone) 14%, var(--paper)); }
/* Deadlines are not time on the calendar: an outlined chip in the deadline tone. */
.calendar-view-date-event.is-due,
.calendar-month-event.is-due {
  background: color-mix(in srgb, var(--tone) 7%, var(--paper));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 30%, transparent);
}
.calendar-view-date-event.is-due:hover,
.calendar-month-event.is-due:hover { background: color-mix(in srgb, var(--tone) 13%, var(--paper)); }
.is-overdue .calendar-item-trigger { color: color-mix(in srgb, var(--tone) 75%, var(--text)); }
.calendar-view-date-event.is-completed,
.calendar-month-event.is-completed { background: color-mix(in srgb, var(--tone) 4%, var(--paper)); }

.calendar-view-grid { height: 1344px; }
.calendar-view-hours { position: sticky; left: 0; z-index: 3; background: var(--paper); }
.calendar-view-hours span {
  position: absolute;
  right: 9px;
  transform: translateY(-7px);
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.calendar-view-hours span:first-child { display: none; }
.calendar-view-day-column {
  position: relative;
  /* Own stacking context: event, preview and drop layers stay under the sticky header. */
  z-index: 0;
  border-left: 1px solid var(--line);
  background-image: repeating-linear-gradient(to bottom, var(--line) 0, var(--line) 1px, transparent 1px, transparent 56px);
}
.calendar-view-day-column.is-today { background-color: var(--cal-today); }
.calendar-now-line {
  position: absolute;
  left: -1px;
  right: 0;
  z-index: 3;
  height: 2px;
  margin-top: -1px;
  background: var(--cal-overdue);
  pointer-events: none;
}
.calendar-now-line::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -3px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cal-overdue);
  box-shadow: 0 0 0 2px var(--paper);
}
.calendar-slot-preview {
  position: absolute;
  left: 3px;
  right: 3px;
  z-index: 4;
  box-sizing: border-box;
  padding: 4px 8px 4px 10px;
  border-radius: var(--cal-radius);
  background: color-mix(in srgb, var(--text) 9%, var(--paper));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text) 28%, transparent), var(--cal-lift);
  color: var(--text);
  font-size: 11px;
  font-weight: 500;
  font-variant-numeric: tabular-nums;
  pointer-events: none;
  animation: tano-fade-in var(--motion-quick) var(--ease-standard);
}
.calendar-slot-preview::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--text) 55%, var(--paper));
}
.calendar-drop-indicator {
  position: absolute;
  left: -1px;
  right: 0;
  z-index: 6;
  height: 0;
  border-top: 2px solid var(--green-fill);
  pointer-events: none;
  transition: top 90ms var(--ease-standard);
}
.calendar-drop-indicator::before {
  content: '';
  position: absolute;
  left: -4px;
  top: -5px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--green-fill);
}
.calendar-drop-indicator span {
  position: absolute;
  left: 8px;
  top: 3px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--green-fill);
  color: var(--on-accent, #fff);
  font-size: 10px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  line-height: 16px;
}

/* Timed blocks: a tinted card with an inset tone bar. */
.calendar-view-event {
  position: absolute;
  z-index: 1;
  box-sizing: border-box;
  display: flex;
  align-items: flex-start;
  gap: 4px;
  overflow: hidden;
  padding: 4px 6px 6px 11px;
  border-radius: var(--cal-radius);
  background: color-mix(in srgb, var(--tone) 8%, var(--paper));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 9%, transparent);
  color: var(--text);
  text-align: left;
  font-size: 11px;
  animation: tano-fade-in var(--motion-base) var(--ease-standard);
  transition:
    background-color var(--motion-quick) var(--ease-standard),
    box-shadow var(--motion-base) var(--ease-standard),
    opacity var(--motion-base) var(--ease-standard),
    height var(--motion-quick) var(--ease-standard);
}
.calendar-view-event::before {
  content: '';
  position: absolute;
  left: 3px;
  top: 3px;
  bottom: 3px;
  width: 3px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone) 58%, var(--paper));
  transition: background-color var(--motion-quick) var(--ease-standard);
}
.calendar-view-event:hover,
.calendar-view-event:focus-within {
  z-index: 3;
  background: color-mix(in srgb, var(--tone) 12%, var(--paper));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 16%, transparent), var(--cal-lift);
}
.calendar-view-event:hover::before,
.calendar-view-event:focus-within::before { background: color-mix(in srgb, var(--tone) 80%, var(--paper)); }
.calendar-view-event.is-completed { opacity: 0.62; }
.calendar-view-event.is-completed:hover { opacity: 0.9; }
.calendar-view-event.is-dragging { opacity: 0.38; box-shadow: none; }
.calendar-view-event.is-resizing {
  z-index: 5;
  transition: none;
  background: color-mix(in srgb, var(--tone) 14%, var(--paper));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--tone) 22%, transparent), var(--cal-lift);
}
.calendar-view-event .calendar-inline-check { margin-top: 1px; }
.calendar-view-event-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 0;
  text-align: left;
  color: inherit;
  font: inherit;
}
.calendar-view-event-body:hover { color: inherit; }
.calendar-view-event-body strong,
.calendar-view-event-body span { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.calendar-view-event-body strong { font-size: 12px; font-weight: 500; line-height: 1.4; }
.calendar-view-event-body span {
  color: color-mix(in srgb, var(--tone) 35%, var(--muted));
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.calendar-view-event.is-compact { align-items: center; padding-top: 1px; padding-bottom: 1px; }
.calendar-view-event.is-compact .calendar-inline-check { margin-top: 0; }
.calendar-view-event.is-compact .calendar-view-event-body { flex-direction: row; align-items: baseline; gap: 6px; }
.calendar-view-event.is-compact .calendar-view-event-body strong { flex: 0 1 auto; min-width: 2.5em; }
.calendar-view-event.is-compact .calendar-view-event-body span { flex: 1 1 0; min-width: 0; }
.calendar-event-resize-handle {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  cursor: ns-resize;
}
.calendar-event-resize-handle::after {
  content: '';
  position: absolute;
  left: 50%;
  bottom: 3px;
  width: 20px;
  height: 3px;
  margin-left: -10px;
  border-radius: 2px;
  background: color-mix(in srgb, var(--tone) 45%, transparent);
  opacity: 0;
  scale: 0.6 1;
  transition: opacity var(--motion-quick) var(--ease-standard), scale var(--motion-spring) var(--ease-spring);
}
.calendar-view-event:hover .calendar-event-resize-handle::after,
.calendar-view-event.is-resizing .calendar-event-resize-handle::after { opacity: 1; scale: 1; }
.calendar-event-resize-handle:hover::after { background: color-mix(in srgb, var(--tone) 75%, transparent); }
/* Zero-length items: a slim row with a tone dot rather than a card. */
.calendar-view-point {
  align-items: center;
  gap: 5px;
  padding: 0 6px 0 15px;
  background: transparent;
  box-shadow: none;
}
.calendar-view-point::before {
  top: 50%;
  bottom: auto;
  left: 6px;
  width: 6px;
  height: 6px;
  margin-top: -3px;
  border-radius: 50%;
  background: var(--tone);
}
.calendar-view-point.is-task { padding-left: 4px; }
.calendar-view-point.is-task::before { display: none; }
.calendar-view-point:hover,
.calendar-view-point:focus-within { background: color-mix(in srgb, var(--tone) 9%, var(--paper)); box-shadow: var(--cal-lift); }
.calendar-view-point .calendar-view-event-body { flex-direction: row; align-items: baseline; gap: 6px; }
.calendar-view-point .calendar-view-event-body span { flex: none; }

/* ---- Month ---------------------------------------------------------------- */
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
  padding: 11px 8px;
  color: var(--muted);
  font-size: 12px;
  text-align: center;
}
.calendar-month-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-height: 108px;
  min-width: 0;
  padding: 6px;
  border-right: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
  overflow: hidden;
  transition: background-color var(--motion-quick) var(--ease-standard), box-shadow var(--motion-quick) var(--ease-standard);
}
.calendar-month-cell.shaded { background: color-mix(in srgb, var(--surface) 55%, var(--paper)); }
.calendar-month-cell-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-bottom: 3px;
}
.calendar-month-add {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  margin-right: auto;
  border-radius: 6px;
  color: var(--muted);
  opacity: 0;
  scale: 0.8;
  transition:
    opacity var(--motion-quick) var(--ease-standard),
    scale var(--motion-spring) var(--ease-spring),
    background-color var(--motion-quick) var(--ease-standard),
    color var(--motion-quick) var(--ease-standard);
}
.calendar-month-cell:hover .calendar-month-add,
.calendar-month-add:focus-visible { opacity: 1; scale: 1; }
.calendar-month-add:hover { background: var(--hover); color: var(--text); }
.calendar-month-date,
.calendar-year-days button {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  font-variant-numeric: tabular-nums;
}
.calendar-month-date { margin: 0; color: var(--text-secondary); font-size: 12px; }
.calendar-month-date.month-start { width: auto; min-width: 26px; padding: 0 8px; color: var(--text); font-weight: 600; }
.calendar-month-date:hover:not(.today) { background: var(--hover); color: var(--text); }
.calendar-month-date.today:hover { background: var(--green-fill-hover); color: var(--on-accent, white); }
.calendar-month-event { width: 100%; }
/* Timed items in a day cell are listed, not blocked out: dot + time + title. */
.calendar-month-event.is-timed:not(.is-due) { background: transparent; }
.calendar-month-event.is-timed:not(.is-due):not(:has(.calendar-inline-check))::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  margin-left: -2px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tone) 70%, var(--paper));
}
.calendar-month-event.is-timed:not(.is-due):hover,
.calendar-month-event.is-timed:not(.is-due):focus-within { background: color-mix(in srgb, var(--tone) 8%, var(--paper)); }
.calendar-month-more {
  display: block;
  width: 100%;
  margin-top: 1px;
  padding: 2px 6px;
  border-radius: 5px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
  text-align: left;
}
.calendar-month-more:hover,
.calendar-month-more[aria-expanded='true'] { background: var(--hover); color: var(--text); }

/* ---- Year ----------------------------------------------------------------- */
.calendar-year-heading {
  max-width: 1200px;
  margin: 0 auto;
  padding: 26px 28px 0;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
}
.calendar-year-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(225px, 1fr));
  gap: 12px 14px;
  max-width: 1200px;
  margin: 0 auto;
  padding: 18px 20px 28px;
}
.calendar-year-month {
  min-width: 0;
  padding: 10px 8px 12px;
  border-radius: 10px;
  transition: background-color var(--motion-base) var(--ease-standard);
}
.calendar-year-month:hover { background: color-mix(in srgb, var(--surface) 45%, var(--paper)); }
.calendar-year-month-title {
  margin: 0 0 8px;
  padding: 3px 8px;
  border-radius: 6px;
  color: var(--text);
  font-size: 14px;
  font-weight: 600;
}
.calendar-year-month-title:hover { background: var(--hover); color: var(--text); }
.calendar-year-weekdays,
.calendar-year-days { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); text-align: center; }
.calendar-year-weekdays span { padding-bottom: 4px; color: var(--muted); font-size: 10px; }
.calendar-year-days button,
.calendar-year-days > span { width: 28px; height: 28px; margin: auto; font-size: 11px; }
.calendar-year-days button { position: relative; padding: 0; border-radius: 50%; color: var(--text-secondary); }
.calendar-year-days button:hover { background: none; }
.calendar-year-date {
  display: grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  transition: background-color var(--motion-quick) var(--ease-standard), color var(--motion-quick) var(--ease-standard), scale var(--motion-spring) var(--ease-spring);
}
.calendar-year-days button:hover:not(.today) > .calendar-year-date { background: var(--hover); color: var(--text); }
.calendar-year-event-dot {
  position: absolute;
  bottom: 0;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 55%, var(--paper));
}
.calendar-year-days button.selected:not(.today) > .calendar-year-date { color: var(--text); background: var(--selected); box-shadow: inset 0 0 0 1px var(--control-border); }
.calendar-year-days button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }

/* ---- Agenda --------------------------------------------------------------- */
.calendar-agenda-view { max-width: 900px; margin: 0 auto; padding: 20px 32px 40px; }
.calendar-agenda-empty { padding: 60px 0; color: var(--muted); text-align: center; }
.calendar-agenda-day { display: flex; align-items: flex-start; gap: 24px; padding: 14px 0; border-bottom: 1px solid var(--line); line-height: 20px; }
.calendar-agenda-day:last-child { border-bottom: 0; }
.calendar-agenda-date {
  position: sticky;
  top: 12px;
  display: flex;
  align-items: baseline;
  gap: 8px;
  width: 112px;
  flex-shrink: 0;
  padding: 7px 0;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.calendar-agenda-date strong {
  display: inline-grid;
  place-items: center;
  min-width: 28px;
  height: 28px;
  padding: 0 4px;
  border-radius: 14px;
  color: var(--text);
  font-size: 18px;
  font-weight: 500;
}
.calendar-agenda-date.today strong { color: var(--on-accent, white); background: var(--green-fill); font-size: 14px; }
.calendar-agenda-date.today span { color: var(--text); }
.calendar-agenda-events { flex: 1; min-width: 0; }
.calendar-agenda-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px;
  border-radius: 7px;
  transition: background-color var(--motion-quick) var(--ease-standard);
}
.calendar-agenda-row:hover,
.calendar-agenda-row:focus-within { background: var(--hover); }
.calendar-agenda-row .calendar-inline-check { width: 18px; height: 18px; }
.calendar-agenda-marker {
  flex: none;
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
}
.calendar-agenda-marker::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--tone) 65%, var(--paper));
}
.calendar-agenda-item { flex: 1; min-width: 0; display: flex; align-items: center; gap: 16px; padding: 8px 0; color: var(--text); text-align: left; }
.calendar-agenda-item:hover { color: var(--text); }
.calendar-agenda-item time { width: 46px; flex-shrink: 0; color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
.calendar-agenda-item span { display: inline-flex; align-items: baseline; gap: 8px; flex-wrap: wrap; min-width: 0; }
.calendar-agenda-item span .calendar-due-flag { align-self: center; }
.calendar-agenda-item small { color: var(--muted); font-size: 11px; }
.calendar-agenda-row.is-overdue .calendar-agenda-item small { color: var(--cal-overdue); }

/* ---- Quick create dialog (teleported: keep its own tokens) ------------------ */
.calendar-create-backdrop {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: grid;
  place-items: center;
  padding: 16px;
  background: #161a2233;
  backdrop-filter: blur(3px);
}
.calendar-create-dialog {
  --create-label: 92px;
  width: min(520px, 100%);
  padding: 16px 20px 18px;
  border: 1px solid var(--line);
  border-radius: var(--radius-dialog, 14px);
  background: var(--paper);
  color: var(--text);
  box-shadow: var(--dialog-shadow, 0 16px 48px #0003);
}
.calendar-create-dialog header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.calendar-create-dialog h2 { margin: 0; color: var(--text-secondary); font-size: 12px; font-weight: 500; }
.calendar-create-close {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  margin-right: -6px;
  border-radius: 7px;
  color: var(--muted);
}
.calendar-create-close:hover:not(:disabled) { background: var(--hover); color: var(--text); }
/* The title is the dialog's headline, written in place like the detail panel. */
.calendar-create-title {
  box-sizing: border-box;
  width: calc(100% + 16px);
  margin: 0 -8px 10px;
  padding: 6px 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 20px;
  font-weight: 600;
  line-height: 1.4;
}
.calendar-create-title::placeholder { color: var(--muted); opacity: 0.7; font-weight: 500; }
.calendar-create-title:hover:not(:disabled, :focus) { background: var(--hover); }
.calendar-create-title:focus,
.calendar-create-title:focus-visible { outline: none; background: transparent; }
/* Property rows share the detail panel's layout: label column + quiet values. */
.calendar-create-properties { display: grid; gap: 4px; padding: 12px 0 4px; border-top: 1px solid var(--line); }
.calendar-create-row { display: grid; grid-template-columns: var(--create-label) minmax(0, 1fr); column-gap: 12px; align-items: start; min-width: 0; }
.calendar-create-label { display: flex; align-items: center; gap: 8px; min-height: 32px; color: var(--muted); font-size: 13px; }
.calendar-create-label svg { flex: none; }
.calendar-create-dialog .calendar-create-scope,
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input) {
  box-sizing: border-box;
  height: 32px;
  min-width: 140px;
  max-width: 100%;
  justify-self: start;
  margin: 0;
  padding: 0 8px;
  border: 1px solid transparent;
  border-radius: 6px;
  background-color: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  transition: background-color var(--motion-quick) var(--ease-standard), border-color var(--motion-base) var(--ease-standard), box-shadow var(--motion-base) var(--ease-standard);
}
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input) { width: auto; }
.calendar-create-dialog .calendar-create-scope {
  appearance: none;
  padding-right: 26px;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8985' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 8px center;
  cursor: pointer;
}
.calendar-create-dialog .calendar-create-scope:hover:not(:disabled, :focus),
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input:hover:not(:disabled, :focus)) { border-color: transparent; background-color: var(--hover); }
.calendar-create-dialog .calendar-create-scope:focus-visible,
.calendar-create-dialog .calendar-create-time :deep(.plan-date-field input:focus-visible) {
  outline: none;
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background-color: var(--paper);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 7%, transparent);
}
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-heading) { justify-content: flex-start; gap: 2px; min-height: 32px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger) { gap: 4px; min-height: 32px; padding: 0 6px 0 8px; border-radius: 6px; color: var(--text); font-size: 13px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger > svg:first-child) { display: none; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-schedule-trigger > svg:last-child) { color: var(--muted); }
.calendar-create-time :deep(.plan-date-field.is-compact .compact-precision) { color: var(--muted); border-radius: 6px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-inputs) { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 0 0 4px; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-input) { display: grid; gap: 0; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-label) { min-height: 0; padding: 2px 9px 0; }
.calendar-create-time :deep(.plan-date-field.is-compact .plan-date-label label) { font-size: 11px; color: var(--muted); }
.calendar-create-checkable {
  display: inline-flex;
  align-items: center;
  justify-self: start;
  gap: 7px;
  min-height: 32px;
  padding: 0 8px;
  border-radius: 6px;
  font-size: 13px;
  color: var(--text);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--motion-quick) var(--ease-standard);
}
.calendar-create-checkable:hover { background: var(--hover); }
.calendar-create-error { margin: 10px 0 0; color: var(--danger, #c24141); font-size: 12px; }
.calendar-create-dialog footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--line);
}
.calendar-create-dialog footer button {
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 13px;
}
.calendar-create-dialog footer button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.calendar-create-dialog footer .calendar-create-submit {
  min-width: 72px;
  border-color: transparent;
  background: var(--green-fill);
  color: var(--on-accent, #fff);
  font-weight: 500;
}
.calendar-create-dialog footer .calendar-create-submit:hover:not(:disabled) { background: var(--green-fill-hover); color: var(--on-accent, #fff); }
.calendar-create-dialog footer .calendar-create-submit:disabled { opacity: 1; background: var(--hover); color: var(--muted); }
@media (prefers-reduced-motion: reduce) {
  .calendar-view-inner,
  .calendar-month-view,
  .calendar-year-view,
  .calendar-agenda-view,
  .calendar-view-event,
  .calendar-slot-preview,
  .calendar-error-banner { animation: none; }
}
@media (max-width: 700px) {
  .calendar-filter-bar { padding: 6px 10px; gap: 8px; }
  .calendar-filter-search input,
  .calendar-filter-search input:focus,
  .calendar-filter-search input:not(:placeholder-shown) { width: 110px; }
  .calendar-year-heading { padding: 18px 18px 0; }
  .calendar-year-grid { padding: 12px; }
  .calendar-agenda-view { padding: 18px; }
  .calendar-agenda-day { gap: 10px; }
  .calendar-agenda-date { width: 88px; flex-direction: column; gap: 2px; }
  .calendar-create-row { grid-template-columns: minmax(0, 1fr); }
}
</style>
