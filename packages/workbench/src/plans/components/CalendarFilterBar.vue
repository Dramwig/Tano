<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import { Check, ChevronDown, ListFilter, Search, X } from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { MOTION_DURATION, canAnimate, resizeHeight, settleHeight, spring } from '@tano/editor/motion';
import { t } from '../../i18n/i18n';
import type { CalendarFilter } from '../calendar';

const filter = defineModel<CalendarFilter>({ required: true });
defineProps<{ inline?: boolean }>();

const kindOptions = computed(() => [
  { value: 'all', label: t('全部') },
  { value: 'task', label: t('任务') },
  { value: 'event', label: t('日程') },
] as const);
const kindLabel = computed(() => kindOptions.value.find((option) => option.value === filter.value.kind)?.label ?? t('全部'));
const filtered = computed(() => filter.value.kind !== 'all' || !filter.value.showCompleted);
const triggerLabel = computed(() => (filter.value.kind === 'all' ? t('筛选') : kindLabel.value));

// Labels differ in width across locales ("Filter" / "Tasks" / "Events"), so the
// trigger glides between measured widths instead of snapping.
const trigger = ref<HTMLElement>();
let triggerMotion: Animation | undefined;
let triggerWidthFrom: number | undefined;
watch(triggerLabel, () => {
  triggerMotion?.cancel();
  triggerWidthFrom = trigger.value?.getBoundingClientRect().width;
}, { flush: 'pre' });
watch(triggerLabel, () => {
  const element = trigger.value;
  const from = triggerWidthFrom;
  triggerWidthFrom = undefined;
  if (!canAnimate(element) || from === undefined) return;
  const to = element.getBoundingClientRect().width;
  if (Math.abs(to - from) < 0.5) return;
  const animation = element.animate([{ width: `${from}px` }, { width: `${to}px` }], {
    duration: MOTION_DURATION.smooth,
    easing: spring('smooth'),
  });
  element.style.overflow = 'clip';
  triggerMotion = animation;
  const settle = () => {
    if (triggerMotion !== animation) return;
    element.style.overflow = '';
    triggerMotion = undefined;
  };
  animation.addEventListener('finish', settle);
  animation.addEventListener('cancel', settle);
}, { flush: 'post' });

const anchor = ref<HTMLElement>();
const menuOpen = ref(false);
function closeOnOutside(event: PointerEvent) {
  if (!anchor.value?.contains(event.target as Node)) menuOpen.value = false;
}
watch(menuOpen, (open) => {
  if (open) document.addEventListener('pointerdown', closeOnOutside, true);
  else document.removeEventListener('pointerdown', closeOnOutside, true);
});
// The reset row appears only while filtering, so the menu height changes with the
// selection; animate between the measured heights instead of jumping.
const menu = ref<HTMLElement>();
let menuHeightFrom: number | undefined;
watch(filtered, () => {
  if (!menu.value) return;
  settleHeight(menu.value);
  menuHeightFrom = menu.value.getBoundingClientRect().height;
}, { flush: 'pre' });
watch(filtered, () => {
  const element = menu.value;
  const from = menuHeightFrom;
  menuHeightFrom = undefined;
  if (!element || from === undefined) return;
  resizeHeight(element, from, element.getBoundingClientRect().height, { kind: 'smooth' });
}, { flush: 'post' });

function resetFilters() {
  filter.value.kind = 'all';
  filter.value.showCompleted = true;
  menuOpen.value = false;
}

// Search stays a single icon until it is used, so the toolbar keeps one quiet control.
const searchInput = ref<HTMLInputElement>();
const searchOpen = ref(Boolean(filter.value.query));
async function openSearch() {
  searchOpen.value = true;
  await nextTick();
  searchInput.value?.focus();
}
function closeSearchIfEmpty() {
  if (!filter.value.query) searchOpen.value = false;
}
function clearSearch() {
  filter.value.query = '';
  searchOpen.value = false;
}

onUnmounted(() => document.removeEventListener('pointerdown', closeOnOutside, true));
</script>

