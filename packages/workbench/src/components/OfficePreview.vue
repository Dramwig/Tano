<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { t } from '../i18n';
import { readOffice } from '../office-preview/client';
import { type OfficePreview } from '../office-preview/model';
import PreviewSkeleton from './PreviewSkeleton.vue';
import OfficeBlocks from './OfficeBlocks.vue';
import DocumentReader from './DocumentReader.vue';
import WordPages from './WordPages.vue';
import ReaderPage from './ReaderPage.vue';
import SpreadsheetEditor from './SpreadsheetEditor.vue';
import type { AttachmentStatusUpdate } from '../attachment-status';

const props = defineProps<{ bytes: Uint8Array; path: string; controlsTarget?: string; controls?: boolean; draftKey?: string; statusManaged?: boolean; save?: (bytes: Uint8Array, expected: string) => Promise<string>; readLatest?: () => Promise<Uint8Array> }>();
const emit = defineEmits<{ status: [update: AttachmentStatusUpdate] }>();
const result = shallowRef<OfficePreview>();
const error = ref(''), loading = ref(false), retry = ref(0), page = ref(0);
const wordPageCount = ref(1);
const wordBlocks = computed(() => result.value?.kind === 'document' ? result.value.pages.flatMap(item => item.blocks) : []);
function updateWordPages(count: number) { wordPageCount.value = count; page.value = Math.min(page.value, count - 1); }
const pageCount = computed(() => Math.max(1, result.value?.kind === 'document' ? wordPageCount.value : result.value?.kind === 'presentation' ? result.value.pages.length : 1));
const navigation = computed(() => result.value?.kind === 'document' ? Array.from({ length: wordPageCount.value }, () => '') : result.value?.kind === 'presentation' ? result.value.pages.map(item => item.blocks.find(block => block.kind === 'paragraph')?.runs.map(run => run.text).join('').slice(0, 80) || item.name) : undefined);
const note = computed(() => result.value && result.value.kind !== 'spreadsheet' && result.value.legacy ? t('旧版文件以文字阅读视图呈现，不保留原始排版和图片。')
  : t('阅读视图保留正文、表格与受支持的内嵌图片；复杂排版、图表、动画和部分对象可能不显示。'));
const status = computed(() => result.value?.kind === 'presentation' ? t('幻灯片 {0} / {1}', [page.value + 1, pageCount.value]) : t('第 {0} 页，共 {1} 页', [page.value + 1, pageCount.value]));
watch([() => props.bytes, () => props.path, retry], async (_, __, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  result.value = undefined; error.value = ''; loading.value = true; page.value = 0; wordPageCount.value = 1;
  try {
    const parsed = await readOffice(props.bytes, props.path, controller.signal);
    if (!controller.signal.aborted) result.value = parsed;
  } catch (reason) {
    if (!controller.signal.aborted) error.value = reason instanceof Error ? t(reason.message) : t('无法读取附件');
  } finally { if (!controller.signal.aborted) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <section class="office-preview" :aria-label="t(save ? 'Office 附件' : 'Office 只读预览')" :aria-busy="loading">
    <PreviewSkeleton v-if="loading" :path="path" :controls="!controlsTarget" />
    <div v-else-if="error" class="office-error" role="alert"><p>{{ error }}</p><button @click="retry++">{{ t('重试') }}</button></div>
    <SpreadsheetEditor v-else-if="result?.kind === 'spreadsheet'" :bytes="bytes" :path="path" :sheets="result.sheets" :controls-target="controlsTarget" :draft-key="draftKey" :save="save" :read-latest="readLatest" :status-managed="statusManaged" @status="emit('status', $event)" />
    <DocumentReader v-else-if="result" :key="path" :page="page + 1" :count="pageCount"
      :controls-target="controlsTarget"
      continuous :landscape="result.kind === 'presentation'"
      :width="result.kind === 'presentation' ? 960 : 794" :height="result.kind === 'presentation' ? 540 : 1123"
      :navigation="navigation" :navigation-label="result.kind === 'presentation' ? '幻灯片' : '页面'"
      :format="path.split('.').at(-1)?.toUpperCase()" :note="note" :status="status" @update:page="page = $event - 1">
      <template #default="{ scale, contentWidth }">
        <template v-if="result.kind === 'document'">
          <ReaderPage v-for="index in wordPageCount" :key="index" :page="index" :width="794" :height="1123" :scale="scale" :keep-mounted="index === 1">
            <WordPages :blocks="wordBlocks" :page="index" :scale="scale" :label="t('第 {0} 页，共 {1} 页', [index, wordPageCount])" @pages="updateWordPages" />
          </ReaderPage>
        </template>
        <template v-else-if="result.kind === 'presentation'">
          <article v-for="(slide, index) in result.pages" :key="index" :data-reader-page="index + 1" class="office-reading office-slide" :style="{ zoom: scale, width: `${contentWidth}px` }" :aria-label="t('幻灯片 {0} / {1}', [index + 1, pageCount])">
            <OfficeBlocks v-if="slide.blocks.length" :blocks="slide.blocks" />
            <p v-else class="office-empty" role="status">{{ t('此页没有可提取的文字或受支持的图片，请导出后查看原始内容。') }}</p>
          </article>
        </template>
      </template>
    </DocumentReader>
  </section>
</template>

<style scoped>
.office-preview { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; overflow: hidden; color: var(--text); font-size: 14px; }
.office-preview > .preview-skeleton { box-sizing: border-box; padding: 24px; overflow: hidden; }
.office-error { padding: 24px; color: var(--muted); overflow-wrap: anywhere; }
.office-error button { font: inherit; border: 1px solid var(--line); padding: 6px 12px; border-radius: 4px; color: var(--text); background: var(--paper); }
.office-preview :deep(.office-reading) { box-sizing: border-box; width: 794px; min-height: 1123px; margin: 0 auto; padding: 64px 64px 80px; color: #24292f; background: #fff; font: 16px/1.85 var(--font-ui, sans-serif); --line: #d9dde3; }
.office-reading :deep(h1) { font-size: 30px; line-height: 1.35; margin-bottom: 28px; }
.office-reading :deep(h2) { font-size: 24px; } .office-reading :deep(h3) { font-size: 20px; }
.office-reading :deep(.office-document-table) { font-size: inherit; }
.office-reading :deep(.office-document-table tr:first-child) { background: #f1f3f6; }
.office-preview .office-slide { width: 960px; min-height: 540px; margin: 0 auto; padding: 54px 64px; font-size: 22px; line-height: 1.7; box-shadow: 0 1px 4px #0002, 0 6px 20px #0001; }
.office-slide :deep(.office-paragraph:first-child) { font-size: 32px; font-weight: 650; line-height: 1.4; margin-bottom: 32px; }
.office-empty { color: #737b86; font-size: 14px; }
</style>
