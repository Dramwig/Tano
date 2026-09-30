<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, useId } from 'vue';
import { X } from 'lucide-vue-next';
defineProps<{ title: string; busy?: boolean }>();
const emit = defineEmits<{ close: [] }>();
const dialog = ref<HTMLDialogElement>();
const titleId = useId();
onMounted(() => dialog.value?.showModal());
onBeforeUnmount(() => dialog.value?.close());
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const controls = [
    ...(dialog.value?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled):not([hidden]), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
    ) ?? []),
  ];
  const first = controls[0];
  const last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
</script>

<template>
  <dialog
    ref="dialog"
    class="plugin-dialog"
    :aria-labelledby="titleId"
    @cancel.prevent="!busy && emit('close')"
    @keydown.stop="trapFocus"
  >
    <header class="plugin-dialog-heading">
      <h2 :id="titleId">{{ title }}</h2>
      <button
        type="button"
        autofocus
        aria-label="关闭插件窗口"
        :disabled="busy"
        @click="emit('close')"
      >
        <X :size="19" />
      </button>
    </header>
    <div class="plugin-dialog-body"><slot /></div>
  </dialog>
</template>

<style scoped>
.plugin-dialog {
  width: min(600px, calc(100vw - 32px));
  max-height: calc(100dvh - 48px);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 16px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 24px 80px #101b2433;
}
.plugin-dialog::backdrop {
  background: #101b2466;
}
.plugin-dialog-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid var(--line);
}
.plugin-dialog-heading h2 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}
.plugin-dialog-heading button {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  padding: 0;
  border-radius: 6px;
  color: var(--muted);
}
.plugin-dialog-heading button:hover:not(:disabled) {
  background: var(--hover);
}
.plugin-dialog-body {
  padding: 24px;
}
@media (max-width: 480px) {
  .plugin-dialog-heading {
    padding: 16px;
  }
  .plugin-dialog-body {
    padding: 20px 16px;
  }
}
</style>
