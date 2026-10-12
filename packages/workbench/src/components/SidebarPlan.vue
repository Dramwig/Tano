<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, onUpdated, ref, useId, watch } from 'vue';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  Cloud,
  FolderOpen,
  Layers3,
  CircleAlert,
  Plus,
  ListTodo,
  UserRound,
} from 'lucide-vue-next';
import type { ObjectRecord } from '../workspace-objects';
import {
  isCheckableEvent,
  isEventCompleted,
  planningEvents,
  plannedEventsOnDay,
  unscheduledTasks,
  localDayKey,
  weekDays,
} from '../calendar';
import { useWorkspaceStore } from '../stores/workspace';
import { usePlanStore } from '../stores/plans';
import type { PlanScope } from '../stores/plans';
import { planKey } from '../personal-plans';
import { useWorkbenchRuntime } from '../runtime';
import PlanEventList from './PlanEventList.vue';
import { createPlanListMotion } from './plan-list-motion';
import PlanConnectionsDialog from './PlanConnectionsDialog.vue';
import { usePlanSyncStore } from '../stores/plan-sync';
import type { SyncKind } from '../plan-sync/types';
import PlanDateField from './PlanDateField.vue';
import { writePlanDate } from '../plan-date';
import type { PlanDateValue } from '../plan-date';
import { taskReview } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import PlanEventContextMenu from './PlanEventContextMenu.vue';

const props = withDefaults(defineProps<{ date: Date; active?: boolean }>(), { active: true });
const listRoot = ref<HTMLElement>();
let listMotion: ReturnType<typeof createPlanListMotion> | undefined;
onBeforeUpdate(() => listMotion?.capture());
onUpdated(() => listMotion?.update());
const emit = defineEmits<{ 'select-date': [date: Date]; 'select-event': [id: string] }>();
const store = useWorkspaceStore();
const plans = usePlanStore();
const sync = usePlanSyncStore();
const connectionKind = ref<SyncKind>();
function openConnections(kind: SyncKind) { viewOpen.value = false; connectionKind.value = kind; }
async function closeConnections() { connectionKind.value = undefined; await nextTick(); viewTrigger.value?.focus(); }
const personalNative = useWorkbenchRuntime().native;
const viewPicker = ref<HTMLElement>();
const viewTrigger = ref<HTMLButtonElement>();
const viewMenu = ref<HTMLElement>();
const viewMenuPosition = ref({ left: '0px', top: '0px' });
const viewOpen = ref(false);
watch(() => props.active, (active) => { if (!active) viewOpen.value = false; });
const viewLabel = computed(() => ({ workspace: '工作区', personal: '个人', all: '全部' })[plans.view]);
const personalIssue = computed(() => !!plans.loadError || !!plans.errors.length);
const personalIssueTitle = computed(() => plans.requiresDesktopRestart ? '个人计划需更新桌面程序' : '个人计划暂时无法读取');
const personalConnectionCount = computed(() => sync.connections.filter(c => c.scope === 'personal').length);
const viewOptions = computed(() => [
  { value: 'workspace' as const, label: '工作区', icon: FolderOpen, detail: store.workspace?.name ?? '尚未打开工作区', disabled: !store.workspace },
  { value: 'personal' as const, label: '个人', icon: UserRound, detail: personalIssue.value ? personalIssueTitle.value : personalNative ? personalConnectionCount.value ? `本设备 · ${personalConnectionCount.value} 个同步连接` : '本设备 · 未连接同步服务' : '仅当前浏览器 · 未同步', disabled: false },
  { value: 'all' as const, label: '全部', icon: Layers3, detail: '个人 + 当前工作区', disabled: !store.workspace },
]);
async function toggleViewMenu() {
  viewOpen.value = !viewOpen.value;
  if (!viewOpen.value) return;
  await nextTick();
  placeViewMenu();
  viewMenu.value?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)')?.focus({ preventScroll: true });
}
function placeViewMenu() {
  if (!viewOpen.value || !viewMenu.value || !viewPicker.value || !viewTrigger.value) return;
  const anchor = viewPicker.value.getBoundingClientRect();
  const trigger = viewTrigger.value.getBoundingClientRect();
  const { width, height } = viewMenu.value.getBoundingClientRect();
  const margin = 12;
  viewMenuPosition.value = {
    left: `${Math.max(margin, Math.min(anchor.left, window.innerWidth - width - margin))}px`,
    top: `${Math.max(margin, Math.min(trigger.bottom + 8, window.innerHeight - height - margin))}px`,
  };
}
async function closeViewMenu() {
  viewOpen.value = false;
  await nextTick();
  viewTrigger.value?.focus();
}
function chooseView(value: typeof plans.view) {
  plans.view = value;
  void closeViewMenu();
}
function dismissViewMenu(event: Event) {
  if (event.target instanceof Node && !viewTrigger.value?.contains(event.target) && !viewMenu.value?.contains(event.target)) viewOpen.value = false;
}
watch(() => plans.view, () => { viewOpen.value = false; });
const WEEK_HEIGHT = 30;
const BUFFER_WEEKS = 26;
const VISIBLE_WEEKS = 6;
const TOTAL_WEEKS = BUFFER_WEEKS * 2 + VISIBLE_WEEKS;
const offsetDays = (date: Date, offset: number) =>
  new Date(date.getFullYear(), date.getMonth(), date.getDate() + offset);
