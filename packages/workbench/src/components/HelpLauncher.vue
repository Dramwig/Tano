<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { ArrowUpRight, BookOpen, ChevronRight, CircleHelp, Compass, Keyboard, MoreHorizontal, X } from 'lucide-vue-next';
import { helpDocumentationUrl } from '../help-content';
import type { HelpAvailability, HelpContext, HelpTopicId } from '../help-content';
import { useHelpGuidance } from '../help-guidance';
import { useHelpChecklist } from '../help-checklist';
import HelpChecklistTimeline from './HelpChecklistTimeline.vue';

const props = defineProps<{
  context: HelpContext;
  availability?: HelpAvailability;
  available: boolean;
  blocked: boolean;
  scope?: string;
  documentationBaseUrl?: string;
  native?: boolean;
}>();
const emit = defineEmits<{ open: []; settings: [page: 'shortcuts' | 'about']; documentation: [url: string] }>();
const id = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const bubble = ref<HTMLElement>();
const opened = ref(false);
const preview = ref(false);
const previewPanel = ref<HTMLElement>();
const previewHovered = ref(false);
const previewFocused = ref(false);
const hovered = ref(false);
const bubbleHovered = ref(false);
const bubbleFocused = ref(false);
const more = ref(false);
const moreTrigger = ref<HTMLButtonElement>();
const morePanel = ref<HTMLElement>();
const moreOnLeft = ref(false);
const morePosition = ref({ left: '12px', top: '12px', maxHeight: '480px' });
const position = ref({ left: '12px', bottom: '56px', maxHeight: '480px', '--help-tail': '24px' });
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let previewLeaveTimer: ReturnType<typeof setTimeout> | undefined;
const { completed } = useHelpChecklist();
const docsUrl = (topic?: HelpTopicId) => helpDocumentationUrl(props.documentationBaseUrl, topic);
const { hint, dismiss, setEnabled, readTopic } = useHelpGuidance({
  context: () => props.context,
  scope: () => props.scope,
  available: () => props.available,
  blocked: () => props.blocked || opened.value || preview.value,
  interacting: () => hovered.value || previewHovered.value || previewFocused.value || bubbleHovered.value || bubbleFocused.value,
});

