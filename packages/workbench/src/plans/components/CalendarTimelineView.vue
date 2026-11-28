<script setup lang="ts">
import { computed } from 'vue';
import { Circle, CircleCheck, Flag } from 'lucide-vue-next';
import { t, uiLocale } from '../../i18n/i18n';
import {
  isCheckableEvent,
  isEventCompleted,
  localDayKey,
  visibleCalendarDays,
  type CalendarViewMode,
} from '../calendar';
import { formatMinutesLabel } from '../calendar-interaction';
import { EMPTY_ENTRIES, EMPTY_RECORDS, getCachedDayTimedLayout, type PlanDayIndex } from '../plan-index';
import type { TimedEventBlock } from '../timeline-layout';
import { planKey, sourcePlanKey } from '../personal-plans';
import type { CalendarInteractions } from '../composables/use-calendar-interactions';
import { CALENDAR_AXIS_WIDTH, CALENDAR_HOUR_HEIGHT } from '../composables/use-calendar-scroll';
import type { IndexRange } from '../composables/use-calendar-viewport';

const props = defineProps<{
  date: Date;
  mode: CalendarViewMode;
  timelineDays: readonly Date[];
  timelineDayWidth: number;
  dayIndex: PlanDayIndex;
  renderRange: IndexRange;
  hourRange: IndexRange;
  today: string;
  nowMinutes: number;
  weekdays: readonly string[];
  canCreate: boolean;
  interactions: CalendarInteractions;
}>();

const emit = defineEmits<{
  'select-event': [id: string];
}>();

const hours = Array.from({ length: 24 }, (_, hour) => hour);
const hourHeight = CALENDAR_HOUR_HEIGHT;
const nowLineTop = computed(() => `${(props.nowMinutes / 60) * hourHeight}px`);
const VERTICAL_WINDOW_THRESHOLD = 24;

interface FormattedTimedEvent extends TimedEventBlock {
  time: string;
  compact: boolean;
}

const formattedCache = new WeakMap<readonly TimedEventBlock[], FormattedTimedEvent[]>();

function isColumnRendered(index: number) {
  return index >= props.renderRange.start && index <= props.renderRange.end;
}

function bannerEntries(dayKey: string) {
  return props.dayIndex.bannerByDay.get(dayKey) ?? EMPTY_ENTRIES;
}
const hasVisibleBanner = computed(() =>
  visibleCalendarDays(props.date, props.mode).some((day) => bannerEntries(localDayKey(day)).length > 0),
);
const BANNER_ITEM_HEIGHT = 22;
const BANNER_GAP = 3;
const bannerRowHeight = computed(() => {
  const most = Math.max(0, ...visibleCalendarDays(props.date, props.mode).map((day) => bannerEntries(localDayKey(day)).length));
  const rows = Math.min(3.5, Math.max(1, most));
  return Math.round(12 + rows * BANNER_ITEM_HEIGHT + Math.max(0, Math.ceil(rows) - 1) * BANNER_GAP);
});

function weekday(day: Date) {
  return props.weekdays[(day.getDay() + 6) % 7];
}

function timedEvents(day: Date, dayKey: string): readonly FormattedTimedEvent[] {
  const records = props.dayIndex.timedByDay.get(dayKey) ?? EMPTY_RECORDS;
  if (!records.length) return [];
  const blocks = getCachedDayTimedLayout(records, day, hourHeight);
  let formatted = formattedCache.get(blocks);
  if (!formatted) {
    formatted = blocks.map((block) => {
      const { start, end } = block.record.object.properties;
      const time = props.interactions.entryTime({ record: block.record, kind: 'timed' });
      return {
        ...block,
        time:
          block.point || !end || Date.parse(String(end)) === Date.parse(String(start))
            ? time
            : `${time} – ${props.interactions.clockLabel(end)}`,
        compact: !block.point && block.height < 44,
      };
    });
    formattedCache.set(blocks, formatted);
  }
  if (formatted.length <= VERTICAL_WINDOW_THRESHOLD) return formatted;
  const minTop = props.hourRange.start * hourHeight;
  const maxTop = props.hourRange.end * hourHeight;
  const resizingKey = props.interactions.resizing.value?.key;
  const draggingKey = props.interactions.draggingKey.value;
  return formatted.filter((item) => {
    if (item.top + item.height >= minTop && item.top <= maxTop) return true;
    const key = planKey(item.record);
    return key === resizingKey || key === draggingKey;
  });
}
</script>

