<script setup lang="ts">
import { t } from '../../i18n/i18n';
import { computed, ref, useId } from 'vue';
import { CalendarPlus, Repeat2 } from 'lucide-vue-next';
import { isActionableTask, isPlanCompleted, parseTaskRepeat, validEventDate, validEventTime } from '@tano/protocol';
import type { TaskRepeatMode, WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../../objects/workspace-objects';
import type { RepeatPreview } from '../task-repeat';
import { localDayKey } from '../calendar';
import { useWorkspaceStore } from '../../stores/workspace';

const props = defineProps<{
  object: WorkspaceObject;
  record: ObjectRecord;
  disabled: boolean;
  dirty: boolean;
  workspaceId?: string;
  personal?: boolean;
}>();
const emit = defineEmits<{ change: [value: unknown]; openRecord: [record: ObjectRecord] }>();
const store = useWorkspaceStore();
const preview = ref<RepeatPreview | null>();
const busy = ref(false);
const error = ref('');
const frequencyId = useId();

const checkable = computed(() => isActionableTask(props.object));
const supportsAfterComplete = computed(() => checkable.value && !props.personal && !!props.workspaceId);
const rule = computed(() => {
  const value = props.object.properties.repeatSourceId
    ? store.objects.find((record) => record.object.id === props.object.properties.repeatSourceId)?.object.properties.repeat
    : props.object.properties.repeat;
  return value === undefined ? null : parseTaskRepeat(value);
});
const effectiveMode = computed<TaskRepeatMode>(() =>
  rule.value?.mode ?? (supportsAfterComplete.value ? 'after_complete' : 'schedule'),
);
const anchor = computed(() => {
  const p = props.object.properties;
  if (validEventDate(p.date)) return p.date;
  if (validEventTime(p.start)) return localDayKey(new Date(p.start));
  if (validEventDate(p.due)) return p.due;
  return '';
});

function update(key: string, value: unknown) {
  preview.value = undefined;
  error.value = '';
  if (key === 'frequency' && !value) {
    emit('change', undefined);
    return;
  }
  try {
    const baseMode: TaskRepeatMode | undefined = supportsAfterComplete.value
      ? rule.value?.mode
      : 'schedule';
    const nextRaw: Record<string, unknown> = {
      version: 1,
      frequency: 'weekly',
      interval: 1,
      anchor: anchor.value,
      ...(baseMode ? { mode: baseMode } : {}),
      ...rule.value,
      [key]: value,
    };
    if (nextRaw.until === undefined) delete nextRaw.until;
    if (nextRaw.mode === undefined) delete nextRaw.mode;
    emit('change', parseTaskRepeat(nextRaw));
  } catch (reason) {
    error.value = String(reason);
  }
}

async function prepare() {
  if (!props.workspaceId) return;
  busy.value = true;
  error.value = '';
  try {
    preview.value = await store.repeatPreview(props.record, props.workspaceId);
    if (!preview.value) error.value = t('重复规则已结束');
  } catch (reason) {
    error.value = String(reason);
  } finally {
    busy.value = false;
  }
}

async function create() {
  if (!preview.value || !props.workspaceId) return;
  busy.value = true;
  error.value = '';
  try {
    emit('openRecord', await store.createRepeat(preview.value, props.workspaceId));
  } catch (reason) {
    error.value = String(reason);
  } finally {
    busy.value = false;
  }
}

const people = computed(
  () =>
    preview.value?.relations
      .filter((row) => row.type === 'assigned')
      .map((row) => store.objects.find((item) => item.object.id === row.source.id)?.object.name ?? t('不可用'))
      .join('、') || t('未分配'),
);
</script>

<template>
  <section class="task-repeat" :aria-label="t('重复任务')">
    <label class="task-repeat-label" :for="frequencyId"><Repeat2 :size="15" />{{ t('重复') }}</label>
    <div class="task-repeat-body">
      <select
        :id="frequencyId"
        :class="{ 'is-empty': !rule }"
        :value="rule?.frequency ?? ''"
        :disabled="disabled || busy || !!object.properties.repeatSourceId"
        @change="update('frequency', ($event.target as HTMLSelectElement).value)"
      >
        <option value="">{{ t('不重复') }}</option>
        <option value="daily">{{ t('每天') }}</option>
        <option value="weekly">{{ t('每周') }}</option>
        <option value="monthly">{{ t('每月') }}</option>
      </select>
    <template v-if="rule">
      <label v-if="supportsAfterComplete">
        {{ t('重复模式') }}
        <select
          :value="effectiveMode"
          :disabled="disabled || busy || !!object.properties.repeatSourceId"
          @change="update('mode', ($event.target as HTMLSelectElement).value)"
        >
          <option value="after_complete">{{ t('完成后生成下一次') }}</option>
          <option value="schedule">{{ t('按日程规律重复') }}</option>
        </select>
      </label>
      <label>
        {{ t('间隔') }}
        <input
          type="number"
          min="1"
          max="99"
          :value="rule.interval"
          :disabled="disabled || busy || !!object.properties.repeatSourceId"
          @change="update('interval', Number(($event.target as HTMLInputElement).value))"
        />
      </label>
      <label>
        {{ t('结束日期') }}
        <input
          type="date"
          :value="rule.until ?? ''"
          :disabled="disabled || busy || !!object.properties.repeatSourceId"
          @change="update('until', ($event.target as HTMLInputElement).value || undefined)"
        />
      </label>
      <button
        v-if="supportsAfterComplete && effectiveMode === 'after_complete'"
        type="button"
        :disabled="disabled || dirty || busy || !isPlanCompleted(object)"
        @click="prepare"
      >
        <CalendarPlus :size="14" />{{ t('预览下一次') }}
      </button>
    </template>
    <div v-if="preview" class="repeat-preview">
      <strong>{{ preview.object.name }}</strong>
      <span>{{ t('下一次：') }}{{ preview.object.properties.date ?? preview.object.properties.due }}</span>
      <span>{{ t('负责人：') }}{{ people }}</span>
      <span>{{ t('关联：') }}{{ preview.relations.length }} {{ t('项') }}</span>
      <div>
        <button type="button" :disabled="disabled || dirty || busy" @click="create">{{ t('确认创建下一次') }}</button>
        <button type="button" :disabled="busy" @click="preview = undefined">{{ t('取消') }}</button>
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
    </div>
  </section>
</template>

<style scoped>
/* Laid out as one row of the detail panel's property list: label column + controls. */
.task-repeat { display: grid; grid-template-columns: var(--plan-row-label, 104px) minmax(0, 1fr); column-gap: 12px; align-items: start; font-size: 13px; }
.task-repeat-label { display: flex; align-items: center; gap: 8px; min-height: 32px; color: var(--muted); }
.task-repeat-body { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 14px; min-width: 0; }
.task-repeat-body > label { display: flex; align-items: center; gap: 6px; min-width: 0; color: var(--muted); font-size: 12px; }
input[type=number] { width: 64px; }
button { display: inline-flex; gap: 5px; align-items: center; min-height: 30px; padding: 0 10px; border: 1px solid var(--line); border-radius: 7px; font: inherit; font-size: 12px; color: var(--text-secondary); }
button:hover:not(:disabled) { border-color: var(--control-border); background: var(--hover); color: var(--text); }
.repeat-preview { display: grid; gap: 6px; flex-basis: 100%; padding: 10px 12px; border-radius: 8px; background: var(--surface); font-size: 12px; }
.repeat-preview > div { display: flex; gap: 8px; margin-top: 4px; }
p { margin: 0; color: var(--danger); flex-basis: 100%; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 420px) { .task-repeat { grid-template-columns: minmax(0, 1fr); } }
</style>
