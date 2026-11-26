<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();
const ResizeObserver = (window as Window & typeof globalThis).ResizeObserver;
import { isNode } from '@tano/editor/dom-realm';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t, uiLocale } from '../../i18n/i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { Circle, CircleCheck, Flag, X } from 'lucide-vue-next';
import { isPlanCompletionLocked } from '@tano/protocol';
import { hasEventTime, isCheckableEvent, isEventCompleted, isEventOverdue, localDayKey } from '../calendar';
import type { CalendarDayEntry } from '../calendar';
import { planKey, planSourceLabel, sourcePlanKey } from '../personal-plans';
import type { ObjectRecord } from '../../objects/workspace-objects';

const props = defineProps<{
  id: string;
  date: Date;
  anchor: HTMLElement;
  records: ObjectRecord[];
  entries?: CalendarDayEntry[];
  canEdit?: (record: ObjectRecord) => boolean;
  pending?: readonly string[];
}>();
const emit = defineEmits<{
  close: [];
  'select-event': [id: string];
  'toggle-complete': [record: ObjectRecord];
}>();
const panel = ref<HTMLElement>();
const position = ref({ left: '0px', top: '0px' });
let resizeObserver: ResizeObserver | undefined;

const items = computed<CalendarDayEntry[]>(() =>
  props.entries ?? props.records.map((record) => ({
    record,
    kind: hasEventTime(record) && record.object.properties.allDay !== true ? 'timed' : 'all-day',
  })),
);

