<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { ArrowDownToLine, ChevronRight, Code2, FileText, Image, FileType } from 'lucide-vue-next';
import type { DocumentExportFormat } from '../document-export';

defineProps<{ disabled?: boolean }>();
const emit = defineEmits<{ select: [format: DocumentExportFormat] }>();
const panelId = useId();
const trigger = ref<HTMLButtonElement>();
const panel = ref<HTMLElement>();
const open = ref(false);
const position = ref({ left: '0px', top: '0px' });
const formats = [
  { id: 'markdown', label: 'Markdown', icon: FileText },
  { id: 'pdf', label: 'PDF', icon: FileType },
  { id: 'html', label: 'HTML', icon: Code2 },
  { id: 'png', label: '图片', icon: Image },
] as const;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function cancelClose() { clearTimeout(closeTimer); }
function close() { cancelClose(); open.value = false; }
function scheduleClose() { cancelClose(); closeTimer = setTimeout(close, 180); }
async function show(focus = false) {
  cancelClose();
  open.value = true;
  await nextTick();
  const anchor = trigger.value?.closest('.document-dropdown')?.getBoundingClientRect();
  const row = trigger.value?.getBoundingClientRect();
  if (!anchor || !row || !panel.value) return;
  const { width, height } = panel.value.getBoundingClientRect();
  const gap = 4, overlap = 4, edge = 8;
  let left = anchor.right + gap, top = row.top - 5;
  if (left + width > window.innerWidth - edge) {
    left = anchor.left - width + overlap;
    if (left < edge) {
      left = anchor.right - width;
      top = row.bottom + gap;
    }
  }
  position.value = {
    left: `${Math.max(edge, Math.min(left, window.innerWidth - width - edge))}px`,
    top: `${Math.max(edge, Math.min(top, window.innerHeight - height - edge))}px`,
  };
  if (focus) panel.value.focus({ preventScroll: true });
}
function triggerKeydown(event: KeyboardEvent) {
  if (!['ArrowRight', 'Enter', ' '].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  void show(true);
}
function panelKeydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (['Escape', 'ArrowLeft'].includes(event.key)) {
    event.preventDefault();
    close();
    trigger.value?.focus();
  } else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const items = [...panel.value!.querySelectorAll<HTMLButtonElement>('button')];
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1
      : current < 0 ? (event.key === 'ArrowDown' ? 0 : items.length - 1)
      : (current + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index]?.focus();
  } else if (event.key === 'Tab') close();
}
function select(format: DocumentExportFormat) { close(); emit('select', format); }
function outside(event: PointerEvent) {
  if (!panel.value?.contains(event.target as Node) && !trigger.value?.contains(event.target as Node)) close();
}
onMounted(() => {
  window.addEventListener('pointerdown', outside);
  window.addEventListener('resize', close);
});
onBeforeUnmount(() => {
  cancelClose();
  window.removeEventListener('pointerdown', outside);
  window.removeEventListener('resize', close);
});
</script>

<template>
  <button ref="trigger" type="button" class="document-export-trigger" :disabled="disabled"
    :title="disabled ? '正在导出' : '导出文档'" :aria-busy="disabled"
    aria-haspopup="menu" :aria-expanded="open" :aria-controls="open ? panelId : undefined"
    @pointerenter="!disabled && show()" @pointerleave="scheduleClose"
    @click="show(true)" @keydown="triggerKeydown">
    <ArrowDownToLine :size="15" />导出<ChevronRight class="document-export-chevron" :size="14" />
  </button>
  <Teleport to="body">
    <div v-if="open" :id="panelId" ref="panel" class="dropdown compact-action-menu document-export-menu"
      :style="position" role="menu" aria-label="导出格式" tabindex="-1"
      @pointerenter="cancelClose" @pointerleave="scheduleClose" @keydown="panelKeydown">
      <button v-for="format in formats" :key="format.id" type="button" role="menuitem"
        @click="select(format.id)"><component :is="format.icon" :size="15" />{{ format.label }}</button>
    </div>
  </Teleport>
</template>
