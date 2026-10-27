<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t, uiLocale } from '../i18n';
import { onBeforeUnmount, ref, TransitionGroup, watch } from 'vue';
import { animate } from 'motion/mini';
import { CalendarDays } from 'lucide-vue-next';
import { taskReview } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { hasEventTime, isCheckableEvent, isEventCompleted, localDayKey } from '../calendar';
import { planKey, planSourceLabel } from '../personal-plans';
import { readPlanDate } from '../plan-date';

const props = defineProps<{
  records: ObjectRecord[];
  loading?: boolean;
  date: Date;
  disabled: boolean;
  pending: string[];
  canEdit?: (record: ObjectRecord) => boolean;
  showDate?: boolean;
  contextKey?: string;
  contextMenuId?: string;
}>();
const emit = defineEmits<{
  select: [id: string];
  complete: [record: ObjectRecord, completed: boolean];
  context: [record: ObjectRecord, event: MouseEvent | KeyboardEvent];
}>();
const completionFeedback = ref<Record<string, boolean>>({});
const leavingCount = ref(0);
const leavingAnimations = new Map<Element, ReturnType<typeof animate>>();
const enteringAnimations = new Map<Element, ReturnType<typeof animate>>();
function contextKeydown(record: ObjectRecord, event: KeyboardEvent) {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
  event.preventDefault();
  event.stopPropagation();
  emit('context', record, event);
}
watch(() => [...props.pending], pending => {
  for (const key of Object.keys(completionFeedback.value)) {
    if (!pending.includes(key)) delete completionFeedback.value[key];
  }
});
function visualCompleted(record: ObjectRecord) {
  return completionFeedback.value[planKey(record)] ?? isEventCompleted(record);
}
function completionLocked(record: ObjectRecord) {
  const review = taskReview(record.object);
  return !!review && review.state !== 'approved';
}
function complete(record: ObjectRecord, event: Event) {
  const input = event.target as HTMLInputElement;
  const completed = input.checked;
  // Reflect persisted state until the hash-checked write succeeds, including on failure.
  input.checked = isEventCompleted(record);
  const key = planKey(record);
  if (props.disabled || props.canEdit?.(record) === false || completionLocked(record) || props.pending.includes(key)) return;
  completionFeedback.value[key] = completed;
  emit('complete', record, completed);
}
function cancelEnter(element: Element) {
  // Cancellation must also work after the list becomes hidden or detached.
  // stop() commits WAAPI styles, which throws for an element that is not rendered.
  enteringAnimations.get(element)?.cancel();
  enteringAnimations.delete(element);
}
function enterRow(element: Element, done: () => void) {
  const row = element as HTMLElement;
  if (typeof row.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }
  const animation = animate(row, { opacity: [0, 1] }, { duration: 0.16, ease: 'easeOut' });
  enteringAnimations.set(row, animation);
  void animation.finished.then(() => {
    if (enteringAnimations.get(row) !== animation) return;
    cancelEnter(row);
    row.style.removeProperty('opacity');
    done();
  });
}
function leaveRow(element: Element, done: () => void) {
  const row = element as HTMLElement;
  const opacity = getComputedStyle(row).opacity || '1';
  cancelEnter(row);
  if (typeof row.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    done();
    return;
  }
  // Let the check finish drawing before its row leaves; storage writes are never delayed.
  const completing = row.hasAttribute('data-completion-transition');
  const animation = animate(row, { opacity: [Number(opacity), 0] }, {
    delay: completing ? 0.6 : 0,
    duration: completing ? 0.2 : 0.12, ease: 'easeOut',
  });
  row.style.pointerEvents = 'none';
  row.setAttribute('inert', '');
  leavingAnimations.set(row, animation);
  leavingCount.value++;
  const finish = () => {
    if (leavingAnimations.get(row) !== animation) return;
    leavingAnimations.delete(row);
    animation.cancel();
    leavingCount.value = Math.max(0, leavingCount.value - 1);
    done();
  };
  void animation.finished.then(finish, finish);
}
function cancelLeave(element: Element) {
  const animation = leavingAnimations.get(element);
  leavingAnimations.delete(element);
  if (animation) { animation.cancel(); leavingCount.value = Math.max(0, leavingCount.value - 1); }
  (element as HTMLElement).style.removeProperty('pointer-events');
  (element as HTMLElement).style.removeProperty('opacity');
  element.removeAttribute('inert');
}
onBeforeUnmount(() => {
  for (const animation of leavingAnimations.values()) animation.cancel();
  for (const animation of enteringAnimations.values()) animation.cancel();
  leavingAnimations.clear();
  enteringAnimations.clear();
});
function eventTime(record: ObjectRecord, day: Date) {
  if (props.showDate) {
    const { date, time, end } = readPlanDate(record.object.properties);
    if (!date) return t('未安排');
    const start = `${date}${time ? ` ${time}` : t(' · 全天')}`;
    return end ? `${start} – ${end.replace('T', ' ')}` : start;
  }
  if (record.object.properties.allDay === true) return t('全天');
  if (!hasEventTime(record)) return record.object.properties.date ? t('当天') : t('未安排');
  const format = (value: unknown) => {
    const date = new Date(String(value));
    const time = date.toLocaleTimeString(uiLocale.value, {
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
  <LoadingSkeleton v-if="loading && !records.length" :rows="3" />
  <slot v-else-if="!records.length && !leavingCount" name="empty" />
  <TransitionGroup tag="ul" class="plan-events" :class="{ 'has-leaving': leavingCount > 0 }" :css="false" @enter="enterRow" @enter-cancelled="cancelEnter" @leave="leaveRow" @leave-cancelled="cancelLeave">
    <li
      v-for="record in records"
      :key="planKey(record)"
      :data-plan-layout="planKey(record)"
      :class="{ completed: visualCompleted(record), 'context-target': contextKey === planKey(record) }"
      :aria-busy="pending.includes(planKey(record))"
      :data-completion-transition="completionFeedback[planKey(record)] !== undefined || undefined"
      @contextmenu.prevent="emit('context', record, $event)"
      @keydown="contextKeydown(record, $event)"
    >
      <label
        v-if="isCheckableEvent(record)"
        class="plan-completion-control"
        :class="{ 'is-completed': visualCompleted(record), 'is-readonly': disabled || canEdit?.(record) === false || completionLocked(record) }"
      >
        <input
          type="checkbox"
          :checked="isEventCompleted(record)"
          :disabled="disabled || canEdit?.(record) === false || completionLocked(record) || pending.includes(planKey(record))"
          :aria-label="`${isEventCompleted(record) ? t('标记未完成') : t('完成')}：${record.object.name}`"
          @change="complete(record, $event)"
        />
        <svg
          width="18"
          height="18"
          viewBox="0 0 18 18"
          class="plan-completion-icon"
          aria-hidden="true"
          focusable="false"
        >
          <circle class="plan-completion-ring" cx="9" cy="9" r="7.25" />
          <path class="plan-completion-check" d="M5.25 9.15 L7.85 11.7 L12.9 6.35" pathLength="1" />
        </svg>
      </label>
      <CalendarDays v-else :size="15" class="plan-event-icon" aria-hidden="true" />
      <button
        type="button"
        class="plan-event-detail"
        aria-haspopup="menu"
        :aria-expanded="contextKey === planKey(record)"
        :aria-controls="contextKey === planKey(record) ? contextMenuId : undefined"
        @click="emit('select', planKey(record))"
      >
        <strong><span class="plan-event-title">{{ record.object.name }}</span></strong>
        <small
          >{{ planSourceLabel(record) }} · {{ isEventCompleted(record) ? t('已完成 · ') : '' }}{{ eventTime(record, date) }}{{ record.object.properties.due ? t(' · 截止 {0}', [record.object.properties.due]) : '' }}</small
        >
      </button>
    </li>
  </TransitionGroup>
</template>

<style scoped>
.plan-events {
  list-style: none;
  margin: 0;
  padding: 0;
}
.plan-events.has-leaving {
  cursor: pointer;
}
.plan-events li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 5px;
  border-radius: 6px;
}
.plan-events li:hover,
.plan-events li.context-target {
  background: var(--hover);
}
.plan-completion-control {
  position: relative;
  display: flex;
  flex: 0 0 auto;
  width: 18px;
  height: 18px;
  color: var(--control-border);
}
.plan-completion-control input {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  margin: 0;
  padding: 0;
  opacity: 0;
  cursor: pointer;
}
.plan-completion-icon {
  overflow: visible;
  pointer-events: none;
}
.plan-completion-ring {
  fill: transparent;
  stroke: var(--control-border);
  stroke-width: 1.5;
  transition: stroke 240ms ease, fill 280ms ease;
}
.plan-completion-check {
  fill: none;
  stroke: var(--green);
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-dasharray: 1;
  stroke-dashoffset: 1;
  opacity: 0;
  transition: stroke-dashoffset 300ms ease, opacity 180ms ease;
}
.plan-completion-control:hover input:not(:disabled) + .plan-completion-icon .plan-completion-ring,
.plan-completion-control.is-completed .plan-completion-ring {
  stroke: var(--green);
}
.plan-completion-control.is-completed .plan-completion-ring {
  fill: color-mix(in srgb, var(--green) 8%, transparent);
}
.plan-completion-control.is-completed .plan-completion-check {
  stroke-dashoffset: 0;
  opacity: 1;
  transition: stroke-dashoffset 440ms cubic-bezier(0.35, 0, 0.25, 1) 30ms, opacity 140ms ease;
}
.plan-completion-control input:focus-visible + .plan-completion-icon {
  border-radius: 50%;
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
.plan-completion-control.is-readonly input:disabled {
  cursor: not-allowed;
}
.plan-completion-control:not(.is-readonly) input:disabled {
  cursor: pointer;
}
.plan-completion-control.is-readonly .plan-completion-icon {
  opacity: 0.5;
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
  transition: color 240ms ease;
}
.plan-event-title {
  background-image: linear-gradient(currentColor, currentColor);
  background-repeat: no-repeat;
  background-position: left 55%;
  background-size: 0% 1px;
  -webkit-box-decoration-break: clone;
  box-decoration-break: clone;
  transition: background-size 300ms ease;
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
}
.completed .plan-event-title {
  background-size: 100% 1px;
  transition: background-size 440ms cubic-bezier(0.35, 0, 0.25, 1) 30ms;
}
button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
}
button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
@media (prefers-reduced-motion: reduce) {
  .plan-completion-ring,
  .plan-completion-check,
  .plan-completion-control.is-completed .plan-completion-check,
  .plan-event-detail strong,
  .plan-event-title,
  .completed .plan-event-title {
    transition: none;
  }
}
</style>
