<script setup lang="ts">
import { computed, ref, shallowRef, watch } from 'vue';
import { t } from '../i18n';
import { readOffice } from '../office-preview/client';
import { officeLimits, type OfficePreview } from '../office-preview/model';
import LoadingSkeleton from './LoadingSkeleton.vue';
import OfficeBlocks from './OfficeBlocks.vue';

const props = defineProps<{ bytes: Uint8Array; path: string }>();
const result = shallowRef<OfficePreview>();
const error = ref(''), loading = ref(false), retry = ref(0), selectedSheet = ref(0), page = ref(0);
const sheet = computed(() => result.value?.kind === 'spreadsheet' ? result.value.sheets[selectedSheet.value] : undefined);
const pageCount = computed(() => Math.max(1, sheet.value ? Math.ceil(sheet.value.rows.length / 100) : result.value && result.value.kind !== 'spreadsheet' ? result.value.pages.length : 1));
const rows = computed(() => sheet.value?.rows.slice(page.value * 100, (page.value + 1) * 100) ?? []);
const readingPage = computed(() => result.value && result.value.kind !== 'spreadsheet' ? result.value.pages[page.value] : undefined);
function columnLabel(index: number) {
  let label = '';
  for (let value = index + 1; value; value = Math.floor((value - 1) / 26)) label = String.fromCharCode(65 + (value - 1) % 26) + label;
  return label;
}
watch(selectedSheet, () => { page.value = 0; });
watch([() => props.bytes, () => props.path, retry], async (_, __, cleanup) => {
  const controller = new AbortController();
  cleanup(() => controller.abort());
  result.value = undefined; error.value = ''; loading.value = true; page.value = selectedSheet.value = 0;
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
    <LoadingSkeleton v-if="loading" variant="document" :rows="8" />
    <div v-else-if="error" class="office-error" role="alert"><p>{{ error }}</p><button @click="retry++">{{ t('重试') }}</button></div>
    <template v-else-if="result">
      <header class="office-controls">
        <span class="office-readonly">{{ t('只读预览') }}</span>
        <label v-if="result.kind === 'spreadsheet'" class="office-sheet-picker">{{ t('工作表') }}
          <select v-model="selectedSheet" :aria-label="t('工作表')"><option v-for="(item, index) in result.sheets" :key="index" :value="index">{{ item.name }}</option></select>
        </label>
        <nav v-if="pageCount > 1" :aria-label="t('预览翻页')">
          <button :disabled="page <= 0" :aria-label="t('上一页')" @click="page--">{{ t('上一页') }}</button>
          <label><span class="sr-only">{{ t('预览页码') }}</span><select v-model="page" :aria-label="t('预览页码')"><option v-for="index in pageCount" :key="index" :value="index - 1">{{ index }} / {{ pageCount }}</option></select></label>
          <button :disabled="page >= pageCount - 1" :aria-label="t('下一页')" @click="page++">{{ t('下一页') }}</button>
        </nav>
      </header>
      <p class="office-note" role="note">{{ result.kind === 'spreadsheet'
        ? t('显示单元格内容与已保存的公式结果，不执行公式、宏或外部链接。')
        : result.legacy ? t('旧版文件以文字阅读视图呈现，不保留原始排版和图片。')
        : t('阅读视图保留正文、表格与受支持的内嵌图片；复杂排版、图表、动画和部分对象可能不显示。') }}</p>
      <template v-if="sheet">
        <p v-if="sheet.truncated" class="office-note" role="status">{{ t('预览仅显示前 {0} 行、{1} 列，请导出后查看完整工作表。', [officeLimits.rows, officeLimits.columns]) }}</p>
        <p class="office-note">{{ t('第 {0}–{1} 行，共 {2} 行', [page * 100 + 1, Math.min((page + 1) * 100, sheet.rows.length), sheet.rows.length]) }}</p>
        <div class="office-grid-scroll"><table class="office-grid" :aria-label="sheet.name"><thead><tr><th scope="col">#</th><th v-for="column in sheet.columns" :key="column" scope="col">{{ columnLabel(column - 1) }}</th></tr></thead><tbody>
          <tr v-for="(row, index) in rows" :key="page * 100 + index"><th scope="row">{{ page * 100 + index + 1 }}</th><td v-for="(cell, column) in row" :key="column">{{ cell }}</td></tr>
        </tbody></table></div>
      </template>
      <article v-else-if="readingPage" :key="page" class="office-reading" :class="{ 'office-slide': result.kind === 'presentation' }" :aria-label="result.kind === 'presentation' ? t('幻灯片 {0} / {1}', [page + 1, pageCount]) : t('阅读分段 {0} / {1}', [page + 1, pageCount])">
        <p v-if="result.kind === 'presentation'" class="office-page-number">{{ t('幻灯片 {0} / {1}', [page + 1, pageCount]) }}</p>
        <OfficeBlocks v-if="readingPage.blocks.length" :blocks="readingPage.blocks" />
        <p v-else class="office-note" role="status">{{ t('此页没有可提取的文字或受支持的图片，请导出后查看原始内容。') }}</p>
      </article>
    </template>
  </section>
</template>

<style scoped>
.office-preview { min-width: 0; width: 100%; color: var(--text); font-size: 14px; }
.office-controls { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; margin-bottom: 12px; }
.office-readonly { color: var(--muted); font-size: 12px; border: 1px solid var(--line); border-radius: 6px; padding: 4px 8px; }
.office-sheet-picker { display: flex; align-items: center; gap: 8px; min-width: 0; }
nav { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
select, button { border: 1px solid var(--line); border-radius: 6px; padding: 5px 8px; color: var(--text); background: var(--panel, var(--bg)); font: inherit; }
select { max-width: min(240px, 55vw); } button:disabled { opacity: 0.4; }
.office-note { margin: 8px 0 16px; color: var(--muted); font-size: 12px; line-height: 1.7; }
.office-error { color: var(--muted); overflow-wrap: anywhere; }
.office-grid-scroll { max-width: 100%; overflow: auto; }
.office-grid { border-collapse: collapse; font-size: 13px; }
.office-grid th, .office-grid td { min-width: 80px; max-width: 420px; border: 1px solid var(--line); padding: 6px 12px; text-align: left; vertical-align: top; white-space: pre-wrap; overflow-wrap: anywhere; }
.office-grid th { color: var(--muted); background: var(--panel, var(--bg)); font-weight: 500; }
.office-reading { max-width: 900px; margin: 24px auto; padding: clamp(16px, 4vw, 48px); border: 1px solid var(--line); border-radius: 8px; line-height: 1.8; }
.office-slide { min-height: 320px; }
.office-page-number { font-size: 12px; color: var(--muted); margin: 0 0 24px; }
.sr-only { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); }
@media (max-width: 640px) { .office-reading { padding: 16px; margin: 16px 0; } .office-controls { gap: 8px; } }
</style>
