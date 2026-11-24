<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  AlignLeft,
  ArrowDownAZ,
  Braces,
  CalendarClock,
  CalendarDays,
  CheckSquare2,
  CircleHelp,
  Hash,
  List,
  Plus,
  Trash2,
} from 'lucide-vue-next';
import { useEditorWindow } from '../primitives/dom-context';
import { isElement } from '../primitives/dom-realm';
import { vSurfaceMotion } from '../primitives/surface-motion';
import {
  canAnimate,
  collapseElement,
  resizeHeight,
  settleHeight,
  spring,
  MOTION_DURATION,
  EASE_EXIT,
} from '../primitives/motion';
import { splitFrontmatter } from '../syntax';
import {
  frontmatterProperties,
  frontmatterValue,
  removeFrontmatterProperty,
  updateFrontmatterProperty,
  type FrontmatterValueKind,
} from '../frontmatter-display';
import type { SlashTranslate } from '../slash-commands';

const props = defineProps<{
  metadata: string;
  getMarkdown: () => string;
  readonly?: boolean;
  showDocumentProperties?: boolean;
  translate?: SlashTranslate;
}>();

const emit = defineEmits<{
  'publish-frontmatter': [markdown: string];
  'edit-source': [];
}>();

const window = useEditorWindow();
const getComputedStyle = (element: Element, pseudo?: string | null) =>
  window.getComputedStyle(element, pseudo);

const t: SlashTranslate = (message, values = []) =>
  props.translate?.(message, values) ??
  message.replace(/\{(\d+)\}/g, (token, index: string) =>
    Number(index) < values.length ? String(values[Number(index)] ?? '') : token,
  );

const properties = computed(() => (props.metadata ? frontmatterProperties(props.metadata) : []));
const editingProperty = ref<string | null | undefined>();
const editingRowKey = ref<string>();
const editingRowHeight = ref(32);
const editingRowIndex = ref(0);
const editingOrder = ref<string[]>([]);
const propertyOrder = ref<'source' | 'name'>('source');
const propertyNameCollator = new Intl.Collator('zh-CN', { numeric: true, sensitivity: 'base' });
const visibleProperties = computed(() => {
  const rows = [...(properties.value ?? [])];
  if (editingProperty.value !== undefined) {
    const order = new Map(editingOrder.value.map((name, index) => [name, index]));
    rows.sort(
      (left, right) => (order.get(left.name) ?? Infinity) - (order.get(right.name) ?? Infinity),
    );
  } else if (propertyOrder.value === 'name') {
    rows.sort((left, right) => propertyNameCollator.compare(left.name, right.name));
  }
  if (editingProperty.value === null) {
    rows.splice(Math.min(editingRowIndex.value, rows.length), 0, {
      name: '',
      value: '',
      kind: 'text',
    });
  } else if (editingProperty.value !== undefined) {
    const currentIndex = rows.findIndex((property) => property.name === editingProperty.value);
    if (currentIndex !== -1) {
      const [current] = rows.splice(currentIndex, 1);
      rows.splice(Math.min(editingRowIndex.value, rows.length), 0, current!);
    }
  }
  return rows;
});

const frontmatterPanel = ref<HTMLDetailsElement>();
const frontmatterContent = ref<HTMLElement>();
const panelExpanded = ref(false);
let panelAnimation: Animation | undefined;
watch(
  frontmatterPanel,
  (panel) => {
    panelExpanded.value = !!panel?.open;
  },
  { flush: 'post' },
);

// Document-property motion. Everything is layout-driven (heights animate), so
// the rows below, and the document body under the panel, glide along instead
// of jumping. Only user-initiated changes animate: switching documents swaps
// the rows silently.
let rowMotionUntil = 0;
let rowMotionMutedUntil = 0;
const armRowMotion = () => {
  if (performance.now() < rowMotionMutedUntil) return;
  rowMotionUntil = performance.now() + 700;
};
/** Pressing the panel heading blurs an open row editor first, which would
 * play the row/button collapse a moment before the panel's own collapse. The
 * panel animation already covers it, so those inner changes apply silently. */
