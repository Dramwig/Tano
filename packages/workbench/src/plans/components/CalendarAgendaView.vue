<script setup lang="ts">
import { computed } from 'vue';
import { Circle, CircleCheck, Flag } from 'lucide-vue-next';
import { t, uiLocale } from '../../i18n/i18n';
import {
  isCheckableEvent,
  isEventCompleted,
  isEventOverdue,
  localDayKey,
  type CalendarDayEntry,
} from '../calendar';
import { EMPTY_ENTRIES, type PlanDayIndex } from '../plan-index';
import { planKey, planSourceLabel, sourcePlanKey } from '../personal-plans';
import type { CalendarInteractions } from '../composables/use-calendar-interactions';

const props = defineProps<{
  date: Date;
  dayIndex: PlanDayIndex;
  scrollTop: number;
  viewportHeight: number;
  today: string;
  weekdays: readonly string[];
  interactions: CalendarInteractions;
}>();

const emit = defineEmits<{
  'select-event': [id: string];
}>();

const DAY_HEADER_HEIGHT = 48;
const EVENT_ROW_HEIGHT = 38;
const VIRTUAL_OVERSCAN = 14;

type AgendaFlatItem =
  | {
      kind: 'header';
      key: string;
      day: Date;
      dayKey: string;
      height: number;
      first: boolean;
    }
  | {
      kind: 'event';
      key: string;
      dayKey: string;
      entry: CalendarDayEntry;
      height: number;
    };

function weekday(day: Date) {
  return props.weekdays[(day.getDay() + 6) % 7];
}

const virtualList = computed(() => {
  const year = props.date.getFullYear();
  const month = props.date.getMonth();
  const length = new Date(year, month + 1, 0).getDate();
  const items: AgendaFlatItem[] = [];
  const offsets: number[] = [];
  let cursor = 0;
  let dayCount = 0;

  for (let d = 1; d <= length; d++) {
    const day = new Date(year, month, d);
    const dayKey = localDayKey(day);
    const entries = props.dayIndex.entriesByDay.get(dayKey) ?? EMPTY_ENTRIES;
    if (!entries.length) continue;
    offsets.push(cursor);
    items.push({
      kind: 'header',
      key: `h:${dayKey}`,
      day,
      dayKey,
      height: DAY_HEADER_HEIGHT,
      first: dayCount === 0,
    });
    cursor += DAY_HEADER_HEIGHT;
    dayCount++;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i]!;
      offsets.push(cursor);
      items.push({
        kind: 'event',
        key: `${dayKey}:${planKey(entry.record)}:${entry.kind}`,
        dayKey,
        entry,
        height: EVENT_ROW_HEIGHT,
      });
      cursor += EVENT_ROW_HEIGHT;
    }
  }
  return { items, offsets, totalHeight: cursor };
});

function findIndexAtOffset(offsets: readonly number[], target: number): number {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid]! <= target) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

const visibleWindow = computed(() => {
  const { items, offsets, totalHeight } = virtualList.value;
  if (!items.length) {
    return { items: [] as AgendaFlatItem[], topPad: 0, bottomPad: 0 };
  }
  if (items.length <= 60) {
    return { items, topPad: 0, bottomPad: 0 };
  }
  const viewTop = Math.max(0, props.scrollTop);
  const viewBottom = viewTop + Math.max(400, props.viewportHeight);
  const start = Math.max(0, findIndexAtOffset(offsets, viewTop) - VIRTUAL_OVERSCAN);
  const end = Math.min(items.length - 1, findIndexAtOffset(offsets, viewBottom) + VIRTUAL_OVERSCAN);
  const topPad = offsets[start]!;
  const endItem = items[end]!;
  const renderedBottom = offsets[end]! + endItem.height;
  const bottomPad = Math.max(0, totalHeight - renderedBottom);
  return {
    items: items.slice(start, end + 1),
    topPad,
    bottomPad,
  };
});
</script>

<template>
  <div class="calendar-agenda-view">
    <p v-if="!virtualList.items.length" class="calendar-agenda-empty">{{ t('本月没有日程') }}</p>
    <template v-else>
      <div v-if="visibleWindow.topPad > 0" class="calendar-agenda-spacer" :style="{ height: `${visibleWindow.topPad}px` }" aria-hidden="true" />
      <template v-for="item in visibleWindow.items" :key="item.key">
        <div
          v-if="item.kind === 'header'"
          class="calendar-agenda-day-header"
          :class="{ 'is-first': item.first }"
          :data-zoom-day="item.dayKey"
        >
          <time
            class="calendar-agenda-date"
            :class="{ today: item.dayKey === today }"
            :datetime="item.dayKey"
            :aria-label="item.day.toLocaleDateString(uiLocale, { month: 'short', day: 'numeric', weekday: 'long' })"
          >
            <strong :data-zoom-num="item.dayKey">{{ item.day.getDate() }}</strong>
            <span>{{ item.day.toLocaleDateString(uiLocale, { month: 'short' }) }} · {{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ weekday(item.day) }}</span>
          </time>
        </div>
        <div
          v-else
          class="calendar-agenda-row"
          data-zoom-scale
          :class="interactions.itemClasses(item.entry.record, item.entry.kind)"
        >
          <button
            v-if="isCheckableEvent(item.entry.record)"
            type="button"
            class="calendar-inline-check"
            :aria-label="`${isEventCompleted(item.entry.record) ? t('标记未完成') : t('完成')}：${item.entry.record.object.name}`"
            :disabled="!interactions.canToggleComplete(item.entry.record)"
            @click.stop="interactions.toggleComplete(item.entry.record)"
          >
            <CircleCheck v-if="isEventCompleted(item.entry.record)" :size="15" aria-hidden="true" />
            <Circle v-else :size="15" aria-hidden="true" />
          </button>
          <span v-else class="calendar-agenda-marker" aria-hidden="true" />
          <button
            type="button"
            class="calendar-agenda-item"
            @click="emit('select-event', sourcePlanKey(item.entry.record))"
          >
            <time>{{ interactions.entryTime(item.entry) }}</time>
            <span>
              <Flag v-if="item.entry.kind === 'due'" :size="12" class="calendar-due-flag" aria-hidden="true" />
              {{ item.entry.record.object.name }}
              <small>{{ planSourceLabel(item.entry.record) }}<template v-if="isEventOverdue(item.entry.record, today)"> · {{ t('逾期') }}</template></small>
            </span>
          </button>
        </div>
      </template>
      <div v-if="visibleWindow.bottomPad > 0" class="calendar-agenda-spacer" :style="{ height: `${visibleWindow.bottomPad}px` }" aria-hidden="true" />
    </template>
  </div>
</template>

<style scoped>
.calendar-agenda-view { max-width: 900px; margin: 0 auto; padding: 20px 32px 40px; }
.calendar-agenda-empty { padding: 60px 0; color: var(--muted); text-align: center; }
.calendar-agenda-spacer { width: 100%; pointer-events: none; }
.calendar-agenda-day-header {
  display: flex;
  align-items: center;
  min-height: 48px;
  padding: 10px 0 4px;
  margin-top: 8px;
  border-top: 1px solid var(--line);
}
.calendar-agenda-day-header.is-first { margin-top: 0; border-top: 0; padding-top: 0; }
.calendar-agenda-date {
  display: flex;
  align-items: baseline;
  gap: 8px;
  padding: 4px 0;
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
@media (max-width: 700px) {
  .calendar-agenda-view { padding: 18px; }
  .calendar-agenda-day { gap: 10px; }
  .calendar-agenda-date { width: 88px; flex-direction: column; gap: 2px; }
}
</style>
