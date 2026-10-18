<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ImagePlus, Link, MessageSquare, Smile, Upload } from 'lucide-vue-next';
import { safeRemoteImage } from '@tano/protocol';
import WorkspaceIconPicker from './WorkspaceIconPicker.vue';
import WorkspaceIcon from './WorkspaceIcon.vue';
import { iconImage } from '../icon-image';
import { appearanceProperty, appearanceText, embeddedCoverImage, updateAppearance } from '../document-appearance';
import { documentCoverGroups, documentCoverPreset } from '../document-cover-gallery';
import type { AppearanceProperty } from '../document-appearance';
import type { DocumentCover } from '../document-cover-gallery';

const props = withDefaults(defineProps<{
  modelValue: string;
  readonly: boolean;
  mode?: 'demo' | 'web' | 'local';
  resolveImage?: (reference: string) => string | null;
  uploadCover?: (file: File) => Promise<{ url: string }>;
  resourceRevision?: string | number;
}>(), { mode: 'local' });
const emit = defineEmits<{ 'update:modelValue': [value: string]; comment: [] }>();
const iconInput = ref<HTMLInputElement>();
const coverInput = ref<HTMLInputElement>();
const addCoverTrigger = ref<HTMLButtonElement>();
const changeCoverTrigger = ref<HTMLButtonElement>();
const coverPanel = ref<HTMLElement>();
const coverPanelId = useId();
const coverLinkInput = ref<HTMLInputElement>();
const coverTabs = [
  { id: 'gallery', get label() { return t('画廊'); } },
  { id: 'upload', get label() { return t('上传'); } },
  { id: 'link', get label() { return t('链接'); } },
] as const;
type CoverTab = typeof coverTabs[number]['id'];
const coverTab = ref<CoverTab>('gallery');
const coverLink = ref('');
const coverPosition = ref({ left: 8, top: 8, width: 560, maxHeight: 460 });
const iconOpen = ref(false);
const coverOpen = ref(false);
const busy = ref(false);
const error = ref('');
const imageFailed = ref(false);
const disabled = computed(() => props.readonly || busy.value);
const icon = computed(() => appearanceText(props.modelValue, 'icon'));
const cover = computed(() => appearanceText(props.modelValue, 'cover'));
const coverTrigger = computed(() => cover.value ? changeCoverTrigger.value : addCoverTrigger.value);
const coverPreset = computed(() => documentCoverPreset(cover.value));
const coverCaption = (preset: DocumentCover) => [preset.label, preset.artist, preset.date].filter(Boolean).join(' · ');
const coverUrl = computed(() => {
  void props.resourceRevision;
  if (coverPreset.value?.image) return coverPreset.value.image;
  if (!cover.value || coverPreset.value) return null;
  if (/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=]+$/i.test(cover.value)) return cover.value;
  return props.resolveImage ? props.resolveImage(cover.value) : safeRemoteImage(cover.value);
});
watch(coverUrl, () => { imageFailed.value = false; });
const bases: Partial<Record<AppearanceProperty, ReturnType<typeof appearanceProperty>>> = {};
let disposed = false;

