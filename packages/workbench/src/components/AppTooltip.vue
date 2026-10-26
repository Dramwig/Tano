<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { shortcutLabel } from '../shortcuts';
import { featureDefinitions } from '@tano/editor/runtime';
import type { DocumentFeature } from '@tano/editor/runtime';
import CapabilityExample from './CapabilityExample.vue';

// Mount once per workbench. Delegation also covers menus teleported to body.
// Controls opt in with data-tooltip and optional data-tooltip-shortcut (Mod+I).
// Rendered editor links share this hint without changing their Markdown content.
const editorLinkSelector = '.tano-prose a[href]:not(.tano-live-wiki)';
function tooltipLabel(element: HTMLElement) {
  if (element.dataset.tooltip !== undefined) return element.dataset.tooltip;
  if (!element.matches(editorLinkSelector)) return '';
  const source = element.classList.contains('tano-wiki-link') ? element.dataset.markdownSource : '';
  return `${source ? `${source} · ` : ''}Ctrl/⌘ + 点击跳转`;
}
const id = useId();
const tooltip = ref<HTMLElement>();
const portal = ref<HTMLElement | string>('body');
const label = ref('');
const shortcut = ref('');
const example = ref<DocumentFeature>();
const ready = ref(false);
let anchor: HTMLElement | null = null;
let pending: HTMLElement | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let observer: MutationObserver | undefined;
let keyboardFocus = true;