function place() {
  const rect = trigger.value?.getBoundingClientRect();
  if (!rect) return;
  const width = Math.min(opened.value ? 248 : preview.value ? 236 : 268, window.innerWidth - 24);
  const anchorLeft = opened.value || preview.value ? rect.left : rect.right - width;
  const left = Math.max(12, Math.min(anchorLeft, window.innerWidth - width - 12));
  position.value = {
    left: `${left}px`, bottom: `${Math.max(12, window.innerHeight - rect.top + 10)}px`,
    maxHeight: `${Math.max(80, rect.top - 22)}px`,
    '--help-tail': `${Math.max(18, Math.min(width - 18, rect.left + rect.width / 2 - left))}px`,
  };
  if (more.value) void nextTick(placeMore);
}
function placeMore() {
  const parent = panel.value?.getBoundingClientRect();
  const row = moreTrigger.value?.getBoundingClientRect();
  if (!more.value || !parent || !row) return;
  const width = Math.min(176, window.innerWidth - 24);
  const height = morePanel.value?.getBoundingClientRect().height || 39;
  const right = parent.right + 4;
  const left = parent.left - width - 4;
  moreOnLeft.value = right + width > window.innerWidth - 12 && left >= 12;
  morePosition.value = {
    left: `${Math.max(12, Math.min(moreOnLeft.value ? left : right, window.innerWidth - width - 12))}px`,
    top: `${Math.max(12, Math.min(row.top - 5, window.innerHeight - height - 12))}px`,
    maxHeight: `${Math.max(80, window.innerHeight - 24)}px`,
  };
}
async function openMore() {
  more.value = true;
  await nextTick();
  if (!more.value || !opened.value) return;
  placeMore();
  morePanel.value?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
}
function closeMore(restoreFocus = false) {
  more.value = false;
  if (restoreFocus) moreTrigger.value?.focus({ preventScroll: true });
}
function hidePreview() {
  clearTimeout(previewTimer);
  clearTimeout(previewLeaveTimer);
  preview.value = previewHovered.value = previewFocused.value = false;
}
function keepPreview() { clearTimeout(previewLeaveTimer); }
function showPreview() {
  keepPreview();
  clearTimeout(previewTimer);
  if (opened.value || preview.value || !props.available || props.blocked) return;
  previewTimer = setTimeout(() => {
    if (opened.value || !props.available || props.blocked) return;
    dismiss();
    preview.value = true;
    place();
  }, 500);
}
function leavePreview() {
  clearTimeout(previewTimer);
  keepPreview();
  // Allow the pointer to cross the small gap between the trigger and the card.
  previewLeaveTimer = setTimeout(() => {
    if (!hovered.value && !previewHovered.value && !previewFocused.value) hidePreview();
  }, 250);
}
function previewFocusOut(event: FocusEvent) {
  previewFocused.value = event.relatedTarget instanceof Node && !!previewPanel.value?.contains(event.relatedTarget);
  leavePreview();
}
function triggerTab(event: KeyboardEvent) {
  if (!event.shiftKey && preview.value) {
    event.preventDefault();
    previewPanel.value?.querySelector<HTMLElement>('button, a')?.focus({ preventScroll: true });
  }
}
async function focusPanel() {
  await nextTick();
  if (opened.value) panel.value?.querySelector<HTMLElement>('a[href], button')?.focus({ preventScroll: true });
}
function openHelp() {
  hidePreview();
  dismiss();
  more.value = false;
  opened.value = true;
  place();
  emit('open');
  void focusPanel();
}
function close(restoreFocus = false) {
  closeMore();
  opened.value = false;
  hidePreview();
  if (restoreFocus) { trigger.value?.focus({ preventScroll: true }); hidePreview(); }
}
function followDocumentation(event: MouseEvent, topic?: HelpTopicId) {
  if (props.native) {
    event.preventDefault();
    emit('documentation', docsUrl(topic));
  }
  if (topic) readTopic(topic);
  close();
}
function settings(page: 'shortcuts' | 'about') { close(); emit('settings', page); }
function inside(target: EventTarget | null) {
  return target instanceof Node && (trigger.value?.contains(target) || panel.value?.contains(target) ||
    morePanel.value?.contains(target) || bubble.value?.contains(target) || previewPanel.value?.contains(target));
}
function outside(event: Event) {
  if (!inside(event.target)) close();
  else if (event.target instanceof Node && !morePanel.value?.contains(event.target) &&
    !moreTrigger.value?.contains(event.target)) closeMore();
}
function onKeydown(event: KeyboardEvent) {
  if (event.key !== 'Escape' || (!opened.value && !hint.value && !preview.value)) return;
  if (opened.value) {
    event.preventDefault();
    event.stopImmediatePropagation();
    if (more.value) closeMore(true);
    else close(true);
  }
  else if (preview.value) {
    if (previewPanel.value?.contains(document.activeElement)) {
      event.preventDefault();
      event.stopImmediatePropagation();
      close(true);
    } else hidePreview();
  }
  else dismiss(true);
}
function menuKeys(event: KeyboardEvent) {
  if (event.key === 'ArrowRight' && event.target === moreTrigger.value) {
    event.preventDefault();
    void openMore();
    return;
  }
  navigateMenu(event, panel.value);
}
function moreKeys(event: KeyboardEvent) {
  if (event.key === 'ArrowLeft') {
    event.preventDefault();
    closeMore(true);
    return;
  }
  navigateMenu(event, morePanel.value);
}
function navigateMenu(event: KeyboardEvent, menu?: HTMLElement) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const buttons = [...(menu?.querySelectorAll<HTMLElement>('a[href], button') ?? [])];
  if (!buttons.length) return;
  event.preventDefault();
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 :
    (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
  buttons[next]?.focus();
}
watch(hint, value => {
  if (value) hidePreview();
  bubbleHovered.value = bubbleFocused.value = false;
  place();
});
watch(() => [props.available, props.scope], () => { close(); dismiss(); });
watch(() => props.blocked, (blocked) => { if (blocked) { dismiss(); hidePreview(); } });
function windowBlur() { close(); dismiss(); }
function visibility() { if (document.hidden) windowBlur(); }
onMounted(() => {
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('focusin', outside);
  window.addEventListener('keydown', onKeydown, true);
  window.addEventListener('resize', place);
  window.addEventListener('blur', windowBlur);
  document.addEventListener('visibilitychange', visibility);
});
onBeforeUnmount(() => {
  clearTimeout(previewTimer);
  clearTimeout(previewLeaveTimer);
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('focusin', outside);
  window.removeEventListener('keydown', onKeydown, true);
  window.removeEventListener('resize', place);
  window.removeEventListener('blur', windowBlur);
  document.removeEventListener('visibilitychange', visibility);
});
</script>

