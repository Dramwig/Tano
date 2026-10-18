<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onMounted, onUnmounted, ref, useId, watch } from 'vue';
import { CalendarDays, Check, ChevronDown, Clock3, ListTodo } from 'lucide-vue-next';
import type { PlanDateValue } from '../plan-date';
import { localDateTime, localDayKey } from '../calendar';

const props = defineProps<{
  modelValue: PlanDateValue;
  disabled?: boolean;
  required?: boolean;
  defaultDate?: string;
  compact?: boolean;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: PlanDateValue] }>();
const dateId = useId();
const endId = useId();
const timeAction = ref<HTMLButtonElement>();
const picker = ref<HTMLElement>();
const pickerOpen = ref(false);
const pickerId = useId();
const mode = computed(() => !props.modelValue.date ? 'none' : props.modelValue.end ? 'range' : 'date');
const options = computed(() => [
  ...(!props.required ? [{ value: 'none', get label() { return t('未安排'); }, icon: ListTodo }] : []),
  { value: 'date', get label() { return t('计划日期'); }, icon: CalendarDays },
  { value: 'range', get label() { return t('时间段'); }, icon: Clock3 },
]);
const label = computed(() => options.value.find(option => option.value === mode.value)?.label ?? t('未安排'));
const startValue = computed(() => `${props.modelValue.date}T${props.modelValue.time}`);
const precisionLabel = computed(() => props.modelValue.time ? t('切换为全天事件') : t('切换为精确时间'));
let lastTime = '09:00';
let lastEndTime = '10:00';
let lastDate = '';
watch(() => props.modelValue.time, time => { if (time) lastTime = time; }, { immediate: true });
watch(() => props.modelValue.end, end => { if (end.includes('T')) lastEndTime = end.slice(11, 16); }, { immediate: true });
watch(() => props.modelValue.date, date => { if (date) lastDate = date; }, { immediate: true });
function update(value: Partial<PlanDateValue>) {
  if (!props.disabled) emit('update:modelValue', { ...props.modelValue, ...value });
}
function movedEnd(date: string) {
  const { end, date: previous } = props.modelValue;
  if (!end || !previous) return end;
  // Shift by calendar days to retain both inclusive dates and cross-day durations.
  const shift = (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${previous}T00:00:00Z`)) / 86400000;
  const allDay = !end.includes('T');
  const moved = new Date(allDay ? `${end}T00:00:00` : end);
  moved.setDate(moved.getDate() + shift);
  return allDay ? localDayKey(moved) : localDateTime(moved);
}
function updateDate(event: Event) {
  const date = (event.target as HTMLInputElement).value;
  if (!date) update({ date: '', time: '', end: '' });
  else update({ date, end: movedEnd(date) });
}
function updateStart(event: Event) {
  const value = (event.target as HTMLInputElement).value;
  if (!value) return update({ date: '', time: '', end: '' });
  const date = value.slice(0, 10);
  update({ date, time: value.slice(11, 16), end: movedEnd(date) });
}
function toggleTime() {
  const { date, time, end } = props.modelValue;
  if (time) update({ time: '', end: end.slice(0, 10) });
  else {
    let preciseEnd = end ? `${end}T${lastEndTime}` : '';
    if (preciseEnd && preciseEnd < `${date}T${lastTime}`) {
      const next = new Date(`${date}T${lastTime}`);
      next.setHours(next.getHours() + 1);
      preciseEnd = localDateTime(next);
    }
    update({ time: lastTime, end: preciseEnd });
  }
}
async function chooseSchedule(value: string) {
  if (props.disabled) return;
  const date = props.modelValue.date || lastDate || props.defaultDate || localDayKey(new Date());
  const time = props.modelValue.time || lastTime;
  if (value === 'none') update({ date: '', time: '', end: '' });
  else if (value === 'date') update({ date, end: '' });
  else if (props.modelValue.end) update({ date });
  else {
    const end = new Date(`${date}T${time}`);
    end.setHours(end.getHours() + 1);
    update({ date, time, end: props.modelValue.end || localDateTime(end) });
  }
  await closePicker();
}
async function togglePicker() {
  pickerOpen.value = !pickerOpen.value;
  if (!pickerOpen.value) return;
  await nextTick();
  picker.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
}
async function closePicker() {
  pickerOpen.value = false;
  await nextTick();
  timeAction.value?.focus();
}
function pickerEscape(event: KeyboardEvent) {
  if (!pickerOpen.value) return;
  event.stopPropagation();
  event.preventDefault();
  void closePicker();
}
function pickerKeydown(event: KeyboardEvent) {
  const options = [...picker.value?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? []];
  const index = options.indexOf(document.activeElement as HTMLButtonElement);
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  options[event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (index + (event.key === 'ArrowUp' ? options.length - 1 : 1)) % options.length]?.focus();
}
function dismissPicker(event: Event) {
  if (event.target instanceof Node && !picker.value?.contains(event.target)) pickerOpen.value = false;
}
onMounted(() => {
  document.addEventListener('pointerdown', dismissPicker);
  document.addEventListener('focusin', dismissPicker);
});
onUnmounted(() => {
  document.removeEventListener('pointerdown', dismissPicker);
  document.removeEventListener('focusin', dismissPicker);
});
watch(() => props.disabled, disabled => { if (disabled) pickerOpen.value = false; });
</script>

<template>
  <div class="plan-date-field" :class="{ 'is-compact': compact }">
    <div class="plan-date-heading">
      <slot name="leading" />
      <div ref="picker" class="plan-date-picker" :class="{ 'with-leading': !!$slots.leading }" @keydown.esc="pickerEscape">
        <button ref="timeAction" type="button" class="plan-schedule-trigger" :aria-label="t('时间安排')" aria-haspopup="menu" :aria-controls="pickerId" :aria-expanded="pickerOpen" :disabled="disabled" @click="togglePicker" @keydown.down.prevent="pickerOpen || togglePicker()">
          <CalendarDays :size="22" :stroke-width="1.8" aria-hidden="true" /><span>{{ label }}</span><ChevronDown :size="16" aria-hidden="true" />
        </button>
        <div v-if="pickerOpen" :id="pickerId" class="plan-date-menu" role="menu" :aria-label="t('时间安排')" @keydown="pickerKeydown">
          <button v-for="option in options" :key="option.value" type="button" role="menuitemradio" :aria-checked="mode === option.value" @click="chooseSchedule(option.value)"><component :is="option.icon" :size="17" aria-hidden="true" /><span>{{ option.label }}</span><Check v-if="mode === option.value" :size="16" aria-hidden="true" /></button>
        </div>
      </div>
      <button v-if="compact && mode !== 'none'" type="button" class="compact-precision" :aria-label="precisionLabel" :title="precisionLabel" :disabled="disabled" @click="toggleTime"><CalendarDays v-if="modelValue.time" :size="15" /><Clock3 v-else :size="15" /></button>
    </div>
    <div v-if="mode !== 'none'" class="plan-date-inputs">
      <div class="plan-date-input">
        <div class="plan-date-label" :class="{ 'compact-single-label': compact && mode !== 'range' }">
          <label :for="dateId">{{ mode === 'range' ? (modelValue.time ? t('开始时间') : t('开始日期')) : t('计划日期') }}</label>
          <button v-if="mode === 'date' && !compact" type="button" class="plan-date-precision" :disabled="disabled" @click="toggleTime">{{ precisionLabel }}</button>
        </div>
        <input v-if="!modelValue.time" :id="dateId" type="date" :value="modelValue.date" required :disabled="disabled" @input="updateDate" />
        <input v-else :id="dateId" type="datetime-local" :value="startValue" required :disabled="disabled" @input="updateStart" />
      </div>
      <div v-if="mode === 'range'" class="plan-date-input">
        <div class="plan-date-label">
          <label :for="endId">{{ modelValue.time ? t('结束时间') : t('结束日期') }}</label>
          <button v-if="!compact" type="button" class="plan-date-precision" :disabled="disabled" @click="toggleTime">{{ precisionLabel }}</button>
        </div>
        <input :id="endId" :type="modelValue.time ? 'datetime-local' : 'date'" :value="modelValue.end" :min="modelValue.time ? startValue : modelValue.date" required :disabled="disabled" @input="update({ end: ($event.target as HTMLInputElement).value })" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.plan-date-field { min-width: 0; }
.plan-date-field .plan-date-heading { display: flex; align-items: center; gap: 22px; min-height: 36px; }
.plan-date-field label { margin: 0; color: var(--text-secondary); font-size: 13px; }
.plan-date-field .plan-date-heading label { display: block; }
.plan-date-field button { display: inline-flex; align-items: center; justify-content: center; gap: 4px; padding: 3px 5px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font-size: 12px; }
.plan-date-picker { position: relative; }
.plan-date-picker.with-leading { padding-left: 20px; border-left: 1px solid var(--line); }
.plan-date-field .plan-schedule-trigger { gap: 10px; min-height: 36px; padding: 4px 6px; border-radius: 6px; font-size: 15px; color: var(--text-secondary); }
.plan-date-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 5; min-width: 176px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--paper); box-shadow: 0 6px 24px #1f23281c; }
.with-leading .plan-date-menu { left: 20px; }
.plan-date-field .plan-date-menu button { display: flex; width: 100%; padding: 9px; gap: 10px; color: var(--text-secondary); font-size: 13px; text-align: left; }
.plan-date-menu button span { flex: 1; }
.plan-date-field .plan-date-menu button[aria-checked='true'] { background: var(--accent); color: var(--green); }
.plan-date-field button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.plan-date-inputs { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(180px, 100%), 1fr)); gap: 16px; margin-top: 22px; }
.plan-date-inputs > label, .plan-date-input { display: grid; gap: 8px; min-width: 0; }
.plan-date-label { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 24px; }
.plan-date-precision { flex-shrink: 0; white-space: nowrap; }
.plan-date-field input { box-sizing: border-box; width: 100%; min-width: 0; margin: 0; padding: 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--paper); font: inherit; font-size: 14px; }
.plan-date-field :is(input, button):disabled { opacity: 0.55; cursor: not-allowed; }
.plan-date-field :is(input, button):focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.plan-date-field.is-compact .plan-date-heading { justify-content: space-between; gap: 8px; min-height: 28px; }
.plan-date-field.is-compact .plan-schedule-trigger { padding: 0; gap: 7px; min-height: 28px; font-size: 12px; }
.plan-date-field.is-compact .plan-schedule-trigger > svg:first-child { width: 15px; height: 15px; }
.plan-date-field.is-compact .plan-schedule-trigger > svg:last-child { width: 13px; height: 13px; }
.plan-date-field.is-compact .compact-precision { width: 28px; height: 28px; padding: 0; flex-shrink: 0; }
.plan-date-field.is-compact .plan-date-inputs { margin-top: 8px; gap: 10px; }
.plan-date-field.is-compact .plan-date-label { min-height: 0; }
.plan-date-field.is-compact .compact-single-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
.plan-date-field.is-compact .plan-date-input { gap: 6px; }
.plan-date-field.is-compact input { height: 36px; padding: 7px 9px; font-size: 13px; background: var(--paper); }
.plan-date-field.is-compact label { font-size: 12px; }
@media (max-width: 480px) {
  .plan-date-field .plan-date-heading { gap: 12px; }
  .plan-date-picker.with-leading { padding-left: 12px; }
  .with-leading .plan-date-menu { left: auto; right: 0; min-width: 152px; }
}
</style>
