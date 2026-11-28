<script setup lang="ts">
import { Circle, CircleCheck, Flag, Plus } from 'lucide-vue-next';
import { t, uiLocale } from '../../i18n/i18n';
import {
  isCheckableEvent,
  isEventCompleted,
  localDayKey,
  weekDays,
  type CalendarDayEntry,
} from '../calendar';
import { EMPTY_ENTRIES, type PlanDayIndex } from '../plan-index';
import { planKey, sourcePlanKey } from '../personal-plans';
import type { PlanDateValue } from '../plan-date';
import type { CalendarInteractions } from '../composables/use-calendar-interactions';
import type { IndexRange } from '../composables/use-calendar-viewport';

const props = defineProps<{
  scrollingWeeks: readonly Date[];
  dayIndex: PlanDayIndex;
  renderRange: IndexRange;
  today: string;
  weekdays: readonly string[];
  canCreate: boolean;
  dayPopoverKey?: string;
  dayPopoverId: string;
  interactions: CalendarInteractions;
}>();

const emit = defineEmits<{
  'select-date': [date: Date];
  'select-event': [id: string];
  'open-day-popover': [day: Date, event: MouseEvent];
  'open-quick-create': [planDate: PlanDateValue, checkable?: boolean];
}>();

const weekKey = localDayKey;

function monthShade(day: Date) {
  return (day.getFullYear() * 12 + day.getMonth()) % 2 === 1;
}

function isWeekRendered(weekIndex: number) {
  return weekIndex >= props.renderRange.start && weekIndex <= props.renderRange.end;
}

interface CellDayView {
  day: Date;
  key: string;
  shaded: boolean;
  preview: readonly CalendarDayEntry[];
  extraCount: number;
}

function weekCells(week: Date, rendered: boolean): CellDayView[] {
  return weekDays(week).map((day) => {
    const key = localDayKey(day);
    if (!rendered) {
      return { day, key, shaded: monthShade(day), preview: EMPTY_ENTRIES, extraCount: 0 };
    }
    const entries = props.dayIndex.entriesByDay.get(key) ?? EMPTY_ENTRIES;
    return {
      day,
      key,
      shaded: monthShade(day),
      preview: entries.length > 3 ? entries.slice(0, 3) : entries,
      extraCount: entries.length > 3 ? entries.length - 3 : 0,
    };
  });
}
</script>

<template>
  <div class="calendar-month-view">
    <div class="calendar-month-weekdays" aria-hidden="true">
      <span v-for="name in weekdays" :key="name">{{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ name }}</span>
    </div>
    <div
      v-for="(week, weekIdx) in scrollingWeeks"
      :key="weekKey(week)"
      class="calendar-month-week"
      :class="{ 'is-offscreen': !isWeekRendered(weekIdx) }"
      :data-week="weekKey(week)"
    >
      <div
        v-for="cell in weekCells(week, isWeekRendered(weekIdx))"
        :key="cell.key"
        class="calendar-month-cell"
        :class="{
          shaded: cell.shaded,
          'is-drop-target': interactions.dropTarget.value?.zone === 'day' && interactions.dropTarget.value.dayKey === cell.key,
        }"
        :data-day="cell.key"
        :data-zoom-day="cell.key"
        @dblclick.self="emit('open-quick-create', { date: cell.key, time: '', end: '' }, false)"
        @dragover="interactions.onDayDragOver(cell.day, $event)"
        @dragleave="interactions.onDragLeave"
        @drop.prevent="interactions.onDayDrop(cell.day, $event)"
      >
        <template v-if="isWeekRendered(weekIdx)">
          <div class="calendar-month-cell-header">
            <button
              v-if="canCreate"
              type="button"
              class="calendar-month-add"
              :aria-label="t('为 {0} 添加事件', [cell.key])"
              @click.stop="emit('open-quick-create', { date: cell.key, time: '', end: '' }, false)"
            ><Plus :size="12" aria-hidden="true" /></button>
            <button
              type="button"
              class="calendar-month-date"
              :data-zoom-num="cell.key"
              :class="{ today: cell.key === today, 'month-start': cell.day.getDate() === 1 }"
              :aria-label="t('{0}，查看日视图', [cell.key])"
              @click="emit('select-date', cell.day)"
            >{{ cell.day.getDate() === 1 ? t('{0} 月 1 日', [cell.day.getMonth() + 1]) : cell.day.getDate() }}</button>
          </div>
          <div
            v-for="entry in cell.preview"
            :key="`${planKey(entry.record)}:${entry.kind}`"
            class="calendar-month-event"
            data-zoom-scale
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
              <CircleCheck v-if="isEventCompleted(entry.record)" :size="11" aria-hidden="true" />
              <Circle v-else :size="11" aria-hidden="true" />
            </button>
            <Flag v-if="entry.kind === 'due'" :size="10" class="calendar-due-flag" aria-hidden="true" />
            <button
              type="button"
              class="calendar-item-trigger"
              @click="emit('select-event', sourcePlanKey(entry.record))"
            ><time v-if="entry.kind === 'timed'" class="calendar-item-time">{{ interactions.entryTime(entry) }}</time>{{ entry.record.object.name }}</button>
          </div>
          <button
            v-if="cell.extraCount > 0"
            type="button"
            class="calendar-month-more"
            aria-haspopup="dialog"
            :aria-expanded="cell.key === dayPopoverKey"
            :aria-controls="cell.key === dayPopoverKey ? dayPopoverId : undefined"
            @click="emit('open-day-popover', cell.day, $event)"
          >{{ t('另有 {0} 项', [cell.extraCount]) }}</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.calendar-month-view { min-width: 630px; }
.calendar-month-weekdays,
.calendar-month-week { display: grid; grid-template-columns: repeat(7, minmax(0, 1fr)); }
.calendar-month-week.is-offscreen { content-visibility: auto; contain-intrinsic-size: auto 108px; }
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
.calendar-month-date {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 13px;
  font-variant-numeric: tabular-nums;
  margin: 0;
  color: var(--text-secondary);
  font-size: 12px;
}
.calendar-month-date.month-start { width: auto; min-width: 26px; padding: 0 8px; color: var(--text); font-weight: 600; }
.calendar-month-date:hover:not(.today) { background: var(--hover); color: var(--text); }
.calendar-month-date.today:hover { background: var(--green-fill-hover); color: var(--on-accent, white); }
.calendar-month-event { width: 100%; }
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
</style>