function capture(key: AppearanceProperty) {
  error.value = '';
  try { bases[key] = appearanceProperty(props.modelValue, key); }
  catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
function save(key: AppearanceProperty, value: string, previous = bases[key]) {
  if (props.readonly || disposed) return false;
  try {
    if (previous === undefined) throw new Error(t('请重新打开选择器后重试'));
    emit('update:modelValue', updateAppearance(props.modelValue, key, value, previous));
    error.value = '';
    return true;
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
    return false;
  }
}
function iconOpened(open: boolean) {
  iconOpen.value = open;
  if (open) { closeCover(); capture('icon'); }
}
function placeCover() {
  if (!coverTrigger.value) return;
  const rect = coverTrigger.value.getBoundingClientRect();
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 8;
  const top = (viewport?.offsetTop ?? 0) + 8;
  const right = left + (viewport?.width ?? window.innerWidth) - 16;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
  const width = Math.max(0, Math.min(560, right - left));
  const maxHeight = Math.max(0, Math.min(460, bottom - top));
  const height = Math.min(coverPanel.value?.offsetHeight || maxHeight, maxHeight);
  coverPosition.value = {
    left: Math.max(left, Math.min(cover.value ? rect.right - width : rect.left, right - width)),
    top: rect.bottom + 8 + height <= bottom ? rect.bottom + 8
      : rect.top - height - 8 >= top ? rect.top - height - 8 : Math.max(top, bottom - height),
    width, maxHeight,
  };
}
async function toggleCover() {
  if (disabled.value) return;
  if (coverOpen.value) { closeCover(true); return; }
  capture('cover');
  coverTab.value = 'gallery';
  coverLink.value = safeRemoteImage(cover.value) ?? '';
  placeCover();
  coverOpen.value = true;
  await nextTick();
  placeCover();
  coverPanel.value?.querySelector<HTMLButtonElement>('[role="tab"]')?.focus({ preventScroll: true });
}
function closeCover(focus = false) {
  coverOpen.value = false;
  if (focus) void nextTick(() => coverTrigger.value?.focus({ preventScroll: true }));
}
function selectCover(value: string) {
  if (disabled.value) return;
  if (save('cover', value)) closeCover(true);
}
async function changeCoverTab(value: CoverTab, focusInput = true) {
  coverTab.value = value;
  error.value = '';
  await nextTick();
  placeCover();
  if (value === 'link' && focusInput) coverLinkInput.value?.focus({ preventScroll: true });
}
function coverTabKeydown(event: KeyboardEvent, current: CoverTab) {
  let index = coverTabs.findIndex(item => item.id === current);
  if (event.key === 'ArrowRight') index = (index + 1) % coverTabs.length;
  else if (event.key === 'ArrowLeft') index = (index + coverTabs.length - 1) % coverTabs.length;
  else if (event.key === 'Home') index = 0;
  else if (event.key === 'End') index = coverTabs.length - 1;
  else return;
  event.preventDefault();
  const value = coverTabs[index]!.id;
  void changeCoverTab(value, false);
  coverPanel.value?.querySelector<HTMLButtonElement>(`[data-tab="${value}"]`)?.focus();
}
function submitCoverLink() {
  if (disabled.value) return;
  const url = safeRemoteImage(coverLink.value.trim());
  if (!url) { error.value = t('请输入有效的 HTTPS 图片链接'); return; }
  selectCover(url);
}
function pasteCover(event: ClipboardEvent) {
  if (coverTab.value !== 'upload' || disabled.value || !event.clipboardData) return;
  const file = [...event.clipboardData.items].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile()
    ?? [...event.clipboardData.files].find(item => item.type.startsWith('image/'));
  if (!file) return;
  event.preventDefault(); event.stopPropagation();
  void uploadImage('cover', file);
}
async function uploadImage(key: AppearanceProperty, file: File) {
  if (disabled.value) return;
  const previous = bases[key];
  busy.value = true;
  error.value = '';
  try {
    if (key === 'cover' && (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 10 * 1024 * 1024))
      throw new Error(t('请选择不超过 10 MB 的 PNG、JPEG、WebP 或 GIF 图片。'));
    const value = key === 'icon' ? await iconImage(file)
      : props.uploadCover ? (await props.uploadCover(file)).url : await embeddedCoverImage(file);
    if (save(key, value, previous) && key === 'cover') {
      busy.value = false;
      await nextTick();
      closeCover(true);
    }
  } catch (cause) {
    if (!disposed) error.value = cause instanceof Error ? cause.message : String(cause);
  } finally { busy.value = false; }
}
function fileChanged(key: AppearanceProperty, event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) void uploadImage(key, file);
}
function outside(event: Event) {
  if (!(event.target instanceof Node) || coverTrigger.value?.contains(event.target) || coverPanel.value?.contains(event.target)) return;
  closeCover();
}
function coverKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault(); event.stopPropagation(); closeCover(true);
  } else if (event.key === 'Tab') {
    const buttons = [...(coverPanel.value?.querySelectorAll<HTMLElement>('button:not(:disabled):not([tabindex="-1"]), input:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLElement);
    if ((event.shiftKey && index === 0) || (!event.shiftKey && index === buttons.length - 1)) {
      event.preventDefault(); closeCover(true);
    }
  }
}
watch(() => props.readonly, value => { if (value) closeCover(); });
watch(error, () => { if (coverOpen.value) void nextTick().then(placeCover); });
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside, true);
  window.addEventListener('scroll', outside, true);
  window.addEventListener('resize', placeCover);
  window.visualViewport?.addEventListener('resize', placeCover);
});
onBeforeUnmount(() => {
  disposed = true;
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside, true);
  window.removeEventListener('scroll', outside, true);
  window.removeEventListener('resize', placeCover);
  window.visualViewport?.removeEventListener('resize', placeCover);
});
</script>