<template>
  <button
    ref="trigger" type="button" class="icon-button sidebar-help" data-help-surface
    :aria-label="t('帮助与上手')" aria-haspopup="dialog" :aria-expanded="opened || preview"
    :aria-controls="opened ? `${id}-panel` : preview ? `${id}-preview` : undefined"
    :aria-describedby="preview ? `${id}-preview-title` : undefined"
    @click="opened ? close(true) : openHelp()"
    @pointerenter="hovered = true; showPreview()"
    @pointerleave="hovered = false; leavePreview()"
    @focus="showPreview" @blur="leavePreview" @keydown.tab="triggerTab"
    @keydown.down.prevent="openHelp()"
  ><CircleHelp :size="17" :stroke-width="1.6" /></button>

  <Teleport to="body">
    <section v-if="preview && !opened && available" :id="`${id}-preview`" ref="previewPanel" data-help-surface
      role="region" :aria-label="t('上手指引')" class="help-preview" :style="position"
      @pointerenter="previewHovered = true; keepPreview()" @pointerleave="previewHovered = false; leavePreview()"
      @focusin="previewFocused = true; keepPreview()" @focusout="previewFocusOut">
      <HelpChecklistTimeline :heading-id="`${id}-preview-title`" :completed="completed" :context="context" :availability="availability" :documentation-base-url="documentationBaseUrl"
        @documentation="followDocumentation" />
    </section>

    <section v-if="opened && available" :id="`${id}-panel`" ref="panel" data-help-surface
      class="help-popover" :style="position" role="dialog" aria-modal="false" :aria-label="t('帮助与上手')"
      @keydown="menuKeys" @scroll="closeMore()">
        <div class="help-menu-heading">{{ t('帮助与上手') }}</div>
        <div class="help-main-links">
          <a class="help-row" :href="docsUrl('welcome')" target="_blank" rel="noopener noreferrer" @click="followDocumentation($event, 'welcome')"><Compass :size="15" /><span>{{ t('快速上手') }}</span><ArrowUpRight :size="12" /></a>
          <a class="help-row" :href="docsUrl()" target="_blank" rel="noopener noreferrer" @click="followDocumentation($event)"><BookOpen :size="15" /><span>{{ t('使用指南') }}</span><ArrowUpRight :size="12" /></a>
          <button ref="moreTrigger" class="help-row" aria-haspopup="menu" :aria-expanded="more"
            :aria-controls="more ? `${id}-more` : undefined" @click="more ? closeMore(true) : openMore()">
            <MoreHorizontal :size="15" /><span>{{ t('更多') }}</span><ChevronRight :size="12" :class="{ 'help-chevron-left': more && moreOnLeft }" />
          </button>
        </div>
        <HelpChecklistTimeline class="help-menu-checklist" :completed="completed" :context="context" :availability="availability" :documentation-base-url="documentationBaseUrl"
          @documentation="followDocumentation" />
    </section>

    <div v-if="opened && available && more" :id="`${id}-more`" ref="morePanel" data-help-surface
      class="help-submenu" :style="morePosition" role="menu" :aria-label="t('更多帮助选项')" @keydown="moreKeys">
      <button class="help-row" role="menuitem" @click="settings('shortcuts')"><Keyboard :size="15" /><span>{{ t('键盘快捷键') }}</span></button>
      <button class="help-row" role="menuitem" @click="settings('about')"><CircleHelp :size="15" /><span>{{ t('关于同页') }}</span></button>
    </div>

    <aside v-if="hint && available && !opened" ref="bubble" data-help-surface class="help-bubble" :style="position" :aria-label="t('使用小提示')"
      @pointerenter="bubbleHovered = true" @pointerleave="bubbleHovered = false"
      @focusin="bubbleFocused = true" @focusout="bubbleFocused = !!bubble?.contains($event.relatedTarget as Node)">
      <div class="help-bubble-heading"><span>{{ t('小提示') }}</span><button class="help-close" :aria-label="t('暂时不提示')" @click="dismiss(true)"><X :size="14" /></button></div>
      <p role="status">{{ hint.hint }}</p>
      <div class="help-bubble-actions">
        <a :href="docsUrl(hint.id)" target="_blank" rel="noopener noreferrer" @click="followDocumentation($event, hint.id)">{{ t('了解用法') }} <ArrowUpRight :size="12" /></a>
        <button @click="setEnabled(false)">{{ t('不再提示') }}</button>
      </div>
    </aside>
  </Teleport>
