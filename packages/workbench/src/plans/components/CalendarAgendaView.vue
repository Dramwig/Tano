<script setup lang="ts">
import { computed } from 'vue';
import { Circle, CircleCheck, Flag } from 'lucide-vue-next';
import { t, uiLocale } from '../../i18n/i18n';
import type { ObjectRecord } from '../../objects/workspace-objects';
import {
  calendarDayEntries,
  isCheckableEvent,
  isEventCompleted,
  isEventOverdue,
  localDayKey,
} from '../calendar';
import { planKey, planSourceLabel, sourcePlanKey } from '../personal-plans';
import type { CalendarInteractions } from '../composables/use-calendar-interactions';

const props = defineProps<{
  date: Date;
  planned: readonly ObjectRecord[];
  today: string;
  weekdays: readonly string[];
  interactions: CalendarInteractions;
}>();

const emit = defineEmits<{
  'select-event': [id: string];
}>();

function dayEntries(day: Date) {
  return calendarDayEntries(props.planned, day);
}

const agendaDates = computed(() => {
  const year = props.date.getFullYear();
  const month = props.date.getMonth();
  const length = new Date(year, month + 1, 0).getDate();
  return Array.from({ length }, (_, index) => new Date(year, month, index + 1))
    .filter((day) => dayEntries(day).length > 0);
});

function weekday(day: Date) {
  return props.weekdays[(day.getDay() + 6) % 7];
}
</script>

<template>
  <div class="calendar-agenda-view">
    <p v-if="!agendaDates.length" class="calendar-agenda-empty">{{ t('本月没有日程') }}</p>
    <section
      v-for="day in agendaDates"
      :key="localDayKey(day)"
      class="calendar-agenda-day"
      :data-zoom-day="localDayKey(day)"
    >
      <time
        class="calendar-agenda-date"
        :class="{ today: localDayKey(day) === today }"
        :datetime="localDayKey(day)"
        :aria-label="day.toLocaleDateString(uiLocale, { month: 'short', day: 'numeric', weekday: 'long' })"
      >
        <strong :data-zoom-num="localDayKey(day)">{{ day.getDate() }}</strong>
        <span>{{ day.toLocaleDateString(uiLocale, { month: 'short' }) }} · {{ uiLocale === 'zh-CN' ? t('周') : '' }}{{ weekday(day) }}</span>
      </time>
      <div class="calendar-agenda-events">
        <div
          v-for="entry in dayEntries(day)"
          :key="`${planKey(entry.record)}:${entry.kind}`"
          class="calendar-agenda-row"
          data-zoom-scale
          :class="interactions.itemClasses(entry.record, entry.kind)"
        >
          <button
            v-if="isCheckableEvent(entry.record)"
            type="button"
            class="calendar-inline-check"
            :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
            :disabled="!interactions.canToggleComplete(entry.record)"
            @click.stop="interactions.toggleComplete(entry.record)"
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
            <time>{{ interactions.entryTime(entry) }}</time>
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
</template>

<style scoped>
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
@media (max-width: 700px) {
  .calendar-agenda-view { padding: 18px; }
  .calendar-agenda-day { gap: 10px; }
  .calendar-agenda-date { width: 88px; flex-direction: column; gap: 2px; }
}
</style>
