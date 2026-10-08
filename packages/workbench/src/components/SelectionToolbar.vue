<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { animate } from 'motion/mini';
import type { EditorSelectionContext } from '@tano/editor/document-model';
import type { DocumentFeatures } from '@tano/editor/runtime';
import EditorToolbar from './EditorToolbar.vue';
import { defaultShortcutBindings, matchesShortcut, shortcutAriaLabel } from '../shortcuts';
import type { ShortcutBindings } from '../shortcuts';
import { selectionToolbarPosition } from '../selection-toolbar-position';
import type { ToolbarMode } from '../toolbar-preference';
import {
  dockedToolbarMenuPosition,
  dockedToolbarPosition,
  toolbarPaneBounds,
} from '../toolbar-docking';

const props = defineProps<{
  context: EditorSelectionContext;
  editorElement?: HTMLElement;
  features?: DocumentFeatures;
  enabledLevels?: readonly number[];
  mode?: Exclude<ToolbarMode, 'fixed'>;
  dragging?: boolean;
  assistant?: boolean;
  annotation?: boolean;
  todo?: boolean;
  shortcuts?: ShortcutBindings;
}>();
const emit = defineEmits<{ command: [name: string, value?: string]; assistant: []; annotation: []; todo: [] }>();
const panel = ref<HTMLElement>();
const visible = ref(false);
const vertical = ref(false);
const docked = computed(() => !!props.mode && props.mode !== 'selection');
let anchor: Range | null = null;
let dismissed: Range | null = null;
let pointerSelecting = false;
let composing = false;
let windowBlurred = false;
let frame = 0;
let resizeObserver: ResizeObserver | undefined;
let menuObserver: MutationObserver | undefined;
const observedMenus = new Set<HTMLElement>();
let mounted = false;
const animations = new Map<Element, ReturnType<typeof animate>>();

function cancelAnimation(element: Element) {
  animations.get(element)?.stop();
  animations.delete(element);
}
function prepareEnter(element: Element) {
  element.removeAttribute('inert');
  element.removeAttribute('aria-hidden');
  const surface = element.firstElementChild as HTMLElement | null;
  if (surface) {
    surface.style.opacity = '0';
    surface.style.transform = 'scale(0.96)';
  }
}
function animateVisibility(element: Element, done: () => void, entering: boolean) {
  cancelAnimation(element);
  if (!entering) {
    element.setAttribute('inert', '');
    element.setAttribute('aria-hidden', 'true');
  }
  // Animate the surface so docking transforms and positioning measurements stay stable.
  const surface = element.firstElementChild as HTMLElement | null;
  if (
    !surface ||
    typeof surface.animate !== 'function' ||
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  ) {
    if (surface) {
      surface.style.opacity = entering ? '1' : '0';
      surface.style.transform = '';
    }
    done();
    return;
  }
  const animation = animate(
    surface,
    { opacity: entering ? 1 : 0, transform: entering ? 'scale(1)' : 'scale(0.96)' },
    { duration: entering ? 0.16 : 0.12, ease: [0.22, 1, 0.36, 1] },
  );
  animations.set(element, animation);
  void animation.finished.then(() => {
    if (animations.get(element) !== animation) return;
    animations.delete(element);
    surface.style.transform = '';
    done();
  });
}
function enter(element: Element, done: () => void) {
  animateVisibility(element, done, true);
}
function leave(element: Element, done: () => void) {
  animateVisibility(element, done, false);
}

