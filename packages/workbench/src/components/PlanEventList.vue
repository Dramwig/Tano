<script setup lang="ts">
import { CalendarDays, CalendarPlus } from 'lucide-vue-next';
import type { ObjectRecord } from '../workspace-objects';
import { hasEventTime, isCheckableEvent, isEventCompleted, localDayKey } from '../calendar';
import { planKey, planSourceLabel } from '../personal-plans';

defineProps<{
  records: ObjectRecord[];
  date: Date;
  disabled: boolean;
  pending: string[];
  unscheduled?: boolean;
  canEdit?: (record: ObjectRecord) => boolean;
}>();
const emit = defineEmits<{
  select: [id: string];
  complete: [record: ObjectRecord, completed: boolean];
  schedule: [record: ObjectRecord];
}>();
function complete(record: ObjectRecord, event: Event) {
  const input = event.target as HTMLInputElement;
  const completed = input.checked;
  // Reflect persisted state until the hash-checked write succeeds, including on failure.
  input.checked = isEventCompleted(record);
  emit('complete', record, completed);
}
function eventTime(record: ObjectRecord, day: Date) {
  if (record.object.properties.allDay === true) return '全天';
  if (!hasEventTime(record)) return record.object.properties.date ? '当天' : '未安排';
  const format = (value: unknown) => {
    const date = new Date(String(value));
    const time = date.toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    return `${localDayKey(date) === localDayKey(day) ? '' : `${date.getMonth() + 1}/${date.getDate()} `}${time}`;
  };
  return Date.parse(String(record.object.properties.start)) === Date.parse(String(record.object.properties.end))
    ? format(record.object.properties.start)
    : `${format(record.object.properties.start)} – ${format(record.object.properties.end)}`;
}
</script>

<template>
  <ul class="plan-events">
    <li
      v-for="record in records"
      :key="planKey(record)"
      :class="{ completed: isEventCompleted(record) }"
      :aria-busy="pending.includes(planKey(record))"
    >
      <input
        v-if="isCheckableEvent(record)"
        type="checkbox"
        :checked="isEventCompleted(record)"
        :disabled="disabled || canEdit?.(record) === false || pending.includes(planKey(record))"
        :aria-label="`${isEventCompleted(record) ? '标记未完成' : '完成'}：${record.object.name}`"
        @change="complete(record, $event)"
      />
      <CalendarDays v-else :size="15" class="plan-event-icon" aria-hidden="true" />
      <button type="button" class="plan-event-detail" @click="emit('select', planKey(record))">
        <strong>{{ record.object.name }}</strong>
        <small
          >{{ planSourceLabel(record) }} · {{ isEventCompleted(record) ? '已完成 · ' : '' }}{{ eventTime(record, date) }}{{ record.object.properties.due ? ` · 截止 ${record.object.properties.due}` : '' }}</small
        >
      </button>
      <button
        v-if="unscheduled && !isEventCompleted(record)"
        type="button"
        class="plan-schedule"
        :title="`安排到 ${date.getMonth() + 1} 月 ${date.getDate()} 日`"
        :aria-label="`将 ${record.object.name} 安排到 ${localDayKey(date)}`"
        :disabled="disabled || canEdit?.(record) === false || pending.includes(planKey(record))"
        @click="emit('schedule', record)"
      >
        <CalendarPlus :size="15" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.plan-events {
  list-style: none;
  margin: 0;
  padding: 0;
}
.plan-events li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 5px;
  border-radius: 6px;
}
.plan-events li:hover {
  background: var(--hover);
}
.plan-events input {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin: 3px 0 0;
  accent-color: var(--green);
}
.plan-event-icon {
  flex: 0 0 auto;
  margin-top: 2px;
  color: var(--muted);
}
.plan-event-detail {
  flex: 1;
  min-width: 0;
  padding: 0;
  text-align: left;
  color: var(--text);
}
.plan-event-detail strong {
  display: block;
  font-size: 12px;
  line-height: 1.5;
  font-weight: 500;
  overflow-wrap: anywhere;
}
.plan-event-detail small {
  display: block;
  margin-top: 2px;
  color: var(--muted);
  font-size: 10px;
  line-height: 1.5;
}
.completed .plan-event-detail strong {
  color: var(--muted);
  text-decoration: line-through;
}
.plan-schedule {
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border-radius: 4px;
  color: var(--muted);
}
.plan-schedule:hover {
  color: var(--green);
  background: var(--surface);
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
button:disabled,
input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