const firstWeek = (date: Date) => weekDays(new Date(date.getFullYear(), date.getMonth(), 1))[0]!;
const viewport = ref<HTMLElement>();
const start = ref(offsetDays(firstWeek(props.date), -BUFFER_WEEKS * 7));
const month = ref(props.date);
const selected = computed(() => localDayKey(props.date));
const focused = ref(selected.value);
const draggingCalendar = ref(false);
let calendarDrag: { pointerId: number; startX: number; startY: number; lastY: number } | undefined;
let suppressCalendarClick = false;
let savedScrollTop = BUFFER_WEEKS * WEEK_HEIGHT;
let repositioning = false;
let resizeObserver: ResizeObserver | undefined;
const events = computed(() => planningEvents(plans.records));
const unfinished = computed(() => events.value.filter(record => !isEventCompleted(record)));
const completed = computed(() => events.value.filter(isEventCompleted));
const completedExpanded = ref(false);
const completedListId = useId();
const contextMenuId = `plan-event-menu-${useId()}`;
const context = ref<{ key: string; x: number; y: number }>();
let contextTrigger: HTMLElement | null = null;
const contextRecord = computed(() => events.value.find(record => planKey(record) === context.value?.key));
function restoreContextFocus(trigger = contextTrigger) {
  void nextTick(() => {
    const target = trigger?.isConnected && !trigger.closest('[inert]') ? trigger
      : listRoot.value?.querySelector<HTMLElement>('.plan-event-detail, .plan-completed-toggle');
    target?.focus({ preventScroll: true });
  });
}
function closeContextMenu(restoreFocus = false) {
  context.value = undefined;
  if (restoreFocus) restoreContextFocus();
}
function openContextMenu(record: ObjectRecord, event: MouseEvent | KeyboardEvent) {
  const row = event.currentTarget as HTMLElement;
  contextTrigger = row.querySelector<HTMLElement>('.plan-event-detail');
  const rect = row.getBoundingClientRect();
  viewOpen.value = false;
  context.value = {
    key: planKey(record),
    x: event instanceof MouseEvent ? event.clientX : rect.left + 24,
    y: event instanceof MouseEvent ? event.clientY : rect.bottom,
  };
}
async function contextAction(action: 'details' | 'complete' | 'archive') {
  const record = contextRecord.value;
  const trigger = contextTrigger;
  closeContextMenu();
  if (!record) return;
  if (action === 'details') {
    trigger?.focus({ preventScroll: true });
    emit('select-event', planKey(record));
    return;
  }
  if (action === 'complete') await completeEvent(record, !isEventCompleted(record));
  else await updateEvent(record, { archived: true });
  if (props.active) restoreContextFocus(trigger);
}
watch(() => [props.active, plans.view, selected.value, store.workspace?.id, completedExpanded.value], () => closeContextMenu());
watch(contextRecord, record => { if (!record) closeContextMenu(); });
const days = computed(() =>
  Array.from({ length: TOTAL_WEEKS * 7 }, (_, index) => offsetDays(start.value, index)).map(
    (date) => ({
      date,
      key: localDayKey(date),
      count: plannedEventsOnDay(events.value, date).length,
    }),
  ),
);
const selectedDate = computed(() => new Date(`${selected.value}T00:00:00`));
const agenda = computed(() => plannedEventsOnDay(events.value, selectedDate.value));
const unscheduled = computed(() => unscheduledTasks(unfinished.value));
const monthTitle = computed(
  () => `${month.value.getFullYear()} 年 ${month.value.getMonth() + 1} 月`,
);
const selectedTitle = computed(
  () => `${selectedDate.value.getMonth() + 1} 月 ${selectedDate.value.getDate()} 日`,
);
const readonly = computed(() => (draft.value?.scope ?? plans.defaultScope) === 'personal'
  ? !plans.personalWritable : !plans.workspaceWritable);
const cannotAdd = computed(() => !plans.personalWritable && !plans.workspaceWritable);
const pending = ref<string[]>([]);
const saving = ref(false);
const error = ref('');
const nameInput = ref<HTMLInputElement>();
const createPanel = ref<HTMLElement>();
const scopePicker = ref<HTMLElement>();
const scopeTrigger = ref<HTMLButtonElement>();
const scopeOpen = ref(false);
let previousCreateFocus: HTMLElement | null = null;
interface EventDraft {
  scope: PlanScope;
  workspaceId?: string;
  name: string;
  checkable: boolean;
  planDate: PlanDateValue;
}
const draft = ref<EventDraft>();
const scopeDescription = computed(() => draft.value?.scope === 'personal'
  ? (personalNative ? '仅保存在这台设备，不随工作区分享。' : '仅保存在当前浏览器，不随工作区分享。')
  : `保存在 ${store.workspace?.name ?? '当前工作区'}，随工作区一起携带。`);
