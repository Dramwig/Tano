<script setup lang="ts">
import './calendar-shared.css';
import { computed, onMounted, onUnmounted, ref, shallowRef, useId } from 'vue';
import { X } from 'lucide-vue-next';
import LoadingSkeleton from '../../shell/components/LoadingSkeleton.vue';
import { t, uiLocale } from '../../i18n/i18n';
import { useWindowContext } from '../../windows/context';
import type { ObjectRecord } from '../../objects/workspace-objects';
import { usePlanStore, type PlanScope } from '../../stores/plans';
import {
  calendarDayEntries,
  calendarEvents,
  filterCalendarRecords,
  localDayKey,
  planningEvents,
  type CalendarFilter,
  type CalendarViewMode,
} from '../calendar';
import { expandRecurringPlans } from '../recurrence';
import { writePlanDate, type PlanDateValue } from '../plan-date';
import { useCalendarScroll } from '../composables/use-calendar-scroll';
import { useCalendarInteractions } from '../composables/use-calendar-interactions';
import CalendarDayPopover from './CalendarDayPopover.vue';
import CalendarFilterBar from './CalendarFilterBar.vue';
import CalendarQuickCreateDialog, { type QuickCreateDraft } from './CalendarQuickCreateDialog.vue';
import CalendarTimelineView from './CalendarTimelineView.vue';
import CalendarMonthView from './CalendarMonthView.vue';
import CalendarYearView from './CalendarYearView.vue';
import CalendarAgendaView from './CalendarAgendaView.vue';

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

const { window } = useWindowContext();
const plans = usePlanStore();
const scroll = ref<HTMLElement>();
const filter = ref<CalendarFilter>({ kind: 'all', showCompleted: true, query: '' });
const nowMinutes = ref(currentMinutes());
let nowTimer: ReturnType<typeof setInterval> | undefined;

function currentMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

const dayPopover = shallowRef<{ date: Date; anchor: HTMLElement; scrollTop: number; scrollLeft: number }>();
const dayPopoverId = useId();
const dayPopoverKey = computed(() => dayPopover.value && localDayKey(dayPopover.value.date));

const {
  timeline,
  timelineDays,
  timelineDayWidth,
  scrollingWeeks,
  scrollingYears,
  visibleWindow,
  onCalendarScroll,
  onCalendarWheel,
} = useCalendarScroll({
  date: () => props.date,
  mode: () => props.mode,
  scroll,
  window,
  onVisibleMonth: (value) => emit('visible-month', value),
  onVisibleYear: (value) => emit('visible-year', value),
  onVisibleTimeline: (value) => emit('visible-timeline', value),
  onSelectMode: (value) => emit('select-mode', value),
  onBeforeViewChange: () => { dayPopover.value = undefined; },
  onScrolled: () => {
    if (
      dayPopover.value &&
      scroll.value &&
      (dayPopover.value.scrollTop !== scroll.value.scrollTop ||
        dayPopover.value.scrollLeft !== scroll.value.scrollLeft)
    ) {
      dayPopover.value = undefined;
    }
  },
});

const rawPlanned = computed(() => planningEvents(props.records ?? plans.records));
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

const today = computed(() => localDayKey(new Date()));
const weekdays = computed(() =>
  uiLocale.value === 'zh-CN'
    ? ['一', '二', '三', '四', '五', '六', '日']
    : Array.from({ length: 7 }, (_, index) =>
        new Intl.DateTimeFormat(uiLocale.value, { weekday: 'short' }).format(new Date(2024, 0, 1 + index)),
      ),
);
const viewLabel = computed(
  () =>
    ({
      day: t('日视图'),
      'four-days': t('4 天视图'),
      week: t('周视图'),
      month: t('月视图'),
      year: t('年视图'),
      agenda: t('日程视图'),
    })[props.mode],
);

// --- Quick-Create State ---
const createDraft = ref<QuickCreateDraft>();
const createSaving = ref(false);
const createError = ref('');

