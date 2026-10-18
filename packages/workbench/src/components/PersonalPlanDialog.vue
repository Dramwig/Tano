<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import SidebarPlan from './SidebarPlan.vue';
defineProps<{ date: Date }>();
const emit = defineEmits<{
  close: [];
  'select-date': [date: Date];
  'select-event': [id: string];
}>();
const panel = ref<HTMLElement>();
let previous: HTMLElement | null = null;
onMounted(async () => {
  previous = document.activeElement as HTMLElement;
  await nextTick();
  panel.value?.focus();
});
onUnmounted(() => {
  if (previous?.isConnected) previous.focus();
});
function keyboard(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(panel.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), select:not(:disabled), [tabindex="0"]',
    ) ?? []),
  ];
  if (
    event.shiftKey &&
    (document.activeElement === controls[0] || document.activeElement === panel.value)
  ) {
    event.preventDefault();
    controls.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
    event.preventDefault();
    controls[0]?.focus();
  }
}
</script>
<template>
  <div class="personal-plan-backdrop" @mousedown.self="emit('close')">
    <section
      ref="panel"
      class="personal-plan-dialog"
      role="dialog"
      aria-modal="true"
      :aria-label="t('个人计划')"
      tabindex="-1"
      @keydown="keyboard"
    >
      <header>
        <strong>{{ t('个人计划') }}</strong
        ><button :aria-label="t('关闭个人计划')" @click="emit('close')">{{ t('关闭') }}</button>
      </header>
      <SidebarPlan
        :date="date"
        @select-date="emit('select-date', $event)"
        @select-event="emit('select-event', $event)"
      />
    </section>
  </div>
</template>
<style scoped>
.personal-plan-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: flex;
  justify-content: center;
  align-items: center;
  background: #0005;
  padding: 16px;
}
.personal-plan-dialog {
  display: flex;
  flex-direction: column;
  width: 380px;
  max-width: 100%;
  max-height: 88vh;
  padding: 20px;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  color: var(--text);
}
header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}
header button {
  padding: 4px 8px;
  border-radius: 5px;
}
</style>