function muteRowMotion() {
  rowMotionMutedUntil = performance.now() + 600;
  rowMotionUntil = 0;
}
function enterRow(element: Element, done: () => void) {
  if (performance.now() < rowMotionUntil) collapseElement(element as HTMLElement, true, done);
  else done();
}
function leaveRow(element: Element, done: () => void) {
  if (performance.now() >= rowMotionUntil) {
    done();
    return;
  }
  (element as HTMLElement).dataset.leaving = '1';
  collapseElement(element as HTMLElement, false, done);
}
function boxHeight(element: HTMLElement) {
  const style = getComputedStyle(element);
  const height = element.getBoundingClientRect().height;
  return style.boxSizing === 'border-box'
    ? height
    : Math.max(0, height - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom));
}
/** Open/close the whole panel with a height + fade spring. Interruptible:
 * reversing mid-way continues from the current visual height. */
function setPanelOpen(open: boolean) {
  const panel = frontmatterPanel.value;
  const content = frontmatterContent.value;
  if (!panel) return;
  panelExpanded.value = open;
  if (!content || !canAnimate(panel) || !canAnimate(content)) {
    panel.open = open;
    return;
  }
  const style = getComputedStyle(content);
  const zero = { height: '0px', paddingTop: '0px', opacity: 0 };
  const from = panel.open
    ? {
        height: `${boxHeight(content)}px`,
        paddingTop: style.paddingTop,
        opacity: Number(style.opacity),
      }
    : zero;
  panelAnimation?.cancel();
  if (open) panel.open = true;
  const natural = getComputedStyle(content);
  const full = { height: `${boxHeight(content)}px`, paddingTop: natural.paddingTop, opacity: 1 };
  const animation = content.animate(
    open ? [from, full] : [from, zero],
    open
      ? { duration: MOTION_DURATION.snappy, easing: spring('smooth') }
      : { duration: MOTION_DURATION.exit + 110, easing: EASE_EXIT, fill: 'forwards' },
  );
  panelAnimation = animation;
  const previousOverflow = content.style.overflow;
  content.style.overflow = 'clip';
  const release = () => {
    if (panelAnimation === animation) panelAnimation = undefined;
    content.style.overflow = previousOverflow;
  };
  animation.addEventListener('finish', () => {
    release();
    // Hide first, then drop the held end state, so the full content can never flash back.
    if (!open && !panelExpanded.value) {
      panel.open = false;
      animation.cancel();
    }
  });
  animation.addEventListener('cancel', release);
}
function onPanelHeadingClick(event: MouseEvent) {
  event.preventDefault();
  setPanelOpen(!panelExpanded.value);
}

// A row whose height changes (edit expands a textarea, a type switch, a
// validation message) animates itself; rows after it follow through layout.
let editingPropertyBase: string | null = null;
let activatingProperty = false;
const propertyName = ref('');
const editingPropertyField = ref<'name' | 'value'>('value');
const propertyKind = ref<FrontmatterValueKind>('text');
const propertyInput = ref('');
const propertyError = ref('');
const propertyErrorField = ref<'name' | 'value'>('value');
const typeMenuProperty = ref<string | null | undefined>();
const propertyLayoutSignature = computed(() =>
  [
    visibleProperties.value.map((property) => property.name).join('\u0000'),
    String(editingProperty.value),
    editingPropertyField.value,
    propertyKind.value,
    Math.min(12, propertyInput.value.split('\n').length),
    propertyError.value,
  ].join('\u0001'),
);
watch(
  propertyLayoutSignature,
  () => {
    const panel = frontmatterPanel.value;
    if (!panel?.open || !canAnimate(panel) || performance.now() < rowMotionMutedUntil) return;
    const before = new Map<HTMLElement, number>();
    for (const row of panel.querySelectorAll<HTMLElement>(
      '.frontmatter-property:not([data-leaving])',
    )) {
      before.set(row, row.getBoundingClientRect().height);
    }
    void nextTick(() => {
      const rows = [...before].filter(([row]) => row.isConnected && !row.dataset.leaving);
      for (const [row] of rows) settleHeight(row);
      const clip = typeMenuProperty.value === undefined;
      for (const [row, from] of rows) {
        resizeHeight(row, from, row.getBoundingClientRect().height, { clip });
      }
    });
  },
  { flush: 'pre' },
);