<template>
  <div class="document-appearance" :class="{ 'is-open': iconOpen || coverOpen || busy, 'has-cover': !!cover, 'has-icon': !!icon }">
    <div v-if="cover" class="document-cover" :class="{ 'is-specimen': coverPreset?.presentation === 'specimen' }" :style="coverPreset ? { background: coverPreset.background } : undefined">
      <img v-if="coverUrl && !imageFailed" :src="coverUrl" :alt="t('文档封面')" :title="coverPreset ? coverCaption(coverPreset) : undefined" :style="{ objectPosition: coverPreset?.objectPosition }" @error="imageFailed = true" />
      <span v-else-if="!coverPreset || coverPreset.image" class="document-cover-unavailable">{{ t('封面图片无法显示') }}</span>
    </div>
    <button v-if="!readonly && cover" ref="changeCoverTrigger" type="button" class="document-title-action document-cover-trigger" :disabled="disabled" aria-haspopup="dialog"
      :aria-expanded="coverOpen" :aria-controls="coverPanelId" @click="toggleCover">
      <ImagePlus :size="15" aria-hidden="true" /><span>{{ t('更换封面') }}</span>
    </button>
    <div class="document-appearance-content">
    <div v-if="icon" class="document-page-icon">
      <WorkspaceIconPicker v-if="!readonly" :icon="icon" :mode="mode" :label="t('文档图标')" align="start" trigger-class="document-icon-trigger"
        :disabled="disabled" @update:open="iconOpened" @select="save('icon', $event)" @upload="iconInput?.click()" @paste-image="uploadImage('icon', $event)">
        <template #preview><WorkspaceIcon :icon="icon" :size="56" /></template>
      </WorkspaceIconPicker>
      <WorkspaceIcon v-else :icon="icon" :size="56" />
    </div>
    <div v-if="!readonly" class="document-title-actions" role="group" :aria-label="t('文档外观与评论')">
      <WorkspaceIconPicker v-if="!icon" :icon="icon" :mode="mode" :label="t('文档图标')" align="start" trigger-class="document-title-action"
        :disabled="disabled" @update:open="iconOpened" @select="save('icon', $event)" @upload="iconInput?.click()" @paste-image="uploadImage('icon', $event)">
        <template #preview><Smile :size="15" aria-hidden="true" /><span>{{ t('添加图标') }}</span></template>
      </WorkspaceIconPicker>
      <button v-if="!cover" ref="addCoverTrigger" type="button" class="document-title-action" :disabled="disabled" aria-haspopup="dialog"
        :aria-expanded="coverOpen" :aria-controls="coverPanelId" @click="toggleCover">
        <ImagePlus :size="15" aria-hidden="true" /><span>{{ t('添加封面') }}</span>
      </button>
      <button type="button" class="document-title-action" @click="emit('comment')"><MessageSquare :size="15" aria-hidden="true" /><span>{{ t('添加评论') }}</span></button>
    </div>
    <div v-else class="document-title-actions document-title-actions-placeholder" aria-hidden="true"></div>
    <input ref="iconInput" hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" :aria-label="t('上传文档图标')" :disabled="disabled" @change="fileChanged('icon', $event)" />
    <input ref="coverInput" hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" :aria-label="t('上传文档封面')" :disabled="disabled" @change="fileChanged('cover', $event)" />
    <p v-if="error && !coverOpen" class="document-appearance-error" role="alert">{{ error }}</p>
    </div>
    <Teleport to="body">
      <section v-if="coverOpen" :id="coverPanelId" ref="coverPanel" class="workspace-icon-picker document-cover-picker" role="dialog" :aria-label="t('文档封面')"
        :style="{ left: `${coverPosition.left}px`, top: `${coverPosition.top}px`, width: `${coverPosition.width}px`, maxHeight: `${coverPosition.maxHeight}px` }"
        :aria-busy="busy" @keydown="coverKeydown" @paste="pasteCover">
        <header class="workspace-icon-picker-header">
          <div class="workspace-icon-picker-tabs" role="tablist" :aria-label="t('封面来源')">
            <button v-for="item in coverTabs" :id="`${coverPanelId}-${item.id}-tab`" :key="item.id" type="button" role="tab" :data-tab="item.id"
              :aria-selected="coverTab === item.id" :aria-controls="`${coverPanelId}-content`" :tabindex="coverTab === item.id ? 0 : -1"
              @click="changeCoverTab(item.id)" @keydown="coverTabKeydown($event, item.id)">{{ item.label }}</button>
          </div>
          <button type="button" class="workspace-icon-picker-remove" :aria-label="t('移除封面')" :disabled="disabled || !cover" @click="selectCover('')">{{ t('移除') }}</button>
        </header>
        <div :id="`${coverPanelId}-content`" class="document-cover-picker-content" role="tabpanel" :aria-labelledby="`${coverPanelId}-${coverTab}-tab`">
          <div v-if="coverTab === 'gallery'" class="document-cover-gallery">
            <section v-for="group in documentCoverGroups" :key="group.id" class="document-cover-group" :aria-labelledby="`${coverPanelId}-${group.id}-heading`">
              <h4 :id="`${coverPanelId}-${group.id}-heading`">{{ group.label }}</h4>
              <div class="document-cover-presets" :class="{ 'document-cover-colors': group.id === 'colors' }">
                <button v-for="item in group.covers" :key="item.value" type="button" :aria-label="t('使用封面：{0}', [item.label])" :title="coverCaption(item)"
                  :class="{ 'is-specimen': item.presentation === 'specimen' }"
                  :aria-pressed="cover === item.value" :disabled="disabled" :style="{ background: item.background }" @click="selectCover(item.value)">
                  <img v-if="item.thumbnail" :src="item.thumbnail" :style="{ objectPosition: item.objectPosition }" alt="" loading="lazy" decoding="async" draggable="false" />
                </button>
              </div>
            </section>
          </div>
          <div v-else-if="coverTab === 'upload'" class="workspace-icon-picker-upload document-cover-upload" tabindex="-1"
            @pointerdown="($event.currentTarget as HTMLElement).focus({ preventScroll: true })">
            <div class="workspace-icon-picker-upload-symbol" aria-hidden="true"><Upload :size="24" /></div>
            <p class="workspace-icon-picker-upload-title">{{ t('上传封面图片') }}</p>
            <div class="workspace-icon-picker-upload-actions">
              <button type="button" class="settings-button" :disabled="disabled" @click="coverInput?.click()">{{ busy ? t('正在上传…') : t('选择图片') }}</button>
              <p class="workspace-icon-picker-upload-paste">{{ t('或按') }} <kbd>Ctrl+V</kbd> {{ t('粘贴图片') }}</p>
            </div>
            <p class="document-cover-hint">{{ t('支持 PNG、JPEG、WebP、GIF，最大 10 MB') }}</p>
          </div>
          <form v-else class="document-cover-link" @submit.prevent="submitCoverLink">
            <label :for="`${coverPanelId}-url`">{{ t('图片链接') }}</label>
            <div class="document-cover-link-field"><Link :size="16" aria-hidden="true" /><input :id="`${coverPanelId}-url`" ref="coverLinkInput" v-model="coverLink"
              type="text" inputmode="url" :placeholder="t('粘贴 HTTPS 图片链接…')" autocomplete="off" :disabled="disabled" :aria-invalid="!!error"
              :aria-describedby="error ? `${coverPanelId}-error` : undefined" @input="error = ''" /></div>
            <button type="submit" class="settings-button" :disabled="disabled || !coverLink.trim()">{{ t('应用封面') }}</button>
            <p class="document-cover-hint">{{ t('使用可公开访问的 HTTPS 图片链接') }}</p>
          </form>
          <p v-if="error" :id="`${coverPanelId}-error`" class="document-appearance-error" role="alert">{{ error }}</p>
        </div>
      </section>
    </Teleport>
  </div>
