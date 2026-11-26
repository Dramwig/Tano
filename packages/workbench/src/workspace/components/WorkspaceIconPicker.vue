<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();
const getComputedStyle = (element: Element, pseudo?: string | null) => window.getComputedStyle(element, pseudo);
import { isButtonElement, isNode } from '@tano/editor/dom-realm';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t, uiIconLabel } from '../../i18n/i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Search, Upload } from 'lucide-vue-next';
import WorkspaceIcon from './WorkspaceIcon.vue';
import { filterWorkspaceIconGroups, workspaceBuiltinIconGroups, workspaceEmojiGroups } from '../workspace-icons';
import { iconImageMaxBytes, iconImageProblem } from '../icon-image';

export interface WorkspaceIconPickerExtraTab {
  id: string;
  label: string;
  matches?: (icon: string) => boolean;
  defaultOpen?: boolean;
}

const props = withDefaults(defineProps<{
  icon: string;
  mode: 'demo' | 'web' | 'local';
  disabled?: boolean;
  label?: string;
  triggerClass?: string;
  align?: 'start' | 'end';
  allowIcons?: boolean;
  allowUpload?: boolean;
  extraTab?: WorkspaceIconPickerExtraTab;
}>(), { align: 'end', allowIcons: true, allowUpload: true });
const label = computed(() => props.label ?? t('工作区图标'));
const emit = defineEmits<{ select: [value: string]; upload: []; pasteImage: [file: File]; 'update:open': [value: boolean] }>();
const pickerId = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const scrollArea = ref<HTMLElement>();
const open = ref(false);
// Keep one anchor for an open session: tab changes must not follow layout
// movement of the document underneath the teleported picker.
let anchorRect: DOMRect | undefined;
watch(open, value => emit('update:open', value), { flush: 'sync' });
const baseTabs = [
  { id: 'emoji', get label() { return t('表情符号'); } },
  { id: 'icons', get label() { return t('图标'); } },
  { id: 'upload', get label() { return t('上传'); } },
] as const;
const visibleTabs = computed(() => [
  ...(props.extraTab ? [{ id: props.extraTab.id, label: props.extraTab.label }] : []),
  ...baseTabs.filter(item => (props.allowIcons || item.id !== 'icons') && (props.allowUpload || item.id !== 'upload')),
]);
type Tab = string;
const tab = ref<Tab>('emoji');
const query = ref('');
const currentCategory = ref('');
const focusedIcon = ref('');
const position = ref({ left: 8, top: 8, width: 392, maxHeight: 440 });
const groups = computed(() => (tab.value === 'icons' ? workspaceBuiltinIconGroups : workspaceEmojiGroups).map(group => ({
  ...group, label: t(group.label),
  icons: group.icons.map(icon => ({ ...icon,
    label: uiIconLabel(icon.value, icon.label),
  })),
})));
const filteredGroups = computed(() => filterWorkspaceIconGroups(groups.value, query.value));
const activeIcon = computed(() => {
  const choices = filteredGroups.value.flatMap(group => group.icons);
  return choices.find(choice => choice.value === focusedIcon.value)?.value
    ?? choices.find(choice => choice.value === props.icon)?.value
    ?? choices[0]?.value;
});

