<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, useId, watch } from 'vue';
import { CalendarDays, ClipboardList, LayoutTemplate, ListTodo, MoreHorizontal, Sparkles } from 'lucide-vue-next';
const props = defineProps<{ assistant: boolean; assistantBusy: boolean }>();
const emit = defineEmits<{ draft: []; template: []; initialize: [kind: 'meeting' | 'weekly' | 'todo'] }>();
const allActions = [
  { id: 'draft', get label() { return t('AI 起草'); }, icon: Sparkles },
  { id: 'meeting', get label() { return t('会议纪要'); }, icon: ClipboardList },
  { id: 'todo', get label() { return t('待办清单'); }, icon: ListTodo },
  { id: 'weekly', get label() { return t('周报'); }, icon: CalendarDays },
  { id: 'template', get label() { return t('模板'); }, icon: LayoutTemplate },
] as const;
type ActionId = typeof allActions[number]['id'];
const actions = computed(() => allActions.filter(action => action.id !== 'draft' || props.assistant));
const row = ref<HTMLElement>();
const more = ref<HTMLButtonElement>();
const menu = ref<HTMLElement>();
const menuId = useId();
const visibleCount = ref(actions.value.length);
const overflow = computed(() => actions.value.slice(visibleCount.value));
const open = ref(false);
const position = ref({ left: '0px', top: '0px', maxHeight: '0px' });
let observer: ResizeObserver | undefined;

function close(restoreFocus = false) {
  open.value = false;
  if (restoreFocus) void nextTick(() => {
    const target = overflow.value.length ? more.value : row.value?.querySelector<HTMLButtonElement>('[data-starter-action]:not(:disabled)');
    target?.focus({ preventScroll: true });
  });
}
function measure() {
  if (!row.value || !more.value) return;
  const width = row.value.getBoundingClientRect().width;
  if (!width) return;
  const buttons = [...row.value.querySelectorAll<HTMLButtonElement>('[data-starter-action]')];
  const widths = buttons.map(button => button.getBoundingClientRect().width);
  const gap = parseFloat(getComputedStyle(row.value).columnGap) || 0;
  let count = widths.length;
  if (widths.reduce((sum, value) => sum + value, 0) + gap * (widths.length - 1) > width) {
    const available = width - more.value.getBoundingClientRect().width;
    let used = 0;
    count = 0;
    for (const buttonWidth of widths) {
      if (used + buttonWidth + gap > available) break;
      used += buttonWidth + gap;
      count++;
    }
  }
  if (count === visibleCount.value) return;
  const focusMoves = buttons.some((button, index) => index >= count && button === document.activeElement);
  visibleCount.value = count;
  close(open.value || focusMoves);
}
function observe() {
  observer?.disconnect();
  if (!row.value) return;
  observer?.observe(row.value);
  for (const button of row.value.querySelectorAll('button')) observer?.observe(button);
  measure();
}
async function show(selection?: 'first' | 'last') {
  if (!overflow.value.length) return;
  open.value = true;
  await nextTick();
  if (!open.value || !more.value || !menu.value) return;
  const anchor = more.value.getBoundingClientRect();
  const above = Math.max(0, anchor.top - 16);
  const below = Math.max(0, window.innerHeight - anchor.bottom - 16);
  const upward = above >= below;
  const maxHeight = Math.max(above, below);
  const height = Math.min(menu.value.scrollHeight + menu.value.offsetHeight - menu.value.clientHeight, maxHeight);
  const width = menu.value.getBoundingClientRect().width;
  position.value = {
    left: `${Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, upward ? anchor.top - height - 8 : anchor.bottom + 8)}px`,
    maxHeight: `${maxHeight}px`,
  };
  await nextTick();
  const buttons = menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
  const target = selection === 'first' ? buttons?.[0] : selection === 'last' ? buttons?.[buttons.length - 1] : menu.value;
  target?.focus({ preventScroll: true });
}
function activate(id: ActionId) {
  if (id === 'draft' && props.assistantBusy) return;
  if (open.value) more.value?.focus({ preventScroll: true });
  close();
  if (id === 'draft') emit('draft');
  else if (id === 'template') emit('template');
  else emit('initialize', id);
}
function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.preventDefault(); close(true);
  } else if (event.key === 'Tab') {
    close(); more.value?.focus({ preventScroll: true });
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : current < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[index]?.focus({ preventScroll: true });
  }
}
function outside(event: Event) {
  if (!menu.value?.contains(event.target as Node) && !more.value?.contains(event.target as Node)) close();
}
function scrolled(event: Event) {
  if (!menu.value?.contains(event.target as Node)) close();
}
function resized() { close(open.value); measure(); }
watch(() => props.assistant, observe, { flush: 'post' });
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(measure);
  observe();
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('scroll', scrolled, true);
  window.addEventListener('resize', resized);
});
onBeforeUnmount(() => {
  observer?.disconnect();
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('scroll', scrolled, true);
  window.removeEventListener('resize', resized);
});
</script>

