<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import PreviewSkeleton from './PreviewSkeleton.vue';
import { t } from '../i18n';
const props = defineProps<{ document: PDFDocumentProxy; page: number; width: number; height: number; scale: number }>();
const canvas = ref<HTMLCanvasElement>();
const busy = ref(true), error = ref('');
let task: RenderTask | undefined, disposed = false;
onMounted(async () => {
  try {
    const page = await props.document.getPage(props.page);
    if (disposed || !canvas.value) return;
    const viewport = page.getViewport({ scale: Math.min(3, 2400 / Math.max(props.width, props.height)) });
    canvas.value.width = viewport.width; canvas.value.height = viewport.height;
    task = page.render({ canvas: canvas.value, viewport });
    await task.promise;
  } catch (reason) {
    if (!disposed && (reason as Error).name !== 'RenderingCancelledException') error.value = String(reason);
  } finally { if (!disposed) busy.value = false; }
});
onBeforeUnmount(() => { disposed = true; task?.cancel(); });
</script>

<template>
  <div class="pdf-paper" :style="{ width: `${width}px`, height: `${height}px`, zoom: scale }" :aria-busy="busy">
    <PreviewSkeleton v-if="busy" kind="pdf" :controls="false" />
    <p v-if="error" class="pdf-page-error" role="alert">{{ error }}</p>
    <canvas v-show="!busy && !error" ref="canvas" :style="{ width: `${width}px`, height: `${height}px` }" :aria-label="t('第 {0} 页，共 {1} 页', [page, document.numPages])" />
  </div>
</template>

<style scoped>
.pdf-paper { background: #fff; overflow: hidden; }
canvas { display: block; }
.pdf-page-error { padding: 24px; color: #24292f; overflow-wrap: anywhere; }
</style>
