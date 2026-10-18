<script setup lang="ts">
import { localizedDataFieldTypes as dataFieldTypes } from '../ui-labels';
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { CSSProperties } from 'vue';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDownUp,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  EyeOff,
  Filter,
  Group,
  GripVertical,
  Pin,
  Plus,
  SlidersHorizontal,
  Sigma,
  Trash2,
  WrapText,
  X,
} from 'lucide-vue-next';
import { } from '@tano/protocol';
import type {
  DataAggregate,
  DataField,
  DataFieldType,
  DataOptionColor,
  DataTable,
  DataView,
} from '@tano/protocol';
import { copyTable, tableItemId } from '../data-tables';
import {
  dataFieldIcons,
  optionPalette,
  optionStyle,
  removeDataOption,
  renameDataOption,
} from '../data-table-properties';

const props = defineProps<{
  table: DataTable;
  field: DataField;
  view: DataView;
  anchor: HTMLElement;
  readonly: boolean;
  commit: (operation: (table: DataTable) => void) => string;
}>();
const emit = defineEmits<{
  close: [];
  edit: [type?: DataFieldType];
  insert: [side: 'left' | 'right'];
  remove: [];
  filter: [];
}>();
type Panel = '' | 'properties' | 'types' | 'sort' | 'aggregate';
const panel = ref<Panel>(''),
  option = ref<string>(),
  optionName = ref(''),
  newOption = ref('');
const dragging = ref<string>();
const name = ref(props.field.name),
  nameBase = ref(props.field.name),
  error = ref('');
const root = ref<HTMLElement>(),
  secondary = ref<HTMLElement>(),
  tertiary = ref<HTMLElement>();
const rootStyle = ref<CSSProperties>({}),
  secondaryStyle = ref<CSSProperties>({}),
  tertiaryStyle = ref<CSSProperties>({});
