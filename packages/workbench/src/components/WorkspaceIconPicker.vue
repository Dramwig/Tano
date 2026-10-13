<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { Search, Upload } from 'lucide-vue-next';
import WorkspaceIcon from './WorkspaceIcon.vue';
import { filterWorkspaceIconGroups, workspaceBuiltinIconGroups, workspaceEmojiGroups } from '../workspace-icons';

const props = withDefaults(defineProps<{
  icon: string;
  mode: 'demo' | 'web' | 'local';
  disabled?: boolean;
  label?: string;
  triggerClass?: string;
  align?: 'start' | 'end';
}>(), { label: '工作区图标', align: 'end' });
const emit = defineEmits<{ select: [value: string]; upload: []; pasteImage: [file: File]; 'update:open': [value: boolean] }>();
const pickerId = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const searchInput = ref<HTMLInputElement>();
const scrollArea = ref<HTMLElement>();
const open = ref(false);
watch(open, value => emit('update:open', value), { flush: 'sync' });
const tabs = [
  { id: 'emoji', label: '表情符号' },
  { id: 'icons', label: '图标' },
  { id: 'upload', label: '上传' },
] as const;
type Tab = typeof tabs[number]['id'];
const tab = ref<Tab>('emoji');
const query = ref('');
const currentCategory = ref('');
const focusedIcon = ref('');
const position = ref({ left: 8, top: 8, width: 392, maxHeight: 440 });
const groups = computed(() => tab.value === 'icons' ? workspaceBuiltinIconGroups : workspaceEmojiGroups);
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
  const rect = trigger.value.getBoundingClientRect();
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
}
async function toggle() {
  if (props.disabled) return;
  if (open.value) { close(); return; }
  tab.value = props.icon.startsWith('icon:') ? 'icons' : 'emoji';
  query.value = ''; focusedIcon.value = '';
  place();
  open.value = true;
  await nextTick();
  place();
  resetScroll();
  searchInput.value?.focus({ preventScroll: true });
}
function close(restoreFocus = false) {
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
  emit('upload');
}
function pasteImage(event: ClipboardEvent) {
  if (!open.value || tab.value !== 'upload' || props.disabled || !event.clipboardData) return;
  const items = [...event.clipboardData.items];
  const file = items.find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    ?? [...event.clipboardData.files].find(file => file.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault();
  event.stopPropagation();
  emit('pasteImage', file);
  close(true);
}
function focusUpload(event: PointerEvent) {
  (event.currentTarget as HTMLElement).focus({ preventScroll: true });
}
function changeTab(value: Tab) {
  tab.value = value;
  query.value = ''; focusedIcon.value = '';
  void nextTick().then(place);
}
function tabKeydown(event: KeyboardEvent, current: Tab) {
  let index = tabs.findIndex(item => item.id === current);
  if (event.key === 'ArrowRight') index = (index + 1) % tabs.length;
  else if (event.key === 'ArrowLeft') index = (index + tabs.length - 1) % tabs.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = tabs.length - 1;
  else return;
  event.preventDefault();
  const value = tabs[index]!.id;
  changeTab(value);
  panel.value?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)?.focus();
}
function gridKeydown(event: KeyboardEvent) {
  if (!(event.target instanceof HTMLButtonElement) || !event.target.hasAttribute('data-icon-choice')) return;
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
  if (!(event.target instanceof Node) || trigger.value?.contains(event.target) || panel.value?.contains(event.target)) return;
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
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside, true);
  window.removeEventListener('scroll', outside, true);
  window.removeEventListener('resize', dismiss);
});
</script>