function syncCategory() {
  const area = scrollArea.value;
  if (!area) return;
  const sections = [...area.querySelectorAll<HTMLElement>('[data-category]')];
  let current: HTMLElement | undefined = sections[0];
  if (area.clientHeight > 0) {
    if (area.scrollTop > 0 && area.scrollTop + area.clientHeight >= area.scrollHeight - 1) {
      current = sections.at(-1);
    } else {
      const top = area.getBoundingClientRect().top + 16;
      for (const section of sections) {
        if (section.getBoundingClientRect().top > top) break;
        current = section;
      }
    }
  }
  currentCategory.value = current?.dataset.category ?? '';
}
function resetScroll() {
  if (scrollArea.value) scrollArea.value.scrollTop = 0;
  syncCategory();
}
function scrollToCategory(id: string) {
  const area = scrollArea.value;
  const section = area?.querySelector<HTMLElement>(`[data-category="${id}"]`);
  if (!area || !section) return;
  area.scrollTop = Math.max(0, area.scrollTop + section.getBoundingClientRect().top - area.getBoundingClientRect().top - 8);
  syncCategory();
}
function place() {
  if (!trigger.value) return;
  const rect = anchorRect ?? trigger.value.getBoundingClientRect();
  const width = Math.max(0, Math.min(392, window.innerWidth - 16));
  const maxHeight = Math.max(0, Math.min(440, window.innerHeight - 16));
  const height = Math.min(panel.value?.offsetHeight || maxHeight, maxHeight);
  const top = rect.bottom + 8 + height <= window.innerHeight - 8
    ? rect.bottom + 8
    : rect.top - height - 8 >= 8
      ? rect.top - height - 8
      : Math.max(8, window.innerHeight - height - 8);
  position.value = {
    left: Math.max(8, Math.min(props.align === 'start' ? rect.left : rect.right - width, window.innerWidth - width - 8)),
    top, width, maxHeight,
  };
  if (panel.value) panel.value.dataset.surfaceSide = top < rect.top ? 'up' : 'down';
}
async function toggle() {
  if (props.disabled) return;
  if (open.value) { close(); return; }
  if (props.extraTab?.matches?.(props.icon)) tab.value = props.extraTab.id;
  else if (props.allowIcons && props.icon.startsWith('icon:')) tab.value = 'icons';
  else if ((!props.icon || props.icon.startsWith('data:') || (!props.allowIcons && props.icon.startsWith('icon:'))) && props.extraTab?.defaultOpen) tab.value = props.extraTab.id;
  else tab.value = 'emoji';
  query.value = ''; focusedIcon.value = '';
  anchorRect = trigger.value?.getBoundingClientRect();
  place();
  open.value = true;
  await nextTick();
  place();
  resetScroll();
  if (tab.value === 'emoji' || tab.value === 'icons') {
    searchInput.value?.focus({ preventScroll: true });
  } else {
    panel.value?.querySelector<HTMLElement>('[data-icon-choice][aria-pressed="true"], [data-icon-choice], [role="tab"][aria-selected="true"]')?.focus({ preventScroll: true });
  }
}
function close(restoreFocus = false) {
  clearUploadError();
  dragDepth = 0; dragging.value = false;
  open.value = false;
  if (restoreFocus) trigger.value?.focus({ preventScroll: true });
}
function select(value: string) {
  if (props.disabled) return;
  emit('select', value);
  close(true);
}
function upload() {
  if (props.disabled) return;
  clearUploadError();
  emit('upload');
}
// Upload feedback stays silent until a dropped or pasted file is rejected.
const uploadError = ref('');
const dragging = ref(false);
let dragDepth = 0;
let uploadErrorTimer: ReturnType<typeof setTimeout> | undefined;
function formatBytes(bytes: number) {
  // Round up so a file just over the limit never reads as equal to it.
  return bytes >= 1024 * 1024 ? `${Math.ceil(bytes / 1024 / 1024 * 10) / 10} MB` : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
}
function clearUploadError() {
  if (uploadErrorTimer) clearTimeout(uploadErrorTimer);
  uploadErrorTimer = undefined;
  uploadError.value = '';
}
function showUploadError(message: string) {
  clearUploadError();
  uploadError.value = message;
  uploadErrorTimer = setTimeout(clearUploadError, 4000);
}
/** Validate a dropped or pasted file; valid images are emitted through `pasteImage`. */
function acceptImage(file: File) {
  const problem = iconImageProblem(file);
  if (problem === 'type') { showUploadError(t('仅支持 PNG、JPG、WebP 或 GIF 图片')); return; }
  if (problem === 'size') {
    showUploadError(t('图片不能超过 {0}（当前 {1}）', [formatBytes(iconImageMaxBytes), formatBytes(file.size)]));
    return;
  }
  clearUploadError();
  emit('pasteImage', file);
  close(true);
}
function pasteImage(event: ClipboardEvent) {
  if (!open.value || tab.value !== 'upload' || props.disabled || !event.clipboardData) return;
  const items = [...event.clipboardData.items].filter(item => item.kind === 'file');
  const file = (items.find(item => item.type.startsWith('image/')) ?? items[0])?.getAsFile()
    ?? [...event.clipboardData.files].find(file => file.type.startsWith('image/'))
    ?? event.clipboardData.files[0];
  if (!file) return;
  event.preventDefault();
  event.stopPropagation();
  acceptImage(file);
}
function hasFiles(event: DragEvent) {
  return [...(event.dataTransfer?.types ?? [])].includes('Files');
}
function dragEnter(event: DragEvent) {
  if (props.disabled || !hasFiles(event)) return;
  event.preventDefault();
  dragDepth++;
  dragging.value = true;
}
function dragOver(event: DragEvent) {
  if (props.disabled || !hasFiles(event)) return;
  event.preventDefault();
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
}
function dragLeave() {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) dragging.value = false;
}
function dropImage(event: DragEvent) {
  dragDepth = 0; dragging.value = false;
  if (props.disabled || !hasFiles(event)) return;
  event.preventDefault();
  const file = event.dataTransfer?.files[0];
  if (file) acceptImage(file);
}
function focusUpload(event: PointerEvent) {
  if (event.target === event.currentTarget) (event.currentTarget as HTMLElement).focus({ preventScroll: true });
}
function changeTab(value: Tab) {
  clearUploadError();
  tab.value = value;
  query.value = ''; focusedIcon.value = '';
  void nextTick().then(place);
}
function tabKeydown(event: KeyboardEvent, current: Tab) {
  const choices = visibleTabs.value;
  let index = choices.findIndex(item => item.id === current);
  if (event.key === 'ArrowRight') index = (index + 1) % choices.length;
  else if (event.key === 'ArrowLeft') index = (index + choices.length - 1) % choices.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = choices.length - 1;
  else return;
  event.preventDefault();
  const value = choices[index]!.id;
  changeTab(value);
  panel.value?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)?.focus();
}
function gridKeydown(event: KeyboardEvent) {
  if (!(isButtonElement(event.target)) || !event.target.hasAttribute('data-icon-choice')) return;
  const buttons = [...(panel.value?.querySelectorAll<HTMLButtonElement>('[data-icon-choice]') ?? [])];
  const index = buttons.indexOf(event.target);
  const grid = event.target.closest<HTMLElement>('.workspace-icon-picker-grid');
  const columns = grid ? Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(/\s+/).filter(Boolean).length) : 1;
  let next: number;
  if (event.key === 'ArrowRight') next = index + 1;
  else if (event.key === 'ArrowLeft') next = index - 1;
  else if (event.key === 'ArrowDown') next = index + columns;
  else if (event.key === 'ArrowUp') next = index - columns;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = buttons.length - 1;
  else return;
  event.preventDefault();
  buttons[Math.max(0, Math.min(next, buttons.length - 1))]?.focus();
}
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); close(true);
  } else if (event.key === 'Tab') {
    const buttons = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
      event.preventDefault(); close(true);
    }
  } else gridKeydown(event);
}
function outside(event: Event) {
  if (!(isNode(event.target)) || trigger.value?.contains(event.target) || panel.value?.contains(event.target)) return;
  close();
}
function dismiss() { close(); }
watch(() => props.disabled, disabled => { if (disabled) close(); });
watch([tab, query], async () => {
  await nextTick();
  resetScroll();
});
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside, true);
  window.addEventListener('scroll', outside, true);
  window.addEventListener('resize', dismiss);
});
onBeforeUnmount(() => {
  clearUploadError();
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside, true);
  window.removeEventListener('scroll', outside, true);
  window.removeEventListener('resize', dismiss);
});