function editor() {
  return props.editorElement?.querySelector<HTMLElement>('.ProseMirror');
}
function sameRange(a: Range | null, b: Range) {
  return (
    a?.startContainer === b.startContainer &&
    a.startOffset === b.startOffset &&
    a.endContainer === b.endContainer &&
    a.endOffset === b.endOffset
  );
}
function hide() {
  visible.value = false;
}
function dismiss() {
  dismissed = anchor?.cloneRange() ?? null;
  hide();
}
function dismissAndFocus() {
  if (!props.mode || props.mode === 'selection') dismiss();
  editor()?.focus();
}
function position() {
  const element = panel.value;
  const content = editor();
  const bounds = toolbarPaneBounds(props.editorElement);
  if (!element || !content || !bounds) return hide();
  const { left, top, right, bottom } = bounds;
  element.style.maxWidth = `${Math.max(0, right - left)}px`;
  const mode = props.mode;
  const shouldBeVertical = (mode === 'left' || mode === 'right') && bottom - top >= 280;
  if (vertical.value !== shouldBeVertical) {
    vertical.value = shouldBeVertical;
    void nextTick(position);
    return;
  }
  const rect = element.getBoundingClientRect();
  if (mode && mode !== 'selection') {
    const result = dockedToolbarPosition(bounds, mode, rect.width, rect.height);
    element.style.left = `${mode === 'bottom' ? (left + right) / 2 : result.x}px`;
    // Anchor at the bottom edge or side center while the controls change height.
    const anchorY =
      mode === 'bottom' ? bottom : vertical.value ? result.y + rect.height / 2 : result.y;
    element.style.top = `${anchorY}px`;
    element.style.setProperty('--dock-menu-top', `${result.menuTop}px`);
    element.style.setProperty(
      '--selection-toolbar-width',
      `${vertical.value || mode === 'bottom' ? result.menuWidth : right - left}px`,
    );
    const above = result.y - top - 6;
    const below = bottom - result.y - rect.height - 6;
    element.dataset.menuSide = mode === 'bottom' || above > below ? 'above' : 'below';
    const menuHeight = vertical.value
      ? result.menuHeight
      : mode === 'bottom'
        ? above
        : Math.max(above, below);
    element.style.setProperty(
      '--selection-menu-height',
      `${Math.max(0, menuHeight)}px`,
    );
    const menus = new Set(
      element.querySelectorAll<HTMLElement>('.dropdown, .toolbar-input-panel'),
    );
    for (const menu of observedMenus) {
      if (!menus.has(menu)) {
        resizeObserver?.unobserve(menu);
        observedMenus.delete(menu);
      }
    }
    for (const menu of menus) {
      if (!observedMenus.has(menu)) {
        observedMenus.add(menu);
        resizeObserver?.observe(menu);
      }
      if (!vertical.value) continue;
      const trigger = menu.closest('.menu-wrap')?.querySelector<HTMLElement>('button');
      const menuPosition = dockedToolbarMenuPosition(
        bounds,
        result.y,
        trigger?.getBoundingClientRect().top ?? result.y,
        menu.offsetHeight,
      );
      menu.style.setProperty('--dock-menu-top', `${menuPosition.top}px`);
    }
    return;
  }
  if (!anchor || !content.contains(anchor.commonAncestorContainer)) return hide();
  const result = selectionToolbarPosition(
    [...anchor.getClientRects()],
    { left, top, right, bottom },
    rect.width,
    rect.height,
  );
  if (!result) return hide();
  element.style.left = `${result.x}px`;
  element.style.top = `${result.y}px`;
  element.dataset.menuSide = result.menuSide;
  element.style.setProperty('--selection-toolbar-width', `${result.menuWidth}px`);
  // Match the chosen side, including in a short horizontal split.
  const availableHeight =
    result.menuSide === 'above' ? result.y - top - 6 : bottom - result.y - rect.height - 6;
  element.style.setProperty('--selection-menu-height', `${Math.max(0, availableHeight)}px`);
}
async function refresh() {
  if (!mounted || props.dragging) return;
  if (windowBlurred) return hide();
  const content = editor();
  if (docked.value) {
    if (
      !content ||
      (!content.contains(document.activeElement) &&
        !(visible.value && panel.value?.contains(document.activeElement)))
    )
      return hide();
    visible.value = true;
    await nextTick();
    if (visible.value) position();
    return;
  }
  if (pointerSelecting || composing) return;
  if (!content || !props.context.textSelected) return hide();
  // Inputs may replace the browser selection. ProseMirror retains its own range;
  // keep the original anchor while a link or formatting menu owns focus.
  if (visible.value && panel.value?.contains(document.activeElement)) return position();
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed || !content.contains(document.activeElement))
    return hide();
  const range = selection.getRangeAt(0);
  if (
    !content.contains(range.commonAncestorContainer) ||
    !range.toString() ||
    sameRange(dismissed, range)
  )
    return hide();
  dismissed = null;
  anchor = range.cloneRange();
  visible.value = true;
  await nextTick();
  if (visible.value) position();
}
function schedule() {
  if (frame) cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    frame = 0;
    void refresh();
  });
}
function pointerDown(event: PointerEvent) {
  const target = event.target as Node | null;
  if (panel.value?.contains(target)) return;
  if (docked.value) {
    if (!editor()?.contains(target)) hide();
    return;
  }
  if (editor()?.contains(target)) {
    dismissed = null;
    pointerSelecting = true;
    hide();
  } else dismiss();
}
function pointerUp() {
  pointerSelecting = false;
  schedule();
}
function keydown(event: KeyboardEvent) {
  if (props.dragging || event.defaultPrevented) return;
  if (event.key === 'Escape' && visible.value) {
    // Nested menus consume Escape first; the next Escape dismisses the capsule.
    if (docked.value) return;
    dismiss();
    if (panel.value?.contains(document.activeElement)) editor()?.focus();
    event.preventDefault();
    event.stopPropagation();
  }
}
function focusShortcut(event: KeyboardEvent) {
  if (props.dragging || event.defaultPrevented || !visible.value ||
      (event.target instanceof Element && event.target.closest('[role="dialog"]'))) return;
  if (!matchesShortcut(event, 'focusToolbar', props.shortcuts ?? defaultShortcutBindings)) return;
  panel.value?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  event.preventDefault();
  event.stopPropagation();
}
function compositionStart() {
  composing = true;
  if (!props.mode || props.mode === 'selection') hide();
}
function compositionEnd() {
  composing = false;
  schedule();
}
function blur() {
  pointerSelecting = false;
  windowBlurred = true;
  if (!props.mode || props.mode === 'selection') dismiss();
  else hide();
}
function focus() {
  windowBlurred = false;
  schedule();
}
watch(() => props.context, schedule);
watch(panel, (element, previous) => {
  menuObserver?.disconnect();
  for (const menu of observedMenus) resizeObserver?.unobserve(menu);
  observedMenus.clear();
  if (previous) resizeObserver?.unobserve(previous);
  if (element) {
    resizeObserver?.observe(element);
    menuObserver?.observe(element, { childList: true, subtree: true });
  }
});
watch(
  () => [props.mode, props.dragging],
  () => {
    dismissed = null;
    schedule();
  },
);
watch(
  () => props.editorElement,
  (element, previous) => {
    if (previous) resizeObserver?.unobserve(previous);
    if (element) resizeObserver?.observe(element);
    schedule();
  },
);
onMounted(() => {
  mounted = true;
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('pointerdown', pointerDown, true);
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', pointerUp);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  document.addEventListener('keydown', keydown);
  document.addEventListener('keydown', focusShortcut, true);
  document.addEventListener('compositionstart', compositionStart);
  document.addEventListener('compositionend', compositionEnd);
  window.addEventListener('scroll', schedule, true);
  window.addEventListener('resize', schedule);
  window.addEventListener('blur', blur);
  window.addEventListener('focus', focus);
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  menuObserver = new MutationObserver(schedule);
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(schedule);
    if (props.editorElement) resizeObserver.observe(props.editorElement);
  }
  schedule();
});
onBeforeUnmount(() => {
  mounted = false;
  for (const element of animations.keys()) cancelAnimation(element);
  cancelAnimationFrame(frame);
  resizeObserver?.disconnect();
  menuObserver?.disconnect();
  document.removeEventListener('selectionchange', schedule);
  document.removeEventListener('pointerdown', pointerDown, true);
  document.removeEventListener('pointerup', pointerUp);
  document.removeEventListener('pointercancel', pointerUp);
  document.removeEventListener('focusin', schedule);
  document.removeEventListener('focusout', schedule);
  document.removeEventListener('keydown', keydown);
  document.removeEventListener('keydown', focusShortcut, true);
  document.removeEventListener('compositionstart', compositionStart);
  document.removeEventListener('compositionend', compositionEnd);
  window.removeEventListener('scroll', schedule, true);
  window.removeEventListener('resize', schedule);
  window.removeEventListener('blur', blur);
  window.removeEventListener('focus', focus);
  window.visualViewport?.removeEventListener('resize', schedule);
  window.visualViewport?.removeEventListener('scroll', schedule);
});
</script>

