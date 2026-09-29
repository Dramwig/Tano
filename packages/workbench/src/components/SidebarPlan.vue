<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Circle,
  CircleCheck,
  Clock3,
  Plus,
  ListTodo,
  X,
} from 'lucide-vue-next';
import type { ObjectRecord } from '../workspace-objects';
import {
  hasEventTime,
  isCheckableEvent,
  isEventCompleted,
  planningEvents,
  plannedEventsOnDay,
  unscheduledTasks,
  localDateTime,
  localDayKey,
  weekDays,
} from '../calendar';
import { useWorkspaceStore } from '../stores/workspace';
import PlanEventList from './PlanEventList.vue';

const props = defineProps<{ date: Date }>();
const emit = defineEmits<{ 'select-date': [date: Date]; 'select-event': [id: string] }>();
const store = useWorkspaceStore();
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
let savedScrollTop = BUFFER_WEEKS * WEEK_HEIGHT;
let repositioning = false;
let resizeObserver: ResizeObserver | undefined;
const events = computed(() => planningEvents(store.objects));
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
const unscheduled = computed(() => unscheduledTasks(events.value));
const monthTitle = computed(
  () => `${month.value.getFullYear()} 年 ${month.value.getMonth() + 1} 月`,
);
const selectedTitle = computed(
  () => `${selectedDate.value.getMonth() + 1} 月 ${selectedDate.value.getDate()} 日`,
);
const readonly = computed(
  () =>
    !store.workspace || store.workspace.readOnly || !store.capabilities.features.objectReferences,
);
const pending = ref<string[]>([]);
const saving = ref(false);
const error = ref('');
const nameInput = ref<HTMLInputElement>();
const createPanel = ref<HTMLElement>();
const schedulePicker = ref<HTMLElement>();
const scheduleTrigger = ref<HTMLButtonElement>();
const scheduleOpen = ref(false);
let previousCreateFocus: HTMLElement | null = null;
interface EventDraft {
  name: string;
  checkable: boolean;
  schedule: 'none' | 'date' | 'time';
  date: string;
  start: string;
  end: string;
}
const draft = ref<EventDraft>();
const scheduleOptions = computed(() => [
  ...(draft.value?.checkable
    ? ([
        { value: 'none', label: '未安排', icon: ListTodo },
        { value: 'date', label: '仅日期', icon: CalendarDays },
      ] as const)
    : []),
  { value: 'time', label: '时间段', icon: Clock3 } as const,
]);
const scheduleLabel = computed(
  () => scheduleOptions.value.find((option) => option.value === draft.value?.schedule)?.label,
);
async function toggleSchedule() {
  scheduleOpen.value = !scheduleOpen.value;
  if (!scheduleOpen.value) return;
  await nextTick();
  schedulePicker.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}
