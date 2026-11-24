<script setup lang="ts">
import { Plus, X } from 'lucide-vue-next';
import type { DataTable, DataView } from '@tano/protocol';
import { t } from '../../i18n';
import { tableItemId } from '../../data-tables';

const props = defineProps<{
  table: DataTable;
  view: DataView;
  readonly: boolean;
  changeView: (operation: (view: DataView) => void) => void;
}>();

const emit = defineEmits<{
  close: [];
  'duplicate-view': [];
  'remove-view': [];
}>();

const filterOperators = [
  { id: 'eq', get label() { return t('等于'); } },
  { id: 'ne', get label() { return t('不等于'); } },
  { id: 'contains', get label() { return t('包含'); } },
  { id: 'gt', get label() { return t('大于'); } },
  { id: 'lt', get label() { return t('小于'); } },
  { id: 'empty', get label() { return t('为空'); } },
  { id: 'notEmpty', get label() { return t('不为空'); } },
];
</script>

<template>
  <aside class="data-settings panel-scrollbar" :aria-label="t('视图设置')">
    <header>
      <strong>{{ t('视图设置') }}</strong>
      <button class="data-icon" :aria-label="t('关闭视图设置')" @click="emit('close')">
        <X :size="16" />
      </button>
    </header>
    <fieldset :disabled="readonly">
      <label
        >{{ t('视图名称') }}<input
          :value="view.name"
          @change="
            props.changeView((view) => {
              view.name = ($event.target as HTMLInputElement).value;
            })
          " /></label
      ><label
        >{{ t('显示方式') }}<select
          :aria-label="t('显示方式')"
          :value="view.type"
          @change="
            props.changeView((view) => {
              view.type = ($event.target as HTMLSelectElement).value as DataView['type'];
            })
          "
        >
          <option value="table">{{ t('表格') }}</option>
          <option value="cards">{{ t('卡片') }}</option>
          <option value="board">{{ t('看板') }}</option>
        </select></label
      ><label
        >{{ t('分组') }}<select
          :aria-label="t('分组字段')"
          :value="view.groupBy"
          @change="
            props.changeView((view) => {
              view.groupBy = ($event.target as HTMLSelectElement).value;
            })
          "
        >
          <option value="">{{ t('不分组') }}</option>
          <option v-for="field in table.fields" :key="field.id" :value="field.id">
            {{ field.name }}
          </option>
        </select></label
      ><label class="data-check-label"
        ><input
          type="checkbox"
          :checked="view.wrap"
          @change="
            props.changeView((view) => {
              view.wrap = !view.wrap;
              delete view.fieldWrap;
            })
          "
        />{{ t('单元格自动换行') }}</label
      ><label class="data-check-label"
        ><input
          type="checkbox"
          :checked="view.freeze"
          @change="
            props.changeView((view) => {
              view.freeze = !view.freeze;
            })
          "
        />{{ t('冻结第一列') }}</label
      >
      <h4>{{ t('排序') }}</h4>
      <div v-for="(sort, index) in view.sorts" :key="index" class="data-rule">
        <select
          :aria-label="t('排序字段')"
          :value="sort.field"
          @change="
            props.changeView((view) => {
              view.sorts[index].field = ($event.target as HTMLSelectElement).value;
            })
          "
        >
          <option v-for="field in table.fields" :key="field.id" :value="field.id">
            {{ field.name }}
          </option></select
        ><select
          :aria-label="t('排序方向')"
          :value="sort.direction"
          @change="
            props.changeView((view) => {
              view.sorts[index].direction = ($event.target as HTMLSelectElement).value as
                | 'asc'
                | 'desc';
            })
          "
        >
          <option value="asc">{{ t('升序') }}</option>
          <option value="desc">{{ t('降序') }}</option></select
        ><button
          :aria-label="t('移除排序')"
          @click="
            props.changeView((view) => {
              view.sorts.splice(index, 1);
            })
          "
        >
          <X :size="13" />
        </button>
      </div>
      <button
        @click="
          props.changeView((view) =>
            view.sorts.push({ field: table.fields[0].id, direction: 'asc' }),
          )
        "
      >
        <Plus :size="13" />{{ t('添加排序') }}
      </button>
      <h4>{{ t('筛选 · 满足全部条件') }}</h4>
      <div v-for="(filter, index) in view.filters" :key="filter.id" class="data-filter-rule">
        <div class="data-rule">
          <select
            :aria-label="t('筛选字段')"
            :value="filter.field"
            @change="
              props.changeView((view) => {
                view.filters[index].field = ($event.target as HTMLSelectElement).value;
              })
            "
          >
            <option v-for="field in table.fields" :key="field.id" :value="field.id">
              {{ field.name }}
            </option></select
          ><select
            :aria-label="t('筛选条件')"
            :value="filter.operator"
            @change="
              props.changeView((view) => {
                view.filters[index].operator = ($event.target as HTMLSelectElement)
                  .value as typeof filter.operator;
              })
            "
          >
            <option v-for="op in filterOperators" :key="op.id" :value="op.id">
              {{ op.label }}
            </option></select
          ><button
            :aria-label="t('移除筛选')"
            @click="
              props.changeView((view) => {
                view.filters.splice(index, 1);
              })
            "
          >
            <X :size="13" />
          </button>
        </div>
        <input
          v-if="!['empty', 'notEmpty'].includes(filter.operator)"
          :aria-label="t('筛选值')"
          :value="filter.value"
          :placeholder="t('输入匹配值')"
          @change="
            props.changeView((view) => {
              view.filters[index].value = ($event.target as HTMLInputElement).value;
            })
          "
        />
      </div>
      <button
        @click="
          props.changeView((view) =>
            view.filters.push({
              id: tableItemId(),
              field: table.fields[0].id,
              operator: 'contains',
              value: '',
            }),
          )
        "
      >
        <Plus :size="13" />{{ t('添加筛选') }}
      </button>
      <h4>{{ t('显示字段') }}</h4>
      <label v-for="field in table.fields" :key="field.id" class="data-check-label"
        ><input
          type="checkbox"
          :checked="!view.hiddenFields.includes(field.id)"
          @change="
            props.changeView((view) => {
              view.hiddenFields = view.hiddenFields.includes(field.id)
                ? view.hiddenFields.filter((id) => id !== field.id)
                : [...view.hiddenFields, field.id];
            })
          "
        />{{ field.name }}</label
      >
      <div class="data-settings-footer">
        <button @click="emit('duplicate-view')">{{ t('复制视图') }}</button
        ><button :disabled="table.views.length < 2" @click="emit('remove-view')">{{ t('删除视图') }}</button>
      </div>
    </fieldset>
  </aside>
