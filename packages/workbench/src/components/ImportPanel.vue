<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId } from 'vue';
import { ArrowDownToLine, ArrowUpFromLine, Check, CheckCircle2, ChevronRight, CircleAlert, Code2, FileArchive, FileText,
  FileType, Folder, Globe2, Layers, ListTodo, LoaderCircle, NotebookPen, Search, Table2, UploadCloud, X } from 'lucide-vue-next';
import WordFileIcon from './WordFileIcon.vue';
import { importAccept, prepareImport } from '../document-import';
import type { PreparedImport, ImportIssue } from '../document-import';
import type { ImportReceipt } from '../workspace-import';
import type { AttachmentService } from '../attachments';
import { useWorkspaceStore } from '../stores/workspace';

export interface ImportRecord extends ImportReceipt { id: string; time: number; workspaceId: string; sourceCount: number }
const props = defineProps<{ attachments?: AttachmentService; records: ImportRecord[] }>();
const emit = defineEmits<{ close: []; completed: [record: ImportRecord] }>();
const store = useWorkspaceStore();
const workspaceId = store.workspace!.id;
const titleId = useId();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const searchInput = ref<HTMLInputElement>();
const originalFocus = document.activeElement as HTMLElement | null;
const query = ref('');
const dragActive = ref(false);
const accept = ref(importAccept);
const sourceLabel = ref('');
const files = shallowRef<File[]>([]);
const prepared = shallowRef<PreparedImport>();
const processing = ref(false);
const saving = ref(false);
const progressName = ref('');
const progressCount = ref(0);
const folderName = ref('导入');
const error = ref('');
let generation = 0;
let backdropPress = false;
const busy = computed(() => processing.value || saving.value);
const records = computed(() => props.records.filter(record => record.workspaceId === workspaceId));
const latestRecord = computed(() => records.value[0]);
const issues = computed(() => prepared.value?.issues ?? []);
const formats = [
  { name: '文本与 Markdown', detail: 'MD · Markdown · TXT · LOG', accept: '.md,.markdown,.txt,.log', icon: FileText, tone: 'green' },
  { name: 'CSV 与 TSV', detail: 'CSV · TSV', accept: '.csv,.tsv', icon: Table2, tone: 'green' },
  { name: 'PDF', detail: 'PDF 文本提取', accept: '.pdf', icon: FileType, tone: 'red' },
  { name: 'HTML', detail: 'HTML · HTM', accept: '.html,.htm', icon: Code2, tone: 'amber' },
  { name: 'Word', detail: 'DOCX', accept: '.docx', icon: WordFileIcon, tone: 'blue' },
  { name: 'EPUB', detail: 'EPUB 电子书', accept: '.epub', icon: NotebookPen, tone: 'amber' },
  { name: 'ZIP', detail: '文档、目录与附件', accept: '.zip', icon: FileArchive, tone: 'gray' },
  { name: 'Evernote 文件', detail: 'ENEX', accept: '.enex', icon: NotebookPen, tone: 'green' },
  { name: 'JSON', detail: 'Trello · Roam Research 导出', accept: '.json', icon: Code2, tone: 'gray' },
];
const providers = [
  { name: 'Notion', detail: 'Markdown / CSV / HTML · ZIP', accept: '.zip,.md,.markdown,.csv,.html', icon: FileText, tone: 'gray' },
  { name: 'Obsidian', detail: 'Markdown · Vault ZIP', accept: '.zip,.md,.markdown', icon: Layers, tone: 'violet' },
  { name: 'Confluence', detail: 'HTML · ZIP', accept: '.zip,.html,.htm', icon: Globe2, tone: 'blue' },
  { name: 'Evernote', detail: 'ENEX 笔记导出', accept: '.enex', icon: NotebookPen, tone: 'green' },
  { name: 'Trello', detail: 'JSON 看板导出', accept: '.json', icon: ListTodo, tone: 'blue' },
  { name: 'Roam Research', detail: 'JSON 页面导出', accept: '.json', icon: Layers, tone: 'gray' },
];
const matches = (item: { name: string; detail: string }) => `${item.name} ${item.detail}`.toLowerCase().includes(query.value.trim().toLowerCase());
const visibleFormats = computed(() => formats.filter(matches));
const visibleProviders = computed(() => providers.filter(matches));
const canImport = computed(() => !!prepared.value?.pages.length && !busy.value && !store.workspace?.readOnly);

