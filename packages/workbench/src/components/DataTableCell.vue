<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import type { CSSProperties } from 'vue';
import type { DataField, DataValue, FileEntry } from '@tano/protocol';
import { dataValueText, parseCellInput } from '../data-tables';
import { optionStyle } from '../data-table-properties';
import { Check, ExternalLink, Paperclip, SlidersHorizontal, X } from 'lucide-vue-next';
const props = defineProps<{
  field: DataField;
  value: DataValue;
  error?: string;
  readonly?: boolean;
  wrap?: boolean;
  files: FileEntry[];
  canUpload?: boolean;
  createOption?: (name: string, expected: DataValue) => string;
}>();
const emit = defineEmits<{
  change: [value: DataValue, expected: DataValue];
  error: [message: string];
  open: [id: string];
  link: [url: string];
  upload: [file: File];
  editField: [anchor: HTMLElement];
}>();
const input = ref(dataValueText(props.value)),
  focused = ref(false),
  expected = ref<DataValue>(props.value);
watch(
  () => props.value,
  (value) => {
    if (!focused.value) input.value = dataValueText(value);
  },
);
const isChoice = computed(() => ['select', 'multiselect'].includes(props.field.type));
const selected = computed(() =>
  Array.isArray(props.value)
    ? props.value
    : props.field.type === 'select' && typeof props.value === 'string'
      ? [props.value]
      : [],
);
const optionQuery = ref(''),
  optionInput = ref<HTMLInputElement>(),
  optionError = ref(''),
  optionBase = ref<DataValue>(props.value),
  activeOption = ref(0);
const optionListId = useId();
const optionName = computed(() => optionQuery.value.trim());
const matchingOptions = computed(() =>
  (props.field.options ?? []).filter((option) =>
    option.toLocaleLowerCase().includes(optionName.value.toLocaleLowerCase()),
  ),
);
const canCreateOption = computed(
  () =>
    !props.readonly &&
    !!props.createOption &&
    !!optionName.value &&
    !props.field.options?.includes(optionName.value),
);
const optionCount = computed(() => matchingOptions.value.length + Number(canCreateOption.value));
const attachments = computed(() =>
  props.files.filter((file) => file.kind === 'file' && !file.path.startsWith('.')),
);
const menu = ref<HTMLDetailsElement>(),
  popover = ref<HTMLElement>(),
  menuStyle = ref<CSSProperties>({});
