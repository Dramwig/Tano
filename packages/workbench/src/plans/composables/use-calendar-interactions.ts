import { computed, onUnmounted, ref, type ComputedRef, type Ref } from 'vue';
import { isPlanCompletionLocked, withPlanCompleted, type WorkspaceObject } from '@tano/protocol';
import { t, uiLocale } from '../../i18n/i18n';
import type { ObjectRecord } from '../../objects/workspace-objects';
import type { usePlanStore } from '../../stores/plans';
import {
  hasEventTime,
  isCheckableEvent,
  isEventCompleted,
  isEventOverdue,
  localDayKey,
  type CalendarDayEntry,
} from '../calendar';
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
import type { TimedEventBlock } from '../timeline-layout';
import { planKey, planSourceLabel } from '../personal-plans';
import type { PlanDateValue } from '../plan-date';
import { isVirtualOccurrence } from '../recurrence';
import { CALENDAR_HOUR_HEIGHT } from './use-calendar-scroll';

export interface SlotPreview {
  dayKey: string;
  top: number;
  height: number;
  label: string;
  startMinutes: number;
  endMinutes: number;
}

export interface ResizeState {
  record: ObjectRecord;
  key: string;
  day: Date;
  dayKey: string;
  startY: number;
  startMinutes: number;
  initialEndMinutes: number;
  previewEndMinutes: number;
}

export interface DropTarget {
  zone: 'timeline' | 'day';
  dayKey: string;
  minutes?: number;
}

export interface CalendarInteractionOptions {
  plans: ReturnType<typeof usePlanStore>;
  records: () => ObjectRecord[] | undefined;
  today: ComputedRef<string>;
  canCreate: ComputedRef<boolean>;
  window: Window;
  openQuickCreate: (planDate: PlanDateValue, checkable?: boolean) => void | Promise<void>;
}

export function useCalendarInteractions(options: CalendarInteractionOptions) {
  const { plans, today, canCreate, window } = options;
  const hourHeight = CALENDAR_HOUR_HEIGHT;

  const pending = ref<string[]>([]);
  const interactionError = ref('');

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

  // --- Timeline Slot Selection (Click / Drag-to-Create) ---
  interface SlotSelection {
    day: Date;
    dayKey: string;
    anchorY: number;
    currentY: number;
    column: HTMLElement;
  }
  const slotSelect = ref<SlotSelection>();
  const slotPreview: ComputedRef<SlotPreview | undefined> = computed(() => {
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
    void options.openQuickCreate(planDateFromSlot(current.day, preview.startMinutes, preview.endMinutes), false);
  }

  // --- Bottom-Edge Resize ---
  const resizing = ref<ResizeState>();

  function startResize(item: TimedEventBlock, day: Date, event: PointerEvent) {
    if (event.button !== 0 || !canDragRecord(item.record) || item.point) return;
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
    const startMinutes = Math.max(0, Math.round((item.visibleStart - dayStart) / 60_000));
    const initialEndMinutes = Math.max(
      startMinutes + MIN_DURATION_MINUTES,
      Math.round((item.visibleEnd - dayStart) / 60_000),
    );
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

  // --- Drag Move & Sidebar Drop Timeblocking ---
  const draggingKey = ref<string>();
  const dropTarget = ref<DropTarget>();

  function allEditablePool(): readonly ObjectRecord[] {
    const fromStore = typeof plans.recordsFor === 'function' ? plans.recordsFor('all') : [];
    if (fromStore.length) return fromStore;
    return options.records() ?? plans.records;
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

  // --- Shared Presentation Helpers ---
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

  function clockLabel(value: unknown) {
    return new Date(String(value)).toLocaleTimeString(uiLocale.value, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function entryTime(entry: CalendarDayEntry) {
    if (entry.kind === 'due') return t('截止');
    const { record } = entry;
    if (record.object.properties.allDay === true) return t('全天');
    if (!hasEventTime(record)) return t('仅日期');
    return new Date(String(record.object.properties.start)).toLocaleTimeString(uiLocale.value, {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
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

  function timedEventStyle(item: TimedEventBlock, day: Date) {
    const widthPct = 100 / item.columnCount;
    const leftPct = item.column * widthPct;
    let height = item.height;
    if (
      resizing.value &&
      resizing.value.key === planKey(item.record) &&
      resizing.value.dayKey === localDayKey(day)
    ) {
      height = Math.max(
        22,
        ((resizing.value.previewEndMinutes - resizing.value.startMinutes) / 60) * hourHeight,
      );
    }
    return {
      top: `${item.top}px`,
      height: `${height}px`,
      left: `calc(${leftPct}% + 2px)`,
      width: `calc(${widthPct}% - 4px)`,
    };
  }

  onUnmounted(() => {
    cleanupSlotListeners();
    cleanupResizeListeners();
  });

  return {
    pending,
    interactionError,
    canEditRecord,
    canDragRecord,
    canToggleComplete,
    toggleComplete,
    slotPreview,
    startSlotSelection,
    resizing: resizing as Ref<ResizeState | undefined>,
    startResize,
    draggingKey,
    dropTarget,
    onEventDragStart,
    onEventDragEnd,
    onTimelineDragOver,
    onTimelineDrop,
    onDayDragOver,
    onDayDrop,
    onDragLeave,
    itemClasses,
    clockLabel,
    entryTime,
    entryTooltip,
    timedEventStyle,
  };
}

export type CalendarInteractions = ReturnType<typeof useCalendarInteractions>;