<template>
  <section class="document-starter" :aria-label="t('开始使用文档')">
    <p>{{ t('开始使用') }}</p>
    <div ref="row" class="document-starter-actions">
      <button v-for="(action, index) in actions" :key="action.id" type="button" :data-starter-action="action.id"
        :class="{ 'is-overflowed': index >= visibleCount }" :aria-hidden="index >= visibleCount || undefined"
        :tabindex="index >= visibleCount ? -1 : undefined" :disabled="action.id === 'draft' && assistantBusy" @click="activate(action.id)">
        <component :is="action.icon" :size="16" :class="{ 'document-starter-spark': action.id === 'draft' }" />{{ action.label }}
      </button>
      <button ref="more" type="button" class="document-starter-more" :class="{ 'is-overflowed': !overflow.length }"
        :aria-hidden="!overflow.length || undefined" :tabindex="overflow.length ? undefined : -1"
        :aria-label="t('更多开始使用选项')" :data-tooltip="t('更多')" aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? menuId : undefined"
        @click="open ? close(true) : show()" @keydown.down.prevent="show('first')" @keydown.up.prevent="show('last')" @keydown.esc.prevent="close(true)">
        <MoreHorizontal :size="18" />
      </button>
    </div>
  </section>
  <Teleport to="body">
    <div v-if="open" :id="menuId" ref="menu" class="dropdown compact-action-menu panel-scrollbar document-starter-menu"
      role="menu" tabindex="-1" :aria-label="t('更多开始使用选项')" :style="position" @keydown.stop="menuKey">
      <button v-for="action in overflow" :key="action.id" type="button" role="menuitem"
        :disabled="action.id === 'draft' && assistantBusy" @click="activate(action.id)">
        <component :is="action.icon" :size="16" :class="{ 'document-starter-spark': action.id === 'draft' }" />{{ action.label }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.document-starter { --starter-control-size: 36px; flex-shrink: 0; width: 100%; max-width: 780px; margin: auto auto 0; padding-top: 20px; }
.document-starter p { margin: 0 0 12px 8px; color: var(--muted); font-size: 12px; }
.document-starter-actions { position: relative; display: flex; flex-wrap: nowrap; gap: 8px; min-width: 0; }
.document-starter button { display: inline-flex; flex: 0 0 auto; align-items: center; gap: 7px; min-height: var(--starter-control-size); padding: 8px 13px; border: 0; border-radius: 999px; background: color-mix(in srgb, var(--text) 5%, var(--paper)); color: var(--text); font-size: 13px; line-height: 20px; white-space: nowrap; }
/* Keep natural widths measurable without leaving hidden actions in the row or tab order. */
.document-starter button.is-overflowed { position: absolute; top: 0; left: 0; width: max-content; visibility: hidden; pointer-events: none; }
.document-starter button.document-starter-more { justify-content: center; width: var(--starter-control-size); padding: 0; }
.document-starter button:hover:not(:disabled) { background: color-mix(in srgb, var(--text) 9%, var(--paper)); }
.document-starter button:focus-visible { outline: 2px solid var(--green); outline-offset: 3px; }
.document-starter-spark { color: var(--green); }
.document-starter-menu { position: fixed; z-index: 100; min-width: 0; overflow-y: auto; overscroll-behavior: contain; outline: none; }
:global(.editor-scroll.width-unlimited) .document-starter { max-width: none; }
@media (max-width: 600px) { .document-starter { --starter-control-size: 40px; } }
</style>
