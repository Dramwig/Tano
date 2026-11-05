<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, shallowRef, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Printer, X } from 'lucide-vue-next';
import { PRINT_CONTENT, PRINT_LOADED, PRINT_READY, printWindowRequest, type PrintWindowContent } from '../print-window';
import { defaultPrintSettings, printPageCss, printPapers, validPrintRanges } from '../print-settings';
import PdfPreview from './PdfPreview.vue';
import { t } from '../i18n';
import '../styles.css';

const request = printWindowRequest()!;
const title = ref(t('正在准备打印…'));
const error = ref('');
const ready = ref(false);
const nativeSettings = ref(true);
const printers = ref<string[]>([]);
const destination = ref('pdf');
const settings = reactive(defaultPrintSettings());
const customPages = ref(false), more = ref(false), previewBusy = ref(false), printing = ref(false);
const pdf = shallowRef<Uint8Array>();
const fallbackContent = ref('');
const ranges = computed(() => customPages.value ? settings.pageRanges.trim().replaceAll('，', ',') : '');
const rangeError = computed(() => validPrintRanges(ranges.value) ? '' : t('页码范围无效，请填写如 1-5,8,11-13'));
const job = () => ({ ...settings, pageRanges: ranges.value, printer: destination.value === 'pdf' ? '' : destination.value });
const canPrint = computed(() => ready.value && !previewBusy.value && !printing.value && !rangeError.value && settings.copies >= 1 && settings.copies <= 999 && (!nativeSettings.value || !!pdf.value));
const paper = document.createElement('div');
paper.className = 'document-print-root document-export-renderer';
paper.inert = true;
document.body.append(paper);
let unlisten: (() => void) | undefined;
let received = false;
let disposed = false;
const addedStyles: HTMLElement[] = [];
const pageStyle = document.createElement('style');
document.head.append(pageStyle);
let previewTimer: ReturnType<typeof setTimeout> | undefined;
let revision = 0, applied = 0, running = false;
async function close() { await getCurrentWindow().close(); }
function drag(event: MouseEvent) {
  if (event.button === 0 && event.detail === 1) void getCurrentWindow().startDragging();
}
function dragPreviewToolbar(event: MouseEvent) {
  const target = event.target as HTMLElement;
  if (target.closest('.reader-toolbar') && !target.closest('button, select, input, a')) drag(event);
}
async function print() {
  if (!canPrint.value) return;
  error.value = ''; printing.value = true;
  try {
    if (!nativeSettings.value) { window.print(); return; }
    if (destination.value === 'pdf') {
      const { saveDocumentExport } = await import('../native-document-export');
      if (!(await saveDocumentExport(new Blob([pdf.value!.slice().buffer], { type: 'application/pdf' }), `${title.value}.pdf`, 'pdf'))) return;
    } else await invoke('document_print_submit', { settings: job() });
    await close();
  } catch (cause) { error.value = t('打印失败：{0}', [String(cause)]); }
  finally { printing.value = false; }
}
function queuePreview() {
  pageStyle.textContent = printPageCss(settings);
  if (!ready.value || !nativeSettings.value || rangeError.value) return;
  revision++; previewBusy.value = true;
  clearTimeout(previewTimer); previewTimer = setTimeout(() => void renderPreview(), 180);
}
async function renderPreview() {
  if (running || disposed) return;
  running = true;
  try {
    while (applied !== revision && !disposed) {
      const current = revision;
      pageStyle.textContent = printPageCss(settings);
      await nextTick();
      try {
        const content = await invoke<string>('document_print_preview', { settings: { ...job(), copies: 1, printer: '' } });
        if (!disposed && current === revision) {
          pdf.value = Uint8Array.from(atob(content), character => character.charCodeAt(0)); error.value = '';
        }
      } catch (cause) { if (!disposed && current === revision) { pdf.value = undefined; error.value = t('打印失败：{0}', [String(cause)]); } }
      applied = current;
    }
  } finally { running = false; if (!disposed) previewBusy.value = false; }
}
watch(() => [settings.paper, settings.landscape, settings.margins, settings.scale, ranges.value, settings.backgrounds, settings.headers], queuePreview);
watch(destination, value => { if (value === 'pdf') { settings.color = true; settings.copies = 1; } });
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'p') { event.preventDefault(); if (!event.repeat && !event.isComposing && event.keyCode !== 229) void print(); }
  else if (event.key === 'Escape') { event.preventDefault(); void close(); }
}
async function receive(content: PrintWindowContent) {
  if (received) return;
  received = true;
  try {
    title.value = content.title;
    document.title = content.title;
    document.documentElement.lang = content.lang;
    document.documentElement.classList.add('document-printing');
    const links = content.stylesheets.map(href => new Promise<void>((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = href;
      link.onload = () => resolve(); link.onerror = () => reject(new Error(t('无法加载打印样式')));
      document.head.append(link); addedStyles.push(link);
    }));
    for (const css of content.css) {
      const style = document.createElement('style'); style.textContent = css;
      document.head.append(style); addedStyles.push(style);
    }
    paper.innerHTML = content.html;
    fallbackContent.value = content.html;
    await Promise.all(links);
    await Promise.all([...paper.querySelectorAll<HTMLImageElement>('img[src]')].map(image => { image.loading = 'eager'; return image.decode(); }));
    await document.fonts.ready;
    const available = await invoke<{ nativeSettings: boolean; defaultPrinter: string; printers: string[] }>('document_print_printers');
    if (disposed) return;
    nativeSettings.value = available.nativeSettings; printers.value = available.printers;
    destination.value = available.defaultPrinter || 'pdf';
    ready.value = true;
    await emitTo(request.opener, PRINT_LOADED, { label: request.label });
    queuePreview();
  } catch (cause) {
    error.value = t('打印失败：{0}', [String(cause)]);
    await emitTo(request.opener, PRINT_LOADED, { label: request.label, error: error.value });
  }
}
onMounted(async () => {
  window.addEventListener('keydown', keydown);
  unlisten = await listen<PrintWindowContent>(PRINT_CONTENT, event => { void receive(event.payload); });
  if (disposed) { unlisten(); return; }
  await emitTo(request.opener, PRINT_READY, { label: request.label });
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(previewTimer);
  unlisten?.(); window.removeEventListener('keydown', keydown);
  pageStyle.remove(); document.documentElement.classList.remove('document-printing');
  paper.remove(); addedStyles.forEach(style => style.remove());
});
</script>

