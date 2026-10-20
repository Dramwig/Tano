<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue';
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist';
import { t } from '../i18n';
const props = defineProps<{ bytes: Uint8Array }>();
const canvas = ref<HTMLCanvasElement>(); const page = ref(1); const pages = ref(0); const error = ref(''); const busy = ref(false);
let document: PDFDocumentProxy | undefined; let rendering: RenderTask | undefined; let generation = 0;
async function render() {
  const current = ++generation;
  rendering?.cancel(); busy.value = true;
  try {
    const pdfPage = await document?.getPage(page.value);
    await nextTick();
    if (!pdfPage || !canvas.value || current !== generation) return;
    const viewport = pdfPage.getViewport({ scale: 1 });
    // Bound both axes, including deliberately oversized pages.
    const scale = Math.min(1.5, 2400 / Math.max(viewport.width, viewport.height));
    const sized = pdfPage.getViewport({ scale });
    canvas.value.width = sized.width; canvas.value.height = sized.height;
    rendering = pdfPage.render({ canvas: canvas.value, viewport: sized });
    await rendering.promise;
  } catch (reason) { if (current === generation && (reason as Error).name !== 'RenderingCancelledException') error.value = String(reason); }
  finally { if (current === generation) busy.value = false; }
}
watch(() => props.bytes, async (bytes, _, onCleanup) => {
  let current = true; let destroy: (() => void) | undefined;
  onCleanup(() => { current = false; generation++; rendering?.cancel(); destroy?.(); });
  page.value = 1; pages.value = 0; error.value = ''; busy.value = true;
  try {
    const pdf = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    if (!current) return;
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdf.getDocument({ data: bytes.slice(), useSystemFonts: true });
    destroy = () => { void task.destroy(); };
    const loaded = await task.promise;
    if (!current) return;
    document = loaded; pages.value = loaded.numPages; await render();
  } catch (reason) { if (current) { error.value = String(reason); busy.value = false; } }
}, { immediate: true });
watch(page, () => { if (document && pages.value) void render(); });
onBeforeUnmount(() => { generation++; rendering?.cancel(); });
</script>
<template>
  <section class="pdf-preview" :aria-label="t('PDF 预览')">
    <nav><button :disabled="busy || page <= 1" @click="page--">{{ t('上一页') }}</button><span>{{ page }} / {{ pages }}</span><button :disabled="busy || page >= pages" @click="page++">{{ t('下一页') }}</button></nav>
    <p v-if="error" role="alert">{{ error }}</p><canvas v-show="pages && !error" ref="canvas" :aria-label="t('PDF 页面')" />
  </section>
</template>
<style scoped>
nav { display: flex; gap: 16px; align-items: center; justify-content: center; margin-bottom: 16px; } button { padding: 6px 12px; } canvas { display: block; max-width: 100%; height: auto; margin: auto; background: white; } p { overflow-wrap: anywhere; }
</style>