const narrow = ref(false);
let panelAnchor: HTMLElement | undefined, optionAnchor: HTMLElement | undefined;
function optionTrigger() {
  return optionAnchor?.isConnected
    ? optionAnchor
    : [...(secondary.value?.querySelectorAll<HTMLElement>('[data-option]') ?? [])].find(
        (element) => element.dataset.option === option.value,
      );
}
const hasOptions = computed(() => ['select', 'multiselect'].includes(props.field.type));
const hasData = computed(() => props.table.rows.some((row) => row.values[props.field.id] != null));
const aggregates: { value: DataAggregate; label: string }[] = [
  { value: 'none', get label() { return t('不汇总'); } },
  { value: 'count', get label() { return t('记录数'); } },
  { value: 'filled', get label() { return t('非空数'); } },
  { value: 'sum', get label() { return t('求和'); } },
  { value: 'average', get label() { return t('平均值'); } },
  { value: 'min', get label() { return t('最小值'); } },
  { value: 'max', get label() { return t('最大值'); } },
];
const visibleAggregates = computed(() =>
  aggregates.filter(
    (item) =>
      ['number', 'formula'].includes(props.field.type) ||
      ['none', 'count', 'filled'].includes(item.value),
  ),
);
function focusable(element?: HTMLElement) {
  return [
    ...(element?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled)') ??
      []),
  ].filter(
    (item) => item.getClientRects().length && getComputedStyle(item).visibility !== 'hidden',
  );
}
function position() {
  const rect = props.anchor.getBoundingClientRect();
  const place = (
    element: HTMLElement | undefined,
    x: number,
    y: number,
    width: number,
  ): CSSProperties => ({
    width: `${Math.min(width, window.innerWidth - 16)}px`,
    left: `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(y, window.innerHeight - Math.min(element?.scrollHeight ?? 450, window.innerHeight - 16) - 8))}px`,
    maxHeight: `${window.innerHeight - 16}px`,
  });
  rootStyle.value = place(root.value, rect.left, rect.bottom + 4, 224);
  const bounds = (style: CSSProperties) => {
    const left = Number.parseFloat(String(style.left)),
      top = Number.parseFloat(String(style.top));
    return { left, top, right: left + Number.parseFloat(String(style.width)) };
  };
  const first = bounds(rootStyle.value);
  narrow.value =
    window.innerWidth < 760 || (first.left < 448 && window.innerWidth - first.right < 448);
  // Reserve room for both levels so the option editor never folds back over its parent.
  const openLeft = window.innerWidth - first.right < 448 && first.left >= 448;
  if (first) {
    const x = narrow.value ? first.left : openLeft ? first.left - 236 : first.right + 4;
    secondaryStyle.value = place(
      secondary.value,
      x,
      narrow.value
        ? first.top
        : first.top + (panelAnchor?.offsetTop ?? 0) - (root.value?.scrollTop ?? 0),
      232,
    );
  }
  const second = bounds(secondaryStyle.value);
  if (second) {
    const x = narrow.value ? second.left : openLeft ? second.left - 212 : second.right + 4;
    tertiaryStyle.value = place(
      tertiary.value,
      x,
      narrow.value
        ? second.top
        : second.top + (optionTrigger()?.offsetTop ?? 0) - (secondary.value?.scrollTop ?? 0),
      208,
    );
  }
}
async function openPanel(value: Panel, event: Event) {
  panel.value = panel.value === value ? '' : value;
  option.value = undefined;
  panelAnchor = event.currentTarget as HTMLElement;
  error.value = '';
  await nextTick();
  position();
  await nextTick();
  position();
  focusable(secondary.value)[0]?.focus();
}
async function openOption(value: string, event: Event) {
  option.value = value;
  optionName.value = value;
  error.value = '';
  optionAnchor = event.currentTarget as HTMLElement;
  await nextTick();
  position();
  await nextTick();
  position();
  tertiary.value?.querySelector<HTMLInputElement>('input')?.focus();
}
function apply(operation: (table: DataTable, field: DataField, view: DataView) => void) {
  if (props.readonly) return false;
  error.value = props.commit((table) => {
    const field = table.fields.find((item) => item.id === props.field.id);
    const view = table.views.find((item) => item.id === props.view.id);
    if (!field || !view) throw new Error(t('字段或视图已变更，请重新打开菜单'));
    operation(table, field, view);
  });
  return !error.value;
}
function rename() {
  if (name.value.trim() === nameBase.value) return;
  if (
    apply((table, field) => {
      if (field.name !== nameBase.value) throw new Error(t('字段名称已被外部修改，请重新打开菜单'));
      if (
        !name.value.trim() ||
        table.fields.some((item) => item.id !== field.id && item.name === name.value.trim())
      )
        throw new Error(t('请输入不重复的字段名称'));
      field.name = name.value.trim();
    })
  )
    nameBase.value = name.value = name.value.trim();
}
function changeType(type: DataFieldType) {
  if (type === props.field.type) {
    panel.value = '';
    return;
  }
  if (type === 'formula') {
    emit('edit', type);
    return;
  }
  if (
    apply((table, field) => {
      if (table.rows.some((row) => row.values[field.id] != null))
        throw new Error(t('此字段已有数据，请新建目标类型的字段'));
      field.type = type;
      delete field.formula;
      if (['select', 'multiselect'].includes(type)) field.options ??= [];
      else {
        delete field.options;
        delete field.optionColors;
      }
    })
  )
    panel.value = '';
}
function addOption() {
  const value = newOption.value.trim();
  if (
    apply((_table, field) => {
      if (!value || field.options?.includes(value)) throw new Error(t('请输入不重复的选项名称'));
      field.options = [...(field.options ?? []), value];
    })
  )
    newOption.value = '';
}
function renameOption() {
  if (option.value === undefined) return;
  const before = option.value,
    next = optionName.value.trim();
  if (apply((table, field) => renameDataOption(table, field.id, before, next)))
    option.value = optionName.value = next;
}
function colorOption(color: DataOptionColor) {
  if (option.value === undefined) return;
  const value = option.value;
  apply((_table, field) => {
    if (!field.options?.includes(value)) throw new Error(t('选项已变更，请重新打开菜单'));
    field.optionColors = { ...field.optionColors, [value]: color };
  });
}
function deleteOption() {
  if (option.value === undefined) return;
  const value = option.value;
  if (apply((table, field) => removeDataOption(table, field.id, value))) {
    option.value = undefined;
    secondary.value?.querySelector('input')?.focus();
  }
}
function moveOption(value: string, offset: number) {
  apply((_table, field) => {
    const index = field.options?.indexOf(value) ?? -1;
    if (index < 0 || !field.options || index + offset < 0 || index + offset >= field.options.length)
      return;
    field.options.splice(index + offset, 0, ...field.options.splice(index, 1));
  });
}
function dropOption(target: string) {
  const source = dragging.value;
  dragging.value = undefined;
  if (!source || source === target) return;
  apply((_table, field) => {
    const from = field.options?.indexOf(source) ?? -1,
      to = field.options?.indexOf(target) ?? -1;
    if (from < 0 || to < 0 || !field.options) throw new Error(t('选项已变更，请重新排序'));
    field.options.splice(to, 0, ...field.options.splice(from, 1));
  });
}
async function backOption() {
  const target = optionTrigger();
  option.value = undefined;
  await nextTick();
  target?.focus();
}
async function backPanel() {
  panel.value = '';
  option.value = undefined;
  await nextTick();
  panelAnchor?.focus();
}
function sort(direction?: 'asc' | 'desc') {
  if (
    apply((_table, field, view) => {
      view.sorts = view.sorts.filter((sort) => sort.field !== field.id);
      if (direction) view.sorts.unshift({ field: field.id, direction });
    })
  )
    emit('close');
}
function duplicate() {
  if (
    apply((table, field) => {
      const next = copyTable(field);
      next.id = tableItemId();
      let count = 1;
      next.name = t('{0} 副本', [field.name]);
      while (table.fields.some((item) => item.name === next.name))
        next.name = t('{0} 副本 {1}', [field.name, ++count]);
      table.fields.splice(table.fields.indexOf(field) + 1, 0, next);
      for (const row of table.rows)
        if (row.values[field.id] !== undefined)
          row.values[next.id] = copyTable(row.values[field.id]);
    })
  )
    emit('close');
}
function outside(event: Event) {
  if (
    ![root.value, secondary.value, tertiary.value, props.anchor].some((element) =>
      element?.contains(event.target as Node),
    )
  ) {
    if (name.value.trim() !== nameBase.value) {
      rename();
      if (error.value) return;
    }
    if (option.value !== undefined && optionName.value.trim() !== option.value) {
      renameOption();
      if (error.value) return;
    }
    emit('close');
  }
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    if (option.value !== undefined) {
      void backOption();
    } else if (panel.value) {
      void backPanel();
    } else emit('close');
  }
  if (event.key === 'Tab') {
    const active =
      option.value !== undefined ? tertiary.value : panel.value ? secondary.value : root.value;
    const items = focusable(active);
    const index = items.indexOf(document.activeElement as HTMLElement);
    if (items.length && (event.shiftKey ? index <= 0 : index === items.length - 1)) {
      event.preventDefault();
      items[event.shiftKey ? items.length - 1 : 0]?.focus();
    }
  }
  if (
    (event.key === 'ArrowDown' || event.key === 'ArrowUp') &&
    document.activeElement?.tagName === 'BUTTON'
  ) {
    const container = (document.activeElement as HTMLElement).closest('.field-menu');
    const items = focusable(container as HTMLElement).filter((item) => item.tagName === 'BUTTON');
    const index = items.indexOf(document.activeElement as HTMLElement);
    event.preventDefault();
    items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
  }
}
watch([panel, option, error, () => props.field.options?.length], async () => {
  await nextTick();
  position();
});
onMounted(async () => {
  position();
  await nextTick();
  position();
  root.value?.querySelector('input')?.focus();
  document.addEventListener('pointerdown', outside, true);
  window.addEventListener('resize', position);
  window.addEventListener('scroll', position, true);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('resize', position);
  window.removeEventListener('scroll', position, true);
  if (props.anchor.isConnected) props.anchor.focus();
});
</script>