<template>
  <section class="document-print-panel" role="dialog" aria-labelledby="document-print-heading">
    <div class="document-print-drag" aria-hidden="true" @mousedown="drag" />
    <button class="document-print-close" type="button" :aria-label="t('关闭')" @click="close"><X :size="18" /></button>
    <aside class="document-print-options" :aria-label="t('打印设置')">
      <header><h1 id="document-print-heading"><Printer :size="19" />{{ t('打印') }}</h1><p :title="title">{{ title }}</p></header>
      <div class="document-print-options-scroll panel-scrollbar" :inert="printing">
        <label v-if="nativeSettings" class="document-print-field"><span>{{ t('打印机') }}</span><select v-model="destination" :disabled="!ready || printing"><option value="pdf">{{ t('另存为 PDF') }}</option><option v-for="printer in printers" :key="printer" :value="printer">{{ printer }}</option></select></label>
        <label class="document-print-field"><span>{{ t('份数') }}</span><input v-model.number="settings.copies" type="number" min="1" max="999" :disabled="destination === 'pdf' || printing" /></label>
        <fieldset class="document-print-field"><legend>{{ t('布局') }}</legend><div class="document-print-choice"><label><input v-model="settings.landscape" type="radio" :value="false" />{{ t('纵向') }}</label><label><input v-model="settings.landscape" type="radio" :value="true" />{{ t('横向') }}</label></div></fieldset>
        <label class="document-print-field"><span>{{ t('纸张') }}</span><select v-model="settings.paper"><option v-for="paper in printPapers" :key="paper.id" :value="paper.id">{{ paper.label }}</option></select></label>
        <fieldset class="document-print-field"><legend>{{ t('页面') }}</legend><div class="document-print-choice"><label><input v-model="customPages" type="radio" :value="false" />{{ t('全部') }}</label><label><input v-model="customPages" type="radio" :value="true" />{{ t('指定页码') }}</label></div><input v-if="customPages" v-model="settings.pageRanges" :aria-label="t('页码范围')" placeholder="1-5,8,11-13" :aria-invalid="!!rangeError" /><small v-if="rangeError" role="alert">{{ rangeError }}</small></fieldset>
        <label class="document-print-field"><span>{{ t('颜色') }}</span><select v-model="settings.color" :disabled="destination === 'pdf'"><option :value="true">{{ t('彩色') }}</option><option :value="false">{{ t('黑白') }}</option></select></label>
        <label v-if="destination !== 'pdf'" class="document-print-field"><span>{{ t('双面打印') }}</span><select v-model="settings.duplex"><option value="simplex">{{ t('单面') }}</option><option value="long">{{ t('双面 · 长边翻转') }}</option><option value="short">{{ t('双面 · 短边翻转') }}</option></select></label>
        <button class="document-print-more" type="button" :aria-expanded="more" @click="more = !more">{{ t('更多设置') }}<span>{{ more ? '−' : '+' }}</span></button>
        <template v-if="more"><label class="document-print-field"><span>{{ t('边距') }}</span><select v-model.number="settings.margins"><option :value="16">{{ t('默认') }} · 16 mm</option><option :value="10">{{ t('窄') }} · 10 mm</option><option :value="0">{{ t('无') }}</option></select></label><label class="document-print-field"><span>{{ t('缩放') }}</span><select v-model.number="settings.scale"><option :value="0.5">50%</option><option :value="0.75">75%</option><option :value="1">100%</option><option :value="1.25">125%</option><option :value="1.5">150%</option><option :value="2">200%</option></select></label><label class="document-print-check"><input v-model="settings.backgrounds" type="checkbox" />{{ t('打印背景') }}</label><label class="document-print-check"><input v-model="settings.headers" type="checkbox" />{{ t('页眉和页脚') }}</label></template>
      </div>
      <footer><button class="document-print-submit" type="button" :disabled="!canPrint" @click="print">{{ printing ? t('正在打印…') : destination === 'pdf' && nativeSettings ? t('保存 PDF') : t('打印') }}</button><button class="document-print-cancel" type="button" @click="close">{{ t('取消') }}</button></footer>
    </aside>
    <main class="document-print-preview" :aria-label="t('打印预览')" :aria-busy="previewBusy" @mousedown="dragPreviewToolbar"><span v-if="previewBusy && pdf" class="document-print-preview-status" role="status">{{ t('正在生成预览…') }}</span><p v-if="error" class="document-print-error" role="alert">{{ error }}</p><PdfPreview v-if="pdf" :bytes="pdf" :class="{ 'document-print-grayscale': !settings.color }" /><div v-else-if="ready && !nativeSettings" class="document-print-fallback" inert v-html="fallbackContent" /><div v-else-if="!error" class="document-print-preview-empty" role="status">{{ ready ? t('正在生成预览…') : t('正在准备打印…') }}</div></main>
  </section>