</script>

<template>
  <button
    ref="trigger" type="button" class="settings-button workspace-icon-preview" data-surface-role="control" :class="triggerClass"
    :aria-label="t('选择{0}', [label])" :data-tooltip="t('选择{0}', [label])" aria-haspopup="dialog" :aria-expanded="open"
    :aria-controls="pickerId" :disabled="disabled" @click="toggle"
  ><slot name="preview"><WorkspaceIcon :icon="icon" :mode="mode" :size="28" /></slot></button>
  <Teleport :to="document.body">
    <section v-surface-motion="'WorkspaceIconPicker:0'"
      v-if="open" :id="pickerId" ref="panel" class="workspace-icon-picker" data-surface-role="popover" role="dialog"
      :aria-label="label" :style="{
        left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px`,
      }" @keydown="keydown" @paste="pasteImage"
    >
      <header class="workspace-icon-picker-header">
        <div class="workspace-icon-picker-tabs" role="tablist" :aria-label="t('图标类型')">
          <button
            v-for="item in visibleTabs" :id="`${pickerId}-${item.id}-tab`" :key="item.id" type="button"
            role="tab" :data-tab="item.id" :aria-selected="tab === item.id" :aria-controls="`${pickerId}-content`"
            :tabindex="tab === item.id ? 0 : -1" @click="changeTab(item.id)" @keydown="tabKeydown($event, item.id)"
          >{{ item.label }}</button>
        </div>
        <button type="button" class="workspace-icon-picker-remove" :disabled="disabled || !icon" @click="select('')">{{ t('移除') }}</button>
      </header>
      <div :id="`${pickerId}-content`" class="workspace-icon-picker-content" role="tabpanel" :aria-labelledby="`${pickerId}-${tab}-tab`">
        <template v-if="extraTab && tab === extraTab.id">
          <slot name="extra-tab" :select="select" :close="close" :disabled="disabled" :icon="icon" />
        </template>
        <template v-else-if="tab !== 'upload'">
          <label class="workspace-icon-picker-search"><Search :size="15" aria-hidden="true" /><input ref="searchInput" v-model="query" :aria-label="t('筛选图标')" :placeholder="t('筛选…')" /></label>
          <div ref="scrollArea" class="workspace-icon-picker-scroll" @scroll="syncCategory">
            <section v-for="group in filteredGroups" :id="`${pickerId}-${group.id}`" :key="group.id" class="workspace-icon-picker-group" :data-category="group.id" :aria-label="group.label">
              <h4>{{ group.label }}</h4>
              <div class="workspace-icon-picker-grid">
                <button
                  v-for="choice in group.icons" :key="choice.value" type="button" data-icon-choice
                  :data-icon-value="choice.value" :aria-label="t('使用图标：{0}', [choice.label])" :data-tooltip="choice.label"
                  :aria-pressed="icon === choice.value" :tabindex="activeIcon === choice.value ? 0 : -1"
                  :disabled="disabled" @click="select(choice.value)" @focus="focusedIcon = choice.value"
                ><WorkspaceIcon :icon="choice.value" :size="23" /></button>
              </div>
            </section>
            <p v-if="!filteredGroups.length" class="workspace-icon-picker-empty" role="status">{{ t('没有找到匹配的图标') }}</p>
          </div>
          <nav v-if="filteredGroups.length" class="workspace-icon-picker-categories" :aria-label="t('图标分类目录')">
            <button
              v-for="group in filteredGroups" :key="group.id" type="button" :aria-label="group.label" :data-tooltip="group.label"
              :aria-controls="`${pickerId}-${group.id}`" :aria-current="currentCategory === group.id ? 'location' : undefined"
              @click="scrollToCategory(group.id)"
            ><WorkspaceIcon :icon="group.symbol" :size="18" /></button>
          </nav>
        </template>
        <div v-else class="workspace-icon-picker-upload" tabindex="-1" @pointerdown="focusUpload">
          <div
            class="workspace-icon-picker-dropzone" :data-state="uploadError ? 'error' : dragging ? 'dragging' : undefined"
            :data-disabled="disabled || undefined"
            @dragenter="dragEnter" @dragover="dragOver" @dragleave="dragLeave" @drop="dropImage"
          >
            <Upload class="workspace-icon-picker-dropzone-symbol" :size="20" aria-hidden="true" />
            <button
              type="button" class="workspace-icon-picker-dropzone-button" :disabled="disabled"
              :aria-describedby="`${pickerId}-upload-hint`" @click="upload"
            >{{ dragging ? t('松开以上传图片') : t('点击选择图片，或拖拽到这里') }}</button>
            <p :id="`${pickerId}-upload-hint`" class="workspace-icon-picker-upload-hint" aria-live="polite">
              <template v-if="uploadError">{{ uploadError }}</template>
              <template v-else>{{ t('也可按') }} <kbd>Ctrl+V</kbd> {{ t('粘贴图片') }}</template>
            </p>
          </div>
          <template v-if="$slots['upload-actions']">
            <div class="workspace-icon-picker-upload-divider" aria-hidden="true"><span>{{ t('或') }}</span></div>
            <div class="workspace-icon-picker-upload-actions"><slot name="upload-actions" :close="close" /></div>
          </template>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style>
@layer components {
.settings-button.workspace-icon-preview { width: 48px; height: 48px; padding: 0; font-size: 28px; overflow: hidden; }
.workspace-icon-picker { position: fixed; z-index: 120; display: flex; flex-direction: column; overflow: hidden; border: 1px solid var(--line); border-radius: 10px; background: var(--paper); color: var(--text); box-shadow: 0 12px 40px #18212b26, 0 2px 8px #18212b0d; }
.workspace-icon-picker-header { display: flex; align-items: center; gap: 4px; flex: none; min-height: 42px; padding: 0 10px; border-bottom: 1px solid var(--line); }
.workspace-icon-picker-tabs { display: flex; align-self: stretch; gap: 16px; }
.workspace-icon-picker-tabs button { position: relative; padding: 0; color: var(--muted); font-size: 13px; white-space: nowrap; }
.workspace-icon-picker-tabs button[aria-selected='true'] { color: var(--text); }
.workspace-icon-picker-tabs button[aria-selected='true']::after { position: absolute; right: 0; bottom: 0; left: 0; height: 2px; background: var(--text); content: ''; }
.workspace-icon-picker-remove { margin-left: auto; padding: 4px 6px; color: var(--muted); font-size: 12px; }
.workspace-icon-picker-remove:disabled { opacity: .4; cursor: default; }
.workspace-icon-picker-content { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.workspace-icon-picker-search { display: flex; align-items: center; gap: 6px; flex: none; margin: 10px 10px 4px; padding: 5px 8px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--muted); }
.workspace-icon-picker-search:focus-within { outline: 2px solid var(--text); outline-offset: 1px; }
.workspace-icon-picker-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: 0; color: var(--text); background: transparent; font-size: 13px; }
.workspace-icon-picker-scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 12px 12px; }
.workspace-icon-picker-group h4 { margin: 12px 1px 8px; color: var(--muted); font-size: 11px; font-weight: 400; }
.workspace-icon-picker-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(34px, 1fr)); gap: 4px; }
.workspace-icon-picker-grid button { display: flex; align-items: center; justify-content: center; min-width: 0; width: 100%; aspect-ratio: 1; padding: 0; border-radius: 6px; font-size: 22px; }
.workspace-icon-picker-grid button .workspace-emoji-icon { font-size: 1em; }
.workspace-icon-picker-grid button:hover, .workspace-icon-picker-grid button[aria-pressed='true'] { background: var(--hover); }
.workspace-icon-picker-grid button[aria-pressed='true'] { box-shadow: inset 0 0 0 1px var(--control-border); }
.workspace-icon-picker-empty { padding: 28px 0; color: var(--muted); font-size: 13px; text-align: center; }
.workspace-icon-picker-categories { display: flex; justify-content: flex-start; gap: 4px; flex: none; padding: 8px 12px; border-top: 1px solid var(--line); }
.workspace-icon-picker-categories button { display: flex; align-items: center; justify-content: center; flex: 0 1 32px; min-width: 0; width: 32px; height: 32px; padding: 0; border-radius: 6px; font-size: 17px; color: var(--text); }
.workspace-icon-picker-categories button:hover, .workspace-icon-picker-categories button[aria-current='location'] { background: var(--hover); }
.workspace-icon-picker-upload { display: flex; flex-direction: column; min-height: 0; overflow-y: auto; padding: 12px; outline: 0; }
.workspace-icon-picker-dropzone { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px; min-height: 128px; padding: 20px 16px; border: 1px dashed var(--control-border); border-radius: 8px; color: var(--muted); text-align: center; transition: border-color 120ms, background-color 120ms, color 120ms; }
.workspace-icon-picker-dropzone:hover:not([data-disabled]), .workspace-icon-picker-dropzone[data-state='dragging'] { border-color: var(--text); background: var(--hover); color: var(--text); }
.workspace-icon-picker-dropzone[data-state='error'] { border-color: var(--danger); background: var(--danger-bg); }
.workspace-icon-picker-dropzone[data-disabled] { opacity: .5; }
.workspace-icon-picker-dropzone-symbol { flex: none; margin-bottom: 2px; }
.workspace-icon-picker-dropzone-button { padding: 0; border: 0; background: none; color: var(--text); font: inherit; font-size: 13px; line-height: 20px; cursor: pointer; }
/* Stretch the button over the whole zone so any click inside opens the file chooser. */
.workspace-icon-picker-dropzone-button::after { position: absolute; inset: 0; border-radius: inherit; content: ''; }
.workspace-icon-picker-dropzone-button:disabled { cursor: default; }
.workspace-icon-picker .workspace-icon-picker-dropzone-button:focus-visible { outline: 0; }
.workspace-icon-picker .workspace-icon-picker-dropzone-button:focus-visible::after { outline: 2px solid var(--text); outline-offset: 2px; }
.workspace-icon-picker-upload-hint { margin: 0; color: var(--muted); font-size: 12px; line-height: 18px; }
.workspace-icon-picker-dropzone[data-state='error'] .workspace-icon-picker-upload-hint { color: var(--danger); }
.workspace-icon-picker-upload-hint kbd { padding: 0 4px; border: 1px solid var(--line); border-radius: 4px; background: var(--paper); font-family: inherit; font-size: 11px; }
.workspace-icon-picker-upload-divider { display: flex; align-items: center; gap: 10px; margin: 12px 2px; color: var(--muted); font-size: 12px; }
.workspace-icon-picker-upload-divider::before, .workspace-icon-picker-upload-divider::after { flex: 1; height: 1px; background: var(--line); content: ''; }
.workspace-icon-picker-upload-actions { display: flex; flex-direction: column; gap: 2px; }
.workspace-icon-picker-remove:hover:not(:disabled) { color: var(--danger); }
.workspace-icon-picker button:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
}
</style>