<template>
  <div
    class="calendar-filter-bar"
    :class="{ 'calendar-filter-bar-inline': inline }"
    role="region"
    :aria-label="t('日历筛选')"
  >
    <div ref="anchor" class="calendar-filter-menu-anchor" @keydown.esc.stop.prevent="menuOpen = false">
      <button
        ref="trigger"
        type="button"
        class="calendar-filter-trigger"
        :class="{ 'is-filtered': filtered }"
        aria-haspopup="menu"
        :aria-expanded="menuOpen"
        @click="menuOpen = !menuOpen"
      >
        <span class="calendar-filter-icon">
          <ListFilter :size="14" />
          <span v-if="filtered" class="calendar-filter-dot" aria-hidden="true" />
        </span>
        <span>{{ triggerLabel }}</span>
        <ChevronDown :size="13" class="calendar-filter-chevron" />
      </button>
      <div v-if="menuOpen" ref="menu" v-surface-motion="'App:4'" class="calendar-filter-menu" role="menu" :aria-label="t('筛选')">
        <p class="calendar-filter-menu-label">{{ t('类型') }}</p>
        <div class="calendar-filter-kinds" role="group" :aria-label="t('类型')">
          <button
            v-for="option in kindOptions"
            :key="option.value"
            type="button"
            role="menuitemradio"
            :aria-checked="filter.kind === option.value"
            @click="filter.kind = option.value"
          >{{ option.label }}<Check v-if="filter.kind === option.value" :size="14" /></button>
        </div>
        <hr />
        <button
          type="button"
          class="calendar-filter-completed"
          role="menuitemcheckbox"
          :aria-checked="filter.showCompleted"
          @click="filter.showCompleted = !filter.showCompleted"
        >{{ t('显示已完成') }}<Check v-if="filter.showCompleted" :size="14" /></button>
        <template v-if="filtered">
          <hr />
          <button type="button" class="calendar-filter-reset" role="menuitem" @click="resetFilters">
            {{ t('重置筛选') }}
          </button>
        </template>
      </div>
    </div>
    <label v-if="searchOpen" class="calendar-filter-search">
      <Search :size="13" aria-hidden="true" />
      <input
        ref="searchInput"
        v-model="filter.query"
        type="search"
        :aria-label="t('搜索事项…')"
        :placeholder="t('搜索事项…')"
        maxlength="100"
        @blur="closeSearchIfEmpty"
        @keydown.esc.stop.prevent="clearSearch"
      />
      <button
        v-if="filter.query"
        type="button"
        class="calendar-filter-clear"
        :aria-label="t('关闭')"
        @mousedown.prevent
        @click="clearSearch"
      >
        <X :size="12" />
      </button>
    </label>
    <button
      v-else
      type="button"
      class="icon-button calendar-filter-search-toggle"
      :aria-label="t('搜索事项…')"
      :data-tooltip="t('搜索事项…')"
      @click="openSearch"
    >
      <Search :size="15" />
    </button>
  </div>
</template>

<style scoped>
.calendar-filter-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 8px 14px;
  border-bottom: 1px solid var(--line);
  background: var(--paper);
  font-size: 12px;
}
.calendar-filter-bar-inline {
  padding: 0;
  border-bottom: 0;
  background: transparent;
}
.calendar-filter-menu-anchor { position: relative; flex-shrink: 0; }
.calendar-filter-trigger {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  min-height: 28px;
  padding: 0 8px 0 9px;
  border: 1px solid var(--line);
  border-radius: 7px;
  color: var(--text-secondary);
  font-size: 12px;
  white-space: nowrap;
}
.calendar-filter-trigger:hover,
.calendar-filter-trigger[aria-expanded='true'] {
  border-color: var(--control-border);
  background: var(--hover);
  color: var(--text);
}
.calendar-filter-trigger.is-filtered { color: var(--text); }
.calendar-filter-chevron { color: var(--muted); transition: rotate var(--motion-quick) var(--ease-standard); }
.calendar-filter-trigger[aria-expanded='true'] .calendar-filter-chevron { rotate: 180deg; }
.calendar-filter-icon { position: relative; display: inline-flex; }
/* Badge on the icon corner: signals an active filter without adding width. */
.calendar-filter-dot {
  position: absolute;
  top: -2px;
  right: -3px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--text);
  box-shadow: 0 0 0 1.5px var(--paper);
}
.calendar-filter-trigger:hover .calendar-filter-dot,
.calendar-filter-trigger[aria-expanded='true'] .calendar-filter-dot { box-shadow: 0 0 0 1.5px var(--hover); }
.calendar-filter-menu {
  position: absolute;
  z-index: 20;
  top: calc(100% + 6px);
  left: 0;
  width: 176px;
  padding: 4px;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--paper);
  box-shadow: var(--overlay-shadow, 0 8px 24px #0002);
}
.calendar-filter-menu-label {
  margin: 0;
  padding: 6px 10px 4px;
  color: var(--muted);
  font-size: 11px;
}
.calendar-filter-menu hr {
  margin: 4px 6px;
  border: 0;
  border-top: 1px solid var(--line);
}
.calendar-filter-menu button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 30px;
  padding: 0 10px;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 12px;
  text-align: left;
}
.calendar-filter-menu button:hover,
.calendar-filter-menu button:focus-visible { background: var(--hover); color: var(--text); }
.calendar-filter-menu button[aria-checked='true'] { color: var(--text); font-weight: 500; }
.calendar-filter-menu .calendar-filter-reset { color: var(--muted); }
.calendar-filter-search-toggle { width: 28px; height: 28px; border-radius: 7px; flex-shrink: 0; }
.calendar-filter-search {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  min-height: 28px;
  padding: 0 6px 0 9px;
  border: 1px solid color-mix(in srgb, var(--text) 30%, var(--line));
  border-radius: 7px;
  background: var(--paper);
  color: var(--text-secondary);
  cursor: text;
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--text) 6%, transparent);
  animation: calendar-filter-search-in var(--motion-base) var(--ease-standard);
}
.calendar-filter-search input {
  width: 180px;
  min-width: 0;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 12px;
  outline: none;
}
.calendar-filter-search input::-webkit-search-cancel-button { display: none; }
.calendar-filter-clear {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  color: var(--muted);
}
.calendar-filter-clear:hover { background: var(--hover); color: var(--text); }
@keyframes calendar-filter-search-in {
  from { opacity: 0; transform: translateX(-4px); }
}
@media (max-width: 700px) {
  .calendar-filter-bar:not(.calendar-filter-bar-inline) { padding: 6px 10px; }
  .calendar-filter-search input { width: 120px; }
}
</style>