function close(restoreFocus = false) {
  if (restoreFocus) props.anchor.focus({ preventScroll: true });
  emit('close');
}
function dismiss(event: Event) {
  const target = event.target;
  if (isNode(target) && !panel.value?.contains(target) && !props.anchor.contains(target)) close();
}
function place() {
  if (!panel.value || !props.anchor.isConnected) return;
  const anchor = props.anchor.getBoundingClientRect();
  const { width, height } = panel.value.getBoundingClientRect();
  const margin = 12;
  const gap = 8;
  const right = window.innerWidth - margin;
  const bottom = window.innerHeight - margin;
  let left = anchor.right + gap;
  let top = anchor.top - 12;
  let side = 'right';
  if (left + width > right) {
    side = 'left';
    if (anchor.left - gap - width >= margin) left = anchor.left - gap - width;
    else {
      side = 'down';
      left = anchor.left + (anchor.width - width) / 2;
      top = anchor.bottom + gap;
      if (top + height > bottom) {
        top = anchor.top - gap - height;
        side = 'up';
      }
    }
  }
  position.value = {
    left: `${Math.max(margin, Math.min(left, right - width))}px`,
    top: `${Math.max(margin, Math.min(top, bottom - height))}px`,
  };
  panel.value.dataset.surfaceSide = side;
}
async function focusPanel() {
  await nextTick();
  place();
  panel.value?.focus({ preventScroll: true });
}
function select(record: ObjectRecord) {
  close();
  emit('select-event', sourcePlanKey(record));
}
function canToggle(record: ObjectRecord) {
  return (
    isCheckableEvent(record) &&
    !isPlanCompletionLocked(record.object) &&
    props.canEdit?.(record) === true &&
    !props.pending?.includes(planKey(record))
  );
}
function eventTime(entry: CalendarDayEntry) {
  if (entry.kind === 'due') return t('截止');
  const { record } = entry;
  if (record.object.properties.allDay === true) return t('全天');
  if (!hasEventTime(record)) return t('当天');
  const format = (value: unknown) => {
    const date = new Date(String(value));
    const time = date.toLocaleTimeString(uiLocale.value, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${localDayKey(date) === localDayKey(props.date) ? '' : `${date.getMonth() + 1}/${date.getDate()} `}${time}`;
  };
  return Date.parse(String(record.object.properties.start)) === Date.parse(String(record.object.properties.end))
    ? format(record.object.properties.start)
    : `${format(record.object.properties.start)} – ${format(record.object.properties.end)}`;
}
onMounted(() => {
  void focusPanel();
  document.addEventListener('pointerdown', dismiss);
  document.addEventListener('focusin', dismiss);
  window.addEventListener('resize', place);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(place);
    if (panel.value) resizeObserver.observe(panel.value);
    const calendar = props.anchor.closest('.calendar-view');
    if (calendar) resizeObserver.observe(calendar);
  }
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', dismiss);
  document.removeEventListener('focusin', dismiss);
  window.removeEventListener('resize', place);
  resizeObserver?.disconnect();
});
watch(() => props.date, focusPanel);

</script>

<template>
  <Teleport :to="document.body">
    <section v-surface-motion="'CalendarDayPopover:0'"
      :id="id"
      ref="panel"
      class="calendar-day-popover"
      role="dialog"
      :aria-label="t('{0} 的活动', [localDayKey(date)])"
      tabindex="-1"
      :style="position"
      @keydown.esc.stop.prevent="close(true)"
    >
      <header class="calendar-day-popover-heading">
        <strong>{{ date.getDate() }}</strong>
        <div>
          <span>{{ date.toLocaleDateString(uiLocale, { month: 'short', weekday: 'short' }) }}</span>
          <small>{{ items.length ? t('{0} 项活动', [items.length]) : t('当天活动') }}</small>
        </div>
        <button type="button" class="calendar-day-popover-close" :aria-label="t('关闭当天活动')" @click="close(true)">
          <X :size="17" aria-hidden="true" />
        </button>
      </header>
      <ul v-if="items.length" class="calendar-day-popover-events">
        <li
          v-for="entry in items"
          :key="`${planKey(entry.record)}:${entry.kind}`"
          class="calendar-day-popover-row"
          :class="{
            completed: isEventCompleted(entry.record),
            overdue: isEventOverdue(entry.record),
            due: entry.kind === 'due',
          }"
        >
          <button
            v-if="isCheckableEvent(entry.record)"
            type="button"
            class="calendar-day-popover-check"
            :aria-label="`${isEventCompleted(entry.record) ? t('标记未完成') : t('完成')}：${entry.record.object.name}`"
            :disabled="!canToggle(entry.record)"
            @click.stop="emit('toggle-complete', entry.record)"
          >
            <CircleCheck v-if="isEventCompleted(entry.record)" :size="15" aria-hidden="true" />
            <Circle v-else :size="15" aria-hidden="true" />
          </button>
          <span
            v-else
            class="calendar-day-popover-marker"
            :class="{ personal: entry.record.source?.scope === 'personal' }"
            aria-hidden="true"
          />
          <button type="button" class="calendar-day-popover-item" @click="select(entry.record)">
            <strong>
              <Flag v-if="entry.kind === 'due'" :size="12" class="calendar-day-popover-flag" aria-hidden="true" />
              {{ entry.record.object.name }}
            </strong>
            <small>
              <time>{{ eventTime(entry) }}</time> · {{ planSourceLabel(entry.record) }}
              <template v-if="isEventOverdue(entry.record)"> · {{ t('逾期') }}</template>
              <template v-else-if="isEventCompleted(entry.record)">{{ t(' · 已完成') }}</template>
            </small>
          </button>
        </li>
      </ul>
      <p v-else class="calendar-day-popover-empty">{{ t('这一天没有安排活动。') }}</p>
    </section>
  </Teleport>
</template>

<style scoped>
.calendar-day-popover {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 292px;
  max-width: calc(100vw - 24px);
  max-height: min(400px, calc(100dvh - 24px));
  padding: 12px 8px 8px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  color: var(--text);
  box-shadow: var(--overlay-shadow, 0 8px 28px #0002, 0 2px 6px #0001);
  outline: none;
}
.calendar-day-popover-heading { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding: 0 4px 0 6px; }
.calendar-day-popover-heading > strong {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 10px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
  color: var(--text);
  font-size: 19px;
  line-height: 1;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
}
.calendar-day-popover-heading > div { flex: 1; min-width: 0; }
.calendar-day-popover-heading span { display: block; font-size: 13px; font-weight: 500; }
.calendar-day-popover-heading small { display: block; margin-top: 3px; color: var(--muted); font-size: 11px; }
.calendar-day-popover-close {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 7px;
  color: var(--muted);
}
.calendar-day-popover-close:hover { background: var(--hover); color: var(--text); }
.calendar-day-popover-empty { margin: 16px 6px 6px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.calendar-day-popover-events {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  list-style: none;
  margin: 10px 0 0;
  padding: 8px 0 0;
  border-top: 1px solid var(--line);
}
.calendar-day-popover-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  padding: 0 4px;
  border-radius: 8px;
  transition: background-color var(--motion-quick) var(--ease-standard);
  animation: tano-rise-in var(--motion-spring) var(--ease-spring-smooth) both;
}
.calendar-day-popover-row:nth-child(2) { animation-delay: 20ms; }
.calendar-day-popover-row:nth-child(3) { animation-delay: 40ms; }
.calendar-day-popover-row:nth-child(4) { animation-delay: 60ms; }
.calendar-day-popover-row:nth-child(n + 5) { animation-delay: 80ms; }
.calendar-day-popover-row + .calendar-day-popover-row { margin-top: 1px; }
.calendar-day-popover-row:hover,
.calendar-day-popover-row:focus-within { background: var(--hover); }
.calendar-day-popover-check,
.calendar-day-popover-marker {
  flex: none;
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  margin-top: 6px;
  border-radius: 50%;
  color: var(--muted);
}
.calendar-day-popover-marker::before {
  content: '';
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text) 55%, var(--paper));
}
.calendar-day-popover-marker.personal::before { background: #3d6cc9; }
:root[data-theme='dark'] .calendar-day-popover-marker.personal::before { background: #86a6ea; }
.calendar-day-popover-check:hover:not(:disabled) { color: var(--text); background: color-mix(in srgb, var(--text) 8%, transparent); }
.calendar-day-popover-check:disabled { opacity: 0.45; cursor: not-allowed; }
.calendar-day-popover-row.completed .calendar-day-popover-check { color: var(--text-secondary); }
.calendar-day-popover-item { flex: 1; min-width: 0; padding: 7px 6px 7px 2px; border-radius: 6px; text-align: left; }
.calendar-day-popover-item:hover { color: inherit; }
.calendar-day-popover-item strong { display: flex; align-items: center; gap: 5px; color: var(--text); font-size: 13px; line-height: 1.5; font-weight: 500; overflow-wrap: anywhere; }
.calendar-day-popover-flag { flex: none; color: #b7791f; }
.calendar-day-popover-item small { display: block; margin-top: 1px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.calendar-day-popover-item small time { font-variant-numeric: tabular-nums; }
.calendar-day-popover-row.completed .calendar-day-popover-item strong { color: var(--muted); text-decoration: line-through; }
.calendar-day-popover-row.overdue .calendar-day-popover-item small,
.calendar-day-popover-row.overdue .calendar-day-popover-flag { color: var(--danger, #c24141); }
button:focus-visible { outline: 2px solid var(--focus-ring, var(--green)); outline-offset: 1px; }
@media (prefers-reduced-motion: reduce) {
  .calendar-day-popover-row { animation: none; }
}
</style>