async function placeMenu() {
  const element = popover.value;
  if (!menu.value?.open || !element) return;
  const width = Math.min(props.field.type === 'select' ? 240 : 300, window.innerWidth - 16);
  menuStyle.value = {
    ...menuStyle.value,
    width: `${width}px`,
    maxHeight: `${Math.min(260, window.innerHeight - 16)}px`,
  };
  await nextTick();
  const anchor = menu.value?.querySelector('summary')?.getBoundingClientRect();
  if (!menu.value?.open || !anchor || popover.value !== element) return;
  // Measure the rendered border box after width and wrapping have settled.
  const height = element.getBoundingClientRect().height;
  menuStyle.value = {
    ...menuStyle.value,
    left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`,
    top: `${anchor.bottom + height + 4 <= window.innerHeight - 8 ? anchor.bottom + 4 : Math.max(8, anchor.top - height - 4)}px`,
  };
}
function dismissMenu(event: Event) {
  if (menu.value?.contains(event.target as Node)) return;
  if (menu.value) menu.value.open = false;
  cleanupMenu();
}
function closeMenu(restoreFocus = false) {
  if (menu.value) menu.value.open = false;
  cleanupMenu();
  if (restoreFocus) menu.value?.querySelector('summary')?.focus({ preventScroll: true });
}
function menuFocusOut(event: FocusEvent) {
  if (menu.value?.open && !menu.value.contains(event.relatedTarget as Node | null)) closeMenu();
}
function editField() {
  if (props.readonly) return;
  const anchor = menu.value?.querySelector('summary');
  closeMenu(true);
  if (anchor) emit('editField', anchor);
}
function resetActiveOption() {
  activeOption.value =
    props.field.type === 'select' && !optionName.value
      ? Math.max(
          0,
          matchingOptions.value.findIndex((option) => option === props.value),
        )
      : 0;
}
function cleanupMenu() {
  window.removeEventListener('resize', placeMenu);
  window.removeEventListener('scroll', dismissMenu, true);
  document.removeEventListener('pointerdown', dismissMenu, true);
}
async function toggleMenu() {
  cleanupMenu();
  if (!menu.value?.open) return;
  optionQuery.value = optionError.value = '';
  resetActiveOption();
  optionBase.value = Array.isArray(props.value) ? [...props.value] : props.value;
  await placeMenu();
  if (!menu.value?.open) return;
  if (isChoice.value) optionInput.value?.focus({ preventScroll: true });
  window.addEventListener('resize', placeMenu);
  window.addEventListener('scroll', dismissMenu, true);
  document.addEventListener('pointerdown', dismissMenu, true);
}
watch([optionQuery, () => props.field.options], async () => {
  resetActiveOption();
  optionError.value = '';
  await nextTick();
  void placeMenu();
});
watch(optionError, () => void placeMenu());
function selectOption(value: string | null) {
  if (props.readonly) return;
  if (props.field.type === 'select') {
    emit('change', value, props.value);
    closeMenu(true);
  } else if (value !== null) toggle(value);
  optionQuery.value = '';
  void nextTick(() => {
    optionBase.value = Array.isArray(props.value) ? [...props.value] : props.value;
    if (menu.value?.open) optionInput.value?.focus({ preventScroll: true });
  });
}
async function createOption() {
  if (!canCreateOption.value) return;
  optionError.value = props.createOption!(optionName.value, optionBase.value);
  if (optionError.value) return;
  optionQuery.value = '';
  await nextTick();
  optionBase.value = Array.isArray(props.value) ? [...props.value] : props.value;
  if (props.field.type === 'select') closeMenu(true);
  else optionInput.value?.focus({ preventScroll: true });
}
function optionKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.isComposing) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeMenu(true);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!optionCount.value) return;
    activeOption.value =
      (activeOption.value + (event.key === 'ArrowDown' ? 1 : -1) + optionCount.value) %
      optionCount.value;
    void nextTick(() =>
      popover.value
        ?.querySelector<HTMLElement>(`[data-option-index="${activeOption.value}"]`)
        ?.scrollIntoView({ block: 'nearest' }),
    );
  } else if (event.key === 'Enter') {
    event.preventDefault();
    const option = matchingOptions.value[activeOption.value];
    if (option !== undefined) selectOption(option);
    else void createOption();
  }
}
onBeforeUnmount(cleanupMenu);
function commit(text = input.value) {
  try {
    emit('change', parseCellInput(props.field, text), expected.value);
  } catch (error) {
    emit('error', String(error));
  }
}
function toggle(value: string) {
  emit(
    'change',
    selected.value.includes(value)
      ? selected.value.filter((item) => item !== value)
      : [...selected.value, value],
    props.value,
  );
}
</script>

<template>
  <span
    v-if="field.type === 'formula'"
    class="data-calculated"
    :class="{ 'data-cell-error': error }"
    :title="error || dataValueText(value)"
    >{{ error ? '#错误' : dataValueText(value) }}</span
  >
  <input
    v-else-if="field.type === 'checkbox'"
    class="data-checkbox"
    type="checkbox"
    :aria-label="field.name"
    :checked="value === true"
    :disabled="readonly"
    @change="emit('change', ($event.target as HTMLInputElement).checked, value)"
  />
  <details
    v-else-if="isChoice || field.type === 'attachment'"
    ref="menu"
    class="data-multi"
    @toggle="toggleMenu"
    @keydown.esc.stop.prevent="closeMenu(true)"
    @focusout="menuFocusOut"
  >
    <summary :aria-label="field.name">
      <template v-if="selected.length"
        ><span
          v-for="item in selected"
          :key="item"
          class="data-tag"
          :class="{ 'data-single-tag': field.type === 'select' }"
          :style="isChoice ? optionStyle(field, item) : undefined"
          :title="item"
          ><span class="data-tag-text">{{
            field.type === 'attachment'
              ? (files.find((file) => file.id === item)?.name ?? '附件不可用')
              : item
          }}</span></span
        ></template
      ><span v-else class="data-cell-empty">{{
        field.type === 'attachment' ? '添加附件' : '选择…'
      }}</span>
    </summary>
    <div
      ref="popover"
      class="data-cell-popover panel-scrollbar"
      :class="{ 'data-choice-popover': isChoice, 'data-single-popover': field.type === 'select' }"
      :style="menuStyle"
    >
      <template v-if="isChoice">
        <div class="data-option-input">
          <span
            v-if="field.type === 'select' && selected.length && !optionQuery"
            class="data-tag data-single-tag data-current-option"
            :style="optionStyle(field, selected[0])"
            :title="selected[0]"
          >
            <span class="data-tag-text">{{ selected[0] }}</span>
            <button
              v-if="!readonly"
              type="button"
              class="data-current-clear"
              aria-label="清除选择"
              title="清除选择"
              @click="selectOption(null)"
            >
              <X :size="10" />
            </button>
          </span>
          <input
            ref="optionInput"
            v-model="optionQuery"
            class="data-option-search"
            role="combobox"
            :aria-label="`搜索或创建${field.name}选项`"
            :aria-controls="optionListId"
            :aria-activedescendant="optionCount ? `${optionListId}-${activeOption}` : undefined"
            aria-expanded="true"
            aria-autocomplete="list"
            :placeholder="
              field.type === 'select' && selected.length
                ? ''
                : readonly
                  ? '搜索选项…'
                  : '搜索或创建选项…'
            "
            :maxlength="2000"
            autocomplete="off"
            @keydown="optionKeydown"
            @paste.stop
          />
        </div>
        <p v-if="field.type !== 'select'" class="data-option-hint">
          {{ readonly ? '选择一个选项' : '选择或创建一个选项' }}
        </p>
        <div
          :id="optionListId"
          class="data-option-list panel-scrollbar"
          role="listbox"
          :aria-label="`${field.name}选项`"
          :aria-multiselectable="field.type === 'multiselect'"
        >
          <button
            v-for="(option, index) in matchingOptions"
            :id="`${optionListId}-${index}`"
            :key="option"
            type="button"
            class="data-option-row"
            :class="{ active: activeOption === index }"
            role="option"
            :aria-label="option"
            :aria-selected="selected.includes(option)"
            :data-option-index="index"
            :disabled="readonly"
            tabindex="-1"
            @pointermove="activeOption = index"
            @mousedown.prevent
            @click="selectOption(option)"
          >
            <span
              class="data-tag"
              :class="{ 'data-single-tag': field.type === 'select' }"
              :style="optionStyle(field, option)"
              :title="option"
              ><span class="data-tag-text">{{ option }}</span></span
            >
            <Check v-if="field.type === 'multiselect' && selected.includes(option)" :size="13" />
          </button>
          <button
            v-if="canCreateOption"
            :id="`${optionListId}-${matchingOptions.length}`"
            type="button"
            class="data-option-row"
            :class="{ active: activeOption === matchingOptions.length }"
            role="option"
            :aria-label="`创建选项 ${optionName}`"
            :aria-selected="false"
            :data-option-index="matchingOptions.length"
            tabindex="-1"
            @pointermove="activeOption = matchingOptions.length"
            @mousedown.prevent
            @click="createOption"
          >
            <span>创建</span>
            <span
              class="data-tag"
              :class="{ 'data-single-tag': field.type === 'select' }"
              :style="optionStyle(field, optionName)"
              :title="optionName"
              ><span class="data-tag-text">{{ optionName }}</span></span
            >
          </button>
          <p v-if="!optionCount && (readonly || optionName)" class="data-popover-empty">
            没有匹配的选项
          </p>
        </div>
        <button
          v-if="field.type === 'select' && !readonly"
          type="button"
          class="data-option-edit"
          @click="editField"
        >
          <SlidersHorizontal :size="13" />编辑属性
        </button>
        <p v-if="optionError" class="data-option-error" role="alert">{{ optionError }}</p>
      </template>
      <template v-else
        ><div v-for="file in attachments" :key="file.id" class="data-attachment-choice">
          <label
            ><input
              type="checkbox"
              :checked="selected.includes(file.id)"
              :disabled="readonly"
              @change="toggle(file.id)"
            /><Paperclip :size="12" />{{ file.path }}</label
          ><button type="button" :aria-label="`打开 ${file.name}`" @click="emit('open', file.id)">
            <ExternalLink :size="13" />
          </button>
        </div>
        <label v-if="canUpload && !readonly" class="data-upload"
          >上传附件<input
            type="file"
            @change="
              ($event.target as HTMLInputElement).files?.[0] &&
                emit('upload', ($event.target as HTMLInputElement).files![0]);
              ($event.target as HTMLInputElement).value = '';
            "
        /></label>
        <p v-if="!attachments.length" class="data-popover-empty">
          可关联工作区文件，原文件会保留。
        </p></template
      >
    </div>
  </details>
  <div v-else class="data-input-cell" :class="{ 'data-input-number': field.type === 'number' }">
    <input
      v-if="field.type === 'date' || field.type === 'number'"
      :aria-label="field.name"
      :type="field.type === 'date' ? 'date' : 'text'"
      :inputmode="field.type === 'number' ? 'decimal' : undefined"
      :readonly="readonly"
      :value="focused ? input : dataValueText(value)"
      @focus="
        focused = true;
        expected = value;
        input = dataValueText(value);
      "
      @input="input = ($event.target as HTMLInputElement).value"
      @change="commit()"
      @blur="focused = false"
    />
    <textarea
      v-else
      class="panel-scrollbar"
      rows="1"
      :aria-label="field.name"
      :readonly="readonly"
      :value="focused ? input : dataValueText(value)"
      :class="{ 'data-cell-wrap': wrap }"
      @focus="
        focused = true;
        expected = value;
        input = dataValueText(value);
      "
      @input="input = ($event.target as HTMLTextAreaElement).value"
      @change="commit()"
      @blur="focused = false"
    />
    <button
      v-if="field.type === 'url' && typeof value === 'string' && /^https?:\/\//i.test(value)"
      type="button"
      class="data-link-open"
      :aria-label="`打开链接 ${field.name}`"
      @click="emit('link', value)"
    >
      <ExternalLink :size="12" />
    </button>
  </div>
</template>

<style scoped>
.data-input-cell {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 31px;
}
.data-input-cell input,
.data-input-cell textarea {
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  padding: 6px 10px;
  font: inherit;
  line-height: 19px;
  background: transparent;
  color: inherit;
  outline: none;
}
.data-input-cell textarea {
  resize: none;
  height: 31px;
  overflow: hidden;
  white-space: nowrap;
}
.data-input-cell textarea.data-cell-wrap {
  white-space: pre-wrap;
  field-sizing: content;
  min-height: 31px;
  height: auto;
  max-height: 200px;
  overflow: auto;
}
.data-input-cell:focus-within {
  box-shadow: inset 0 0 0 2px var(--green);
}
.data-input-number input {
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.data-calculated {
  display: block;
  padding: 6px 10px;
  min-height: 31px;
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary);
}
.data-cell-error {
  color: var(--danger);
}
.data-checkbox {
  margin: 8px 12px;
  accent-color: var(--green);
}
.data-tag {
  display: inline-flex;
  align-items: center;
  background: var(--accent);
  color: var(--green);
}
.data-multi {
  padding: 3px 8px;
  min-height: 31px;
}
.data-multi summary {
  cursor: pointer;
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  min-height: 24px;
  align-items: center;
}
.data-tag {
  border-radius: 4px;
  padding: 1px 6px;
  font-size: 11px;
  max-width: 180px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-tag-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.data-single-tag {
  gap: 4px;
  border-radius: 999px;
  line-height: 16px;
}
.data-single-tag::before {
  content: '';
  flex: none;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  opacity: 0.8;
}
.data-cell-empty {
  color: var(--muted);
  font-size: 11px;
}
.data-cell-popover {
  position: fixed;
  z-index: 130;
  width: 270px;
  max-height: 260px;
  overflow: auto;
  overscroll-behavior: contain;
  background: var(--paper);
  border: 1px solid var(--line);
  border-radius: 8px;
  box-shadow: 0 8px 24px #0002;
  padding: 8px;
  color: var(--text);
}
.data-cell-popover label {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px;
  font-size: 12px;
}
.data-choice-popover {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  padding: 0;
  font-size: 12px;
}
.data-option-input {
  display: flex;
  align-items: center;
  gap: 5px;
  flex: none;
  min-height: 36px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--line);
  background: var(--sidebar);
}
.data-cell-popover .data-option-search {
  flex: 1;
  width: 100%;
  min-width: 0;
  border: 0;
  border-radius: 0;
  padding: 0;
  font: inherit;
  line-height: 18px;
  color: var(--text);
  background: transparent;
  outline: none;
}
.data-current-option {
  flex: 0 1 auto;
  max-width: calc(100% - 24px);
}
.data-current-option + .data-option-search {
  width: 24px;
}
.data-cell-popover .data-current-clear {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  padding: 1px;
  border-radius: 50%;
  color: inherit;
  opacity: 0.6;
}
.data-current-clear:hover {
  opacity: 1;
}
.data-single-popover .data-option-list {
  padding-top: 5px;
  padding-bottom: 5px;
}
.data-option-hint {
  flex: none;
  margin: 0;
  padding: 8px 10px 5px;
  font-size: 11px;
  color: var(--muted);
}
.data-option-list {
  min-height: 0;
  overflow: auto;
  overscroll-behavior: contain;
  padding: 0 4px 4px;
}
.data-cell-popover .data-option-row {
  display: flex;
  align-items: center;
  width: 100%;
  min-height: 28px;
  justify-content: flex-start;
  padding: 4px 6px;
  gap: 6px;
  border-radius: 4px;
  font: inherit;
  color: var(--text);
  text-align: left;
}
.data-option-row.active {
  background: var(--hover);
}
.data-option-row svg {
  margin-left: auto;
  color: var(--muted);
}
.data-option-row .data-tag {
  min-width: 0;
  max-width: 100%;
}
.data-cell-popover .data-option-edit {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: none;
  justify-content: flex-start;
  border-top: 1px solid var(--line);
  border-radius: 0;
  padding: 7px 10px;
  font: inherit;
  color: var(--muted);
}
.data-option-error {
  margin: 0;
  padding: 6px 10px;
  color: var(--danger);
  overflow-wrap: anywhere;
}
.data-popover-empty {
  margin: 0;
  padding: 8px 6px;
  color: var(--muted);
  font-size: 12px;
  line-height: 20px;
}
.data-cell-popover input {
  accent-color: var(--green);
}
.data-attachment-choice {
  display: flex;
  align-items: center;
}
.data-attachment-choice label {
  flex: 1;
  overflow-wrap: anywhere;
}
.data-upload {
  color: var(--green);
  border-top: 1px solid var(--line);
  margin-top: 8px;
}
.data-upload input {
  max-width: 170px;
  font-size: 11px;
}
.data-link-open {
  padding: 6px;
  color: var(--green);
}
</style>
