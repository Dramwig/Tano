<script setup lang="ts">
import { Circle, CircleCheck, Flag, Plus } from 'lucide-vue-next';
import { t, uiLocale } from '../../i18n/i18n';
import type { ObjectRecord } from '../../objects/workspace-objects';
import {
  calendarDayEntries,
  isCheckableEvent,
  isEventCompleted,
  localDayKey,
  weekDays,
} from '../calendar';
import { planKey, sourcePlanKey } from '../personal-plans';
import type { PlanDateValue } from '../plan-date';
import type { CalendarInteractions } from '../composables/use-calendar-interactions';

const props = defineProps<{
  scrollingWeeks: readonly Date[];
  planned: readonly ObjectRecord[];
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

function dayEntries(day: Date) {
  return calendarDayEntries(props.planned, day);
}
</script>

<template>
  <div class="calendar-month-view">
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
          'is-drop-target': interactions.dropTarget.value?.zone === 'day' && interactions.dropTarget.value.dayKey === localDayKey(day),
        }"
        :data-day="localDayKey(day)"
        @dblclick.self="emit('open-quick-create', { date: localDayKey(day), time: '', end: '' }, false)"
        @dragover="interactions.onDayDragOver(day, $event)"
        @dragleave="interactions.onDragLeave"
        @drop.prevent="interactions.onDayDrop(day, $event)"
      >
        <div class="calendar-month-cell-header">
          <button
            v-if="canCreate"
            type="button"
            class="calendar-month-add"
            :aria-label="t('为 {0} 添加事件', [localDayKey(day)])"
            @click.stop="emit('open-quick-create', { date: localDayKey(day), time: '', end: '' }, false)"
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
          v-if="dayEntries(day).length > 3"
          type="button"
          class="calendar-month-more"
          aria-haspopup="dialog"
          :aria-expanded="localDayKey(day) === dayPopoverKey"
          :aria-controls="localDayKey(day) === dayPopoverKey ? dayPopoverId : undefined"
          @click="emit('open-day-popover', day, $event)"
        >{{ t('另有 {0} 项', [dayEntries(day).length - 3]) }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
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