<template>
  <Teleport to="body">
    <Transition
      :css="false"
      @before-enter="prepareEnter"
      @enter="enter"
      @leave="leave"
      @enter-cancelled="cancelAnimation"
      @leave-cancelled="cancelAnimation"
    >
      <div
        v-if="visible"
        ref="panel"
        class="selection-toolbar"
        :class="{ 'docked-toolbar': vertical, 'toolbar-being-dragged': dragging }"
        :data-dock="docked ? mode : undefined"
        :aria-label="mode === 'left' ? '左侧工具栏' : mode === 'right' ? '右侧工具栏' : mode === 'bottom' ? '底部工具栏' : '选区工具栏'"
        :aria-keyshortcuts="[shortcutAriaLabel((shortcuts ?? defaultShortcutBindings).focusToolbar), 'Escape'].filter(Boolean).join(' ')"
      >
        <EditorToolbar
          compact
          :vertical="vertical"
          :dragging="dragging"
          :assistant="assistant"
          :annotation="annotation"
          :todo="todo"
          @todo="visible && emit('todo')"
          @assistant="visible && emit('assistant')"
          @annotation="visible && emit('annotation')"
          :context="context"
          :features="features"
          :enabled-levels="enabledLevels"
          @dismiss="dismissAndFocus"
          @command="(name, value) => visible && emit('command', name, value)"
        >
          <template #leading><slot name="leading" /></template>
          <template #preferences><slot name="preferences" /></template>
        </EditorToolbar>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.selection-toolbar {
  position: fixed;
  z-index: 35;
  width: max-content;
}
.selection-toolbar[inert] {
  pointer-events: none;
}
.docked-toolbar {
  transform: translateY(-50%);
}
.selection-toolbar[data-dock='bottom'] {
  /* Keep the capsule centered and above the bottom edge while its controls animate. */
  transform: translate(-50%, -100%);
}
.selection-toolbar:not(.docked-toolbar)[data-menu-side='above']
  :deep(.selection-format-toolbar .dropdown),
.selection-toolbar:not(.docked-toolbar)[data-menu-side='above']
  :deep(.selection-format-toolbar .toolbar-input-panel) {
  top: auto;
  bottom: calc(100% + 6px);
}
.toolbar-being-dragged {
  opacity: 0;
}
.docked-toolbar :deep(.selection-format-toolbar .dropdown),
.docked-toolbar :deep(.selection-format-toolbar .toolbar-input-panel) {
  top: var(--dock-menu-top, 0px);
  bottom: auto;
  left: calc(100% + 8px);
}
.docked-toolbar[data-dock='right'] :deep(.selection-format-toolbar .dropdown),
.docked-toolbar[data-dock='right'] :deep(.selection-format-toolbar .toolbar-input-panel) {
  left: auto;
  right: calc(100% + 8px);
}
.selection-toolbar[data-dock='right']:not(.docked-toolbar) :deep(.dropdown),
.selection-toolbar[data-dock='right']:not(.docked-toolbar) :deep(.toolbar-input-panel) {
  left: auto;
  right: 0;
}
</style>
