<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from 'lucide-vue-next';
import type { WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { calendarEvents, eventsOnDay, localDateTime, localDayKey, monthDays } from '../calendar';
import { useWorkspaceStore } from '../stores/workspace';
const store = useWorkspaceStore();
const month = ref(new Date(new Date().getFullYear(), new Date().getMonth(), 1));
const selected = ref(localDayKey(new Date()));
const events = computed(() => calendarEvents(store.objects));
const days = computed(() =>
  monthDays(month.value).map((date) => ({
    date,
    key: localDayKey(date),
    events: eventsOnDay(events.value, date),
  })),
);
const selectedDate = computed(() => new Date(`${selected.value}T00:00:00`));
const agenda = computed(() => eventsOnDay(events.value, selectedDate.value));
const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const busy = ref(false),
  error = ref(''),
  status = ref('');
const titleInput = ref<HTMLInputElement>();
const disabled = computed(
  () => busy.value || !!store.workspace?.readOnly || !store.capabilities.features.objectReferences,
);
const draft = ref<{
  workspace: string;
  record?: ObjectRecord;
  name: string;
  description: string;
  start: string;
  end: string;
}>();
const title = computed(() => `${month.value.getFullYear()} 年 ${month.value.getMonth() + 1} 月`);
const time = (value: unknown) =>
  new Date(String(value)).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
function span(record: ObjectRecord) {
  const start = new Date(String(record.object.properties.start)),
    end = new Date(String(record.object.properties.end));
  return `${localDayKey(start) === selected.value ? '' : `${start.getMonth() + 1}/${start.getDate()} `}${time(start)} – ${localDayKey(end) === selected.value ? '' : `${end.getMonth() + 1}/${end.getDate()} `}${time(end)}`;
}
function move(offset: number) {
  month.value = new Date(month.value.getFullYear(), month.value.getMonth() + offset, 1);
  selected.value = localDayKey(month.value);
}
function today() {
  month.value = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  selected.value = localDayKey(new Date());
}
function choose(date: Date) {
  selected.value = localDayKey(date);
  if (date.getMonth() !== month.value.getMonth())
    month.value = new Date(date.getFullYear(), date.getMonth(), 1);
}
async function edit(record?: ObjectRecord) {
  if (disabled.value || draft.value || !store.workspace) return;
  error.value = '';
  status.value = '';
  draft.value = {
    workspace: store.workspace.id,
    record: record ? JSON.parse(JSON.stringify(record)) : undefined,
    name: record?.object.name ?? '',
    description: record?.object.description ?? '',
    start: record
      ? localDateTime(new Date(String(record.object.properties.start)))
      : `${selected.value}T09:00`,
    end: record
      ? localDateTime(new Date(String(record.object.properties.end)))
      : `${selected.value}T10:00`,
  };
  await nextTick();
  titleInput.value?.focus();
}
async function save(archive = false) {
  const current = draft.value;
  if (!current || disabled.value || current.workspace !== store.workspace?.id) return;
  busy.value = true;
  error.value = '';
  status.value = '';
  try {
    const start = new Date(current.start),
      end = new Date(current.end);
    if (
      !current.start ||
      !current.end ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime())
    )
      throw new Error('请填写有效的开始与结束时间');
    if (localDateTime(start) !== current.start || localDateTime(end) !== current.end)
      throw new Error('所选时间在本地时区不存在，请检查夏令时或日期');
    if (end < start) throw new Error('结束时间不能早于开始时间');
    const value: WorkspaceObject = {
      ...(current.record?.object ?? {
        version: 1,
        id: '',
        type: 'event',
        properties: {},
        archived: false,
      }),
      name: current.name.trim(),
      description: current.description,
      archived: archive,
      properties: {
        ...current.record?.object.properties,
        start: start.toISOString(),
        end: end.toISOString(),
      },
    };
    if (current.record) await store.updateObject(current.record, value, current.workspace);
    else await store.createObject(value);
    if (draft.value === current && current.workspace === store.workspace?.id) {
      draft.value = undefined;
      selected.value = localDayKey(start);
      month.value = new Date(start.getFullYear(), start.getMonth(), 1);
      status.value = archive ? '事件已归档，可在对象管理中恢复' : '事件已保存';
    }
  } catch (cause) {
    if (draft.value === current) error.value = String(cause);
  } finally {
    busy.value = false;
  }
}
watch(
  () => store.workspace?.id,
  () => {
    draft.value = undefined;
    error.value = '';
    status.value = '';
    today();
  },
);
</script>