async function closeSchedule() {
  scheduleOpen.value = false;
  await nextTick();
  scheduleTrigger.value?.focus();
}
function chooseSchedule(value: EventDraft['schedule']) {
  if (!draft.value || saving.value || readonly.value) return;
  draft.value.schedule = value;
  void closeSchedule();
}
function onScheduleKeydown(event: KeyboardEvent) {
  const options = [
    ...(schedulePicker.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []),
  ];
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
function dismissSchedule(event: MouseEvent | FocusEvent) {
  if (event.target instanceof Node && !schedulePicker.value?.contains(event.target))
    scheduleOpen.value = false;
}
async function addEvent(schedule: EventDraft['schedule']) {
  if (readonly.value || saving.value) return;
  if (!draft.value) {
    previousCreateFocus = document.activeElement as HTMLElement | null;
    const day = selectedDate.value;
    draft.value = {
      name: '',
      checkable: true,
      schedule,
      date: selected.value,
      start: localDateTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 9)),
      end: localDateTime(new Date(day.getFullYear(), day.getMonth(), day.getDate(), 10)),
    };
  }
  error.value = '';
  await nextTick();
  nameInput.value?.focus();
}
function closeCreate() {
  if (saving.value) return;
  scheduleOpen.value = false;
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
    scheduleOpen.value = false;
    await nextTick();
    if (previousCreateFocus?.isConnected) previousCreateFocus.focus({ preventScroll: true });
    previousCreateFocus = null;
  },
);
watch(saving, async (busy) => {
  if (busy) scheduleOpen.value = false;
  await nextTick();
  if (!draft.value) return;
  if (busy) createPanel.value?.focus({ preventScroll: true });
  else nameInput.value?.focus({ preventScroll: true });
});
function changeCheckable() {
  if (draft.value && !draft.value.checkable) draft.value.schedule = 'time';
}
async function saveEvent() {
  const value = draft.value;
  const workspaceId = store.workspace?.id;
  if (!value || !workspaceId || readonly.value || saving.value || !value.name.trim()) return;
  saving.value = true;
  error.value = '';
  try {
    const properties: Record<string, unknown> = { checkable: value.checkable, completed: false };
    if (value.schedule === 'date') properties.date = value.date;
    if (value.schedule === 'time') {
      properties.start = new Date(value.start).toISOString();
      properties.end = new Date(value.end).toISOString();
    }
    await store.createObject({
      type: 'event',
      name: value.name.trim(),
      description: '',
      archived: false,
      properties,
    });
    if (store.workspace?.id === workspaceId && draft.value === value) draft.value = undefined;
  } catch (cause) {
    if (store.workspace?.id === workspaceId) error.value = String(cause);
  } finally {
    if (store.workspace?.id === workspaceId) saving.value = false;
  }
}
async function updateEvent(record: ObjectRecord, properties: Record<string, unknown>) {
  const workspaceId = store.workspace?.id;
  if (!workspaceId || readonly.value || pending.value.includes(record.object.id)) return;
  pending.value.push(record.object.id);
  error.value = '';
  try {
    await store.updateObject(record, { ...record.object, properties }, workspaceId);
  } catch (cause) {
    if (store.workspace?.id === workspaceId) error.value = String(cause);
  } finally {
    if (store.workspace?.id === workspaceId)
      pending.value = pending.value.filter((id) => id !== record.object.id);
  }
}
function completeEvent(record: ObjectRecord, completed: boolean) {
  if (!isCheckableEvent(record)) return;
  const properties = { ...record.object.properties, completed };
  if (record.object.type === 'task')
    Object.assign(properties, { status: completed ? 'done' : 'todo' });
  return updateEvent(record, properties);
}
function scheduleEvent(record: ObjectRecord) {
  if (hasEventTime(record)) return;
  return updateEvent(record, { ...record.object.properties, date: selected.value });
}

async function resetScroll(date: Date) {
  repositioning = true;
  start.value = offsetDays(firstWeek(date), -BUFFER_WEEKS * 7);
  month.value = date;
  savedScrollTop = BUFFER_WEEKS * WEEK_HEIGHT;
  await nextTick();
  if (viewport.value?.clientHeight) viewport.value.scrollTop = savedScrollTop;
  repositioning = false;
}
async function onScroll() {
  const element = viewport.value;
  if (!element?.clientHeight || repositioning) return;
  savedScrollTop = element.scrollTop;
  const week = Math.floor(savedScrollTop / WEEK_HEIGHT);
  // Thursday identifies the month containing most of the top visible week.
  month.value = offsetDays(start.value, week * 7 + 3);
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
    draft.value = undefined;
    error.value = '';
    pending.value = [];
    saving.value = false;
    void resetScroll(today);
  },
);
onMounted(() => {
  // The sidebar is initially hidden with v-show; restore its position when it opens.
  resizeObserver = new ResizeObserver(() => {
    if (viewport.value?.clientHeight) viewport.value.scrollTop = savedScrollTop;
  });
  if (viewport.value) resizeObserver.observe(viewport.value);
});
onBeforeUnmount(() => resizeObserver?.disconnect());
</script>