async function toggleScope() {
  scopeOpen.value = !scopeOpen.value;
  if (!scopeOpen.value) return;
  await nextTick();
  const menu = scopePicker.value;
  (menu?.querySelector<HTMLElement>('[aria-checked="true"]:not(:disabled)')
    ?? menu?.querySelector<HTMLElement>('[role="menuitemradio"]:not(:disabled)'))?.focus();
}
async function closeScope() {
  scopeOpen.value = false;
  await nextTick();
  scopeTrigger.value?.focus();
}
function chooseScope(scope: PlanScope) {
  if (!draft.value || saving.value || (scope === 'personal' ? !plans.personalWritable : !plans.workspaceWritable)) return;
  draft.value.scope = scope;
  void closeScope();
}
function onPickerKeydown(event: KeyboardEvent, picker?: HTMLElement) {
  const options = [
    ...(picker?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]:not(:disabled), [role="menuitem"]:not(:disabled)') ?? []),
  ];
  if (!options.length) return;
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  let next: number;
  if (event.key === 'ArrowDown') next = (index + 1) % options.length;
  else if (event.key === 'ArrowUp') next = (index + options.length - 1) % options.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = options.length - 1;
  else return;
  event.preventDefault();
  options[next]?.focus();
}
function dismissPickers(event: MouseEvent | FocusEvent) {
  if (!(event.target instanceof Node)) return;
  if (!scopePicker.value?.contains(event.target)) scopeOpen.value = false;
}
async function addEvent(kind: 'event' | 'task') {
  if (cannotAdd.value || saving.value) return;
  viewOpen.value = false;
  if (!draft.value) {
    previousCreateFocus = document.activeElement as HTMLElement | null;
    draft.value = {
      scope: plans.defaultScope,
      workspaceId: store.workspace?.id,
      name: '',
      checkable: kind === 'task',
      planDate: kind === 'task'
        ? { date: '', time: '', end: '' }
        : { date: selected.value, time: '09:00', end: `${selected.value}T10:00` },
    };
  }
  error.value = '';
  await nextTick();
  nameInput.value?.focus();
}
function closeCreate() {
  if (saving.value) return;
  scopeOpen.value = false;
  draft.value = undefined;
  error.value = '';
}
function onCreateKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeCreate();
  }
  if (event.key !== 'Tab' || !createPanel.value) return;
  const controls = [
    ...createPanel.value.querySelectorAll<HTMLElement>(':is(button, input, select):not(:disabled)'),
  ];
  if (!controls.length) {
    event.preventDefault();
    createPanel.value.focus();
  } else if (
    event.shiftKey &&
    (document.activeElement === controls[0] || document.activeElement === createPanel.value)
  ) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (
    !event.shiftKey &&
    (document.activeElement === controls.at(-1) || document.activeElement === createPanel.value)
  ) {
    event.preventDefault();
    controls[0]?.focus();
  }
}
watch(
  () => !!draft.value,
  async (open) => {
    if (open) return;
    scopeOpen.value = false;
    await nextTick();
    if (previousCreateFocus?.isConnected) previousCreateFocus.focus({ preventScroll: true });
    previousCreateFocus = null;
  },
);
watch(saving, async (busy) => {
  if (busy) scopeOpen.value = false;
  await nextTick();
  if (!draft.value) return;
  if (busy) createPanel.value?.focus({ preventScroll: true });
  else nameInput.value?.focus({ preventScroll: true });
});
function changeCheckable() {
  if (draft.value && !draft.value.checkable && !draft.value.planDate.date)
    draft.value.planDate.date = selected.value;
}
async function saveEvent() {
  const value = draft.value;
  const workspaceId = store.workspace?.id;
  if (!value || readonly.value || saving.value || !value.name.trim()) return;
  saving.value = true;
  error.value = '';
  try {
    const properties = writePlanDate({ checkable: value.checkable, completed: false }, value.planDate);
    await plans.create({
      type: 'event',
      name: value.name.trim(),
      description: '',
      archived: false,
      properties,
    }, value.scope, value.workspaceId);
    if (draft.value === value) {
      if (plans.view !== 'all') plans.view = value.scope;
      draft.value = undefined;
    }
  } catch (cause) {
    if (store.workspace?.id === workspaceId) error.value = String(cause);
  } finally {
    if (store.workspace?.id === workspaceId) saving.value = false;
  }
}
async function updateEvent(record: ObjectRecord, change: Partial<Pick<WorkspaceObject, 'properties' | 'archived'>>) {
  const workspaceId = store.workspace?.id;
  const key = planKey(record);
  if (!plans.canEdit(record) || pending.value.includes(key)) return;
  pending.value.push(key);
  error.value = '';
  try {
    await plans.update(record, { ...record.object, ...change });
  } catch (cause) {
    if (record.source?.scope === 'personal' || store.workspace?.id === workspaceId) error.value = String(cause);
  } finally {
    pending.value = pending.value.filter((id) => id !== key);
  }
}
function completeEvent(record: ObjectRecord, completed: boolean) {
  if (!isCheckableEvent(record)) return;
  const review = taskReview(record.object);
  if (review && review.state !== 'approved') return;
  const properties = { ...record.object.properties, completed };
  if (record.object.type === 'task')
    Object.assign(properties, { status: completed ? 'done' : 'todo' });
  return updateEvent(record, { properties });
}

