<script setup lang="ts">
import { Search } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import type { CalendarFilter } from '../calendar';

const filter = defineModel<CalendarFilter>({ required: true });
</script>

<template>
  <div class="calendar-filter-bar" role="region" :aria-label="t('日历筛选')">
    <div class="calendar-filter-kinds" role="group" :aria-label="t('筛选')">
      <button
        v-for="option in ([
          { value: 'all', label: t('全部') },
          { value: 'task', label: t('任务') },
          { value: 'event', label: t('日程') },
        ] as const)"
        :key="option.value"
        type="button"
        :aria-pressed="filter.kind === option.value"
        @click="filter.kind = option.value"
      >{{ option.label }}</button>
    </div>
    <label class="calendar-filter-completed">
      <input v-model="filter.showCompleted" type="checkbox" />
      <span>{{ t('显示已完成') }}</span>
    </label>
    <label class="calendar-filter-search">
      <Search :size="13" aria-hidden="true" />
      <input
        v-model="filter.query"
        type="search"
        :aria-label="t('搜索事项…')"
        :placeholder="t('搜索事项…')"
        maxlength="100"
      />
    </label>
  </div>
</template>

<style scoped>
.calendar-filter-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  font-size: 12px;
}
.calendar-filter-kinds {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--surface);
  box-shadow: inset 0 0 0 1px var(--line);
}
.calendar-filter-kinds button {
  min-height: 24px;
  padding: 0 10px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--muted);
}
.calendar-filter-kinds button:hover { color: var(--text); background: color-mix(in srgb, var(--hover) 70%, transparent); }
.calendar-filter-kinds button[aria-pressed='true'] {
  background: var(--paper);
  color: var(--text);
  font-weight: 500;
  box-shadow: 0 0 0 1px var(--line), 0 1px 2px rgb(15 15 15 / 0.08);
}
.calendar-filter-completed {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-height: 28px;
  padding: 0 8px 0 6px;
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  user-select: none;
  transition: background-color var(--motion-quick) var(--ease-standard), color var(--motion-quick) var(--ease-standard);
}
.calendar-filter-completed:hover { background: var(--hover); color: var(--text); }
.calendar-filter-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  min-height: 28px;
  padding: 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  background: var(--surface);
  color: var(--muted);
  cursor: text;
  transition: border-color var(--motion-base) var(--ease-standard), background-color var(--motion-base) var(--ease-standard), box-shadow var(--motion-base) var(--ease-standard);
}
.calendar-filter-search:hover { border-color: var(--control-border); }
.calendar-filter-search:focus-within {
  border-color: color-mix(in srgb, var(--text) 35%, var(--line));
  background: var(--paper);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 7%, transparent);
  color: var(--text-secondary);
}
.calendar-filter-search input {
  width: 140px;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
  transition: width var(--motion-spring) var(--ease-spring-smooth);
}
.calendar-filter-search input:focus,
.calendar-filter-search input:not(:placeholder-shown) { width: 200px; }
.calendar-filter-search input:focus-visible { outline: none; }
@media (max-width: 700px) {
  .calendar-filter-bar { padding: 6px 10px; gap: 8px; }
  .calendar-filter-search input,
  .calendar-filter-search input:focus,
  .calendar-filter-search input:not(:placeholder-shown) { width: 110px; }
}
</style>
