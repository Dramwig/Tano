<script setup lang="ts">
import { t, uiLocale } from '../../i18n/i18n';
import { localDayKey, monthDays } from '../calendar';
import { calendarMonthKey } from '../calendar-zoom-motion';
import type { PlanDayIndex } from '../plan-index';
import type { IndexRange } from '../composables/use-calendar-viewport';

const props = defineProps<{
  scrollingYears: readonly number[];
  dayIndex: PlanDayIndex;
  renderRange: IndexRange;
  today: string;
  weekdays: readonly string[];
  dayPopoverKey?: string;
  dayPopoverId: string;
}>();

const emit = defineEmits<{
  'select-month': [date: Date];
  'open-day-popover': [day: Date, event: MouseEvent];
}>();

interface YearMonthGrid {
  date: Date;
  monthKey: string;
  days: { day: Date; key: string; inMonth: boolean }[];
}

const yearMonthsCache = new Map<number, YearMonthGrid[]>();

function monthsForYear(year: number): YearMonthGrid[] {
  let cached = yearMonthsCache.get(year);
  if (!cached) {
    cached = Array.from({ length: 12 }, (_, month) => {
      const date = new Date(year, month, 1);
      return {
        date,
        monthKey: calendarMonthKey(date),
        days: monthDays(date).map((day) => ({
          day,
          key: localDayKey(day),
          inMonth: day.getMonth() === month,
        })),
      };
    });
    yearMonthsCache.set(year, cached);
  }
  return cached;
}

function isYearRendered(index: number) {
  return index >= props.renderRange.start && index <= props.renderRange.end;
}

function dayCount(dayKey: string) {
  return props.dayIndex.countByDay.get(dayKey) ?? 0;
}
</script>

<template>
  <div class="calendar-year-view">
    <section
      v-for="(year, yearIdx) in scrollingYears"
      :key="year"
      class="calendar-year-section"
      :class="{ 'is-offscreen': !isYearRendered(yearIdx) }"
      :data-year="year"
    >
      <h2 class="calendar-year-heading">{{ new Date(year, 0, 1).toLocaleDateString(uiLocale, { year: 'numeric' }) }}</h2>
      <div v-if="isYearRendered(yearIdx)" class="calendar-year-grid">
        <section
          v-for="month in monthsForYear(year)"
          :key="month.date.getMonth()"
          class="calendar-year-month"
          :data-month="month.monthKey"
        >
          <button type="button" class="calendar-year-month-title" @click="emit('select-month', month.date)">
            {{ month.date.toLocaleDateString(uiLocale, { month: 'long' }) }}
          </button>
          <div class="calendar-year-weekdays" aria-hidden="true">
            <span v-for="name in weekdays" :key="name">{{ name }}</span>
          </div>
          <div class="calendar-year-days">
            <template v-for="cell in month.days" :key="cell.key">
              <span v-if="!cell.inMonth" aria-hidden="true" />
              <button
                v-else
                type="button"
                :data-zoom-day="cell.key"
                :class="{ today: cell.key === today, selected: cell.key === dayPopoverKey }"
                :aria-label="t('{0}，{1} 个事件', [cell.key, dayCount(cell.key)])"
                aria-haspopup="dialog"
                :aria-expanded="cell.key === dayPopoverKey"
                :aria-controls="cell.key === dayPopoverKey ? dayPopoverId : undefined"
                @click="emit('open-day-popover', cell.day, $event)"
              >
                <span class="calendar-year-date" :data-zoom-num="cell.key">{{ cell.day.getDate() }}</span>
                <i v-if="dayCount(cell.key) > 0" class="calendar-year-event-dot" aria-hidden="true" />
              </button>
            </template>
          </div>
        </section>
      </div>
      <div v-else class="calendar-year-placeholder" aria-hidden="true" />
    </section>
  </div>
</template>

<style scoped>
.calendar-year-section.is-offscreen { content-visibility: auto; contain-intrinsic-size: auto 760px; }
.calendar-year-placeholder { height: 700px; }
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
.calendar-year-days > span { width: 28px; height: 30px; margin: auto; font-size: 11px; }
.calendar-year-days button {
  display: grid;
  /* Date circle at the top, event dot in its own lane below so they never overlap. */
  place-items: start center;
  position: relative;
  padding: 0;
  border-radius: 6px;
  color: var(--text-secondary);
  font-variant-numeric: tabular-nums;
}
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
  bottom: 1px;
  left: 50%;
  width: 4px;
  height: 4px;
  margin-left: -2px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 55%, var(--paper));
}
.calendar-year-days button.selected:not(.today) > .calendar-year-date { color: var(--text); background: var(--selected); box-shadow: inset 0 0 0 1px var(--control-border); }
.calendar-year-days button:focus-visible { outline: 2px solid var(--focus-ring); outline-offset: 1px; }
@media (max-width: 700px) {
  .calendar-year-heading { padding: 18px 18px 0; }
  .calendar-year-grid { padding: 12px; }
}
</style>