function openQuickCreate(planDate: PlanDateValue, checkable = false) {
  if (!canCreate.value || createSaving.value) return;
  const preferred: PlanScope = plans.defaultScope === 'personal' ? 'personal' : 'workspace';
  const scope: PlanScope =
    preferred === 'personal'
      ? (canCreatePersonal.value ? 'personal' : 'workspace')
      : (canCreateWorkspace.value ? 'workspace' : 'personal');
  createError.value = '';
  createDraft.value = { name: '', checkable, planDate, scope };
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

const interactions = useCalendarInteractions({
  plans,
  records: () => props.records,
  today,
  canCreate,
  window,
  openQuickCreate,
});

const dayPopoverEntries = (day: Date) => calendarDayEntries(planned.value, day);
function openDayPopover(day: Date, event: MouseEvent) {
  dayPopover.value =
    dayPopoverKey.value === localDayKey(day)
      ? undefined
      : {
          date: day,
          anchor: event.currentTarget as HTMLElement,
          scrollTop: scroll.value?.scrollTop ?? 0,
          scrollLeft: scroll.value?.scrollLeft ?? 0,
        };
}

onMounted(() => {
  nowTimer = setInterval(() => { nowMinutes.value = currentMinutes(); }, 60_000);
});
onUnmounted(() => {
  if (nowTimer) clearInterval(nowTimer);
});
</script>

<template>
  <div class="calendar-shell">
    <CalendarFilterBar v-model="filter" />
    <p v-if="interactions.interactionError.value" class="calendar-error-banner" role="alert">
      <span>{{ interactions.interactionError.value }}</span>
      <button type="button" :aria-label="t('关闭')" @click="interactions.interactionError.value = ''"><X :size="14" /></button>
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
        <CalendarTimelineView
          v-if="timeline"
          :date="date"
          :mode="mode"
          :timeline-days="timelineDays"
          :timeline-day-width="timelineDayWidth"
          :planned="planned"
          :events="events"
          :today="today"
          :now-minutes="nowMinutes"
          :weekdays="weekdays"
          :can-create="canCreate"
          :interactions="interactions"
          @select-event="emit('select-event', $event)"
        />
        <CalendarMonthView
          v-else-if="mode === 'month'"
          :scrolling-weeks="scrollingWeeks"
          :planned="planned"
          :today="today"
          :weekdays="weekdays"
          :can-create="canCreate"
          :day-popover-key="dayPopoverKey"
          :day-popover-id="dayPopoverId"
          :interactions="interactions"
          @select-date="emit('select-date', $event)"
          @select-event="emit('select-event', $event)"
          @open-day-popover="openDayPopover"
          @open-quick-create="openQuickCreate"
        />
        <CalendarYearView
          v-else-if="mode === 'year'"
          :scrolling-years="scrollingYears"
          :planned="planned"
          :today="today"
          :weekdays="weekdays"
          :day-popover-key="dayPopoverKey"
          :day-popover-id="dayPopoverId"
          @select-month="emit('select-month', $event)"
          @open-day-popover="openDayPopover"
        />
        <CalendarAgendaView
          v-else
          :date="date"
          :planned="planned"
          :today="today"
          :weekdays="weekdays"
          :interactions="interactions"
          @select-event="emit('select-event', $event)"
        />
      </div>
    </main>
  </div>
  <CalendarQuickCreateDialog
    :draft="createDraft"
    :saving="createSaving"
    :error="createError"
    :default-date="localDayKey(date)"
    :can-create-workspace="canCreateWorkspace"
    :can-create-personal="canCreatePersonal"
    @close="closeQuickCreate"
    @submit="submitQuickCreate"
  />
  <CalendarDayPopover
    v-if="(mode === 'year' || mode === 'month') && dayPopover"
    :id="dayPopoverId"
    :date="dayPopover.date"
    :anchor="dayPopover.anchor"
    :records="dayPopoverEntries(dayPopover.date).map(entry => entry.record)"
    :entries="dayPopoverEntries(dayPopover.date)"
    :can-edit="interactions.canEditRecord"
    :pending="interactions.pending.value"
    @close="dayPopover = undefined"
    @select-event="emit('select-event', $event)"
    @toggle-complete="interactions.toggleComplete"
  />
</template>

<style scoped>
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
</style>
