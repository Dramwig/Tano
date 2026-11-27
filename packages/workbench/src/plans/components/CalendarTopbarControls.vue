<script setup lang="ts">
import { Archive, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-vue-next';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { t } from '../../i18n/i18n';
import type { CalendarViewMode } from '../calendar';

defineProps<{
  isVisible: (id: string) => boolean;
  calendarPeriod: string;
  calendarMode: CalendarViewMode;
  calendarModeLabel: string;
  calendarModeOptions: readonly { mode: CalendarViewMode; label: string }[];
  calendarModeOpen: boolean;
}>();

const emit = defineEmits<{
  'go-today': [];
  'move-period': [delta: -1 | 1];
  'update:calendarModeOpen': [open: boolean];
  'select-mode': [mode: CalendarViewMode];
  'open-archive': [];
}>();
</script>

<template>
  <div class="calendar-topbar-controls" role="group" :aria-label="t('日历导航')">
    <span v-if="isVisible('calendar-period')" class="calendar-topbar-period">{{ calendarPeriod }}</span>
    <button
      v-if="isVisible('calendar-today')"
      type="button"
      class="calendar-topbar-today"
      @click="emit('go-today')"
    >
      {{ t('今天') }}
    </button>
    <button
      v-if="isVisible('calendar-previous')"
      type="button"
      class="icon-button"
      :aria-label="t('上一时段')"
      :data-tooltip="t('上一时段')"
      @click="emit('move-period', -1)"
    >
      <ChevronLeft :size="17" />
    </button>
    <button
      v-if="isVisible('calendar-next')"
      type="button"
      class="icon-button"
      :aria-label="t('下一时段')"
      :data-tooltip="t('下一时段')"
      @click="emit('move-period', 1)"
    >
      <ChevronRight :size="17" />
    </button>
    <div
      v-if="isVisible('calendar-mode')"
      class="calendar-view-picker"
      @keydown.esc.stop.prevent="emit('update:calendarModeOpen', false)"
    >
      <button
        type="button"
        class="calendar-topbar-mode"
        :aria-label="t('切换日历视图')"
        :data-tooltip="t('Ctrl + 滚轮：切换日历视图')"
        aria-haspopup="menu"
        :aria-expanded="calendarModeOpen"
        @click="emit('update:calendarModeOpen', !calendarModeOpen)"
      >
        {{ calendarModeLabel }}<ChevronDown :size="14" />
      </button>
      <div
        v-surface-motion="'App:4'"
        v-if="calendarModeOpen"
        class="calendar-view-menu"
        role="menu"
        :aria-label="t('日历视图')"
      >
        <button
          v-for="option in calendarModeOptions"
          :key="option.mode"
          type="button"
          role="menuitemradio"
          :aria-checked="calendarMode === option.mode"
          @click="emit('select-mode', option.mode)"
        >
          {{ option.label }}<Check v-if="calendarMode === option.mode" :size="15" />
        </button>
      </div>
    </div>
    <button
      v-if="isVisible('calendar-events')"
      type="button"
      class="icon-button calendar-topbar-archive"
      :aria-label="t('已归档')"
      :data-tooltip="t('查看和恢复已归档事项')"
      @click="emit('open-archive')"
    >
      <Archive :size="16" />
    </button>
  </div>
</template>
