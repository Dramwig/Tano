<script setup lang="ts">
import { t } from '../i18n';
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { X } from 'lucide-vue-next';
import ChangeDiff from './ChangeDiff.vue';
defineProps<{
  title: string;
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}>();
const emit = defineEmits<{ close: [] }>();
const closeButton = ref<HTMLButtonElement>();
const previous = document.activeElement as HTMLElement | null;
onMounted(() => closeButton.value?.focus());
onBeforeUnmount(() => previous?.focus());
function keydown(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    emit('close');
  }
  if (event.key !== 'Tab') return;
  const elements = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('button, [tabindex="0"]'),
  ];
  if (event.shiftKey && document.activeElement === elements[0]) {
    event.preventDefault();
    elements.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
    event.preventDefault();
    elements[0]?.focus();
  }
}
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="emit('close')">
    <section
      class="modal diff-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('文档修改差异')"
      @keydown="keydown"
    >
      <div class="modal-heading">
        <h2>{{ title }}</h2>
        <button ref="closeButton" class="icon-button" :aria-label="t('关闭差异')" @click="emit('close')">
          <X :size="19" />
        </button>
      </div>
      <ChangeDiff
        :before="before"
        :after="after"
        :before-label="beforeLabel"
        :after-label="afterLabel"
      />
    </section>
  </div>
</template>
