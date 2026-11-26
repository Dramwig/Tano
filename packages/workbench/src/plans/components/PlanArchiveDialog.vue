<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { document } = useWindowContext();

import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { Archive, CalendarDays, ListTodo, RotateCcw, Search, X } from 'lucide-vue-next';
import { isPlanObject } from '@tano/protocol';
import type { ObjectRecord } from '../../objects/workspace-objects';
import { usePlanStore, type PlanScope } from '../../stores/plans';
import { eventDueDate, isCheckableEvent } from '../calendar';
import { planKey, planSourceLabel } from '../personal-plans';

const props = defineProps<{ scope: PlanScope | 'all' }>();
const emit = defineEmits<{ close: []; selectEvent: [key: string] }>();

const plans = usePlanStore();
const query = ref('');
const busyKey = ref('');
const error = ref('');
const searchInput = ref<HTMLInputElement>();
const previousFocus = document.activeElement as HTMLElement | null;

const archived = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return plans
    .recordsFor(props.scope)
    .filter((record) => isPlanObject(record.object) && record.object.archived)
    .filter(
      (record) =>
        !needle ||
        `${record.object.name}\n${record.object.description}`
          .toLocaleLowerCase()
          .includes(needle),
    )
    .sort((a, b) => a.object.name.localeCompare(b.object.name, 'zh-CN'));
});

function dateLabel(record: ObjectRecord) {
  const properties = record.object.properties;
  if (typeof properties.date === 'string' && properties.date) return properties.date;
  if (typeof properties.start === 'string' && properties.start) return properties.start.slice(0, 10);
  const due = eventDueDate(record);
  return due ? t('截止 {0}', [due]) : '';
}

async function restore(record: ObjectRecord) {
  const key = planKey(record);
  if (busyKey.value || !plans.canEdit(record)) return;
  busyKey.value = key;
  error.value = '';
  try {
    await plans.update(record, { ...record.object, archived: false });
  } catch (reason) {
    error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    busyKey.value = '';
  }
}

function openItem(record: ObjectRecord) {
  emit('selectEvent', planKey(record));
  emit('close');
}

onMounted(() => {
  searchInput.value?.focus();
});
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});
</script>

<template>
  <div
    v-surface-motion="'PlanArchiveDialog:0'"
    class="modal-backdrop" data-surface-role="backdrop"
    @mousedown.self="emit('close')"
    @keydown.esc.stop.prevent="emit('close')"
  >
    <section
      class="modal plan-archive-dialog" data-surface-role="dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('已归档事项')"
    >
      <header class="plan-archive-header">
        <div>
          <h2><Archive :size="17" aria-hidden="true" />{{ t('已归档事项') }}</h2>
          <p>{{ t('已归档的事件与任务不会出现在日历和计划列表中，可随时查看或恢复。') }}</p>
        </div>
        <button
          type="button"
          class="icon-button"
          :aria-label="t('关闭')"
          :data-tooltip="t('关闭 · Esc')"
          @click="emit('close')"
        >
          <X :size="18" />
        </button>
      </header>

      <div class="plan-archive-search">
        <Search :size="15" aria-hidden="true" />
        <input
          ref="searchInput"
          v-model="query"
          type="search"
          :aria-label="t('搜索已归档事项')"
          :placeholder="t('搜索已归档的事件或任务…')"
        />
      </div>

      <p v-if="error" class="plan-archive-error" role="alert">{{ error }}</p>

      <ul v-if="archived.length" class="plan-archive-list" :aria-label="t('已归档事项列表')">
        <li v-for="record in archived" :key="planKey(record)" class="plan-archive-row">
          <button
            type="button"
            class="plan-archive-open"
            @click="openItem(record)"
          >
            <ListTodo v-if="isCheckableEvent(record)" :size="15" aria-hidden="true" />
            <CalendarDays v-else :size="15" aria-hidden="true" />
            <span class="plan-archive-info">
              <strong>{{ record.object.name }}</strong>
              <small v-if="scope === 'all' || dateLabel(record)">
                <template v-if="scope === 'all'">{{ planSourceLabel(record) }}</template>
                <template v-if="scope === 'all' && dateLabel(record)"> · </template>
                <template v-if="dateLabel(record)">{{ dateLabel(record) }}</template>
              </small>
            </span>
          </button>
          <button
            type="button"
            class="plan-archive-restore"
            :disabled="busyKey === planKey(record) || !plans.canEdit(record)"
            @click="restore(record)"
          >
            <RotateCcw :size="13" aria-hidden="true" />{{
              busyKey === planKey(record) ? t('恢复中…') : t('恢复')
            }}
          </button>
        </li>
      </ul>
      <div v-else class="plan-archive-empty">
        <Archive :size="24" :stroke-width="1.5" aria-hidden="true" />
        <p>{{ query.trim() ? t('没有找到匹配的已归档事项。') : t('当前范围内没有已归档的事件或任务。') }}</p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.plan-archive-dialog {
  width: min(520px, 100%);
  max-height: min(640px, calc(100dvh - 40px));
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.plan-archive-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.plan-archive-header h2 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  font-size: 16px;
}
.plan-archive-header p {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--muted);
  line-height: 1.5;
}
.plan-archive-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--surface);
  color: var(--muted);
}
.plan-archive-search input {
  flex: 1;
  min-width: 0;
  height: 34px;
  border: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
  outline: none;
}
.plan-archive-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}
.plan-archive-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: grid;
  gap: 4px;
}
.plan-archive-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
}
.plan-archive-row:hover {
  background: var(--hover);
}
.plan-archive-open {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 0;
  padding: 2px 0;
  background: transparent;
  color: var(--text);
  text-align: left;
  font: inherit;
  cursor: pointer;
}
.plan-archive-open > svg {
  flex: none;
  color: var(--muted);
}
.plan-archive-info {
  display: grid;
  gap: 2px;
  min-width: 0;
}
.plan-archive-info strong {
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.plan-archive-info small {
  font-size: 11px;
  color: var(--muted);
}
.plan-archive-restore {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.plan-archive-restore:hover:not(:disabled) {
  background: var(--surface);
  border-color: var(--control-border);
}
.plan-archive-restore:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.plan-archive-empty {
  display: grid;
  justify-items: center;
  gap: 8px;
  padding: 28px 16px;
  color: var(--muted);
  text-align: center;
  font-size: 13px;
}
.plan-archive-empty p {
  margin: 0;
}
</style>