<template>
  <div class="sidebar-calendar" role="region" aria-label="计划侧栏">
    <div class="sidebar-calendar-heading">
      <strong>计划</strong>
      <button
        type="button"
        class="plan-add"
        aria-label="添加事件"
        title="添加事件"
        :disabled="readonly || saving"
        @click="addEvent('none')"
      >
        <Plus :size="16" />
      </button>
    </div>
    <p v-if="store.isDemo" class="plan-storage-note">浏览器演示存储</p>
    <p v-if="!store.capabilities.features.objectReferences" class="plan-storage-note">
      事件编辑需在工作区设置中启用对象功能。
    </p>
    <div class="sidebar-calendar-month">
      <span>{{ monthTitle }}</span>
      <button type="button" aria-label="回到今天" @click="goToToday">今天</button>
    </div>
    <div class="sidebar-calendar-weekdays" aria-hidden="true">
      <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">{{ day }}</span>
    </div>
    <div
      ref="viewport"
      class="sidebar-calendar-scroll"
      role="region"
      aria-label="连续日历，可上下滚动"
      tabindex="0"
      :style="{ '--week-height': `${WEEK_HEIGHT}px`, height: `${VISIBLE_WEEKS * WEEK_HEIGHT}px` }"
      @scroll.passive="onScroll"
    >
      <div class="sidebar-calendar-grid">
        <button
          v-for="day in days"
          :key="day.key"
          type="button"
          class="sidebar-calendar-day"
          :class="{
            alternate: day.date.getMonth() % 2 === 1,
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
          @mousedown="dismissSchedule"
          @focusin="dismissSchedule"
        >
          <header>
            <h2>新建事件</h2>
            <button
              type="button"
              class="icon-button"
              aria-label="关闭新建事件"
              :disabled="saving"
              @click="closeCreate"
            >
              <X :size="18" />
            </button>
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
            <div class="plan-create-properties">
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
              <div ref="schedulePicker" class="plan-schedule-picker">
                <button
                  ref="scheduleTrigger"
                  type="button"
                  class="plan-schedule-trigger"
                  aria-label="时间安排"
                  aria-haspopup="menu"
                  aria-controls="plan-create-schedule-menu"
                  :aria-expanded="scheduleOpen"
                  :disabled="saving || readonly"
                  @click="toggleSchedule"
                  @keydown.down.prevent="scheduleOpen || toggleSchedule()"
                >
                  <CalendarDays :size="22" :stroke-width="1.8" aria-hidden="true" />
                  <span>{{ scheduleLabel }}</span>
                  <ChevronDown :size="16" aria-hidden="true" />
                </button>
                <div
                  v-if="scheduleOpen"
                  id="plan-create-schedule-menu"
                  class="plan-schedule-menu"
                  role="menu"
                  aria-label="时间安排"
                  @keydown="onScheduleKeydown"
                >
                  <button
                    v-for="option in scheduleOptions"
                    :key="option.value"
                    type="button"
                    role="menuitemradio"
                    :aria-checked="draft.schedule === option.value"
                    @click="chooseSchedule(option.value)"
                  >
                    <component :is="option.icon" :size="17" aria-hidden="true" />
                    <span>{{ option.label }}</span>
                    <Check v-if="draft.schedule === option.value" :size="16" aria-hidden="true" />
                  </button>
                </div>
              </div>
            </div>
            <div v-if="draft.schedule !== 'none'" class="plan-create-dates">
              <label v-if="draft.schedule === 'date'"
                >计划日期<input
                  v-model="draft.date"
                  type="date"
                  required
                  :disabled="saving || readonly"
              /></label>
              <template v-if="draft.schedule === 'time'">
                <label
                  >开始时间<input
                    v-model="draft.start"
                    type="datetime-local"
                    required
                    :disabled="saving || readonly"
                /></label>
                <label
                  >结束时间<input
                    v-model="draft.end"
                    type="datetime-local"
                    required
                    :min="draft.start"
                    :disabled="saving || readonly"
                /></label>
              </template>
            </div>
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
      <div class="plan-section-heading">
        <h3>
          {{ selectedTitle }}
          <small>{{ agenda.filter((record) => !isEventCompleted(record)).length }}</small>
        </h3>
        <button
          type="button"
          class="plan-add"
          :aria-label="`为 ${selectedTitle} 添加事件`"
          :disabled="readonly || saving"
          @click="addEvent('date')"
        >
          <Plus :size="14" />
        </button>
      </div>
      <p v-if="!agenda.length" class="sidebar-calendar-empty">
        <CalendarDays :size="15" />这一天没有安排
      </p>
      <PlanEventList
        v-else
        :records="agenda"
        :date="selectedDate"
        :disabled="readonly"
        :pending="pending"
        @select="emit('select-event', $event)"
        @complete="completeEvent"
      />
    </section>
    <section class="sidebar-calendar-agenda plan-unscheduled" aria-label="未安排任务">
      <div class="plan-section-heading">
        <h3>
          未安排
          <small>{{ unscheduled.filter((record) => !isEventCompleted(record)).length }}</small>
        </h3>
        <button
          type="button"
          class="plan-add"
          aria-label="添加未安排任务"
          :disabled="readonly || saving"
          @click="addEvent('none')"
        >
          <Plus :size="14" />
        </button>
      </div>
      <p v-if="!unscheduled.length" class="sidebar-calendar-empty">
        <ListTodo :size="15" />没有未安排的任务
      </p>
      <PlanEventList
        v-else
        :records="unscheduled"
        :date="selectedDate"
        :disabled="readonly"
        :pending="pending"
        unscheduled
        @select="emit('select-event', $event)"
        @complete="completeEvent"
        @schedule="scheduleEvent"
      />
    </section>
  </div>