<template>
  <div
    class="calendar-view-inner"
    :style="{
      '--calendar-axis-width': `${CALENDAR_AXIS_WIDTH}px`,
      '--calendar-day-count': timelineDays.length,
      '--calendar-day-width': `${timelineDayWidth}px`,
      width: `${CALENDAR_AXIS_WIDTH + timelineDays.length * timelineDayWidth}px`,
    }"
  >
    <div
      class="calendar-view-days"
      :class="{ 'has-banner': hasVisibleBanner || interactions.draggingKey.value }"
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
        <strong :data-zoom-num="localDayKey(day)">{{ day.getDate() }}</strong>
      </div>
      <template v-if="hasVisibleBanner || interactions.draggingKey.value">
        <span class="calendar-view-date-label">{{ t('全天') }}</span>
        <div
          v-for="(day, dayIdx) in timelineDays"
          :key="`date-${localDayKey(day)}`"
          class="calendar-view-date-events"
          :class="{ 'is-drop-target': interactions.dropTarget.value?.zone === 'day' && interactions.dropTarget.value.dayKey === localDayKey(day) }"
          :data-day="localDayKey(day)"
          @dragover="interactions.onDayDragOver(day, $event)"
          @dragleave="interactions.onDragLeave"
          @drop.prevent="interactions.onDayDrop(day, $event)"
        >
          <template v-if="isColumnRendered(dayIdx)">
          <div
            v-for="entry in bannerEntries(localDayKey(day))"
            :key="`${planKey(entry.record)}:${entry.kind}`"
            class="calendar-view-date-event"
            :class="interactions.itemClasses(entry.record, entry.kind)"
            :draggable="entry.kind !== 'due' && interactions.canDragRecord(entry.record)"
            :data-tooltip="interactions.entryTooltip(entry)"
            @dragstart="interactions.onEventDragStart(entry.record, $event)"
            @dragend="interactions.onEventDragEnd"
          >
            <button
              v-if="isCheckableEvent(entry.record)"
              type="button"
              class="calendar-inline-check"
              :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
              :disabled="!interactions.canToggleComplete(entry.record)"
              @click.stop="interactions.toggleComplete(entry.record)"
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
          </template>
        </div>
      </template>
    </div>
    <div class="calendar-view-grid">
      <div class="calendar-view-hours" aria-hidden="true">
        <span v-for="hour in hours" :key="hour" :style="{ top: `${hour * hourHeight}px` }">{{ String(hour).padStart(2, '0') }}:00</span>
      </div>
      <div
        v-for="(day, dayIdx) in timelineDays"
        :key="localDayKey(day)"
        class="calendar-view-day-column"
        :class="{ 'is-creatable': canCreate, 'is-today': localDayKey(day) === today }"
        :data-day="localDayKey(day)"
        :data-zoom-day="localDayKey(day)"
        @pointerdown="interactions.startSlotSelection(day, $event)"
        @dragover="interactions.onTimelineDragOver(day, $event)"
        @dragleave="interactions.onDragLeave"
        @drop.prevent="interactions.onTimelineDrop(day, $event)"
      >
        <div v-if="localDayKey(day) === today" class="calendar-now-line" :style="{ top: nowLineTop }" aria-hidden="true" />
        <div
          v-if="interactions.slotPreview.value && interactions.slotPreview.value.dayKey === localDayKey(day)"
          class="calendar-slot-preview"
          :style="{ top: `${interactions.slotPreview.value.top}px`, height: `${interactions.slotPreview.value.height}px` }"
          aria-hidden="true"
        >{{ interactions.slotPreview.value.label }}</div>
        <div
          v-if="interactions.dropTarget.value?.zone === 'timeline' && interactions.dropTarget.value.dayKey === localDayKey(day) && interactions.dropTarget.value.minutes !== undefined"
          class="calendar-drop-indicator"
          :style="{ top: `${(interactions.dropTarget.value.minutes / 60) * hourHeight}px` }"
          aria-hidden="true"
        ><span>{{ formatMinutesLabel(interactions.dropTarget.value.minutes) }}</span></div>
        <template v-if="isColumnRendered(dayIdx)">
        <div
          v-for="item in timedEvents(day, localDayKey(day))"
          :key="planKey(item.record)"
          class="calendar-view-event"
          data-zoom-scale
          :class="[
            { 'calendar-view-point': item.point, 'is-compact': item.compact, 'is-resizing': interactions.resizing.value?.key === planKey(item.record) },
            interactions.itemClasses(item.record, 'timed'),
          ]"
          :style="interactions.timedEventStyle(item, day)"
          :draggable="interactions.canDragRecord(item.record) && !interactions.resizing.value"
          :data-tooltip="interactions.entryTooltip({ record: item.record, kind: 'timed' }, item.time)"
          @dragstart="interactions.onEventDragStart(item.record, $event)"
          @dragend="interactions.onEventDragEnd"
        >
          <button
            v-if="isCheckableEvent(item.record)"
            type="button"
            class="calendar-inline-check"
            :aria-label="`${isEventCompleted(item.record) ? t('标记未完成') : t('完成')}：${item.record.object.name}`"
            :disabled="!interactions.canToggleComplete(item.record)"
            @click.stop="interactions.toggleComplete(item.record)"
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
            v-if="!item.point && interactions.canDragRecord(item.record)"
            class="calendar-event-resize-handle"
            role="separator"
            :aria-label="t('调整时长')"
            @pointerdown.stop.prevent="interactions.startResize(item, day, $event)"
          />
        </div>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-view-days,
