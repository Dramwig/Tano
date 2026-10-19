<script setup lang="ts">
import { t } from '../i18n';
import { formattingShortcuts } from '../shortcuts';
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import {
  Type,
  Underline,
  Strikethrough,
  Superscript,
  Subscript,
  Code,
  Highlighter,
  Ellipsis,
  Sigma,
  Palette,
} from 'lucide-vue-next';
import { announceToolbarMenuOpen, isAnotherToolbarMenu, toolbarMenuOpenEvent } from '../toolbar-menu';

const props = defineProps<{
  disabled?: boolean;
  more?: boolean;
  hideFormats?: boolean;
  dragging?: boolean;
  inlineMath?: boolean;
  textColor?: string | null;
  backgroundColor?: string | null;
}>();
const emit = defineEmits<{ format: [command: string, value?: string] }>();
const open = ref(false);
const root = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const colorsOpen = ref(false);
const colorTrigger = ref<HTMLButtonElement>();
const colorPanel = ref<HTMLElement>();
const colorPanelId = useId();
watch(open, () => { colorsOpen.value = false; });
watch(() => [props.disabled, props.hideFormats], () => { colorsOpen.value = false; });
watch(() => props.dragging, () => { open.value = false; });
const styles = [
  { command: 'underline', get name() { return t('下划线'); }, icon: Underline },
  { command: 'strikethrough', get name() { return t('删除线'); }, icon: Strikethrough },
  { command: 'superscript', get name() { return t('上标'); }, icon: Superscript },
  { command: 'subscript', get name() { return t('下标'); }, icon: Subscript },
  { command: 'code', get name() { return t('行内代码'); }, icon: Code },
  { command: 'highlight', get name() { return t('高亮'); }, icon: Highlighter },
];
const colors = [
  { get name() { return t('灰色'); }, value: '#787774', background: '#f1f1ef' },
  { get name() { return t('棕色'); }, value: '#9f6b53', background: '#f4eeee' },
  { get name() { return t('橙色'); }, value: '#c2410c', background: '#faebdd' },
  { get name() { return t('黄色'); }, value: '#ca8a04', background: '#fbf3db' },
  { get name() { return t('绿色'); }, value: '#15803d', background: '#e7f3ec' },
  { get name() { return t('蓝色'); }, value: '#2563eb', background: '#e3f2fd' },
  { get name() { return t('紫色'); }, value: '#7c3aed', background: '#f3ebf9' },
  { get name() { return t('粉色'); }, value: '#db2777', background: '#fae9f1' },
  { get name() { return t('红色'); }, value: '#dc2626', background: '#fdebec' },
];
function format(command: string, value?: string) {
  open.value = false;
  emit('format', command, value);
}
function closeOutside(event: MouseEvent) {
  if (!root.value?.contains(event.target as Node)) open.value = false;
}
function closeOtherMenu(event: Event) {
  if (!isAnotherToolbarMenu(event, root.value)) return;
  open.value = false;
  colorsOpen.value = false;
}
function toggleOpen() {
  if (open.value) {
    open.value = false;
    return;
  }
  announceToolbarMenuOpen(root.value);
  open.value = true;
}
function escape() {
  if (colorsOpen.value) {
    closeColors(true);
    return;
  }
  open.value = false;
  trigger.value?.focus();
}
function closeColors(focus = false) {
  colorsOpen.value = false;
  if (focus) colorTrigger.value?.focus();
}
async function openColors(focus = false) {
  if (props.disabled) return;
  colorsOpen.value = true;
  await nextTick();
  const panel = colorPanel.value;
  const button = colorTrigger.value;
  if (!panel || !button) return;
  const anchor = button.getBoundingClientRect();
  const parentElement = (panel.offsetParent ?? root.value) as HTMLElement;
  const parent = parentElement.getBoundingClientRect();
  const x = Math.max(8, Math.min(anchor.left, window.innerWidth - panel.offsetWidth - 8));
  const below = anchor.bottom + 4;
  const y = below + panel.offsetHeight <= window.innerHeight - 8 ? below
    : Math.max(8, anchor.top - panel.offsetHeight - 4);
  panel.style.left = `${x - parent.left - parentElement.clientLeft}px`;
  panel.style.top = `${y - parent.top - parentElement.clientTop}px`;
  if (focus) panel.querySelector<HTMLButtonElement>('button')?.focus();
}
function colorPanelKey(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    event.stopPropagation();
    closeColors(true);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const buttons = [...colorPanel.value!.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length]?.focus();
  }
}
function closeColorsOnViewportChange(event: Event) {
  if (event.target instanceof Node && colorPanel.value?.contains(event.target)) return;
  closeColors();
}
onMounted(() => {
  window.addEventListener('click', closeOutside);
  window.addEventListener(toolbarMenuOpenEvent, closeOtherMenu);
  window.addEventListener('resize', closeColorsOnViewportChange);
  window.addEventListener('scroll', closeColorsOnViewportChange, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('click', closeOutside);
  window.removeEventListener(toolbarMenuOpenEvent, closeOtherMenu);
  window.removeEventListener('resize', closeColorsOnViewportChange);
  window.removeEventListener('scroll', closeColorsOnViewportChange, true);
});
</script>

<template>
  <div ref="root" class="menu-wrap" @keydown.esc.stop.prevent="escape">
    <button
      ref="trigger"
      class="icon-button"
      :aria-label="more ? t('更多格式') : t('文字样式')"
      :data-tooltip="more ? t('更多格式') : t('文字样式与颜色')"
      :aria-expanded="open && (!disabled || !!$slots.preferences)"
      :disabled="disabled && !$slots.preferences"
      @mousedown.prevent
      @click="toggleOpen"
    >
      <Ellipsis v-if="more" :size="17" /><Type v-else :size="17" />
    </button>
    <div
      v-if="open && (!disabled || $slots.preferences)"
      class="dropdown compact-action-menu text-style-dropdown panel-scrollbar"
      :class="{ 'toolbar-action-dropdown': hideFormats }"
    >
      <template v-if="!hideFormats">
        <div class="text-style-grid">
          <button
            v-for="style in styles"
            :key="style.command"
            class="icon-button"
            :disabled="disabled"
            :aria-label="style.name"
            :data-tooltip="style.name"
            :data-tooltip-shortcut="formattingShortcuts[style.command]"
            @mousedown.prevent
            @click="format(style.command)"
          >
            <component :is="style.icon" :size="17" aria-hidden="true" />
          </button>
          <button v-if="inlineMath" class="icon-button" :disabled="disabled" :aria-label="t('行内公式')"
            :data-tooltip="t('行内公式')" @mousedown.prevent @click="format('math')">
            <Sigma :size="17" aria-hidden="true" />
          </button>
          <button ref="colorTrigger" class="icon-button" :disabled="disabled" :aria-label="t('文字颜色')"
            :data-tooltip="t('文字颜色')" :aria-expanded="colorsOpen" :aria-controls="colorPanelId"
            @mousedown.prevent @click="colorsOpen ? closeColors() : openColors()"
            @keydown.right.stop.prevent="openColors(true)" @keydown.down.stop.prevent="openColors(true)">
            <Palette :size="17" aria-hidden="true" />
          </button>
        </div>
      </template>
      <div v-if="$slots.extra" class="extra-formats" @click="open = false">
        <div v-if="!hideFormats" class="menu-divider" role="separator" />
        <slot name="extra" />
      </div>
      <div v-if="$slots.preferences" @click="open = false">
        <div v-if="!hideFormats && !$slots.extra" class="menu-divider" role="separator" />
        <slot name="preferences" />
      </div>
    </div>
    <div v-if="open && colorsOpen && !disabled && !hideFormats" :id="colorPanelId" ref="colorPanel"
      class="text-color-submenu compact-action-menu panel-scrollbar" role="group" :aria-label="t('文字颜色')"
      @keydown="colorPanelKey">
        <div class="text-style-label">{{ t('文字颜色') }}</div>
        <div class="text-color-grid">
          <button :disabled="disabled" :aria-label="t('恢复默认文字颜色')"
            :aria-pressed="textColor === null"
            :data-tooltip="t('恢复默认文字颜色')" @mousedown.prevent @click="format('text-color')">
            <span aria-hidden="true">A</span>
          </button>
          <button
            v-for="color in colors"
            :key="color.value"
            :disabled="disabled"
            :aria-label="t('{0}文字', [color.name])"
            :aria-pressed="textColor === color.value"
            :data-tooltip="color.name"
            :style="{ '--text-color-option': color.value }"
            @mousedown.prevent
            @click="format('text-color', color.value)"
          >
            <span aria-hidden="true">A</span>
          </button>
        </div>
        <div class="text-style-label">{{ t('背景颜色') }}</div>
        <div class="text-color-grid background-color-grid">
          <button :disabled="disabled" :aria-label="t('恢复默认背景颜色')"
            :aria-pressed="backgroundColor === null"
            :data-tooltip="t('恢复默认背景颜色')" @mousedown.prevent @click="format('background-color')" />
          <button v-for="color in colors" :key="color.background" :disabled="disabled"
            :aria-pressed="backgroundColor === color.background || (backgroundColor === 'highlight' && color.background === '#fbf3db')"
            :aria-label="t('{0}背景', [color.name])" :data-tooltip="t('{0}背景', [color.name])"
            :style="{ '--text-color-option': color.value, '--background-color-option': color.background }"
            @mousedown.prevent @click="format('background-color', color.background)" />
        </div>
    </div>
  </div>
</template>

<style scoped>
.text-style-dropdown {
  --text-style-menu-width: 184px;
  top: calc(100% + 6px);
  left: 0;
  width: var(--text-style-menu-width);
}
.toolbar-action-dropdown {
  --text-style-menu-width: 184px;
}
.text-style-grid {
  display: grid;
  grid-template-columns: repeat(5, 30px);
  justify-content: center;
  gap: 2px;
  padding: 2px 0;
}
.text-style-label {
  margin: 3px -6px 0;
  padding: 5px 13px 4px;
  color: var(--muted);
  font-size: 11px;
}
.text-color-submenu {
  position: absolute;
  z-index: 31;
  width: 210px;
  max-height: calc(100vh - 16px);
  overflow-y: auto;
  background: var(--paper);
}
.text-color-grid {
  display: grid;
  grid-template-columns: repeat(5, 30px);
  justify-content: center;
  gap: 8px;
  margin: 6px 4px 8px;
}
.text-color-grid button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--text-color-option, var(--text)) 25%, var(--paper));
  border-radius: 6px;
  color: var(--text-color-option, var(--text));
  background: var(--paper);
  font-size: 18px;
  font-weight: 600;
  line-height: 1;
}
.text-color-grid button:is(:hover, :focus-visible):not(:disabled) {
  border-color: currentColor;
  background: color-mix(in srgb, var(--text-color-option, var(--text)) 8%, var(--paper));
}
.text-color-grid button:focus-visible {
  outline: 2px solid currentColor;
  outline-offset: 2px;
}
.text-color-grid button[aria-pressed='true'] {
  border-color: currentColor;
  box-shadow: inset 0 0 0 1px currentColor;
}
.background-color-grid button,
.background-color-grid button:is(:hover, :focus-visible):not(:disabled) {
  background: var(--background-color-option, var(--paper));
}
@media (max-width: 700px) {
  .text-style-dropdown {
    left: 50%;
    transform: translateX(-50%);
  }
}
</style>
