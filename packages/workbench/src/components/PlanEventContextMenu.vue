<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Archive, CircleCheck, FileText, Pencil, RotateCcw } from 'lucide-vue-next';
import { taskReview } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import { isCheckableEvent, isEventCompleted } from '../calendar';

const props = defineProps<{
  id: string;
  record: ObjectRecord;
  position: { x: number; y: number };
  disabled: boolean;
}>();
const emit = defineEmits<{
  action: [action: 'details' | 'complete' | 'archive'];
  close: [restoreFocus: boolean];
}>();
const menu = ref<HTMLElement>();
const position = ref(props.position);
const checkable = computed(() => isCheckableEvent(props.record));
const completed = computed(() => isEventCompleted(props.record));
const completionLocked = computed(() => {
  const review = taskReview(props.record.object);
  return !!review && review.state !== 'approved';
});
async function place() {
  await nextTick();
  if (!menu.value) return;
  position.value = {
    x: Math.max(8, Math.min(props.position.x, window.innerWidth - menu.value.offsetWidth - 8)),
    y: Math.max(8, Math.min(props.position.y, window.innerHeight - menu.value.offsetHeight - 8)),
  };
  menu.value.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
}
function outside(event: Event) {
  if (!(event.target instanceof Node) || !menu.value?.contains(event.target)) emit('close', false);
}
function dismiss() {
  emit('close', false);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Escape' || event.key === 'Tab') {
    event.preventDefault();
    emit('close', true);
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [
      ...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []),
    ];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? buttons.length - 1
          : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}
watch(() => props.position, place);
onMounted(() => {
  void place();
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('contextmenu', outside, true);
  window.addEventListener('focusin', outside);
  window.addEventListener('scroll', outside, true);
  window.addEventListener('resize', dismiss);
});
onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', outside, true);
  window.removeEventListener('contextmenu', outside, true);
  window.removeEventListener('focusin', outside);
  window.removeEventListener('scroll', outside, true);
  window.removeEventListener('resize', dismiss);
});
</script>

<template>
  <Teleport to="body">
    <div
      :id="id"
      ref="menu"
      class="dropdown compact-action-menu plan-event-context-menu"
      role="menu"
      :aria-label="t('{0} 操作', [record.object.name])"
      :style="{ left: `${position.x}px`, top: `${position.y}px` }"
      @contextmenu.stop.prevent
      @keydown.stop="keydown"
    >
      <button type="button" role="menuitem" @click="emit('action', 'details')">
        <FileText v-if="disabled" :size="14" /><Pencil v-else :size="14" />
        {{ disabled ? t('查看详情') : checkable ? t('编辑任务') : t('编辑事件') }}
      </button>
      <button
        v-if="checkable"
        type="button"
        role="menuitem"
        :disabled="disabled || completionLocked"
        :title="completionLocked ? t('请先完成任务验收') : undefined"
        @click="emit('action', 'complete')"
      >
        <RotateCcw v-if="completed" :size="14" /><CircleCheck v-else :size="14" />
        {{ completed ? t('标记未完成') : t('标记完成') }}
      </button>
      <div class="menu-divider" role="separator" />
      <button type="button" role="menuitem" :disabled="disabled" @click="emit('action', 'archive')">
        <Archive :size="14" />{{ checkable ? t('归档任务') : t('归档事件') }}
      </button>
    </div>
  </Teleport>
</template>

<style scoped>
.plan-event-context-menu {
  position: fixed;
  z-index: 100;
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
}
</style>