</template>

<style scoped>
.help-popover, .help-submenu, .help-bubble, .help-preview { position: fixed; z-index: 65; }
.help-popover, .help-submenu, .help-bubble, .help-preview { --help-surface: var(--paper); color: var(--text); background: var(--help-surface); border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 8px 30px #00000012, 0 2px 6px #00000008; font-size: 13px; line-height: 1.5; }
.help-popover { width: min(248px, calc(100vw - 24px)); overflow-y: auto; padding: 5px; border-radius: 9px; font-size: 12px; overscroll-behavior: contain; }
.help-submenu { z-index: 66; width: min(176px, calc(100vw - 24px)); overflow-y: auto; padding: 5px; border-radius: 9px; overscroll-behavior: contain; }
.help-menu-checklist { margin: 4px 4px 0; padding: 10px 3px 4px; border-top: 1px solid var(--line); }
.help-preview { width: min(236px, calc(100vw - 24px)); padding: 10px 11px 8px; border-radius: 9px; overflow-y: auto; overscroll-behavior: contain; }
.help-popover a, .help-bubble a, .help-preview a { text-decoration: none; }
.help-menu-heading { padding: 4px 7px 5px; color: var(--muted); font-size: 10px; }
.help-row { display: flex; align-items: center; gap: 7px; width: 100%; min-height: 27px; padding: 4px 7px; color: var(--text); border-radius: 5px; text-align: left; font-size: 12px; }
.help-row > span { flex: 1; }
.help-row > svg:last-child:not(:first-child) { color: var(--muted); }
.help-row:hover, .help-close:hover { background: var(--hover); }
.help-popover :is(button, a):focus-visible, .help-submenu button:focus-visible, .help-bubble :is(button, a):focus-visible, .help-preview :is(button, a):focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.help-row[aria-expanded='true'] { background: var(--hover); }
.help-chevron-left { transform: rotate(180deg); }
.help-close { display: grid; place-items: center; flex: 0 0 24px; width: 24px; height: 24px; padding: 3px; color: var(--muted); border-radius: 5px; }
.help-bubble { width: min(268px, calc(100vw - 24px)); padding: 10px 13px 12px; }
.help-bubble::after { content: ''; position: absolute; left: var(--help-tail); bottom: -5px; width: 8px; height: 8px; background: var(--help-surface); border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); transform: translateX(-50%) rotate(45deg); }
.help-bubble-heading { display: flex; align-items: center; justify-content: space-between; color: var(--muted); font-size: 11px; }
.help-bubble p { margin: 5px 0 12px; font-size: 13px; line-height: 1.8; }
.help-bubble-actions { display: flex; align-items: center; justify-content: space-between; }
.help-bubble-actions :is(button, a) { display: flex; align-items: center; gap: 3px; padding: 2px 0; font-size: 12px; color: var(--text-secondary); }
.help-bubble-actions button:last-child { font-size: 11px; color: var(--muted); }
.help-bubble-actions :is(button, a):hover { color: var(--green); }
</style>