<template>
  <div class="tool-content calendar-panel">
    <div class="tool-intro">
      <div>
        <h3>工作区日历</h3>
        <p>安排会议、截止日期和重要时刻。</p>
      </div>
      <button class="tool-primary" :disabled="disabled || !!draft" @click="edit()">
        <Plus :size="16" />新建事件
      </button>
    </div>
    <p class="tool-note">按本地时区 {{ timezone }} 显示 · {{ events.length }} 个未归档事件</p>
    <p v-if="store.objectErrors.length" class="tool-error" role="alert">
      部分对象格式无效，未显示在日历中。请在对象管理中检查。
    </p>
    <p v-if="status" class="tool-success" role="status">{{ status }}</p>
    <div class="calendar-toolbar">
      <h3 aria-live="polite">{{ title }}</h3>
      <div class="tool-actions">
        <button class="tool-icon" aria-label="上个月" @click="move(-1)">
          <ChevronLeft :size="18" /></button
        ><button class="tool-secondary" @click="today">今天</button
        ><button class="tool-icon" aria-label="下个月" @click="move(1)">
          <ChevronRight :size="18" />
        </button>
      </div>
    </div>
    <div class="calendar-weekdays" aria-hidden="true">
      <span v-for="day in ['一', '二', '三', '四', '五', '六', '日']" :key="day">周{{ day }}</span>
    </div>
    <div class="calendar-grid" aria-label="月历">
      <button
        v-for="day in days"
        :key="day.key"
        class="calendar-day"
        :class="{
          outside: day.date.getMonth() !== month.getMonth(),
          selected: day.key === selected,
          today: day.key === localDayKey(new Date()),
        }"
        :aria-label="`${day.key}，${day.events.length} 个事件`"
        :aria-pressed="day.key === selected"
        @click="choose(day.date)"
      >
        <span class="calendar-number">{{ day.date.getDate() }}</span>
        <span
          v-for="record in day.events.slice(0, 2)"
          :key="record.object.id"
          class="calendar-event"
          :title="`${record.object.name} ${span(record)}`"
          >{{ record.object.name }}</span
        >
        <small v-if="day.events.length > 2">+{{ day.events.length - 2 }} 个</small>
      </button>
    </div>
    <div class="calendar-bottom">
      <section class="calendar-agenda" aria-label="当日安排">
        <h3>
          {{ selectedDate.getMonth() + 1 }} 月 {{ selectedDate.getDate() }} 日
          <span class="tool-count">{{ agenda.length }}</span>
        </h3>
        <div v-if="!agenda.length" class="tool-empty compact">
          <CalendarDays :size="26" />
          <p>这一天还没有安排</p>
          <button class="tool-text-button" :disabled="disabled || !!draft" @click="edit()">
            添加一个事件
          </button>
        </div>
        <button
          v-for="record in agenda"
          :key="record.object.id"
          class="agenda-event"
          :disabled="disabled || !!draft"
          @click="edit(record)"
        >
          <span>{{ span(record) }}</span
          ><strong>{{ record.object.name }}</strong
          ><small v-if="record.object.description">{{ record.object.description }}</small>
        </button>
      </section>
      <form v-if="draft" class="calendar-form" @submit.prevent="save()">
        <h3>{{ draft.record ? '编辑事件' : '新建事件' }}</h3>
        <label
          >标题<input
            ref="titleInput"
            v-model="draft.name"
            aria-label="事件标题"
            required
            maxlength="200"
            :disabled="disabled"
            placeholder="例如：项目评审"
        /></label>
        <div class="calendar-dates">
          <label
            >开始<input
              v-model="draft.start"
              aria-label="事件开始时间"
              type="datetime-local"
              required
              :disabled="disabled" /></label
          ><label
            >结束<input
              v-model="draft.end"
              aria-label="事件结束时间"
              type="datetime-local"
              required
              :disabled="disabled"
          /></label>
        </div>
        <label
          >说明<textarea
            v-model="draft.description"
            aria-label="事件说明"
            rows="2"
            maxlength="20000"
            :disabled="disabled"
          />
        </label>
        <p v-if="error" class="tool-error" role="alert">{{ error }}</p>
        <div class="tool-actions">
          <button class="tool-primary" :disabled="disabled">
            {{ busy ? '保存中…' : '保存事件' }}</button
          ><button
            type="button"
            class="tool-secondary"
            :disabled="busy"
            @click="
              draft = undefined;
              error = '';
            "
          >
            放弃编辑</button
          ><button
            v-if="draft.record"
            type="button"
            class="tool-text-button"
            :disabled="disabled"
            @click="save(true)"
          >
            归档事件
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
