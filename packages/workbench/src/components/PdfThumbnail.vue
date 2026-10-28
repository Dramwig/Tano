<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
const props = defineProps<{ document: PDFDocumentProxy; page: number }>();
const canvas = ref<HTMLCanvasElement>();
let observer: IntersectionObserver | undefined, task: RenderTask | undefined, disposed = false;
async function draw() {
  observer?.disconnect();
  try {
    const page = await props.document.getPage(props.page);
    if (disposed || !canvas.value) return;
    const natural = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 120 / Math.max(natural.width, natural.height) });
    canvas.value.width = viewport.width; canvas.value.height = viewport.height;
    task = page.render({ canvas: canvas.value, viewport });
    await task.promise;
  } catch { /* Navigation remains available if a thumbnail cannot render. */ }
}
onMounted(() => {
  if (typeof IntersectionObserver === 'undefined') return;
  observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) void draw(); });
  if (canvas.value) observer.observe(canvas.value);
});
onBeforeUnmount(() => { disposed = true; observer?.disconnect(); task?.cancel(); });
</script>
<template><canvas ref="canvas" class="pdf-thumbnail" aria-hidden="true" /></template>
<style scoped>.pdf-thumbnail { width: 40px; max-height: 58px; object-fit: contain; background: white; box-shadow: 0 1px 3px #0002; flex-shrink: 0; }</style>