<template>
  <Teleport to="body">
    <div class="field-menu-layer" :class="{ 'field-menu-stacked': narrow }" @keydown="keydown">
      <section
        ref="root"
        class="field-menu panel-scrollbar"
        :class="{ 'field-menu-covered': narrow && panel }"
        :style="rootStyle"
        role="dialog"
        :aria-label="t('{0} 属性菜单', [field.name])"
      >
        <div class="field-name">
          <component :is="dataFieldIcons[field.type]" :size="15" /><input
            v-model="name"
            :aria-label="t('字段名称')"
            maxlength="200"
            :disabled="readonly"
            @change="rename"
            @keydown.enter="rename"
          /><button :aria-label="t('关闭属性菜单')" @click="emit('close')"><X :size="13" /></button>
        </div>
        <button
          :disabled="readonly"
          :class="{ active: panel === 'properties' }"
          @click="hasOptions ? openPanel('properties', $event) : emit('edit')"
        >
          <SlidersHorizontal :size="15" />{{ t('编辑属性') }}<ChevronRight class="trailing" :size="13" />
        </button>
        <button
          :disabled="readonly"
          :class="{ active: panel === 'types' }"
          @click="openPanel('types', $event)"
        >
          <component :is="dataFieldIcons[field.type]" :size="15" />{{ t('更改类型') }}<span class="hint">{{
            dataFieldTypes[field.type]
          }}</span
          ><ChevronRight :size="13" />
        </button>
        <hr />
        <button :disabled="readonly" @click="emit('filter')">
          <Filter :size="15" />{{ t('筛选') }}<span
            v-if="view.filters.some((item) => item.field === field.id)"
            class="hint"
            >{{ t('已设置') }}</span
          >
        </button>
        <button
          :disabled="readonly"
          :class="{ active: panel === 'sort' }"
          @click="openPanel('sort', $event)"
        >
          <ArrowDownUp :size="15" />{{ t('排序') }}<ChevronRight class="trailing" :size="13" />
        </button>
        <button
          :disabled="readonly"
          @click="
            apply((_table, field, view) => {
              view.groupBy = view.groupBy === field.id ? '' : field.id;
            })
          "
        >
          <Group :size="15" />{{ t('按此列分组') }}<Check
            v-if="view.groupBy === field.id"
            class="trailing"
            :size="13"
          />
        </button>
        <button
          :disabled="readonly"
          :class="{ active: panel === 'aggregate' }"
          @click="openPanel('aggregate', $event)"
        >
          <Sigma :size="15" />{{ t('计算') }}<ChevronRight class="trailing" :size="13" />
        </button>
        <button
          :disabled="readonly"
          @click="
            apply((_table, _field, view) => {
              view.freeze = !view.freeze;
            })
          "
        >
          <Pin :size="15" />{{ t('冻结首列') }}<Check v-if="view.freeze" class="trailing" :size="13" />
        </button>
        <button
          :disabled="readonly || table.fields.length - view.hiddenFields.length <= 1"
          @click="apply((_table, field, view) => view.hiddenFields.push(field.id)) && emit('close')"
        >
          <EyeOff :size="15" />{{ t('隐藏此列') }}
        </button>
        <button
          :disabled="readonly"
          @click="
            apply((_table, field, view) => {
              view.fieldWrap = {
                ...view.fieldWrap,
                [field.id]: !(view.fieldWrap?.[field.id] ?? view.wrap),
              };
            })
          "
        >
          <WrapText :size="15" />{{ t('此列内容换行') }}<Check
            v-if="view.fieldWrap?.[field.id] ?? view.wrap"
            class="trailing"
            :size="13"
          />
        </button>
        <hr />
        <button :disabled="readonly" @click="emit('insert', 'left')">
          <ArrowLeft :size="15" />{{ t('在左侧插入') }}
        </button>
        <button :disabled="readonly" @click="emit('insert', 'right')">
          <ArrowRight :size="15" />{{ t('在右侧插入') }}
        </button>
        <button :disabled="readonly" @click="duplicate"><Copy :size="15" />{{ t('创建属性副本') }}</button>
        <button
          class="danger"
          :disabled="readonly || table.fields.length <= 1"
          @click="emit('remove')"
        >
          <Trash2 :size="15" />{{ t('删除属性') }}
        </button>
        <p v-if="error && !panel" role="alert">{{ error }}</p>
      </section>

      <section
        v-if="panel"
        ref="secondary"
        class="field-menu field-submenu panel-scrollbar"
        :class="{ 'field-menu-covered': narrow && option !== undefined }"
        :style="secondaryStyle"
        role="dialog"
        :aria-label="t('属性设置')"
      >
        <button class="panel-back" @click="backPanel"><ChevronLeft :size="14" />{{ t('返回') }}</button>
        <template v-if="panel === 'properties'">
          <div class="section-label"><span>{{ t('选项') }}</span><span>{{ t('手动排序') }}</span></div>
          <div
            v-for="(item, index) in field.options"
            :key="item"
            class="option-row"
            :class="{ active: option === item }"
            draggable="true"
            @dragstart="
              dragging = item;
              $event.dataTransfer?.setData('text/plain', item);
            "
            @dragend="dragging = undefined"
            @dragover.prevent
            @drop.prevent="dropOption(item)"
          >
            <GripVertical class="option-grip" :size="13" />
            <button
              class="option-choice"
              :data-option="item"
              :aria-label="t('编辑选项 {0}', [item])"
              @click="openOption(item, $event)"
            >
              <span class="option-tag" :style="optionStyle(field, item)">{{ item }}</span
              ><ChevronRight class="trailing" :size="12" />
            </button>
            <button
              class="option-move"
              :aria-label="t('上移 {0}', [item])"
              :disabled="index === 0"
              @click="moveOption(item, -1)"
            >
              <ArrowUp :size="12" />
            </button>
            <button
              class="option-move"
              :aria-label="t('下移 {0}', [item])"
              :disabled="index === (field.options?.length ?? 0) - 1"
              @click="moveOption(item, 1)"
            >
              <ArrowDown :size="12" />
            </button>
          </div>
          <form class="option-add" @submit.prevent="addOption">
            <input
              v-model="newOption"
              :aria-label="t('新选项名称')"
              :placeholder="t('添加选项…')"
              maxlength="2000"
            /><button :aria-label="t('添加选项')" :disabled="!newOption.trim()">
              <Plus :size="15" />
            </button>
          </form>
        </template>
        <template v-else-if="panel === 'types'">
          <div class="section-label">{{ t('属性类型') }}</div>
          <button
            v-for="(label, type) in dataFieldTypes"
            :key="type"
            :disabled="hasData && field.type !== type"
            @click="changeType(type)"
          >
            <component :is="dataFieldIcons[type]" :size="15" />{{ label
            }}<Check v-if="field.type === type" class="trailing" :size="13" />
          </button>
          <p v-if="hasData" class="note">{{ t('此列已有数据。转换类型请先新建一列。') }}</p>
        </template>
        <template v-else-if="panel === 'sort'">
          <div class="section-label">{{ field.name }}</div>
          <button @click="sort('asc')">
            <ArrowUp :size="15" />{{ t('升序') }}<Check
              v-if="view.sorts.some((item) => item.field === field.id && item.direction === 'asc')"
              class="trailing"
              :size="13"
            />
          </button>
          <button @click="sort('desc')">
            <ArrowDown :size="15" />{{ t('降序') }}<Check
              v-if="view.sorts.some((item) => item.field === field.id && item.direction === 'desc')"
              class="trailing"
              :size="13"
            />
          </button>
          <button v-if="view.sorts.some((item) => item.field === field.id)" @click="sort()">
            <X :size="15" />{{ t('移除此列排序') }}
          </button>
        </template>
        <template v-else-if="panel === 'aggregate'">
          <div class="section-label">{{ t('列底部计算') }}</div>
          <button
            v-for="item in visibleAggregates"
            :key="item.value"
            @click="
              apply((_table, field, view) => {
                view.aggregates[field.id] = item.value;
              }) && emit('close')
            "
          >
            {{ item.label
            }}<Check
              v-if="(view.aggregates[field.id] ?? 'none') === item.value"
              class="trailing"
              :size="13"
            />
          </button>
        </template>
        <p v-if="error && option === undefined" role="alert">{{ error }}</p>
      </section>

      <section
        v-if="option !== undefined"
        ref="tertiary"
        class="field-menu field-option-menu panel-scrollbar"
        :style="tertiaryStyle"
        role="dialog"
        :aria-label="t('选项设置')"
      >
        <button class="panel-back" @click="backOption"><ChevronLeft :size="14" />{{ t('返回选项') }}</button>
        <input
          v-model="optionName"
          class="option-name"
          :aria-label="t('选项名称')"
          maxlength="2000"
          @change="renameOption"
          @keydown.enter="renameOption"
        />
        <button class="danger" @click="deleteOption"><Trash2 :size="14" />{{ t('删除选项') }}</button>
        <hr />
        <div class="section-label">{{ t('颜色') }}</div>
        <button
          v-for="color in optionPalette"
          :key="color.value"
          :aria-label="t('选项颜色：{0}', [t(color.label)])"
          @click="colorOption(color.value)"
        >
          <span
            class="color-swatch"
            :style="{
              background: `color-mix(in srgb, ${color.color} 24%, var(--paper))`,
              borderColor: `color-mix(in srgb, ${color.color} 35%, var(--paper))`,
            }"
          />{{ t(color.label)
          }}<Check
            v-if="(field.optionColors?.[option] ?? 'default') === color.value"
            class="trailing"
            :size="13"
          />
        </button>
        <p v-if="table.fields.some((item) => item.formula?.includes(`[${field.id}]`))" class="note">
          {{ t('重命名会更新记录和精确筛选。公式中的选项文字需另行修改。') }}
        </p>
        <p v-if="error" role="alert">{{ error }}</p>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.field-menu-layer {
  position: fixed;
  inset: 0;
  z-index: 160;
  pointer-events: none;
  color: var(--text);
  font-size: 12px;
}
.field-menu {
  position: fixed;
  pointer-events: auto;
  padding: 5px;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow:
    0 4px 18px #00000012,
    0 1px 4px #0000000a;
  overflow: auto;
  overscroll-behavior: contain;
  box-sizing: border-box;
}
.field-menu button {
  width: 100%;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 6px 8px;
  min-height: 29px;
  background: transparent;
  border: 0;
  border-radius: 4px;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.field-menu button:hover,
.field-menu button:focus-visible,
.field-menu .active {
  background: var(--sidebar);
}
.field-menu button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: -2px;
}
.field-menu button:disabled {
  opacity: 0.4;
  cursor: default;
}
.field-menu button > svg {
  flex: none;
  color: var(--text-secondary);
}
.field-menu .trailing {
  margin-left: auto;
}
.field-menu .hint {
  margin-left: auto;
  color: var(--muted);
  font-size: 11px;
}
.field-menu hr {
  border: 0;
  border-top: 1px solid var(--line);
  margin: 5px 3px;
}
.field-menu input {
  font: inherit;
  color: var(--text);
  background: transparent;
  border: 1px solid transparent;
  border-radius: 4px;
  padding: 5px;
  min-width: 0;
  outline: none;
}
.field-menu input:focus {
  border-color: var(--green);
  box-shadow: 0 0 0 1px var(--accent);
  background: var(--paper);
}
.field-name {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 3px;
  margin-bottom: 3px;
}
.field-name > svg {
  color: var(--muted);
  flex: none;
}
.field-name input {
  width: 100%;
  background: var(--sidebar);
}
.field-name button {
  width: 24px;
  min-height: 24px;
  padding: 5px;
  flex: none;
}
.section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 7px 8px;
  font-size: 11px;
  color: var(--muted);
}
.option-row {
  display: flex;
  align-items: center;
  padding: 0 3px;
  border-radius: 4px;
}
.option-grip {
  color: var(--muted);
  flex: none;
}
.field-menu .option-choice {
  flex: 1;
  min-width: 0;
  padding: 4px;
  gap: 4px;
}
.option-tag {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 3px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  line-height: 18px;
}
.field-menu .option-move {
  width: 21px;
  padding: 4px;
  flex: none;
  color: var(--muted);
  opacity: 0;
}
.option-row:hover .option-move,
.option-row:focus-within .option-move {
  opacity: 1;
}
.option-row .option-move:disabled {
  opacity: 0.2;
}
.option-add {
  display: flex;
  gap: 4px;
  border-top: 1px solid var(--line);
  margin-top: 5px;
  padding: 5px 3px 0;
}
.option-add input {
  width: 100%;
}
.option-add button {
  width: 28px;
  flex: none;
}
.option-name {
  width: calc(100% - 8px);
  margin: 4px;
  background: var(--sidebar) !important;
}
.color-swatch {
  width: 14px;
  height: 14px;
  border: 1px solid;
  border-radius: 3px;
  flex: none;
}
.field-menu .danger {
  color: var(--danger);
}
.field-menu p {
  font-size: 11px;
  line-height: 1.6;
  margin: 5px;
  color: var(--danger);
  overflow-wrap: anywhere;
}
.field-menu .note {
  color: var(--muted);
}
.field-menu .panel-back {
  display: none;
  color: var(--muted);
  border-bottom: 1px solid var(--line);
  border-radius: 0;
  margin-bottom: 3px;
}
.field-menu-stacked .panel-back {
  display: flex;
}
.field-menu-covered {
  visibility: hidden;
}
.field-menu-stacked .option-move {
  opacity: 1;
}
@media (prefers-reduced-motion: no-preference) {
  .field-menu {
    animation: field-menu-in 0.1s ease-out;
  }
  @keyframes field-menu-in {
    from {
      opacity: 0;
      transform: translateY(-2px);
    }
    to {
      opacity: 1;
      transform: none;
    }
  }
}
</style>
