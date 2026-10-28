<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { t } from '../i18n';
import PreviewSkeleton from './PreviewSkeleton.vue';
import DocumentReader from './DocumentReader.vue';
import PdfThumbnail from './PdfThumbnail.vue';
import PdfPage from './PdfPage.vue';
import ReaderPage from './ReaderPage.vue';
const props = defineProps<{ bytes: Uint8Array; controlsTarget?: string }>();
const page = ref(1), error = ref(''), busy = ref(false);
const document = shallowRef<PDFDocumentProxy>();
const sizes = shallowRef<{ width: number; height: number }[]>([]);
const navigation = computed(() => sizes.value.map(() => ''));
const width = computed(() => sizes.value.reduce((max, size) => Math.max(max, size.width), 0));
watch(() => props.bytes, async (bytes, _, onCleanup) => {
  let current = true; let destroy: (() => void) | undefined;
  onCleanup(() => { current = false; destroy?.(); });
  document.value = undefined; page.value = 1; sizes.value = []; error.value = ''; busy.value = true;
  try {
    const pdf = await import('pdfjs-dist');
    const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    if (!current) return;
    pdf.GlobalWorkerOptions.workerSrc = worker.default;
    const task = pdf.getDocument({ data: bytes.slice(), useSystemFonts: true });
    destroy = () => { void task.destroy(); };
    const loaded = await task.promise;
    // Reserve true page sizes before lazy rendering to keep the scroll range stable.
    const dimensions: { width: number; height: number }[] = [];
    for (let index = 1; index <= loaded.numPages; index++) {
      if (!current) return;
      const view = (await loaded.getPage(index)).getViewport({ scale: 1 });
      dimensions.push({ width: view.width, height: view.height });
    }
    if (!current) return;
    document.value = loaded; sizes.value = dimensions;
  } catch (reason) { if (current) error.value = String(reason); }
  finally { if (current) busy.value = false; }
}, { immediate: true });
</script>
<template>
  <section class="pdf-preview" :aria-label="t('PDF 预览')" :aria-busy="busy">
    <PreviewSkeleton v-if="busy && !error" kind="pdf" :controls="!controlsTarget" />
    <p v-if="error" class="pdf-error" role="alert">{{ error }}</p>
    <DocumentReader v-if="document && sizes.length && !error" v-model:page="page" continuous :controls-target="controlsTarget" :count="sizes.length" :width="width" :height="sizes[0].height" :navigation="navigation" format="PDF" :status="t('第 {0} 页，共 {1} 页', [page, sizes.length])">
      <template #thumbnail="{ index }"><PdfThumbnail :key="index" :document="document" :page="index + 1" /></template>
      <template #default="{ scale }">
        <ReaderPage v-for="(size, index) in sizes" :key="index" :page="index + 1" :width="size.width" :height="size.height" :scale="scale">
          <PdfPage :document="document" :page="index + 1" :width="size.width" :height="size.height" :scale="scale" />
        </ReaderPage>
      </template>
    </DocumentReader>
  </section>
</template>
<style scoped>
.pdf-preview { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; }
.pdf-preview > .preview-skeleton { box-sizing: border-box; padding: 24px; overflow: hidden; }
.pdf-error { padding: 24px; color: var(--muted); overflow-wrap: anywhere; font-size: 14px; }
</style>