const propertyTypeOptions = [
  { kind: 'text', get label() { return t('文本'); }, icon: AlignLeft },
  { kind: 'number', get label() { return t('数字'); }, icon: Hash },
  { kind: 'boolean', get label() { return t('复选框'); }, icon: CheckSquare2 },
  { kind: 'date', get label() { return t('日期'); }, icon: CalendarDays },
  { kind: 'datetime', get label() { return t('日期和时间'); }, icon: CalendarClock },
  { kind: 'list', get label() { return t('列表'); }, icon: List },
  { kind: 'object', get label() { return t('对象'); }, icon: Braces },
  { kind: 'null', get label() { return t('空值'); }, icon: CircleHelp },
] as const;

function currentPropertyKind(name: string): FrontmatterValueKind {
  return editingProperty.value === name || (editingProperty.value === null && !name)
    ? propertyKind.value
    : frontmatterValue(props.metadata, name)?.kind ?? 'text';
}
function propertyTypeIcon(name: string) {
  return (
    propertyTypeOptions.find((option) => option.kind === currentPropertyKind(name))?.icon ??
    AlignLeft
  );
}
function editProperty(name: string | null, focus: 'name' | 'value' | false = 'value') {
  if (props.readonly || properties.value === null) return;
  if (editingProperty.value !== undefined && editingProperty.value !== name) {
    finishProperty();
    if (editingProperty.value !== undefined) return;
  }
  const current = name === null ? null : frontmatterValue(props.metadata, name);
  if (name !== null && !current) return;
  armRowMotion();
  editingOrder.value = visibleProperties.value.map((property) => property.name);
  const rowIndex =
    name === null
      ? visibleProperties.value.length
      : visibleProperties.value.findIndex((property) => property.name === name);
  editingRowIndex.value = rowIndex < 0 ? visibleProperties.value.length : rowIndex;
  const row = [
    ...(frontmatterPanel.value?.querySelectorAll<HTMLElement>('.frontmatter-property') ?? []),
  ].find((element) => element.dataset.propertyName === name);
  editingRowHeight.value = row?.offsetHeight || 32;
  editingRowKey.value = name ?? '__new__';
  activatingProperty = true;
  editingProperty.value = name;
  editingPropertyField.value = name === null || focus !== 'value' ? 'name' : 'value';
  propertyName.value = name ?? '';
  propertyKind.value = current?.kind ?? 'text';
  propertyInput.value = current?.value ?? '';
  editingPropertyBase = current ? JSON.stringify(current) : null;
  propertyError.value = '';
  void nextTick(() => {
    if (name === null && frontmatterPanel.value && !panelExpanded.value) setPanelOpen(true);
    if (focus) {
      frontmatterPanel.value
        ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
          `.frontmatter-row-editor ${name === null || focus === 'name' ? '.frontmatter-name-input' : '.frontmatter-value-editor :is(input, textarea, select)'}`,
        )
        ?.focus();
    }
    activatingProperty = false;
  });
}
async function addDocumentProperty() {
  if (props.readonly || !props.showDocumentProperties || properties.value === null) return;
  editProperty(null);
  await nextTick();
  frontmatterPanel.value?.scrollIntoView?.({ block: 'nearest' });
}
async function editPropertyValue() {
  activatingProperty = true;
  editingPropertyField.value = 'value';
  await nextTick();
  frontmatterPanel.value
    ?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      '.frontmatter-value-editor :is(input, textarea, select)',
    )
    ?.focus();
  activatingProperty = false;
}
function finishProperty() {
  armRowMotion();
  editingProperty.value = undefined;
  typeMenuProperty.value = undefined;
  propertyError.value = '';
}
function finishPropertyOnKey(event: KeyboardEvent) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    (event.target as HTMLInputElement & { composing?: boolean }).composing
  ) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  finishProperty();
}
function onPropertyFocusOut(event: FocusEvent) {
  if (activatingProperty) return;
  if (
    event.relatedTarget instanceof globalThis.Node &&
    (event.currentTarget as HTMLElement).contains(event.relatedTarget)
  ) {
    return;
  }
  finishProperty();
}
function dismissPropertyTypeMenu(event: PointerEvent) {
  if (typeMenuProperty.value === undefined) return;
  const panel = frontmatterPanel.value;
  const menu = panel?.querySelector('.frontmatter-type-menu');
  const trigger = panel?.querySelector('.frontmatter-property-type[aria-expanded="true"]');
  const path = event.composedPath();
  if ((menu && path.includes(menu)) || (trigger && path.includes(trigger))) return;
  typeMenuProperty.value = undefined;
}
function syncProperty(event?: Event) {
  if (event instanceof InputEvent && event.isComposing) return;
  if (props.readonly || editingProperty.value === undefined) return;
  if (editingProperty.value === null && !propertyName.value.trim()) return;
  try {
    if (
      editingProperty.value !== null &&
      JSON.stringify(frontmatterValue(props.metadata, editingProperty.value)) !== editingPropertyBase
    ) {
      throw new Error('属性已被其他修改更新，请重新打开编辑');
    }
    const markdown = updateFrontmatterProperty(
      props.getMarkdown(),
      editingProperty.value,
      propertyName.value,
      propertyKind.value,
      propertyInput.value,
    );
    emit('publish-frontmatter', markdown);
    editingProperty.value = propertyName.value.trim();
    editingPropertyBase = JSON.stringify(
      frontmatterValue(splitFrontmatter(markdown).prefix, editingProperty.value),
    );
    propertyError.value = '';
  } catch (error) {
    propertyError.value = error instanceof Error ? error.message : String(error);
    propertyErrorField.value =
      isElement(event?.target) && event.target.classList.contains('frontmatter-name-input')
        ? 'name'
        : 'value';
  }
}
function convertedPropertyInput(kind: FrontmatterValueKind): string {
  const value = propertyInput.value;
  if (kind === 'number') return Number.isFinite(Number(value)) && value.trim() ? value : '0';
  if (kind === 'boolean') return value === 'true' ? 'true' : 'false';
  if (kind === 'date') {
    return /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value)
      ? value.slice(0, 10).replaceAll('/', '-')
      : new Date().toISOString().slice(0, 10);
  }
  if (kind === 'datetime') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value;
    const date = /^\d{4}[-/]\d{2}[-/]\d{2}/.test(value)
      ? value.slice(0, 10).replaceAll('/', '-')
      : new Date().toISOString().slice(0, 10);
    return `${date}T00:00`;
  }
  if (kind === 'list' || kind === 'object') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (kind === 'list' && Array.isArray(parsed)) return JSON.stringify(parsed, null, 2);
      if (kind === 'object' && parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return JSON.stringify(parsed, null, 2);
      }
    } catch {
      /* Use a valid empty collection. */
    }
    return kind === 'list' ? JSON.stringify(value ? [value] : [], null, 2) : '{}';
  }
  return kind === 'null' ? '' : value;
}
function openPropertyTypeMenu(name: string | null) {
  if (props.readonly) return;
  if (editingProperty.value !== name) editProperty(name, false);
  if (editingProperty.value !== name) return;
  typeMenuProperty.value = typeMenuProperty.value === name ? undefined : name;
}
function changePropertyType(kind: FrontmatterValueKind) {
  armRowMotion();
  editingPropertyField.value = 'value';
  propertyInput.value = convertedPropertyInput(kind);
  propertyKind.value = kind;
  typeMenuProperty.value = undefined;
  syncProperty();
}
function deleteProperty() {
  if (props.readonly || editingProperty.value == null) return;
  try {
    if (
      JSON.stringify(frontmatterValue(props.metadata, editingProperty.value)) !== editingPropertyBase
    ) {
      throw new Error('属性已被其他修改更新，请重新打开编辑');
    }
    armRowMotion();
    emit('publish-frontmatter', removeFrontmatterProperty(props.getMarkdown(), editingProperty.value));
    editingProperty.value = undefined;
    typeMenuProperty.value = undefined;
    propertyError.value = '';
  } catch (error) {
    propertyError.value = error instanceof Error ? error.message : String(error);
  }
}