</template>

<style>
.document-appearance { position: relative; }
.document-title-actions { position: relative; display: flex; flex-wrap: wrap; align-items: center; gap: 2px; min-height: 30px; margin: 0 -6px 6px; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.document-title-actions-placeholder { visibility: hidden; }
.document-title:has(.document-title-content:hover, .document-appearance-content:hover) .document-title-actions,
.document-title:has(.document-title-actions :focus-visible, .document-page-icon :focus-visible) .document-title-actions,
.document-appearance.is-open .document-title-actions { opacity: 1; pointer-events: auto; }
.document-title-action, .settings-button.workspace-icon-preview.document-title-action { display: inline-flex; align-items: center; justify-content: center; gap: 5px; width: auto; height: 28px; min-height: 28px; padding: 4px 6px; border: 0; border-radius: 5px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 400; line-height: 20px; white-space: nowrap; }
.document-title-action:hover:not(:disabled), .settings-button.workspace-icon-preview.document-title-action:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.document-title-action:disabled { opacity: .45; cursor: default; }
.document-title-action:focus-visible, .document-cover-picker button:focus-visible { outline: 2px solid var(--text); outline-offset: 2px; }
.document-cover { position: relative; display: flex; align-items: center; justify-content: center; width: calc(100% + var(--document-inset-start, 0px) + var(--document-inset-end, 0px)); aspect-ratio: 5 / 1; min-height: 160px; max-height: 320px; margin-inline-start: calc(-1 * var(--document-inset-start, 0px)); overflow: hidden; background: var(--surface); }
.document-cover img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; object-position: center; }
.document-cover-unavailable { color: var(--muted); font-size: 13px; }
.document-appearance.has-cover .document-appearance-content { padding-top: 24px; }
.document-appearance.has-cover.has-icon .document-page-icon { position: relative; margin-top: -56px; margin-bottom: 22px; }
.document-appearance.has-cover .document-appearance-content:not(:has(.document-title-actions)) { padding-bottom: 36px; }
.document-page-icon { display: flex; align-items: center; width: 64px; height: 64px; margin-bottom: 10px; border-radius: 8px; }
.settings-button.workspace-icon-preview.document-icon-trigger { width: 64px; height: 64px; padding: 4px; border: 0; border-radius: 8px; background: transparent; box-shadow: none; }
.document-title-action.document-cover-trigger { position: absolute; z-index: 1; top: 12px; right: calc(16px - var(--document-inset-end, 0px)); padding-inline: 10px; border: 1px solid var(--line); background: var(--paper); color: var(--text); box-shadow: 0 1px 3px #18212b0a; opacity: 0; pointer-events: none; transition: opacity 120ms ease; }
.document-cover:hover + .document-cover-trigger,
.document-cover-trigger:hover,
.document-cover-trigger:focus-visible,
.document-cover-trigger[aria-expanded='true'] { opacity: 1; pointer-events: auto; }
.document-cover-picker .workspace-icon-picker-header { padding-inline: 16px; min-height: 44px; }
.document-cover-picker-content { min-height: 0; overflow-y: auto; overscroll-behavior: contain; }
.document-cover-gallery { padding: 14px 16px 18px; }
.document-cover-group + .document-cover-group { margin-top: 22px; }
.document-cover-gallery h4 { margin: 0 0 12px; color: var(--muted); font-size: 12px; font-weight: 400; }
.document-cover-presets { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 7px; }
.document-cover-presets button { position: relative; min-width: 0; aspect-ratio: 5 / 1; padding: 0; border: 0; border-radius: 5px; background: var(--surface); transition: box-shadow 120ms ease; }
.document-cover-presets button img { position: absolute; inset: 0; display: block; width: 100%; height: 100%; object-fit: cover; border-radius: inherit; }
.document-cover.is-specimen img, .document-cover-presets button.is-specimen img { inset: 5%; width: 90%; height: 90%; object-fit: contain; }
.document-cover-presets button::after { content: ''; position: absolute; inset: 0; border-radius: inherit; pointer-events: none; }
.document-cover-presets button:hover::after { box-shadow: inset 0 0 0 2px #ffffff99; }
.document-cover-presets button[aria-pressed='true'] { outline: 2px solid var(--text); outline-offset: 2px; }
.document-cover-colors { grid-template-columns: repeat(8, minmax(0, 1fr)); }
.document-cover-colors button { aspect-ratio: 1.5; }
.document-cover-upload { padding-block: 28px 22px; }
.document-cover-hint { margin: 14px 0 0; color: var(--muted); font-size: 12px; line-height: 1.6; text-align: center; }
.document-cover-link { display: flex; flex-direction: column; align-items: stretch; padding: 22px 20px; }
.document-cover-link label { margin-bottom: 8px; font-size: 13px; }
.document-cover-link-field { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--control-border); border-radius: 6px; color: var(--muted); }
.document-cover-link-field:focus-within { outline: 2px solid var(--text); outline-offset: 1px; }
.document-cover-link-field input { min-width: 0; width: 100%; padding: 0; border: 0; outline: none; background: transparent; color: var(--text); font: inherit; font-size: 13px; }
.document-cover-link > .settings-button { align-self: center; justify-content: center; min-width: 112px; margin-top: 16px; color: #fff; border-color: var(--green-fill); background: var(--green-fill); }
.document-cover-link > .settings-button:hover:not(:disabled) { border-color: var(--green-fill-hover); background: var(--green-fill-hover); }
.document-cover-picker .document-appearance-error { margin: 0; padding: 0 16px 14px; }
.document-appearance-error { margin: 6px 0; color: #c43e47; font-size: 12px; line-height: 1.5; }
@media (max-width: 420px) {
  .document-cover-presets button { aspect-ratio: 2.5 / 1; }
  .document-cover-colors { grid-template-columns: repeat(8, minmax(0, 1fr)); }
  .document-cover-colors button { aspect-ratio: 1; }
}
@media (hover: none) { .document-title-actions, .document-title-action.document-cover-trigger { opacity: 1; pointer-events: auto; } }
@media (prefers-reduced-motion: reduce) { .document-title-actions, .document-cover-trigger { transition: none; } }
</style>