function choose(value = importAccept, label = '') {
  if (busy.value || store.workspace?.readOnly) return;
  accept.value = value;
  sourceLabel.value = label;
  void nextTick(() => input.value?.click());
}
async function addFiles(incoming: File[]) {
  if (!incoming.length || busy.value || store.workspace?.readOnly) return;
  error.value = '';
  const merged = [...files.value];
  for (const file of incoming) if (!merged.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) merged.push(file);
  files.value = merged;
  prepared.value = undefined;
  const version = ++generation;
  processing.value = true;
  try {
    const result = await prepareImport(merged, name => { if (generation === version) progressName.value = name; });
    if (generation !== version) return;
    prepared.value = result;
    if (!result.pages.length && !result.issues.length) error.value = '所选文件中没有可导入的文档';
  } catch (reason) { if (generation === version) error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { if (generation === version) { processing.value = false; progressName.value = ''; } }
}
function selected(event: Event) {
  const element = event.target as HTMLInputElement;
  void addFiles([...(element.files ?? [])]);
  element.value = '';
}
function dropped(event: DragEvent) {
  dragActive.value = false;
  sourceLabel.value = '';
  void addFiles([...(event.dataTransfer?.files ?? [])]);
}
function clear() { prepared.value = undefined; files.value = []; error.value = ''; sourceLabel.value = ''; }
async function importFiles() {
  if (!canImport.value || !prepared.value) return;
  saving.value = true;
  error.value = '';
  progressCount.value = 0;
  try {
    const receipt = await store.importDocuments(prepared.value, folderName.value.trim(), workspaceId, {
      importAsset: props.attachments ? async (file, documentPath) => (await props.attachments!.importAttachment(workspaceId, documentPath, file, false)).path : undefined,
      progress: done => { progressCount.value = done; },
    });
    emit('completed', { ...receipt, issues: [...prepared.value.issues, ...receipt.issues], id: crypto.randomUUID(),
      time: Date.now(), workspaceId, sourceCount: files.value.length });
    clear();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { saving.value = false; }
}
async function openRecord(record: ImportRecord) {
  const file = store.workspace?.files.find(file => file.path === record.paths[0]);
  if (file) { await store.openFile(file); emit('close'); }
  else error.value = '导入的文件已被移动或删除';
}
function keydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key !== 'Tab') return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),summary,[tabindex="0"]') ?? [])];
  const first = controls[0], last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
}
function close() { if (!saving.value) emit('close'); }
function isBackdrop(event: MouseEvent) {
  if (event.target !== dialog.value) return false;
  const rect = dialog.value.getBoundingClientRect();
  return event.clientX < rect.left || event.clientX >= rect.right || event.clientY < rect.top || event.clientY >= rect.bottom;
}
function backdropPointerDown(event: PointerEvent) { backdropPress = event.button === 0 && isBackdrop(event); }
function backdropClick(event: MouseEvent) {
  const shouldClose = backdropPress && isBackdrop(event);
  backdropPress = false;
  if (shouldClose) close();
}
onMounted(() => { dialog.value?.showModal(); void nextTick(() => searchInput.value?.focus()); });
onBeforeUnmount(() => { generation++; dialog.value?.close(); originalFocus?.isConnected && originalFocus.focus(); });
const issueText = (issue: ImportIssue) => `${issue.name}：${issue.message}`;
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="import-dialog" :aria-labelledby="titleId" @cancel.prevent="close" @keydown="keydown"
      @pointerdown="backdropPointerDown" @click.self="backdropClick">
      <div class="import-main">
        <header class="import-heading">
          <div><h2 :id="titleId">导入</h2><p>文件与第三方应用导出</p><span class="import-storage">{{ store.isDemo ? '浏览器演示 · 本浏览器存储' : store.isWeb ? '在线工作区' : '本地工作区' }}</span></div>
          <button class="import-icon-button" type="button" title="关闭导入面板" aria-label="关闭导入面板" :disabled="saving" @click="close"><X :size="19" /></button>
        </header>
        <div class="import-scroll panel-scrollbar">
          <p v-if="store.workspace?.readOnly" class="import-alert"><CircleAlert :size="16" />当前工作区只有阅读权限</p>
          <p v-if="error" class="import-alert" role="alert"><CircleAlert :size="16" />{{ error }}</p>
            <input ref="input" type="file" multiple hidden :accept="accept" @change="selected" />
            <button class="import-dropzone" :class="{ dragging: dragActive }" :disabled="busy || store.workspace?.readOnly"
              @click="choose()" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop.prevent="dropped">
              <LoaderCircle v-if="processing" :size="30" class="import-spinning" /><UploadCloud v-else :size="30" />
              <strong>{{ processing ? '正在解析文件' : '选择文件或拖放到此处' }}</strong>
              <span v-if="processing" class="import-current-file">{{ progressName }}</span>
              <span v-else>ZIP、Markdown、PDF、Word、CSV、HTML、EPUB</span>
              <small>单文件 ≤ 50 MiB · 每批 ≤ 100 MiB</small>
            </button>
            <article v-if="latestRecord && !prepared && !processing" class="import-record" aria-label="最近导入结果">
              <div class="import-record-heading"><CheckCircle2 v-if="latestRecord.paths.length" :size="20" class="import-tone-green" /><CircleAlert v-else :size="20" class="import-tone-red" />
                <div><strong>{{ latestRecord.folder }}</strong><small>{{ new Date(latestRecord.time).toLocaleString('zh-CN') }}</small></div>
                <button class="import-icon-button" :disabled="!latestRecord.paths.length" title="打开导入的页面" aria-label="打开导入的页面" @click="openRecord(latestRecord)"><ArrowUpFromLine :size="17" /></button></div>
              <p>{{ latestRecord.sourceCount }} 个来源文件 · {{ latestRecord.paths.length }} 个页面已导入</p>
              <details v-if="latestRecord.issues.length" class="import-issues"><summary><CircleAlert :size="14" />{{ latestRecord.issues.length }} 条提示</summary><p v-for="(issue, index) in latestRecord.issues" :key="index">{{ issueText(issue) }}</p></details>
            </article>
            <section v-if="prepared && !processing" class="import-preview" aria-label="待导入内容">
              <div class="import-section-heading"><h3>待导入<span>{{ prepared.pages.length }} 个页面 · {{ prepared.assets.length }} 个附件</span></h3>
                <button class="import-icon-button" :disabled="saving" title="清空待导入内容" aria-label="清空待导入内容" @click="clear"><X :size="16" /></button></div>
              <p v-if="sourceLabel" class="import-source-label">{{ sourceLabel }} · 导出文件</p>
              <div v-if="prepared.pages.length" class="import-page-list panel-scrollbar"><div v-for="page in prepared.pages" :key="page.path"><FileText :size="15" /><span :title="page.path">{{ page.path }}</span><Check :size="14" /></div></div>
              <details v-if="issues.length" class="import-issues"><summary><CircleAlert :size="14" />{{ issues.length }} 条提示</summary><p v-for="(issue, index) in issues" :key="index">{{ issueText(issue) }}</p></details>
            </section>
            <label class="import-search"><Search :size="16" /><input ref="searchInput" v-model="query" type="search" aria-label="搜索导入来源" placeholder="搜索来源或文件格式" /><button v-if="query" class="import-icon-button" title="清除搜索" aria-label="清除搜索" @click="query = ''"><X :size="14" /></button></label>
            <section v-if="visibleFormats.length" class="import-section">
              <div class="import-section-heading"><h3>文件导入</h3><span>保存为 Markdown</span></div>
              <div class="import-grid"><button v-for="format in visibleFormats" :key="format.name" class="import-source" :disabled="busy || store.workspace?.readOnly" @click="choose(format.accept, format.name)">
                <component :is="format.icon" :size="21" :class="`import-tone-${format.tone}`" /><span><strong>{{ format.name }}</strong><small>{{ format.detail }}</small></span><ChevronRight :size="14" /></button></div>
            </section>
            <section v-if="visibleProviders.length" class="import-section">
              <div class="import-section-heading"><h3>第三方应用</h3><span>导出文件导入</span></div>
              <div class="import-grid"><button v-for="provider in visibleProviders" :key="provider.name" class="import-source" :disabled="busy || store.workspace?.readOnly" @click="choose(provider.accept, provider.name)">
                <component :is="provider.icon" :size="21" :class="`import-tone-${provider.tone}`" /><span><strong>{{ provider.name }}</strong><small>{{ provider.detail }}</small></span><ChevronRight :size="14" /></button></div>
            </section>
            <p v-if="!visibleFormats.length && !visibleProviders.length" class="import-empty">没有匹配的导入来源</p>
        </div>
        <footer v-if="prepared?.pages.length" class="import-footer">
          <label><Folder :size="16" /><span>新文件夹</span><input v-model="folderName" maxlength="40" aria-label="导入文件夹名称" :disabled="saving" /></label>
          <button class="import-submit" :disabled="!canImport" @click="importFiles"><LoaderCircle v-if="saving" :size="16" class="import-spinning" /><ArrowDownToLine v-else :size="16" />{{ saving ? `导入中 ${progressCount}/${prepared.pages.length}` : `导入 ${prepared.pages.length} 个页面` }}</button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.import-dialog { width: min(900px, calc(100vw - 48px)); height: min(800px, calc(100dvh - 80px)); max-width: none; max-height: none; padding: 0; border: 1px solid var(--line); border-radius: 8px; color: var(--text); background: var(--paper); box-shadow: 0 24px 80px #0003; overflow: hidden; }
.import-dialog[open] { display: flex; }
.import-dialog::backdrop { background: #0006; }
.import-storage { display: block; margin-top: 6px; font-size: 11px; line-height: 1.6; color: var(--muted); }
.import-main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.import-heading { display: flex; align-items: flex-start; justify-content: space-between; flex: 0 0 auto; padding: 34px 40px 22px; gap: 16px; }
.import-heading h2 { margin: 0; font-size: 24px; line-height: 1.3; font-weight: 600; }
.import-heading p { margin: 9px 0 0; font-size: 13px; color: var(--muted); }
.import-icon-button { width: 30px; height: 30px; flex: 0 0 30px; padding: 0; display: grid; place-items: center; border-radius: 4px; color: var(--muted); }
.import-icon-button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.import-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 40px 32px; overscroll-behavior: contain; scrollbar-gutter: stable; }
.import-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 13px; width: 100%; min-height: 180px; padding: 24px 16px; border: 1px dashed var(--control-border); border-radius: 6px; background: var(--surface); }
.import-dropzone > svg { color: var(--green); }
.import-dropzone strong { font-size: 14px; font-weight: 600; }
.import-dropzone span { font-size: 12px; line-height: 1.5; color: var(--muted); max-width: 100%; overflow-wrap: anywhere; }
.import-dropzone small { font-size: 11px; color: var(--muted); }
.import-dropzone:hover:not(:disabled), .import-dropzone.dragging { background: var(--accent); border-color: var(--green); }
.import-search { display: flex; align-items: center; gap: 8px; height: 34px; margin: 24px 0; padding: 0 10px; border: 1px solid var(--line); border-radius: 5px; color: var(--muted); }
.import-search input { width: 100%; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--text); font-size: 12px; }
.import-search:focus-within { border-color: var(--green); }
.import-section + .import-section { margin-top: 28px; }
.import-section-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 12px; }
.import-section-heading h3 { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.6; }
.import-section-heading > span, .import-section-heading h3 span { font-size: 11px; font-weight: 400; color: var(--muted); }
.import-section-heading h3 span { display: block; margin-top: 3px; }
.import-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
.import-source { display: flex; align-items: center; gap: 10px; min-height: 76px; padding: 13px 12px; border: 1px solid var(--line); border-radius: 5px; text-align: left; }
.import-source:hover:not(:disabled) { border-color: var(--control-border); background: var(--surface); }
.import-source > svg:first-child { flex-shrink: 0; }
.import-source > svg:last-child { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.import-source > span { min-width: 0; }
.import-source strong { display: block; font-size: 12px; line-height: 1.4; font-weight: 500; overflow-wrap: anywhere; }
.import-source small { display: block; margin-top: 5px; font-size: 10px; line-height: 1.5; color: var(--muted); overflow-wrap: anywhere; }
.import-tone-green { color: var(--green); }.import-tone-blue { color: var(--syntax-blue); }.import-tone-red { color: var(--danger); }.import-tone-amber { color: var(--warning); }.import-tone-violet { color: var(--syntax-purple); }.import-tone-gray { color: var(--text-secondary); }
.import-alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; margin: 0 0 16px; font-size: 12px; line-height: 1.6; color: var(--danger); background: var(--danger-bg); border-radius: 4px; overflow-wrap: anywhere; }
.import-alert svg { flex-shrink: 0; margin-top: 2px; }
.import-preview { margin-top: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.import-source-label { color: var(--muted); font-size: 11px; }
.import-page-list { max-height: 175px; overflow-y: auto; scrollbar-gutter: stable; }
.import-page-list > div { display: flex; align-items: center; gap: 8px; min-height: 30px; font-size: 12px; }
.import-page-list svg { flex-shrink: 0; color: var(--muted); }.import-page-list svg:last-child { color: var(--green); margin-left: auto; }
.import-page-list span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.import-issues { margin-top: 12px; color: var(--warning); font-size: 12px; }
.import-issues summary { cursor: pointer; }.import-issues summary svg { vertical-align: -3px; margin: 0 5px; }
.import-issues p { margin: 8px 0; line-height: 1.7; overflow-wrap: anywhere; }
.import-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 40px; border-top: 1px solid var(--line); }
.import-footer label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; min-width: 0; }
.import-footer label span { white-space: nowrap; }
.import-footer input { width: 130px; min-width: 60px; padding: 6px 8px; border: 1px solid var(--control-border); border-radius: 4px; color: var(--text); background: var(--paper); }
.import-submit { display: flex; align-items: center; justify-content: center; flex-shrink: 0; gap: 8px; min-height: 34px; padding: 8px 13px; border-radius: 5px; font-size: 12px; font-weight: 500; color: #fff; background: var(--green-fill); }
.import-submit:hover:not(:disabled) { background: var(--green-fill-hover); }
.import-record { border-bottom: 1px solid var(--line); padding: 20px 0; }
.import-record-heading { display: flex; align-items: center; gap: 12px; }.import-record-heading > div { min-width: 0; }.import-record-heading strong { display: block; font-size: 13px; overflow-wrap: anywhere; }.import-record-heading small { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; }.import-record-heading button { margin-left: auto; }
.import-record > p { margin: 12px 0 0 32px; color: var(--muted); font-size: 12px; }
.import-empty { text-align: center; padding: 30px 0; color: var(--muted); font-size: 13px; }
.import-spinning { animation: import-spin 1s linear infinite; }@keyframes import-spin { to { transform: rotate(360deg); } }
@media (max-width: 1000px) { .import-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.import-heading { padding: 28px 28px 22px; }.import-scroll { padding: 0 28px 28px; }.import-footer { padding: 14px 28px; } }
@media (max-width: 650px) {
  .import-dialog { width: calc(100vw - 20px); height: calc(100dvh - 24px); }.import-dialog[open] { flex-direction: column; }
  .import-main { min-height: 0; }.import-heading { padding: 22px 18px 18px; }.import-heading h2 { font-size: 21px; }.import-scroll { padding: 0 18px 20px; }
  .import-dropzone { min-height: 165px; }.import-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.import-source { min-height: 80px; padding: 10px 8px; gap: 7px; }.import-source > svg:last-child { display: none; }
  .import-footer { padding: 12px 18px; flex-wrap: wrap; gap: 10px; }.import-footer label { flex: 1; }.import-footer input { flex: 1; width: 80px; }.import-submit { width: 100%; }
}
</style>