</template>

<style>
.document-print-panel { position: fixed; inset: 0; display: flex; width: 100%; height: 100dvh; min-height: 0; margin: 0; padding: 0; border: 0; border-radius: 0; box-shadow: none; overflow: hidden; background: var(--paper); color: var(--text); font: 13px/1.5 var(--font-ui); }
.document-print-drag { position: absolute; top: 0; left: 0; z-index: 2; width: 264px; height: 24px; cursor: grab; user-select: none; }
.document-print-close { position: absolute; top: 6px; right: 8px; z-index: 3; display: grid; place-items: center; width: 30px; height: 30px; border-radius: 6px; color: var(--muted); }
.document-print-close:hover { background: var(--hover); color: var(--text); }
.document-print-close:focus-visible { outline: 2px solid var(--green); outline-offset: -2px; }
.document-print-options { flex: 0 0 264px; display: flex; flex-direction: column; min-height: 0; border-right: 1px solid var(--line); }
.document-print-options > header { padding: 30px 24px 20px; }
.document-print-options h1 { display: flex; align-items: center; gap: 9px; margin: 0; font-size: 18px; font-weight: 600; }
.document-print-options header p { margin: 8px 0 0; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; color: var(--muted); font-size: 12px; }
.document-print-options-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 24px 20px; }
.document-print-field { display: flex; flex-direction: column; gap: 8px; margin: 0 0 19px; padding: 0; border: 0; min-width: 0; }
.document-print-field > span, .document-print-field legend { color: var(--text-secondary); font-size: 12px; padding: 0 0 7px; }
.document-print-field > span { padding: 0; }
.document-print-field select, .document-print-field input:not([type=radio]) { width: 100%; min-width: 0; height: 34px; padding: 6px 9px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--text); font: inherit; }
.document-print-field input[type=number] { width: 90px; }
.document-print-field :is(select,input):focus-visible { outline: 2px solid var(--green); outline-offset: 1px; }
.document-print-choice { display: flex; gap: 20px; }
.document-print-choice label, .document-print-check { display: flex; align-items: center; gap: 7px; }
.document-print-choice input, .document-print-check input { margin: 0; accent-color: var(--green); }
.document-print-check { margin: 12px 0; }
.document-print-field small { color: var(--danger); }
.document-print-more { display: flex; justify-content: space-between; width: 100%; margin: 0 0 16px; padding: 0; color: var(--text-secondary); font-size: 12px; }
.document-print-options footer { display: flex; gap: 8px; padding: 16px 24px 20px; border-top: 1px solid var(--line); }
.document-print-options footer button { flex: 1; height: 34px; border: 1px solid var(--line); border-radius: 6px; font: inherit; }
.document-print-options footer .document-print-submit { border-color: var(--green-fill); background: var(--green-fill); color: #fff; }
.document-print-options footer .document-print-submit:hover:not(:disabled) { background: var(--green-fill-hover); }
.document-print-cancel:hover { background: var(--hover); }
.document-print-preview { position: relative; display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; }
.document-print-panel .document-print-preview .reader-toolbar { padding-right: 48px; }
.document-print-preview-status { position: absolute; top: 50px; right: 16px; z-index: 2; padding: 6px 10px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); color: var(--muted); font-size: 12px; pointer-events: none; }
.document-print-preview-empty { display: grid; flex: 1; place-items: center; color: var(--muted); }
.document-print-error { margin: 16px 24px; color: var(--danger); overflow-wrap: anywhere; }
.document-print-grayscale .reader-content { filter: grayscale(1); }
.document-print-fallback { flex: 1; min-height: 0; overflow: auto; padding: 24px; background: var(--sidebar); }
.document-print-fallback .document-export-content { max-width: 100%; margin: auto; }
@media (max-width: 760px) { .document-print-options { flex-basis: 230px; } .document-print-drag { width: 230px; } .document-print-options > header, .document-print-options-scroll { padding-inline: 18px; } .document-print-options footer { padding-inline: 18px; } }
</style>
