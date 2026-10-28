<script setup lang="ts">
import { computed, nextTick, ref, shallowRef, watch } from 'vue';
import { t } from '../i18n';
import { readOffice } from '../office-preview/client';
import { officeLimits, type OfficePreview } from '../office-preview/model';
import PreviewSkeleton from './PreviewSkeleton.vue';
import OfficeBlocks from './OfficeBlocks.vue';
import DocumentReader from './DocumentReader.vue';
import WordPages from './WordPages.vue';
import ReaderPage from './ReaderPage.vue';

const props = defineProps<{ bytes: Uint8Array; path: string; controlsTarget?: string; controls?: boolean }>();
const result = shallowRef<OfficePreview>();
const sheetTabs = ref<HTMLElement>();
async function focusSheet(index: number) {
  selectedSheet.value = index;
  await nextTick();
  sheetTabs.value?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
}
const error = ref(''), loading = ref(false), retry = ref(0), selectedSheet = ref(0), page = ref(0);
const wordPageCount = ref(1);
const wordBlocks = computed(() => result.value?.kind === 'document' ? result.value.pages.flatMap(item => item.blocks) : []);
function updateWordPages(count: number) { wordPageCount.value = count; page.value = Math.min(page.value, count - 1); }
const sheet = computed(() => result.value?.kind === 'spreadsheet' ? result.value.sheets[selectedSheet.value] : undefined);
const pageCount = computed(() => Math.max(1, sheet.value ? Math.ceil(sheet.value.rows.length / 100) : result.value?.kind === 'document' ? wordPageCount.value : result.value?.kind === 'presentation' ? result.value.pages.length : 1));
const rows = computed(() => sheet.value?.rows.slice(page.value * 100, (page.value + 1) * 100) ?? []);
const navigation = computed(() => result.value?.kind === 'document' ? Array.from({ length: wordPageCount.value }, () => '') : result.value?.kind === 'presentation' ? result.value.pages.map(item => item.blocks.find(block => block.kind === 'paragraph')?.runs.map(run => run.text).join('').slice(0, 80) || item.name) : undefined);
const note = computed(() => result.value?.kind === 'spreadsheet'
  ? t('显示单元格内容与已保存的公式结果，不执行公式、宏或外部链接。')
  : result.value?.legacy ? t('旧版文件以文字阅读视图呈现，不保留原始排版和图片。')
  : t('阅读视图保留正文、表格与受支持的内嵌图片；复杂排版、图表、动画和部分对象可能不显示。'));
const status = computed(() => sheet.value ? t('第 {0}–{1} 行，共 {2} 行', [sheet.value.rows.length ? page.value * 100 + 1 : 0, Math.min((page.value + 1) * 100, sheet.value.rows.length), sheet.value.rows.length])
  : result.value?.kind === 'presentation' ? t('幻灯片 {0} / {1}', [page.value + 1, pageCount.value]) : t('第 {0} 页，共 {1} 页', [page.value + 1, pageCount.value]));