.calendar-view-grid {
  display: grid;
  grid-template-columns: var(--calendar-axis-width, 52px) repeat(var(--calendar-day-count), var(--calendar-day-width));
}
.calendar-view-days {
  position: sticky;
  top: 0;
  z-index: 4;
  grid-template-rows: 44px;
  min-height: 44px;
  align-items: center;
  background: var(--paper);
  border-bottom: 1px solid var(--line);
  transition: grid-template-rows var(--motion-spring) var(--ease-spring-smooth);
}
.calendar-view-days.has-banner { grid-template-rows: 44px var(--calendar-banner-height, auto); }
.calendar-view-zone {
  position: sticky;
  left: 0;
  z-index: 3;
  align-self: stretch;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
  background: var(--paper);
  font-size: 10px;
  color: var(--muted);
  white-space: nowrap;
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
.calendar-view-date-label {
  position: sticky;
  left: 0;
  z-index: 3;
  align-self: stretch;
  padding: 10px 4px;
  border-top: 1px solid var(--line);
  background: var(--paper);
  color: var(--muted);
  font-size: 10px;
  text-align: center;
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
.calendar-view-grid { height: 1344px; }
.calendar-view-hours { position: sticky; left: 0; z-index: 3; background: var(--paper); }
.calendar-view-zone::after,
.calendar-view-date-label::after,
.calendar-view-hours::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 100%;
  width: 10px;
  background: linear-gradient(
    to right,
    var(--paper) 0%,
    color-mix(in srgb, var(--paper) 65%, transparent) 45%,
    color-mix(in srgb, var(--paper) 0%, transparent) 100%
  );
  pointer-events: none;
}
.calendar-view-hours span {
  position: absolute;
  left: 0;
  right: 0;
  text-align: center;
  transform: translateY(-7px);
  font-size: 10.5px;
  color: var(--muted);
  font-variant-numeric: tabular-nums;
}
.calendar-view-hours span:first-child { display: none; }
.calendar-view-day-column {
  position: relative;
  z-index: 0;
  border-left: 1px solid var(--line);
  background-image: repeating-linear-gradient(to bottom, transparent 0, transparent 55px, var(--line) 55px, var(--line) 56px);
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
</style>