function cancelTimer() { clearTimeout(timer); timer = undefined; }
function hide() {
  cancelTimer();
  pending = null;
  if (anchor) {
    const descriptions = (anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(value => value && value !== id);
    if (descriptions.length) anchor.setAttribute('aria-describedby', descriptions.join(' '));
    else anchor.removeAttribute('aria-describedby');
  }
  anchor = null;
  label.value = '';
  example.value = undefined;
  ready.value = false;
}
function usable(button: HTMLElement) {
  return button.isConnected && !button.closest('[inert], [hidden], [aria-hidden="true"]') && !!tooltipLabel(button);
}
async function place() {
  const button = anchor;
  await nextTick();
  if (!button || anchor !== button || !tooltip.value) return;
  if (!usable(button) || !button.getClientRects().length) return hide();
  const hint = tooltip.value;
  // The top layer keeps hints visible over native modal dialogs too.
  if (hint.showPopover && !hint.matches(':popover-open')) hint.showPopover();
  const viewport = window.visualViewport;
  const left = (viewport?.offsetLeft ?? 0) + 8;
  const top = (viewport?.offsetTop ?? 0) + 8;
  const right = left + (viewport?.width ?? window.innerWidth) - 16;
  const bottom = top + (viewport?.height ?? window.innerHeight) - 16;
  hint.style.maxWidth = `${Math.min(320, right - left)}px`;
  hint.style.maxHeight = `${bottom - top}px`;
  const rect = button.getBoundingClientRect();
  const above = rect.top - hint.offsetHeight - 8;
  const y = above >= top ? above : rect.bottom + 8;
  hint.style.left = `${Math.max(left, Math.min(rect.left + (rect.width - hint.offsetWidth) / 2, right - hint.offsetWidth))}px`;
  hint.style.top = `${Math.max(top, Math.min(y, bottom - hint.offsetHeight))}px`;
  ready.value = true;
}
function update() {
  if (!anchor) return;
  if (!usable(anchor)) return hide();
  label.value = tooltipLabel(anchor);
  example.value = featureDefinitions.find(feature => feature.key === anchor?.dataset.tooltipExample)?.key;
  shortcut.value = anchor.dataset.tooltipShortcut ? shortcutLabel(anchor.dataset.tooltipShortcut.split(',')) : '';
  void place();
}
function show(button: HTMLElement) {
  hide();
  if (!usable(button)) return;
  anchor = button;
  // A modal makes nodes outside its DOM subtree inert, including popovers.
  portal.value = button.closest<HTMLDialogElement>('dialog[open]') ?? 'body';
  button.setAttribute('aria-describedby', [button.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
  update();
}
function enter(event: PointerEvent | FocusEvent) {
  if ('pointerType' in event && event.pointerType === 'touch') return;
  const target = event.target;
  if (!(target instanceof Element)) return;
  const button = target.closest<HTMLElement>(`[data-tooltip], ${editorLinkSelector}`);
  if (!button) return;
  // Menus restore focus after selection, even when the pointer is elsewhere.
  // Only keyboard focus should open a hint without an actual pointer hover.
  if (event.type === 'focusin' && !keyboardFocus) return;
  if (anchor === button) { cancelTimer(); return; }
  if (pending === button) return;
  hide();
  if (event.type === 'focusin') return show(button);
  pending = button;
  timer = setTimeout(() => show(button), 250);
}
function leave(event: MouseEvent | FocusEvent) {
  if (!(event.target instanceof Node) ||
    (!(anchor ?? pending)?.contains(event.target) && !tooltip.value?.contains(event.target))) return;
  const next = event.relatedTarget;
  if (next instanceof Node && ((anchor ?? pending)?.contains(next) || tooltip.value?.contains(next))) return;
  cancelTimer();
  pending = null;
  // Allow moving onto the hint to read a long description.
  timer = setTimeout(hide, 100);
}
function escape(event: KeyboardEvent) {
  keyboardFocus = true;
  if (event.key === 'Escape') {
    if (example.value) { event.preventDefault(); event.stopPropagation(); }
    hide();
  }
}
function dismiss(event: Event) {
  if (event.type === 'pointerdown') keyboardFocus = false;
  if (event.target instanceof Node && tooltip.value?.contains(event.target)) return;
  hide();
}
function scroll(event: Event) {
  if (event.target instanceof Node && tooltip.value?.contains(event.target)) return;
  hide();
}
onMounted(() => {
  document.addEventListener('pointerover', enter, true);
  document.addEventListener('pointerout', leave, true);
  document.addEventListener('focusin', enter, true);
  document.addEventListener('focusout', leave, true);
  document.addEventListener('pointerdown', dismiss, true);
  document.addEventListener('click', dismiss, true);
  window.addEventListener('keydown', escape, true);
  window.addEventListener('scroll', scroll, true);
  window.addEventListener('resize', hide);
  window.addEventListener('blur', hide);
  window.visualViewport?.addEventListener('resize', hide);
  window.visualViewport?.addEventListener('scroll', hide);
  observer = new MutationObserver(() => { if (anchor) update(); });
  observer.observe(document.body, { childList: true, subtree: true, attributes: true,
    attributeFilter: ['data-tooltip', 'data-tooltip-example', 'data-tooltip-shortcut', 'data-markdown-source', 'href', 'class', 'hidden', 'inert', 'aria-hidden', 'open'] });
});
onBeforeUnmount(() => {
  hide();
  observer?.disconnect();
  document.removeEventListener('pointerover', enter, true);
  document.removeEventListener('pointerout', leave, true);
  document.removeEventListener('focusin', enter, true);
  document.removeEventListener('focusout', leave, true);
  document.removeEventListener('pointerdown', dismiss, true);
  document.removeEventListener('click', dismiss, true);
  window.removeEventListener('keydown', escape, true);
  window.removeEventListener('scroll', scroll, true);
  window.removeEventListener('resize', hide);
  window.removeEventListener('blur', hide);
  window.visualViewport?.removeEventListener('resize', hide);
  window.visualViewport?.removeEventListener('scroll', hide);
});
</script>

<template>
  <Teleport :to="portal">
    <div v-if="label" :id="id" ref="tooltip" class="app-tooltip panel-scrollbar" role="tooltip"
      popover="manual" :data-ready="ready" @pointerenter="cancelTimer" @pointerleave="leave">
      <span v-if="!example">{{ label }}</span>
      <span v-if="shortcut" class="app-tooltip-shortcut">{{ shortcut }}</span>
      <CapabilityExample v-if="example" :feature="example" />
    </div>
  </Teleport>
</template>

<style scoped>
.app-tooltip {
  position: fixed;
  inset: auto;
  margin: 0;
  z-index: 1000;
  display: grid;
  gap: 2px;
  width: max-content;
  overflow: auto;
  padding: 6px 8px;
  border: 0;
  border-radius: 6px;
  background: #292929;
  color: #fff;
  box-shadow: 0 3px 10px #0003;
  font-size: 12px;
  line-height: 16px;
  white-space: pre-line;
  overflow-wrap: anywhere;
}
.app-tooltip[data-ready='false'] { visibility: hidden; }
.app-tooltip::backdrop { background: transparent; pointer-events: none; }
.app-tooltip-shortcut { color: #b8b8b8; }
@media (forced-colors: active) {
  .app-tooltip { border: 1px solid CanvasText; background: Canvas; color: CanvasText; }
  .app-tooltip-shortcut { color: CanvasText; }
}
</style>