function columnLabel(index: number) {
  let label = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return label;
}
watch(selectedSheet, () => { page.value = 0; });
watch([() => props.bytes, () => props.path, retry], async (_, __, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  result.value = undefined; error.value = ''; loading.value = true; page.value = selectedSheet.value = 0; wordPageCount.value = 1;
  try {
    const parsed = await readOffice(props.bytes, props.path, controller.signal);
    if (!controller.signal.aborted) result.value = parsed;
  } catch (reason) {
    if (!controller.signal.aborted) error.value = reason instanceof Error ? t(reason.message) : t('无法读取附件');
  } finally { if (!controller.signal.aborted) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <section class="office-preview" :aria-label="t('Office 只读预览')" :aria-busy="loading">
    <PreviewSkeleton v-if="loading" :path="path" :controls="!controlsTarget" />
    <div v-else-if="error" class="office-error" role="alert"><p>{{ error }}</p><button @click="retry++">{{ t('重试') }}</button></div>
    <DocumentReader v-else-if="result" :key="path" :page="page + 1" :count="pageCount" :grid="result.kind === 'spreadsheet'"
      :controls-target="controlsTarget"
      :continuous="result.kind !== 'spreadsheet'" :landscape="result.kind === 'presentation'" :reset-key="selectedSheet"
      :width="result.kind === 'presentation' ? 960 : 794" :height="result.kind === 'presentation' ? 540 : 1123"
      :navigation="navigation" :navigation-label="result.kind === 'presentation' ? '幻灯片' : '页面'"
      :format="path.split('.').at(-1)?.toUpperCase()" :note="note" :status="status" @update:page="page = $event - 1">
      <template #default="{ scale, contentWidth }">
        <template v-if="sheet">
          <p v-if="sheet.truncated" class="office-truncated" role="status">{{ t('预览仅显示前 {0} 行、{1} 列，请导出后查看完整工作表。', [officeLimits.rows, officeLimits.columns]) }}</p>
          <table class="office-grid" :style="{ zoom: scale }" :aria-label="sheet.name"><thead><tr><th scope="col" class="office-corner"></th><th v-for="column in sheet.columns" :key="column" scope="col">{{ columnLabel(column - 1) }}</th></tr></thead><tbody>
            <tr v-for="(row, index) in rows" :key="page * 100 + index"><th scope="row">{{ page * 100 + index + 1 }}</th><td v-for="(cell, column) in row" :key="column">{{ cell }}</td></tr>
          </tbody></table>
        </template>
        <template v-else-if="result.kind === 'document'">
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
      <template v-if="result.kind === 'spreadsheet'" #tabs>
        <label class="office-sheet-list"><select v-model="selectedSheet" :aria-label="t('工作表')"><option v-for="(item, index) in result.sheets" :key="index" :value="index">{{ item.name }}</option></select></label>
        <div ref="sheetTabs" class="office-sheet-tabs" role="tablist" :aria-label="t('工作表')">
          <button v-for="(item, index) in result.sheets" :key="index" role="tab" :tabindex="selectedSheet === index ? 0 : -1" :aria-selected="selectedSheet === index" @click="selectedSheet = index" @keydown.right.prevent="focusSheet((index + 1) % result.sheets.length)" @keydown.left.prevent="focusSheet((index + result.sheets.length - 1) % result.sheets.length)">{{ item.name }}</button>
        </div>
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
.office-truncated { padding: 10px 16px; margin: 0; font-size: 12px; color: var(--muted); white-space: normal; max-width: 700px; }
.office-grid { border-collapse: separate; border-spacing: 0; font: 13px/1.55 var(--font-ui, sans-serif); width: 100%; }
.office-grid th, .office-grid td { min-width: 140px; max-width: 420px; border: 0; border-right: 1px solid var(--line); border-bottom: 1px solid var(--line); padding: 5px 12px; text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
.office-grid th { color: var(--muted); background: var(--surface); font-weight: 400; text-align: center; font-size: 11px; user-select: none; }
.office-grid thead th { position: sticky; top: 0; z-index: 1; }
.office-grid tbody th, .office-grid .office-corner { position: sticky; left: 0; min-width: 44px; width: 44px; padding: 5px 8px; box-sizing: border-box; }
.office-grid .office-corner { z-index: 2; }
.office-grid tr:hover td { background: color-mix(in srgb, var(--green) 5%, var(--paper)); }
.office-sheet-list { display: flex; align-items: center; padding: 0 8px; border-right: 1px solid var(--line); }
.office-sheet-list select { max-width: 120px; font: 12px var(--font-ui, sans-serif); color: var(--muted); border: 0; background: transparent; }
.office-sheet-tabs { display: flex; }
.office-sheet-tabs button { flex-shrink: 0; padding: 7px 18px; border: 0; border-right: 1px solid var(--line); border-bottom: 2px solid transparent; background: transparent; color: var(--muted); font: 12px var(--font-ui, sans-serif); cursor: pointer; }
.office-sheet-tabs button[aria-selected=true] { color: var(--green); background: var(--paper); border-bottom-color: var(--green); }
.office-sheet-tabs button:hover { background: var(--hover); }
.office-sheet-tabs button:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
</style>
