<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { X } from 'lucide-vue-next';
import { hasEventTime, isEventCompleted, localDayKey } from '../calendar';
import { planKey, planSourceLabel } from '../personal-plans';
import type { ObjectRecord } from '../workspace-objects';

const props = defineProps<{ id: string; date: Date; anchor: HTMLElement; records: ObjectRecord[] }>();
const emit = defineEmits<{ close: []; 'select-event': [id: string] }>();
const panel = ref<HTMLElement>();
const position = ref({ left: '0px', top: '0px' });
let resizeObserver: ResizeObserver | undefined;

function close(restoreFocus = false) {
  if (restoreFocus) props.anchor.focus({ preventScroll: true });
  emit('close');
}
function dismiss(event: Event) {
  const target = event.target;
  if (target instanceof Node && !panel.value?.contains(target) && !props.anchor.contains(target)) close();
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
  if (left + width > right) {
    if (anchor.left - gap - width >= margin) left = anchor.left - gap - width;
    else {
      left = anchor.left + (anchor.width - width) / 2;
      top = anchor.bottom + gap;
      if (top + height > bottom) top = anchor.top - gap - height;
    }
  }
  position.value = {
    left: `${Math.max(margin, Math.min(left, right - width))}px`,
    top: `${Math.max(margin, Math.min(top, bottom - height))}px`,
  };
}
async function focusPanel() {
  await nextTick();
  place();
  panel.value?.focus({ preventScroll: true });
}
function select(record: ObjectRecord) {
  close();
  emit('select-event', planKey(record));
}
function eventTime(record: ObjectRecord) {
  if (record.object.properties.allDay === true) return '全天';
  if (!hasEventTime(record)) return '当天';
  const format = (value: unknown) => {
    const date = new Date(String(value));
    const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
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
  resizeObserver = new ResizeObserver(place);
  if (panel.value) resizeObserver.observe(panel.value);
  const calendar = props.anchor.closest('.calendar-view');
  if (calendar) resizeObserver.observe(calendar);
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
  <Teleport to="body">
    <section
      :id="id"
      ref="panel"
      class="calendar-day-popover"
      role="dialog"
      :aria-label="`${localDayKey(date)} 的活动`"
      tabindex="-1"
      :style="position"
      @keydown.esc.stop.prevent="close(true)"
    >
      <header class="calendar-day-popover-heading">
        <strong>{{ date.getDate() }}</strong>
        <div>
          <span>{{ date.getMonth() + 1 }} 月 · {{ date.toLocaleDateString('zh-CN', { weekday: 'short' }) }}</span>
          <small>{{ records.length ? `${records.length} 项活动` : '当天活动' }}</small>
        </div>
        <button type="button" class="calendar-day-popover-close" aria-label="关闭当天活动" @click="close(true)">
          <X :size="17" aria-hidden="true" />
        </button>
      </header>
      <ul v-if="records.length" class="calendar-day-popover-events">
        <li v-for="record in records" :key="planKey(record)">
          <button type="button" :class="{ completed: isEventCompleted(record) }" @click="select(record)">
            <strong>{{ record.object.name }}</strong>
            <small><time>{{ eventTime(record) }}</time> · {{ planSourceLabel(record) }}{{ isEventCompleted(record) ? ' · 已完成' : '' }}</small>
          </button>
        </li>
      </ul>
      <p v-else class="calendar-day-popover-empty">这一天没有安排活动。</p>
    </section>
  </Teleport>
</template>

<style scoped>
.calendar-day-popover {
  position: fixed;
  z-index: 40;
  display: flex;
  flex-direction: column;
  width: 272px;
  max-width: calc(100vw - 24px);
  max-height: min(380px, calc(100dvh - 24px));
  padding: 14px 12px 12px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 8px 28px #0002, 0 2px 6px #0001;
  outline: none;
}
.calendar-day-popover-heading { display: flex; align-items: center; gap: 10px; flex-shrink: 0; padding: 0 2px; }
.calendar-day-popover-heading > strong { display: grid; place-items: center; flex-shrink: 0; width: 40px; height: 40px; border-radius: 10px; background: var(--accent); color: var(--green); font-size: 23px; line-height: 1; font-weight: 500; }
.calendar-day-popover-heading > div { flex: 1; }
.calendar-day-popover-heading span { display: block; font-size: 13px; }
.calendar-day-popover-heading small { display: block; margin-top: 4px; color: var(--muted); font-size: 11px; }
.calendar-day-popover-close {
  flex-shrink: 0;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--text-secondary);
}
.calendar-day-popover-close:hover { background: var(--hover); }
.calendar-day-popover-empty { margin: 16px 4px 6px; color: var(--muted); font-size: 12px; line-height: 1.6; }
.calendar-day-popover-events { min-height: 0; overflow-y: auto; overscroll-behavior: contain; list-style: none; margin: 10px 0 0; padding: 2px; }
.calendar-day-popover-events li + li { margin-top: 3px; }
.calendar-day-popover-events button { width: 100%; padding: 8px; border-radius: 6px; text-align: left; }
.calendar-day-popover-events button:hover { background: var(--hover); }
.calendar-day-popover-events strong { display: block; color: var(--text); font-size: 13px; line-height: 1.5; font-weight: 500; overflow-wrap: anywhere; }
.calendar-day-popover-events small { display: block; margin-top: 2px; color: var(--muted); font-size: 11px; line-height: 1.5; overflow-wrap: anywhere; }
.calendar-day-popover-events .completed strong { color: var(--muted); text-decoration: line-through; }
button:focus-visible { outline: 2px solid var(--green); outline-offset: 1px; }
</style>
