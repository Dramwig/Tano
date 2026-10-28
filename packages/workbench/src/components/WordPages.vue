<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { OfficeBlock } from '../office-preview/model';
import OfficeBlocks from './OfficeBlocks.vue';
import { t } from '../i18n';

const props = defineProps<{ blocks: OfficeBlock[]; page: number; scale: number; label: string }>();
const emit = defineEmits<{ pages: [count: number] }>();
const flow = ref<HTMLElement>();
let observer: ResizeObserver | undefined;
let frame = 0;
let disposed = false;
function measure() {
  if (disposed || props.page !== 1) return;
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    // A column is the printable width (666px) plus the two page margins (128px).
    if (flow.value) emit('pages', Math.max(1, Math.ceil((flow.value.scrollWidth + 128) / 794)));
  });
}
function observeContent() {
  observer?.disconnect();
  if (flow.value) {
    observer?.observe(flow.value);
    for (const child of flow.value.children) observer?.observe(child);
  }
  measure();
}
watch(() => props.blocks, async () => { await nextTick(); if (!disposed) observeContent(); });
onMounted(() => {
  if (props.page !== 1) return;
  // Image and font metrics can change the number of columns after initial layout.
  if (typeof ResizeObserver !== 'undefined') observer = new ResizeObserver(measure);
  observeContent();
  document.fonts?.ready.then(measure);
});
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); cancelAnimationFrame(frame); });
</script>

<template>
  <article class="office-reading office-word-page" :style="{ zoom: scale }" :aria-label="label">
    <div class="office-word-window">
      <div ref="flow" class="office-word-flow" :style="{ transform: `translateX(-${(page - 1) * 794}px)` }" @load.capture="measure" @error.capture="measure">
        <OfficeBlocks v-if="blocks.length" :blocks="blocks" image-loading="eager" />
        <p v-else class="office-empty" role="status">{{ t('此页没有可提取的文字或受支持的图片，请导出后查看原始内容。') }}</p>
      </div>
    </div>
  </article>
</template>

<style scoped>
.office-word-page { width: 794px; height: 1123px; min-height: 0; overflow: hidden; }
.office-word-window { width: 666px; height: 979px; overflow: hidden; }
.office-word-flow { width: 666px; height: 979px; columns: 666px; column-gap: 128px; column-fill: auto; }
.office-word-flow :deep(h1), .office-word-flow :deep(h2), .office-word-flow :deep(h3) { break-after: avoid; }
.office-word-flow :deep(p) { orphans: 2; widows: 2; }
.office-word-flow :deep(.office-table-scroll) { overflow: visible; }
.office-word-flow :deep(.office-document-table) { table-layout: fixed; }
.office-word-flow :deep(td) { min-width: 0; overflow-wrap: anywhere; }
.office-word-flow :deep(.office-image) { max-height: 947px; break-inside: avoid; }
</style>