function resetEditing() {
  editingProperty.value = undefined;
  typeMenuProperty.value = undefined;
}

onMounted(() => {
  window.addEventListener('pointerdown', dismissPropertyTypeMenu, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', dismissPropertyTypeMenu, true);
});

defineExpose({
  addDocumentProperty,
  resetEditing,
});
</script>

<template>
  <Transition :css="false" @enter="enterRow" @leave="leaveRow">
    <details
      v-if="showDocumentProperties && (properties === null || properties.length > 0 || editingProperty !== undefined)"
      ref="frontmatterPanel"
      class="frontmatter-panel"
    >
      <summary class="frontmatter-heading" @pointerdown="muteRowMotion" @click="onPanelHeadingClick">
        <svg
          class="frontmatter-chevron"
          :class="{ 'is-expanded': panelExpanded }"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="m6 4.5 3.5 3.5L6 11.5"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
        {{ t('文档属性') }}
        <button
          v-if="properties !== null"
          type="button"
          class="frontmatter-order-toggle"
          :aria-pressed="propertyOrder === 'name'"
          :aria-label="propertyOrder === 'source' ? t('按名称排序文档属性') : t('按文件顺序显示文档属性')"
          :title="propertyOrder === 'source' ? t('按名称排序') : t('按文件顺序显示')"
          @click.stop.prevent="propertyOrder = propertyOrder === 'source' ? 'name' : 'source'"
          @keydown.stop
        >
          <ArrowDownAZ :size="16" />
        </button>
      </summary>
      <div ref="frontmatterContent" class="frontmatter-content">
        <template v-if="properties === null">
          <pre class="frontmatter-raw">{{ metadata }}</pre>
          <button v-if="!readonly" type="button" class="frontmatter-add" @click="emit('edit-source')">
            {{ t('在源码中编辑') }}
          </button>
        </template>
        <TransitionGroup v-else tag="div" class="frontmatter-rows" :css="false" @enter="enterRow" @leave="leaveRow">
          <div
            v-for="property in visibleProperties"
            :key="editingProperty === property.name || (editingProperty === null && !property.name) ? editingRowKey : property.name"
            class="frontmatter-property"
            :class="{ 'is-editing': editingProperty === property.name || (editingProperty === null && !property.name) }"
            :data-property-name="property.name"
            :style="editingProperty === property.name || (editingProperty === null && !property.name) ? { minHeight: `${editingRowHeight}px` } : undefined"
            @focusout="onPropertyFocusOut"
            @keydown.esc="finishPropertyOnKey"
          >
            <button
              v-if="!readonly"
              type="button"
              class="frontmatter-property-type"
              :title="t('属性类型：{0}', [propertyTypeOptions.find((option) => option.kind === currentPropertyKind(property.name))?.label])"
              :aria-label="t('切换 {0} 的类型', [property.name || t('新属性')])"
              :aria-expanded="typeMenuProperty === property.name || (typeMenuProperty === null && !property.name)"
              @click="openPropertyTypeMenu(property.name || null)"
            >
              <component :is="propertyTypeIcon(property.name)" :size="16" />
            </button>
            <component :is="propertyTypeIcon(property.name)" v-else class="frontmatter-property-icon" :size="16" aria-hidden="true" />
            <div
              v-if="editingProperty === property.name || (editingProperty === null && !property.name)"
              class="frontmatter-row-editor"
            >
              <div class="frontmatter-name-editor">
                <input
                  v-model="propertyName"
                  class="frontmatter-name-input"
                  :aria-label="t('属性名')"
                  :aria-invalid="propertyError && propertyErrorField === 'name' ? true : undefined"
                  spellcheck="false"
                  @input="syncProperty"
                  @compositionend="syncProperty"
                  @keydown.enter="finishPropertyOnKey"
                />
                <span v-if="propertyError && propertyErrorField === 'name'" class="frontmatter-row-error" role="alert">
                  {{ propertyError }}
                </span>
              </div>
              <div class="frontmatter-value-editor">
                <button
                  v-if="editingPropertyField === 'name'"
                  type="button"
                  class="frontmatter-property-value frontmatter-property-button"
                  data-no-press
                  :title="t('编辑 {0}', [property.name])"
                  @click="editPropertyValue"
                >
                  {{ propertyKind === 'null' ? t('空') : property.value }}
                </button>
                <select
                  v-else-if="propertyKind === 'boolean'"
                  v-model="propertyInput"
                  :aria-label="t('属性值')"
                  :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                  @change="syncProperty"
                >
                  <option value="true">true</option>
                  <option value="false">false</option>
                </select>
                <span v-else-if="propertyKind === 'null'" class="frontmatter-null-value">{{ t('空') }}</span>
                <input
                  v-else-if="propertyKind === 'date'"
                  v-model="propertyInput"
                  :aria-label="t('属性值')"
                  :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                  type="date"
                  @input="syncProperty"
                />
                <textarea
                  v-else-if="propertyKind === 'list' || propertyKind === 'object' || propertyInput.includes('\n')"
                  v-model="propertyInput"
                  :aria-label="t('属性值')"
                  :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                  :rows="Math.min(12, Math.max(propertyKind === 'text' ? 2 : 4, propertyInput.split('\n').length))"
                  :title="propertyKind === 'list' || propertyKind === 'object' ? t('使用 JSON 格式') : undefined"
                  spellcheck="false"
                  @input="syncProperty"
                  @compositionend="syncProperty"
                />
                <input
                  v-else
                  v-model="propertyInput"
                  :aria-label="t('属性值')"
                  :aria-invalid="propertyError && propertyErrorField === 'value' ? true : undefined"
                  type="text"
                  :inputmode="propertyKind === 'number' ? 'decimal' : undefined"
                  @input="syncProperty"
                  @compositionend="syncProperty"
                  @keydown.enter="finishPropertyOnKey"
                />
                <span v-if="propertyError && propertyErrorField === 'value'" class="frontmatter-row-error" role="alert">
                  {{ propertyError }}
                </span>
              </div>
            </div>
            <template v-else>
              <button
                v-if="!readonly"
                type="button"
                class="frontmatter-property-name frontmatter-property-button"
                data-no-press
                :title="t('编辑 {0}', [property.name])"
                @click="editProperty(property.name, 'name')"
              >
                {{ property.name }}
              </button>
              <span v-else class="frontmatter-property-name">{{ property.name }}</span>
              <button
                v-if="!readonly"
                type="button"
                class="frontmatter-property-value frontmatter-property-button"
                data-no-press
                :title="t('编辑 {0}', [property.name])"
                @click="editProperty(property.name)"
              >
                {{ currentPropertyKind(property.name) === 'null' ? t('空') : property.value }}
              </button>
              <span v-else class="frontmatter-property-value">
                {{ currentPropertyKind(property.name) === 'null' ? t('空') : property.value }}
              </span>
            </template>
            <div
              v-if="typeMenuProperty === property.name || (typeMenuProperty === null && !property.name)"
              v-surface-motion="'MarkdownEditor:0'"
              class="frontmatter-type-menu compact-action-menu"
              role="menu"
              :aria-label="t('属性类型')"
            >
              <button
                v-for="option in propertyTypeOptions"
                :key="option.kind"
                type="button"
                role="menuitemradio"
                :aria-checked="currentPropertyKind(property.name) === option.kind"
                @click="changePropertyType(option.kind)"
              >
                <component :is="option.icon" :size="16" />{{ option.label }}
              </button>
              <button
                v-if="editingProperty !== null"
                type="button"
                role="menuitem"
                class="frontmatter-type-delete"
                @click="deleteProperty"
              >
                <Trash2 :size="16" />{{ t('删除属性') }}
              </button>
            </div>
          </div>
        </TransitionGroup>
        <Transition :css="false" @enter="enterRow" @leave="leaveRow">
          <button
            v-if="!readonly && properties !== null && editingProperty !== null"
            type="button"
            class="frontmatter-add frontmatter-add-property"
            @click="editProperty(null)"
          >
            <Plus :size="16" aria-hidden="true" />{{ t('添加文档属性') }}
          </button>
        </Transition>
      </div>
    </details>
  </Transition>
</template>