</template>

<style scoped>
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
  color: var(--text);
  font-size: 13px;
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
.plan-unscheduled {
  border-top: 1px solid var(--line);
  padding-top: 14px;
}
.plan-create-backdrop {
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
.plan-create-panel > header .icon-button {
  width: 28px;
  height: 28px;
  margin-right: -6px;
  border-radius: 6px;
  color: var(--text-secondary);
}
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
.plan-create-properties {
  display: flex;
  align-items: center;
  gap: 22px;
  margin-top: 28px;
}
.plan-create-dates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr));
  gap: 16px;
  margin-top: 22px;
}
.plan-create-dates label {
  display: grid;
  gap: 8px;
  min-width: 0;
  margin: 0;
  color: var(--text-secondary);
  font-size: 13px;
}
.plan-create-dates input {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  padding: 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  color: var(--text);
  background: var(--paper);
  font-size: 14px;
}
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
.plan-schedule-picker {
  position: relative;
  padding-left: 20px;
  border-left: 1px solid var(--line);
}
.plan-schedule-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 36px;
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 15px;
  color: var(--text-secondary);
}
.plan-schedule-menu {
  position: absolute;
  top: calc(100% + 6px);
  left: 20px;
  z-index: 1;
  min-width: 176px;
  padding: 5px;
  border: 1px solid var(--line);
  border-radius: 9px;
  background: var(--paper);
  box-shadow: 0 6px 24px #1f23281c;
}
.plan-schedule-menu button {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 9px;
  border-radius: 5px;
  text-align: left;
  font-size: 13px;
}
.plan-schedule-menu button span {
  flex: 1;
}
.plan-schedule-menu button[aria-checked='true'] {
  color: var(--green);
  background: var(--accent);
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
  .plan-create-properties {
    gap: 12px;
  }
  .plan-schedule-picker {
    padding-left: 12px;
  }
  .plan-schedule-menu {
    left: auto;
    right: 0;
    min-width: 152px;
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
.sidebar-calendar-month button {
  display: grid;
  place-items: center;
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
}
.sidebar-calendar-scroll:focus-visible {
  outline: 1px solid var(--green);
  outline-offset: 2px;
  border-radius: 6px;
}
.sidebar-calendar-month button:hover {
  background: var(--hover);
  color: var(--text);
}
.sidebar-calendar-month {
  color: var(--text-secondary);
  font-size: 12px;
  font-weight: 600;
  margin-bottom: 10px;
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
}
.sidebar-calendar-day:hover,
.sidebar-calendar-day[aria-pressed='true'] {
  background: var(--hover);
  color: var(--text);
}
.sidebar-calendar-day[aria-pressed='true'] {
  font-weight: 600;
}
.sidebar-calendar-day.alternate {
  color: var(--muted);
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
  width: min(22px, 100%);
  aspect-ratio: 1;
  border-radius: 50%;
  background: var(--green-fill);
  color: white;
}
.sidebar-calendar-event-dot {
  position: absolute;
  bottom: 2px;
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