<template>
  <button
    ref="trigger" type="button" class="settings-button workspace-icon-preview" :class="triggerClass"
    :aria-label="`选择${label}`" :title="`选择${label}`" aria-haspopup="dialog" :aria-expanded="open"
    :aria-controls="pickerId" :disabled="disabled" @click="toggle"
  ><slot name="preview"><WorkspaceIcon :icon="icon" :mode="mode" :size="28" /></slot></button>
  <Teleport to="body">
    <section
      v-if="open" :id="pickerId" ref="panel" class="workspace-icon-picker" role="dialog"
      :aria-label="label" :style="{
        left: `${position.left}px`, top: `${position.top}px`, width: `${position.width}px`, maxHeight: `${position.maxHeight}px`,
      }" @keydown="keydown" @paste="pasteImage"
    >
      <header class="workspace-icon-picker-header">
        <div class="workspace-icon-picker-tabs" role="tablist" aria-label="图标类型">
          <button
            v-for="item in tabs" :id="`${pickerId}-${item.id}-tab`" :key="item.id" type="button"
            role="tab" :data-tab="item.id" :aria-selected="tab === item.id" :aria-controls="`${pickerId}-content`"
            :tabindex="tab === item.id ? 0 : -1" @click="changeTab(item.id)" @keydown="tabKeydown($event, item.id)"
          >{{ item.label }}</button>
        </div>
        <button type="button" class="workspace-icon-picker-remove" :disabled="disabled || !icon" @click="select('')">移除</button>
      </header>
      <div :id="`${pickerId}-content`" class="workspace-icon-picker-content" role="tabpanel" :aria-labelledby="`${pickerId}-${tab}-tab`">
        <template v-if="tab !== 'upload'">
          <label class="workspace-icon-picker-search"><Search :size="15" aria-hidden="true" /><input ref="searchInput" v-model="query" aria-label="筛选图标" placeholder="筛选…" /></label>
          <div ref="scrollArea" class="workspace-icon-picker-scroll" @scroll="syncCategory">
            <section v-for="group in filteredGroups" :id="`${pickerId}-${group.id}`" :key="group.id" class="workspace-icon-picker-group" :data-category="group.id" :aria-label="group.label">
              <h4>{{ group.label }}</h4>
              <div class="workspace-icon-picker-grid">
                <button
                  v-for="choice in group.icons" :key="choice.value" type="button" data-icon-choice
                  :data-icon-value="choice.value" :aria-label="`使用图标：${choice.label}`" :title="choice.label"
                  :aria-pressed="icon === choice.value" :tabindex="activeIcon === choice.value ? 0 : -1"
                  :disabled="disabled" @click="select(choice.value)" @focus="focusedIcon = choice.value"
                ><WorkspaceIcon :icon="choice.value" :size="23" /></button>
              </div>
            </section>
            <p v-if="!filteredGroups.length" class="workspace-icon-picker-empty" role="status">没有找到匹配的图标</p>
          </div>
          <nav v-if="filteredGroups.length" class="workspace-icon-picker-categories" aria-label="图标分类目录">
            <button
              v-for="group in filteredGroups" :key="group.id" type="button" :aria-label="group.label" :title="group.label"
              :aria-controls="`${pickerId}-${group.id}`" :aria-current="currentCategory === group.id ? 'location' : undefined"
              @click="scrollToCategory(group.id)"
            ><WorkspaceIcon :icon="group.symbol" :size="18" /></button>
          </nav>
        </template>
        <div v-else class="workspace-icon-picker-upload" tabindex="-1" @pointerdown="focusUpload">
          <div class="workspace-icon-picker-upload-symbol" aria-hidden="true"><Upload :size="24" /></div>
          <p class="workspace-icon-picker-upload-title">上传{{ label }}</p>
          <div class="workspace-icon-picker-upload-actions">
            <button type="button" class="settings-button" :disabled="disabled" @click="upload">选择图片</button>
            <p class="workspace-icon-picker-upload-paste">或按 <kbd>Ctrl+V</kbd> 粘贴图片</p>
          </div>
        </div>
      </div>
    </section>
  </Teleport>
</template>

<style>
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
.workspace-icon-picker-upload { display: flex; flex-direction: column; align-items: center; min-height: 0; overflow-y: auto; padding: 24px 20px 22px; text-align: center; }
.workspace-icon-picker-upload-symbol { display: grid; place-items: center; flex: none; width: 44px; height: 44px; border-radius: 12px; color: var(--muted); background: var(--surface); }
.workspace-icon-picker-upload-title { margin: 12px 0 0; font-size: 14px; font-weight: 500; line-height: 20px; }
.workspace-icon-picker-upload-actions { display: flex; flex-direction: column; align-items: center; gap: 8px; margin-top: 16px; }
.workspace-icon-picker-upload-actions .settings-button { min-width: 112px; min-height: 34px; padding: 6px 11px; justify-content: center; border-color: var(--green-fill); color: #fff; background: var(--green-fill); }
.workspace-icon-picker-upload-actions .settings-button:hover:not(:disabled) { border-color: var(--green-fill-hover); background: var(--green-fill-hover); }
.workspace-icon-picker-upload-paste { margin: 0; color: var(--muted); font-size: 12px; line-height: 20px; }
.workspace-icon-picker-upload-paste kbd { font-family: inherit; font-size: inherit; }
.workspace-icon-picker button:focus-visible { outline: 2px solid var(--text); outline-offset: -2px; }
</style>