</template>

<style scoped>
.data-settings {
  flex: 0 0 300px;
  border-left: 1px solid var(--line);
  padding: 18px;
  overflow: auto;
  background: var(--paper);
}
.data-settings header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}
.data-settings button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 6px 9px;
  border-radius: 5px;
  font: inherit;
  cursor: pointer;
}
.data-settings button:hover {
  background: var(--hover);
}
.data-settings button:disabled {
  opacity: 0.45;
  cursor: default;
}
.data-settings .data-icon {
  padding: 6px;
  flex: none;
}
.data-settings fieldset {
  border: 0;
  padding: 0;
  margin: 0;
  min-width: 0;
}
.data-settings input,
.data-settings select {
  font: inherit;
  color: inherit;
}
.data-settings label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 12px 0;
  font-size: 12px;
}
.data-settings input:not([type='checkbox']),
.data-settings select {
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 5px;
  padding: 7px 9px;
  min-width: 0;
  width: 100%;
}
.data-settings .data-check-label {
  flex-direction: row;
  align-items: center;
  gap: 8px;
}
.data-check-label input {
  accent-color: var(--green);
}
.data-settings h4 {
  margin: 24px 0 10px;
  font-size: 12px;
  font-weight: 600;
}
.data-rule {
  display: flex;
  gap: 5px;
  margin: 8px 0;
}
.data-rule select {
  width: 42%;
  padding: 5px;
}
.data-rule button {
  padding: 4px;
}
.data-filter-rule {
  margin-bottom: 12px;
}
.data-settings-footer {
  display: flex;
  justify-content: space-between;
  margin-top: 24px;
  border-top: 1px solid var(--line);
  padding-top: 12px;
}
@media (max-width: 760px) {
  .data-settings {
    position: absolute;
    inset: 0 0 0 auto;
    width: min(100%, 340px);
    z-index: 30;
    box-shadow: -8px 0 24px #0001;
  }
}
</style>