async function resetScroll(date: Date) {
  finishCalendarDrag();
  repositioning = true;
  start.value = offsetDays(firstWeek(date), -BUFFER_WEEKS * 7);
  month.value = date;
  savedScrollTop = BUFFER_WEEKS * WEEK_HEIGHT;
  await nextTick();
  if (viewport.value?.clientHeight) viewport.value.scrollTop = savedScrollTop;
  repositioning = false;
}
function updateVisibleMonth(top: number, height: number) {
  const bottom = top + height;
  const coverage = new Map<number, number>();
  // Count visible date-cell area, including partially clipped rows at both edges.
  for (let week = Math.floor(top / WEEK_HEIGHT); week < Math.ceil(bottom / WEEK_HEIGHT); week++) {
    const visibleHeight = Math.min(bottom, (week + 1) * WEEK_HEIGHT) - Math.max(top, week * WEEK_HEIGHT);
    for (let day = 0; day < 7; day++) {
      const date = offsetDays(start.value, week * 7 + day);
      const key = date.getFullYear() * 12 + date.getMonth();
      coverage.set(key, (coverage.get(key) ?? 0) + visibleHeight);
    }
  }
  // Keep the current month on a tie so small movements at the boundary stay stable.
  let dominant = month.value.getFullYear() * 12 + month.value.getMonth();
  let mostVisible = coverage.get(dominant) ?? 0;
  for (const [key, visible] of coverage) {
    if (visible > mostVisible) {
      dominant = key;
      mostVisible = visible;
    }
  }
  if (dominant !== month.value.getFullYear() * 12 + month.value.getMonth())
    month.value = new Date(Math.floor(dominant / 12), dominant % 12, 1);
}
async function onScroll() {
  const element = viewport.value;
  if (!element?.clientHeight || repositioning) return;
  savedScrollTop = element.scrollTop;
  const week = Math.floor(savedScrollTop / WEEK_HEIGHT);
  updateVisibleMonth(savedScrollTop, element.clientHeight);
  if (!element.contains(document.activeElement))
    focused.value = localDayKey(
      offsetDays(start.value, Math.ceil(savedScrollTop / WEEK_HEIGHT) * 7),
    );
  if (week >= VISIBLE_WEEKS && week <= TOTAL_WEEKS - VISIBLE_WEEKS * 2) return;
  // Recycle offscreen weeks, preserving the exact date and fractional row offset.
  repositioning = true;
  const shift = week - BUFFER_WEEKS;
  start.value = offsetDays(start.value, shift * 7);
  savedScrollTop -= shift * WEEK_HEIGHT;
  await nextTick();
  element.scrollTop = savedScrollTop;
  repositioning = false;
}
function startCalendarDrag(event: PointerEvent) {
  if (!event.isPrimary || event.button !== 0 || calendarDrag) return;
  suppressCalendarClick = false;
  // Touch keeps native vertical scrolling, including the browser's gesture handling.
  if (event.pointerType === 'touch') return;
  calendarDrag = {
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    lastY: event.clientY,
  };
  window.addEventListener('pointermove', moveCalendarDrag, { passive: false });
  window.addEventListener('pointerup', endCalendarDrag);
  window.addEventListener('pointercancel', endCalendarDrag);
  window.addEventListener('blur', finishCalendarDrag);
}
function moveCalendarDrag(event: PointerEvent) {
  const drag = calendarDrag;
  const element = viewport.value;
  if (!drag || !element || event.pointerId !== drag.pointerId) return;
  if (!(event.buttons & 1)) {
    finishCalendarDrag();
    return;
  }
  if (!draggingCalendar.value) {
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    draggingCalendar.value = true;
    suppressCalendarClick = true;
    // Capture only after dragging starts so ordinary clicks still reach the date button.
    element.setPointerCapture(event.pointerId);
  }
  event.preventDefault();
  // Incremental movement stays continuous when onScroll recycles offscreen weeks.
  element.scrollTop += drag.lastY - event.clientY;
  drag.lastY = event.clientY;
}
function endCalendarDrag(event: PointerEvent) {
  if (event.pointerId === calendarDrag?.pointerId) finishCalendarDrag();
}
function finishCalendarDrag() {
  const drag = calendarDrag;
  calendarDrag = undefined;
  draggingCalendar.value = false;
  window.removeEventListener('pointermove', moveCalendarDrag);
  window.removeEventListener('pointerup', endCalendarDrag);
  window.removeEventListener('pointercancel', endCalendarDrag);
  window.removeEventListener('blur', finishCalendarDrag);
  if (drag && viewport.value?.hasPointerCapture(drag.pointerId))
    viewport.value.releasePointerCapture(drag.pointerId);
}
function onCalendarClick(event: MouseEvent) {
  if (!suppressCalendarClick || event.detail === 0) return;
  suppressCalendarClick = false;
  event.preventDefault();
  event.stopPropagation();
}
function chooseDay(date: Date) {
  focused.value = localDayKey(date);
  emit('select-date', date);
}
function goToToday() {
  const today = new Date();
  chooseDay(today);
  void resetScroll(today);
}
async function onDayKeydown(event: KeyboardEvent, date: Date) {
  const offset = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[event.key];
  if (offset === undefined) return;
  event.preventDefault();
  const target = offsetDays(date, offset);
  focused.value = localDayKey(target);
  if (!days.value.some((day) => day.key === focused.value)) await resetScroll(target);
  await nextTick();
  viewport.value?.querySelector<HTMLButtonElement>(`[data-date="${focused.value}"]`)?.focus();
}
watch(selected, async () => {
  focused.value = selected.value;
  if (!days.value.some((day) => day.key === selected.value)) await resetScroll(selectedDate.value);
  await nextTick();
  const index = days.value.findIndex((day) => day.key === selected.value);
  const element = viewport.value;
  const top = Math.floor(index / 7) * WEEK_HEIGHT;
  if (element && (top < savedScrollTop || top >= savedScrollTop + VISIBLE_WEEKS * WEEK_HEIGHT)) {
    savedScrollTop = top;
    if (element.clientHeight) element.scrollTop = top;
    month.value = selectedDate.value;
  }
});
watch(
  () => store.workspace?.id,
  () => {
    const today = new Date();
    focused.value = selected.value;
    if (draft.value?.scope !== 'personal') {
      draft.value = undefined;
      error.value = '';
      saving.value = false;
    }
    pending.value = pending.value.filter(key => key.startsWith('personal:'));
    void resetScroll(today);
  },
);
onMounted(() => {
  if (listRoot.value) listMotion = createPlanListMotion(listRoot.value);
  document.addEventListener('pointerdown', dismissViewMenu, true);
  document.addEventListener('focusin', dismissViewMenu, true);
  window.addEventListener('resize', placeViewMenu);
  document.addEventListener('scroll', placeViewMenu, true);
  // The sidebar is initially hidden with v-show; restore its position when it opens.
  resizeObserver = new ResizeObserver(() => {
    if (viewport.value?.clientHeight) {
      viewport.value.scrollTop = savedScrollTop;
      placeViewMenu();
    } else viewOpen.value = false;
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
});
onBeforeUnmount(() => {
  listMotion?.dispose();
  finishCalendarDrag();
  resizeObserver?.disconnect();
  document.removeEventListener('pointerdown', dismissViewMenu, true);
  document.removeEventListener('focusin', dismissViewMenu, true);
  window.removeEventListener('resize', placeViewMenu);
  document.removeEventListener('scroll', placeViewMenu, true);
});
</script>

<template>
  <div ref="listRoot" class="sidebar-calendar" role="region" aria-label="计划侧栏">
    <div ref="viewPicker" class="sidebar-calendar-heading">
      <div class="sidebar-calendar-month">
        <span :title="monthTitle"><span class="sidebar-calendar-year">{{ month.getFullYear() }} 年 </span>{{ month.getMonth() + 1 }} 月</span>
        <button ref="viewTrigger" type="button" class="plan-view-trigger" aria-label="计划范围" aria-haspopup="menu" aria-controls="plan-view-menu" :aria-expanded="viewOpen" :title="viewOptions.find(option => option.value === plans.view)?.detail" @click="toggleViewMenu" @keydown.down.prevent="viewOpen || toggleViewMenu()">
          <span>{{ viewLabel }}</span><ChevronDown :size="12" aria-hidden="true" />
        </button>
        <button type="button" class="sidebar-calendar-today" aria-label="回到今天" @click="goToToday">今天</button>
      </div>
      <Teleport to="body">
        <div v-if="viewOpen" id="plan-view-menu" ref="viewMenu" class="plan-scope-menu plan-view-menu" :style="viewMenuPosition" role="menu" aria-label="查看计划" @keydown="onPickerKeydown($event, viewMenu)" @keydown.esc.stop.prevent="closeViewMenu()">
          <span class="plan-scope-menu-heading">查看计划</span>
          <button v-for="option in viewOptions" :key="option.value" type="button" role="menuitemradio" :aria-label="option.label" :aria-checked="plans.view === option.value" :disabled="option.disabled" @click="chooseView(option.value)">
            <component :is="option.icon" :size="16" aria-hidden="true" />
            <span><strong>{{ option.label }}</strong><small :title="option.detail">{{ option.detail }}</small></span>
            <Check v-if="plans.view === option.value" :size="14" aria-hidden="true" />
            <CircleAlert v-else-if="option.value === 'personal' && personalIssue" :size="14" class="plan-issue-icon" aria-hidden="true" />
          </button>
          <div class="plan-connections-menu">
            <button type="button" role="menuitem" @click="openConnections('calendar')"><Cloud :size="15" /><span>日历同步与导入</span></button>
            <button type="button" role="menuitem" @click="openConnections('todo')"><ListTodo :size="15" /><span>Todo 同步与导入</span></button>
          </div>
          <p v-if="store.isDemo" class="plan-view-footnote">浏览器演示 · 数据仅保存在本浏览器</p>
        </div>
      </Teleport>
    </div>
    <PlanConnectionsDialog v-if="connectionKind" :initial-kind="connectionKind" @close="closeConnections" />
    <p v-if="plans.view !== 'personal' && !store.capabilities.features.objectReferences" class="plan-storage-note">
      事件编辑需在工作区设置中启用对象功能。
    </p>
    <details v-if="plans.view !== 'workspace' && personalIssue" class="plan-load-notice" role="status">
      <summary><CircleAlert :size="13" aria-hidden="true" /><span>{{ personalIssueTitle }}</span><ChevronDown :size="12" aria-hidden="true" /></summary>
      <p>{{ plans.loadError || '部分个人事项格式有误，原文件已保留。请修复后重试。' }}</p>
      <p v-for="issue in plans.errors" :key="issue">{{ issue }}</p>
      <button type="button" @click="plans.refreshPersonal()">重试</button>
    </details>
    <div class="sidebar-calendar-weekdays" aria-hidden="true">
      <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</span>
    </div>
    <div
      ref="viewport"
      class="sidebar-calendar-scroll"
      :class="{ dragging: draggingCalendar }"
      role="region"
      aria-label="连续日历，可上下滚动或拖动"
      tabindex="0"
      :style="{ '--week-height': `${WEEK_HEIGHT}px`, height: `${VISIBLE_WEEKS * WEEK_HEIGHT}px` }"
      @scroll.passive="onScroll"
      @pointerdown="startCalendarDrag"
      @lostpointercapture="endCalendarDrag"
      @click.capture="onCalendarClick"
      @dragstart.prevent
    >
      <div class="sidebar-calendar-grid">
        <button
          v-for="day in days"
          :key="day.key"
          type="button"
          class="sidebar-calendar-day"
          :class="{
            'outside-month':
              day.date.getFullYear() !== month.getFullYear() ||
              day.date.getMonth() !== month.getMonth(),
            today: day.key === localDayKey(new Date()),
            'month-start': day.date.getDate() === 1,
          }"
          :data-date="day.key"
          :tabindex="day.key === focused ? 0 : -1"
          :aria-label="`${day.key}，${day.count} 个事件`"
          :aria-pressed="day.key === selected"
          @click="chooseDay(day.date)"
          @keydown="onDayKeydown($event, day.date)"
        >
          <span>{{
            day.date.getDate() === 1 ? `${day.date.getMonth() + 1}月` : day.date.getDate()
          }}</span>
          <i v-if="day.count" class="sidebar-calendar-event-dot" aria-hidden="true" />
        </button>
      </div>
    </div>
    <Teleport to="body">
      <div v-if="draft" class="modal-backdrop plan-create-backdrop" @mousedown.self="closeCreate">
        <section
          ref="createPanel"
          class="modal plan-create-panel"
          role="dialog"
          aria-modal="true"
          aria-label="新建事件"
          :aria-busy="saving"
          tabindex="-1"
          @keydown.stop="onCreateKeydown"
          @mousedown="dismissPickers"
          @focusin="dismissPickers"
        >
          <header>
            <h2>新建事件</h2>
            <div class="plan-create-header-actions">
              <div ref="scopePicker" class="plan-scope-picker">
                <button
                  ref="scopeTrigger"
                  type="button"
                  class="plan-scope-trigger"
                  aria-label="保存到"
                  :title="scopeDescription"
                  aria-haspopup="menu"
                  aria-controls="plan-create-scope-menu"
                  :aria-expanded="scopeOpen"
                  :disabled="saving"
                  @click="toggleScope"
                  @keydown.down.prevent="scopeOpen || toggleScope()"
                >
                  <component :is="draft.scope === 'personal' ? UserRound : FolderOpen" :size="14" aria-hidden="true" />
                  <span>{{ draft.scope === 'personal' ? '个人' : '工作区' }}</span>
                  <ChevronDown :size="13" aria-hidden="true" />
                </button>
                <div
                  v-if="scopeOpen"
                  id="plan-create-scope-menu"
                  class="plan-scope-menu"
                  role="menu"
                  aria-label="保存位置"
                  @keydown="onPickerKeydown($event, scopePicker)"
                  @keydown.esc.stop.prevent="closeScope"
                >
                  <span class="plan-scope-menu-heading">保存到</span>
                  <button type="button" role="menuitemradio" aria-label="工作区" :aria-checked="draft.scope === 'workspace'" :disabled="!plans.workspaceWritable" @click="chooseScope('workspace')">
                    <FolderOpen :size="17" aria-hidden="true" />
                    <span><strong>工作区</strong><small>{{ store.workspace?.name ?? '尚未打开工作区' }}</small></span>
                    <Check v-if="draft.scope === 'workspace'" :size="15" aria-hidden="true" />
                  </button>
                  <button type="button" role="menuitemradio" aria-label="个人" :aria-checked="draft.scope === 'personal'" :disabled="!plans.personalWritable" @click="chooseScope('personal')">
                    <UserRound :size="17" aria-hidden="true" />
                    <span><strong>个人</strong><small>{{ personalNative ? '仅这台设备，不随工作区分享' : '仅当前浏览器，不随工作区分享' }}</small></span>
                    <Check v-if="draft.scope === 'personal'" :size="15" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
          </header>
          <form class="plan-create" aria-label="新建事件" @submit.prevent="saveEvent">
            <input
              ref="nameInput"
              v-model="draft.name"
              class="plan-create-title"
              aria-label="事件名称"
              placeholder="记下一件事…"
              autocomplete="off"
              required
              maxlength="200"
              :disabled="saving || readonly"
            />
            <PlanDateField v-model="draft.planDate" :default-date="selected" :required="!draft.checkable" :disabled="saving || readonly">
              <template #leading>
              <label
                class="plan-checkable"
                :class="{ checked: draft.checkable, disabled: saving || readonly }"
              >
                <input
                  v-model="draft.checkable"
                  type="checkbox"
                  :disabled="saving || readonly"
                  @change="changeCheckable"
                />
                <component
                  :is="draft.checkable ? CircleCheck : Circle"
                  :size="24"
                  :stroke-width="1.8"
                  aria-hidden="true"
                />
                <span>需要完成</span>
              </label>
              </template>
            </PlanDateField>
            <p v-if="error" class="plan-error" role="alert">{{ error }}</p>
            <div class="plan-create-actions">
              <span class="plan-create-hint" aria-hidden="true">Esc 取消 · Enter 创建</span>
              <button type="button" :disabled="saving" @click="closeCreate">取消</button
              ><button type="submit" :disabled="saving || readonly || !draft.name.trim()">
                {{ saving ? '保存中…' : '创建' }}
              </button>
            </div>
          </form>
        </section>
      </div>
    </Teleport>
    <p v-if="error && !draft" class="plan-error" role="alert">{{ error }}</p>
    <section class="sidebar-calendar-agenda" aria-label="当天安排">
      <div class="plan-section-heading" data-plan-layout="agenda-heading">
        <h3>
          {{ selectedTitle }}
          <small>{{ agenda.length }}</small>
        </h3>
        <button
          type="button"
          class="plan-add"
          :aria-label="`为 ${selectedTitle} 添加事件`"
          :disabled="cannotAdd || saving"
          @click="addEvent('event')"
        >
          <Plus :size="14" />
        </button>
      </div>
      <PlanEventList
        :records="agenda"
        :date="selectedDate"
        :disabled="false"
        :can-edit="plans.canEdit"
        :pending="pending"
        :context-key="context?.key"
        :context-menu-id="contextMenuId"
        @context="openContextMenu"
        @select="emit('select-event', $event)"
        @complete="completeEvent"
      >
        <template #empty>
          <p class="sidebar-calendar-empty" data-plan-layout="agenda-empty">
            <CalendarDays :size="15" />{{ plans.view === 'personal' && personalIssue ? '个人事项尚未加载' : '这一天没有安排' }}
          </p>
        </template>
      </PlanEventList>
    </section>
    <section class="sidebar-calendar-agenda plan-unscheduled" aria-label="未安排任务">
      <div class="plan-section-heading" data-plan-layout="unscheduled-heading">
        <h3>
          未安排
          <small>{{ unscheduled.length }}</small>
        </h3>
        <button
          type="button"
          class="plan-add"
          aria-label="添加未安排任务"
          :disabled="cannotAdd || saving"
          @click="addEvent('task')"
        >
          <Plus :size="14" />
        </button>
      </div>
      <PlanEventList
        :records="unscheduled"
        :date="selectedDate"
        :disabled="false"
        :can-edit="plans.canEdit"
        :pending="pending"
        :context-key="context?.key"
        :context-menu-id="contextMenuId"
        @context="openContextMenu"
        @select="emit('select-event', $event)"
        @complete="completeEvent"
      >
        <template #empty>
          <p class="sidebar-calendar-empty" data-plan-layout="unscheduled-empty">
            <ListTodo :size="15" />{{ plans.view === 'personal' && personalIssue ? '个人事项尚未加载' : '没有未安排的任务' }}
          </p>
        </template>
      </PlanEventList>
    </section>
    <section class="sidebar-calendar-agenda plan-completed" aria-label="已完成任务">
      <h3 class="plan-completed-heading" data-plan-layout="completed-heading">
        <button
          type="button"
          class="plan-completed-toggle"
          aria-label="已完成"
          :aria-expanded="completedExpanded"
          :aria-controls="completedListId"
          @click="completedExpanded = !completedExpanded"
        >
          <span>已完成 <small>{{ completed.length }}</small></span>
          <ChevronDown :size="14" aria-hidden="true" />
        </button>
      </h3>
      <div :id="completedListId" :hidden="!completedExpanded">
        <template v-if="completedExpanded">
          <PlanEventList
            :records="completed"
            :date="selectedDate"
            show-date
            :disabled="false"
            :can-edit="plans.canEdit"
            :pending="pending"
            :context-key="context?.key"
            :context-menu-id="contextMenuId"
            @context="openContextMenu"
            @select="emit('select-event', $event)"
            @complete="completeEvent"
          >
            <template #empty>
              <p class="sidebar-calendar-empty" data-plan-layout="completed-empty">
                <CircleCheck :size="15" />{{ plans.view === 'personal' && personalIssue ? '个人事项尚未加载' : '没有已完成的任务' }}
              </p>
            </template>
          </PlanEventList>
        </template>
      </div>
    </section>
    <PlanEventContextMenu
      v-if="context && contextRecord"
      :id="contextMenuId"
      :record="contextRecord"
      :position="context"
      :disabled="!plans.canEdit(contextRecord) || pending.includes(context.key)"
      @action="contextAction"
      @close="closeContextMenu"
    />
  </div>
</template>

<style scoped>
.plan-view-trigger { display: flex; flex-shrink: 0; align-items: center; gap: 4px; height: 24px; padding: 2px 6px; border-radius: 5px; color: var(--muted); font-size: 12px; font-weight: 400; line-height: inherit; }
.plan-view-trigger > svg { color: var(--muted); }
.plan-view-trigger:hover,
.plan-view-trigger[aria-expanded='true'] { background: var(--hover); color: var(--text); }
.plan-view-footnote { margin: 6px 5px 2px; padding: 8px 4px 2px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; line-height: 1.5; }
.plan-load-notice { margin: 0 0 14px; border: 1px solid var(--line); border-radius: 6px; padding: 7px 8px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.plan-load-notice summary { display: flex; align-items: center; gap: 6px; list-style: none; cursor: pointer; }
.plan-load-notice summary::-webkit-details-marker { display: none; }
.plan-load-notice summary span { flex: 1; }
.plan-load-notice summary svg { flex: 0 0 auto; }
.plan-load-notice[open] summary > svg:last-child { transform: rotate(180deg); }
.plan-load-notice p { margin: 7px 0; overflow-wrap: anywhere; }
.plan-load-notice button { color: var(--green); }
.plan-issue-icon { color: var(--warning); }
.sidebar-calendar {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  margin: 6px -7px 0 0;
  padding: 4px 11px 18px 4px;
  scrollbar-width: none;
}
.sidebar-calendar::-webkit-scrollbar,
.sidebar-calendar-scroll::-webkit-scrollbar {
  display: none;
}
.sidebar-calendar-heading,
.sidebar-calendar-month {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.sidebar-calendar-heading {
  position: relative;
  gap: 8px;
  color: var(--text);
  font-size: 13px;
  line-height: 20px;
  padding: 2px 0 10px;
}
.plan-storage-note {
  margin: 0 0 12px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
}
.plan-add {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 5px;
  color: var(--muted);
}
.plan-add:hover {
  color: var(--text);
  background: var(--hover);
}
.plan-section-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 5px;
}
.plan-section-heading h3 {
  margin: 0;
}
.plan-unscheduled,
.plan-completed {
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.sidebar-calendar-agenda .plan-completed-heading { margin: 0; }
.plan-completed-toggle {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: 4px 0;
  border-radius: 5px;
  color: inherit;
  font: inherit;
  text-align: left;
}
.plan-completed-toggle:hover { background: var(--hover); color: var(--text); }
.plan-completed-toggle:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.plan-completed-toggle > svg { transform: rotate(-90deg); transition: transform 150ms ease; }
.plan-completed-toggle[aria-expanded='true'] > svg { transform: rotate(0); }
.plan-create-backdrop {
  z-index: 90;
  padding: max(24px, 26vh) 20px 24px;
  background: #1f23282b;
  backdrop-filter: none;
}
.plan-create-panel {
  width: 480px;
  padding: 22px 28px 24px;
  border-radius: 14px;
  border-color: color-mix(in srgb, var(--line) 55%, transparent);
  box-shadow: 0 18px 60px #1f232824;
}
.plan-create-panel > header {
  margin-bottom: 24px;
}
.plan-create-panel h2 {
  font-size: 14px;
  font-weight: 400;
  color: var(--muted);
}
.plan-create-header-actions {
  display: flex;
  align-items: center;
  gap: 14px;
}
.plan-scope-picker { position: relative; }
.plan-scope-trigger {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 4px 7px;
  border-radius: 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 20px;
}
.plan-scope-trigger:hover,
.plan-scope-trigger[aria-expanded='true'] {
  background: var(--surface);
  color: var(--text);
}
.plan-scope-menu {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  z-index: 2;
  width: min(264px, calc(100vw - 80px));
  padding: 6px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: 0 8px 28px #1f232820;
}
.plan-scope-menu-heading {
  display: block;
  padding: 5px 9px 7px;
  color: var(--muted);
  font-size: 11px;
}
.plan-scope-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 10px;
  border-radius: 6px;
  text-align: left;
  color: var(--text-secondary);
}
.plan-scope-menu button > span { flex: 1; min-width: 0; }
.plan-scope-menu button > svg { flex: 0 0 auto; }
.plan-scope-menu strong { display: block; color: var(--text); font-size: 13px; font-weight: 500; }
.plan-scope-menu small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.plan-scope-menu button[aria-checked='true'] { background: var(--accent); color: var(--green); }
.plan-scope-menu button:not(:disabled):hover { background: var(--hover); }
.plan-view-menu {
  position: fixed;
  right: auto;
  z-index: 40;
  width: 248px;
  max-width: calc(100vw - 24px);
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  padding: 4px;
}
.plan-view-menu .plan-scope-menu-heading { padding: 4px 8px 6px; line-height: 16px; }
.plan-view-menu button { gap: 8px; padding: 6px 8px; line-height: 18px; }
.plan-view-menu strong { line-height: 18px; }
.plan-view-menu small { margin-top: 0; line-height: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.plan-view-menu button:disabled { opacity: 0.5; cursor: not-allowed; }
.plan-connections-menu { margin-top: 4px; padding-top: 4px; border-top: 1px solid var(--line); }
.plan-connections-menu button { font-size: 12px; }
.plan-create-header-actions button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.plan-create-header-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
.plan-create {
  margin: 0;
}
.plan-create .plan-create-title {
  width: 100%;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 26px;
  font-weight: 550;
  line-height: 1.5;
  caret-color: var(--green);
}
.plan-create .plan-create-title::placeholder {
  color: var(--muted);
  font-weight: 400;
}
.plan-create .plan-create-title:focus-visible {
  outline: none;
}
.plan-create > .plan-date-field { margin-top: 28px; }
.plan-create .plan-checkable {
  position: relative;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 12px;
  min-height: 36px;
  margin: 0;
  padding: 4px 6px;
  margin-left: -6px;
  border-radius: 6px;
  font-size: 15px;
  color: var(--muted);
  cursor: pointer;
}
.plan-checkable.checked {
  color: var(--green);
}
.plan-checkable:not(.disabled):hover {
  background: var(--hover);
}
.plan-checkable.disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plan-checkable input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  padding: 0;
  clip-path: inset(50%);
  overflow: hidden;
}
.plan-checkable:has(input:focus-visible) {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.plan-create-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid var(--line);
}
.plan-create-hint {
  margin-right: auto;
  color: var(--muted);
  font-size: 13px;
}
.plan-create-actions button {
  min-height: 38px;
  padding: 9px 18px;
  border-radius: 7px;
  font-size: 14px;
  color: var(--text);
}
.plan-create-actions button[type='submit'] {
  background: var(--green-fill);
  color: white;
}
.plan-create-actions button[type='submit']:not(:disabled):hover {
  background: var(--green-fill-hover);
}
@media (max-width: 480px) {
  .plan-create-backdrop {
    padding: max(20px, 12vh) 12px 20px;
  }
  .plan-create-panel {
    padding: 20px;
  }
  .plan-create .plan-create-title {
    font-size: 23px;
  }
}
@media (max-height: 600px) {
  .plan-create-backdrop {
    padding-top: 24px;
  }
}
.plan-error {
  color: var(--danger, #b54141);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.plan-add:focus-visible,
.plan-view-trigger:focus-visible,
.plan-view-menu button:focus-visible,
.plan-load-notice summary:focus-visible,
.plan-load-notice button:focus-visible,
.plan-create input:focus-visible,
.plan-create select:focus-visible,
.plan-create button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.plan-add:disabled,
.plan-create button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.sidebar-calendar-today {
  display: grid;
  flex-shrink: 0;
  place-items: center;
  margin-left: auto;
  min-width: 34px;
  height: 26px;
  border-radius: 6px;
  color: var(--muted);
}
.sidebar-calendar-scroll {
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior-y: contain;
  overflow-anchor: none;
  scrollbar-width: none;
  touch-action: pan-y;
  user-select: none;
  cursor: grab;
}
.sidebar-calendar-scroll.dragging {
  cursor: grabbing;
}
.sidebar-calendar-scroll:focus-visible {
  outline: 1px solid var(--green);
  outline-offset: 2px;
  border-radius: 6px;
}
.sidebar-calendar-today:hover {
  background: var(--hover);
  color: var(--text);
}
.sidebar-calendar-month {
  container: plan-month-header / inline-size;
  flex: 1;
  min-width: 0;
  justify-content: flex-start;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
}
.sidebar-calendar-month > span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
@container plan-month-header (max-width: 190px) {
  .sidebar-calendar-year { display: none; }
}
.sidebar-calendar-weekdays,
.sidebar-calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.sidebar-calendar-weekdays span {
  color: var(--muted);
  font-size: 11px;
  text-align: center;
  padding-bottom: 6px;
}
.sidebar-calendar-day {
  position: relative;
  display: grid;
  place-items: center;
  min-width: 0;
  height: var(--week-height);
  padding: 0;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  cursor: inherit;
}
.sidebar-calendar-day:hover,
.sidebar-calendar-day[aria-pressed='true'] {
  background: var(--hover);
  color: var(--text);
}
.sidebar-calendar-day[aria-pressed='true'] {
  font-weight: 600;
}
.sidebar-calendar-day.outside-month {
  color: color-mix(in srgb, var(--muted) 65%, transparent);
}
.sidebar-calendar-day.month-start {
  font-size: 10px;
  font-weight: 600;
}
.sidebar-calendar-day:focus-visible {
  outline: 1px solid var(--green);
  outline-offset: -1px;
}
.sidebar-calendar-day.today > span {
  display: grid;
  place-items: center;
  width: min(18px, 100%);
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--green-fill);
  color: white;
}
.sidebar-calendar-event-dot {
  position: absolute;
  bottom: 1px;
  width: 3px;
  height: 3px;
  border-radius: 50%;
  background: var(--green);
}
.sidebar-calendar-agenda {
  margin-top: 21px;
}
.sidebar-calendar-agenda h3 {
  margin: 0 0 9px;
  color: var(--muted);
  font-size: 12px;
  font-weight: 600;
}
.sidebar-calendar-agenda h3 small {
  font-size: 11px;
  font-weight: 400;
  margin-left: 3px;
}
.sidebar-calendar-empty {
  display: flex;
  align-items: center;
  gap: 7px;
  margin: 0;
  color: var(--muted);
  font-size: 12px;
  padding: 7px 2px;
}
</style>
