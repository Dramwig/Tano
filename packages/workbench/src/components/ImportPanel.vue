<script setup lang="ts">
import { t, uiLocale } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, useId } from 'vue';
import { animate } from 'motion/mini';
import { ArrowDownToLine, ArrowLeft, ArrowUpFromLine, Check, CheckCircle2, ChevronRight, CircleAlert, FileText,
  Folder, History, LoaderCircle, UploadCloud, X } from 'lucide-vue-next';
import { isWorkspaceInternalPath } from '@tano/protocol';
import markdownIcon from '../assets/import-file-icons/markdown.svg?raw';
import tableIcon from '../assets/import-file-icons/table.svg?raw';
import pdfIcon from '../assets/import-file-icons/pdf.svg?raw';
import htmlIcon from '../assets/import-file-icons/html.svg?raw';
import wordIcon from '../assets/import-file-icons/word.svg?raw';
import epubIcon from '../assets/import-file-icons/epub.svg?raw';
import zipIcon from '../assets/import-file-icons/zip.svg?raw';
import jsonIcon from '../assets/import-file-icons/json.svg?raw';
import notionIcon from '../assets/import-icons/notion.svg?raw';
import obsidianIcon from '../assets/import-icons/obsidian.svg?raw';
import confluenceIcon from '../assets/import-icons/confluence.svg?raw';
import evernoteIcon from '../assets/import-icons/evernote.svg?raw';
import trelloIcon from '../assets/import-icons/trello.svg?raw';
import roamResearchIcon from '../assets/import-icons/roamresearch.svg?raw';
import asanaIcon from '../assets/import-icons/asana.svg?raw';
import workflowyIcon from '../assets/import-icons/workflowy.svg?raw';
import jiraIcon from '../assets/import-icons/jira.svg?raw';
import mondayIcon from '../assets/import-icons/monday.svg?raw';
import quipIcon from '../assets/import-icons/quip.svg?raw';
import googleDocsIcon from '../assets/import-icons/googledocs.svg?raw';
import { importAccept, prepareImport } from '../document-import';
import type { PreparedImport, ImportIssue } from '../document-import';
import type { ImportReceipt } from '../workspace-import';
import type { AttachmentService } from '../attachments';
import { useWorkspaceStore } from '../stores/workspace';
import ImportAccountStep from './ImportAccountStep.vue';
import type { ImportProviderId } from '../account-import/types';

export interface ImportRecord extends ImportReceipt { id: string; time: number; workspaceId: string; sourceCount: number }
type ImportEntry = { path: string; name: string; depth: number; kind: 'folder' | 'file' };
const props = defineProps<{ attachments?: AttachmentService; records: ImportRecord[] }>();
const emit = defineEmits<{ close: []; completed: [record: ImportRecord] }>();
const store = useWorkspaceStore();
const workspaceId = store.workspace!.id;
const titleId = useId();
const dialog = ref<HTMLDialogElement>();
const input = ref<HTMLInputElement>();
const originalFocus = document.activeElement as HTMLElement | null;
const dragActive = ref(false);
const accept = ref(importAccept);
const sourceLabel = ref('');
const files = shallowRef<File[]>([]);
const remoteSourceCount = ref(0);
const prepared = shallowRef<PreparedImport>();
const processing = ref(false);
const saving = ref(false);
const progressName = ref('');
const progressCount = ref(0);
const destinationFolder = ref('');
const error = ref('');
const historyOpen = ref(false);
let generation = 0;
let backdropPress = false;
let dialogHeightMotion: ReturnType<typeof animate> | undefined;
let capturedDialogHeight: number | undefined;
const busy = computed(() => processing.value || saving.value);
const records = computed(() => props.records.filter(record => record.workspaceId === workspaceId).sort((left, right) => right.time - left.time));
const issues = computed(() => prepared.value?.issues ?? []);
const formats = [
  { get name() { return t('文本与 Markdown'); }, detail: 'MD · Markdown · TXT · LOG', accept: '.md,.markdown,.txt,.log', icon: markdownIcon },
  { get name() { return t('CSV 与 TSV'); }, detail: 'CSV · TSV', accept: '.csv,.tsv', icon: tableIcon },
  { name: 'PDF', get detail() { return t('PDF 文本提取'); }, accept: '.pdf', icon: pdfIcon },
  { name: 'HTML', detail: 'HTML · HTM', accept: '.html,.htm', icon: htmlIcon },
  { name: 'Word', detail: 'DOCX', accept: '.docx', icon: wordIcon },
  { name: 'EPUB', get detail() { return t('EPUB 电子书'); }, accept: '.epub', icon: epubIcon },
  { name: 'ZIP', get detail() { return t('文档、目录与附件'); }, accept: '.zip', icon: zipIcon },
  { name: 'JSON', get detail() { return t('Trello · Roam Research 导出'); }, accept: '.json', icon: jsonIcon },
];
const providers = [
  { id: 'notion', name: 'Notion', detail: 'Markdown / CSV / HTML · ZIP', accept: '.zip,.md,.markdown,.csv,.html', icon: notionIcon, color: 'var(--text)' },
  { id: 'obsidian', name: 'Obsidian', detail: 'Markdown · Vault ZIP', accept: '.zip,.md,.markdown', icon: obsidianIcon, color: '#7c3aed' },
  { id: 'confluence', name: 'Confluence', detail: 'HTML · ZIP', accept: '.zip,.html,.htm', icon: confluenceIcon, color: '#0052cc' },
  { id: 'evernote', name: 'Evernote', get detail() { return t('ENEX 笔记导出'); }, accept: '.enex', icon: evernoteIcon, color: '#00a82d' },
  { id: 'trello', name: 'Trello', get detail() { return t('JSON 看板导出'); }, accept: '.json', icon: trelloIcon, color: '#0052cc' },
  { id: 'roam', name: 'Roam Research', get detail() { return t('JSON 页面导出'); }, accept: '.json', icon: roamResearchIcon, color: 'var(--text)' },
  { id: 'asana', name: 'Asana', get detail() { return t('CSV 项目与任务导出'); }, accept: '.csv', icon: asanaIcon, color: '#f06a6a' },
  { id: 'workflowy', name: 'Workflowy', get detail() { return t('OPML 大纲 · 文本'); }, accept: '.opml,.txt', icon: workflowyIcon, color: '#3978b8' },
  { id: 'jira', name: 'Jira', get detail() { return t('CSV 问题与项目导出'); }, accept: '.csv', icon: jiraIcon, color: '#0052cc' },
  { id: 'monday', name: 'Monday.com', get detail() { return t('Excel 看板导出 · CSV'); }, accept: '.xlsx,.csv', icon: mondayIcon, color: '#6161ff' },
  { id: 'quip', name: 'Quip', get detail() { return t('Word · HTML 文档导出'); }, accept: '.docx,.html,.htm', icon: quipIcon, color: '#f27557' },
  { id: 'google-docs', name: 'Google Docs', get detail() { return t('Word · HTML / ZIP · 文本'); }, accept: '.docx,.html,.htm,.zip,.txt,.md', icon: googleDocsIcon, color: '#4285f4' },
] satisfies { id: ImportProviderId; name: string; detail: string; accept: string; icon: string; color: string }[];
const selectedProvider = shallowRef<typeof providers[number]>();
const destinationFolders = computed(() => (store.workspace?.files ?? [])
  .filter(file => file.kind === 'directory' && !isWorkspaceInternalPath(file.path))
  .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN')));
const canImport = computed(() => !!prepared.value?.pages.length && !busy.value && !store.workspace?.readOnly);
const detailTitle = computed(() => historyOpen.value ? t('导入历史') : prepared.value ? t('导入 {0}', [sourceLabel.value || '文件']) : selectedProvider.value ? t('导入 {0}', [selectedProvider.value.name]) : t('导入'));
const importEntries = computed(() => {
  if (!prepared.value) return [];
  const filePaths = new Set([...prepared.value.pages.map(page => page.sourcePath), ...prepared.value.assets.map(asset => asset.sourcePath), ...prepared.value.issues.map(issue => issue.name)]);
  const folders = new Set<string>();
  for (const path of filePaths) {
    const parts = path.split('/');
    for (let index = 1; index < parts.length; index++) folders.add(parts.slice(0, index).join('/'));
  }
  const entries: ImportEntry[] = [...folders].map(path => ({ path, name: path.split('/').at(-1) ?? path, depth: path.split('/').length - 1, kind: 'folder' }));
  entries.push(...[...filePaths].map(path => ({ path, name: path.split('/').at(-1) ?? path, depth: path.split('/').length - 1, kind: 'file' as const })));
  return entries
    .sort((left, right) => left.path.localeCompare(right.path, 'zh-CN') || left.kind.localeCompare(right.kind));
});

function captureDialogHeight() {
  const element = dialog.value;
  if (!element) return;
  dialogHeightMotion?.stop();
  dialogHeightMotion = undefined;
  const height = element.getBoundingClientRect().height;
  if (height > 0) {
    capturedDialogHeight = height;
    element.style.height = `${height}px`;
  }
}
async function animateDialogHeight() {
  const element = dialog.value;
  const from = capturedDialogHeight;
  capturedDialogHeight = undefined;
  if (!element || !from) return;
  await nextTick();
  element.style.height = '';
  const to = element.getBoundingClientRect().height;
  element.style.height = `${from}px`;
  if (Math.abs(to - from) < 1 || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    element.style.height = '';
    return;
  }
  const animation = animate(element, { height: [from, to] }, { duration: 0.3, ease: [0.22, 1, 0.36, 1] });
  dialogHeightMotion = animation;
  void animation.finished.then(() => {
    if (dialogHeightMotion !== animation) return;
    element.style.height = '';
    dialogHeightMotion = undefined;
  });
}

function choose(value = importAccept, label = '') {
  if (busy.value || store.workspace?.readOnly) return;
  accept.value = value;
  sourceLabel.value = label;
  void nextTick(() => input.value?.click());
}
async function addFiles(incoming: File[]) {
  if (!incoming.length || busy.value || store.workspace?.readOnly) return;
  error.value = '';
  remoteSourceCount.value = 0;
  const merged = [...files.value];
  for (const file of incoming) if (!merged.some(existing => existing.name === file.name && existing.size === file.size && existing.lastModified === file.lastModified)) merged.push(file);
  files.value = merged;
  prepared.value = undefined;
  const version = ++generation;
  processing.value = true;
  try {
    const result = await prepareImport(merged, name => { if (generation === version) progressName.value = name; });
    if (generation !== version) return;
    captureDialogHeight();
    prepared.value = result;
    void animateDialogHeight();
    if (!result.pages.length && !result.issues.length) error.value = t('所选文件中没有可导入的文档');
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
function clear() {
  captureDialogHeight();
  prepared.value = undefined;
  void animateDialogHeight();
  files.value = []; remoteSourceCount.value = 0; selectedProvider.value = undefined; error.value = ''; sourceLabel.value = ''; destinationFolder.value = '';
}
function openProvider(provider: typeof providers[number]) {
  error.value = ''; selectedProvider.value = provider; sourceLabel.value = provider.name;
}
function accountPrepared(result: PreparedImport, sourceCount: number) {
  captureDialogHeight(); prepared.value = result; remoteSourceCount.value = sourceCount;
  void animateDialogHeight();
}
async function importFiles() {
  if (!canImport.value || !prepared.value) return;
  saving.value = true;
  error.value = '';
  progressCount.value = 0;
  try {
    const receipt = await store.importDocuments(prepared.value, destinationFolder.value, workspaceId, {
      destination: destinationFolder.value ? 'existing' : 'root',
      importAsset: props.attachments ? async (file, documentPath) => (await props.attachments!.importAttachment(workspaceId, documentPath, file, false)).path : undefined,
      progress: done => { progressCount.value = done; },
    });
    emit('completed', { ...receipt, issues: [...prepared.value.issues, ...receipt.issues], id: crypto.randomUUID(),
      time: Date.now(), workspaceId, sourceCount: remoteSourceCount.value || files.value.length });
    clear();
    historyOpen.value = true;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { saving.value = false; }
}
async function openRecord(record: ImportRecord) {
  const path = record.paths.find(path => store.workspace?.files.some(file => file.path === path));
  await openImportedPage(path ?? record.paths[0]);
}
async function openImportedPage(path: string) {
  const file = store.workspace?.files.find(file => file.path === path);
  if (file) { await store.openFile(file); emit('close'); }
  else error.value = t('导入的文件已被移动或删除');
}
function openHistory() { error.value = ''; historyOpen.value = true; }
function back() {
  if (historyOpen.value) { historyOpen.value = false; error.value = ''; }
  else clear();
}
function keydown(event: KeyboardEvent) {
  event.stopPropagation();
  if (event.key !== 'Tab') return;
  const controls = [...(dialog.value?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled):not([hidden]),select:not(:disabled),summary,[tabindex="0"]') ?? [])];
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
onMounted(() => { dialog.value?.showModal(); });
onBeforeUnmount(() => { generation++; dialogHeightMotion?.stop(); dialogHeightMotion = undefined; dialog.value?.close(); originalFocus?.isConnected && originalFocus.focus(); });
const issueText = (issue: ImportIssue) => `${issue.name}：${issue.message}`;
</script>

<template>
  <Teleport to="body">
    <dialog ref="dialog" class="import-dialog" :class="{ 'import-dialog-detail': prepared }" :aria-labelledby="titleId" @cancel.prevent="close" @keydown="keydown"
      @pointerdown="backdropPointerDown" @click.self="backdropClick">
      <div class="import-main">
        <header class="import-heading" :class="{ 'import-heading-detail': prepared }">
          <div class="import-heading-main">
            <button v-if="historyOpen || prepared || selectedProvider" class="import-back-button" type="button" :title="t('返回导入来源')" :aria-label="t('返回导入来源')" :disabled="saving" @click="back"><ArrowLeft :size="18" /></button>
            <div><h2 :id="titleId">{{ detailTitle }}</h2></div>
          </div>
          <div class="import-heading-actions">
            <button v-if="!historyOpen && !prepared && !selectedProvider" class="import-history-button" type="button" :disabled="busy" @click="openHistory"><History :size="16" />{{ t('导入历史') }}<span v-if="records.length">{{ records.length }}</span></button>
            <button class="import-icon-button" type="button" :title="t('关闭导入面板')" :aria-label="t('关闭导入面板')" :disabled="saving" @click="close"><X :size="19" /></button>
          </div>
        </header>
        <div class="import-scroll panel-scrollbar">
          <section v-if="historyOpen" class="import-history" :aria-label="t('导入历史')">
            <p class="import-history-description">{{ t('当前工作区 · 本次会话的导入记录') }}</p>
            <p v-if="error" class="import-alert" role="alert"><CircleAlert :size="16" />{{ error }}</p>
            <div v-if="!records.length" class="import-history-empty"><History :size="30" /><h3>{{ t('暂无导入记录') }}</h3><p>{{ t('导入完成后，可在这里查看结果和提示。') }}</p><button class="import-secondary" type="button" @click="back">{{ t('去导入') }}</button></div>
            <article v-for="record in records" :key="record.id" class="import-record" :aria-label="t('导入记录')">
              <div class="import-record-heading"><CheckCircle2 v-if="record.paths.length" :size="20" class="import-tone-green" /><CircleAlert v-else :size="20" class="import-tone-red" />
                <div><strong>{{ record.folder }}</strong><small>{{ new Date(record.time).toLocaleString(uiLocale) }}</small></div>
                <button class="import-icon-button" :disabled="!record.paths.length" :title="t('打开导入的页面')" :aria-label="t('打开导入的页面')" @click="openRecord(record)"><ArrowUpFromLine :size="17" /></button></div>
              <p>{{ record.sourceCount }} {{ t('个来源文件 ·') }} {{ record.paths.length }} {{ t('个页面已导入') }}</p>
              <details v-if="record.paths.length" class="import-record-pages"><summary>{{ t('已导入的页面（') }}{{ record.paths.length }}）</summary><ul><li v-for="path in record.paths" :key="path"><button type="button" :title="path" @click="openImportedPage(path)"><FileText :size="14" /><span>{{ path }}</span></button></li></ul></details>
              <details v-if="record.issues.length" class="import-issues"><summary><CircleAlert :size="14" />{{ record.issues.length }} {{ t('条提示') }}</summary><p v-for="(issue, index) in record.issues" :key="index">{{ issueText(issue) }}</p></details>
            </article>
          </section>
          <template v-else-if="prepared">
            <div class="import-detail" :aria-label="t('导入详情')">
              <p v-if="error" class="import-alert" role="alert"><CircleAlert :size="16" />{{ error }}</p>
              <section class="import-detail-card" :aria-label="t('导入目录')">
                <div v-if="importEntries.length" class="import-directory-list panel-scrollbar">
                  <div v-for="entry in importEntries" :key="`${entry.kind}:${entry.path}`" class="import-directory-entry" :class="{ 'import-directory-folder': entry.kind === 'folder' }" :style="{ paddingLeft: `${entry.depth * 18}px` }">
                    <Folder v-if="entry.kind === 'folder'" :size="15" /><FileText v-else :size="15" /><span :title="entry.path">{{ entry.name }}</span><small v-if="entry.kind === 'folder'">{{ t('文件夹') }}</small><Check v-else :size="14" />
                  </div>
                </div>
                <details v-if="issues.length" class="import-issues"><summary><CircleAlert :size="14" />{{ issues.length }} {{ t('条提示') }}</summary><p v-for="(issue, index) in issues" :key="index">{{ issueText(issue) }}</p></details>
              </section>
              <label class="import-destination"><Folder :size="19" /><span><strong>{{ t('导入位置') }}</strong><small>{{ destinationFolder ? t('页面会保存到「{0}」', [destinationFolder]) : t('页面会直接保存到工作区根目录') }}</small></span><select v-model="destinationFolder" :aria-label="t('导入位置')" :disabled="saving"><option value="">{{ t('工作区根目录') }}</option><option v-for="folder in destinationFolders" :key="folder.path" :value="folder.path">{{ folder.path }}</option></select></label>
              <div v-if="saving" class="import-progress" role="status" aria-live="polite"><div class="import-progress-heading"><span>{{ t('正在导入') }}</span><strong>{{ progressCount }}/{{ prepared.pages.length }}</strong></div><div class="import-progress-track"><span :style="{ width: `${prepared.pages.length ? (progressCount / prepared.pages.length) * 100 : 0}%` }" /></div></div>
            </div>
          </template>
          <template v-else>
            <p v-if="store.workspace?.readOnly" class="import-alert"><CircleAlert :size="16" />{{ t('当前工作区只有阅读权限') }}</p>
            <p v-if="error" class="import-alert" role="alert"><CircleAlert :size="16" />{{ error }}</p>
              <input ref="input" type="file" multiple hidden :accept="accept" @change="selected" />
              <ImportAccountStep v-if="selectedProvider" :key="selectedProvider.id" :provider="selectedProvider" @file="choose(selectedProvider.accept, selectedProvider.name)" @prepared="accountPrepared" />
              <template v-else>
              <button class="import-dropzone" :class="{ dragging: dragActive }" :disabled="busy || store.workspace?.readOnly"
                @click="choose()" @dragover.prevent="dragActive = true" @dragleave.prevent="dragActive = false" @drop.prevent="dropped">
                <LoaderCircle v-if="processing" :size="30" class="import-spinning" /><UploadCloud v-else :size="30" />
                <strong>{{ processing ? t('正在解析文件') : t('选择文件或拖放到此处') }}</strong>
                <span v-if="processing" class="import-current-file">{{ progressName }}</span>
                <span v-else>ZIP、Markdown、PDF、Word、CSV、HTML、EPUB</span>
                <small>{{ t('单文件 ≤ 50 MiB · 每批 ≤ 100 MiB') }}</small>
              </button>
              <section class="import-section">
                <div class="import-section-heading"><h3>{{ t('文件导入') }}</h3><span>{{ t('保存为 Markdown') }}</span></div>
                <div class="import-grid"><button v-for="format in formats" :key="format.name" class="import-source" :disabled="busy || store.workspace?.readOnly" @click="choose(format.accept, format.name)">
                  <span class="import-file-icon" aria-hidden="true" v-html="format.icon" /><span><strong>{{ format.name }}</strong><small>{{ format.detail }}</small></span><ChevronRight :size="14" /></button></div>
              </section>
              <section class="import-section">
                <div class="import-section-heading"><h3>{{ t('第三方应用') }}</h3><span>{{ t('连接账号或导入文件') }}</span></div>
                <div class="import-grid"><button v-for="provider in providers" :key="provider.name" class="import-source" :disabled="busy || store.workspace?.readOnly" @click="openProvider(provider)">
                  <span class="import-provider-icon" :style="{ color: provider.color }" aria-hidden="true" v-html="provider.icon" /><span><strong>{{ provider.name }}</strong><small>{{ provider.id === 'obsidian' ? t('本地仓库 · 导出文件') : t('连接账号 · 导出文件') }}</small></span><ChevronRight :size="14" /></button></div>
              </section>
              </template>
          </template>
        </div>
        <footer v-if="prepared" class="import-footer import-detail-footer">
          <button class="import-secondary" type="button" :disabled="saving" @click="clear">{{ t('重新选择') }}</button>
          <button class="import-submit" :disabled="!canImport" @click="importFiles"><LoaderCircle v-if="saving" :size="16" class="import-spinning" /><ArrowDownToLine v-else :size="16" />{{ saving ? t('导入中 {0}/{1}', [progressCount, prepared.pages.length]) : t('开始导入 {0} 个页面', [prepared.pages.length]) }}</button>
        </footer>
      </div>
    </dialog>
  </Teleport>
</template>

<style scoped>
.import-dialog { width: min(780px, calc(100vw - 40px)); height: min(680px, calc(100dvh - 56px)); max-width: none; max-height: none; padding: 0; border: 1px solid var(--line); border-radius: 14px; color: var(--text); background: var(--paper); box-shadow: 0 28px 80px #0004; overflow: hidden; }
.import-dialog-detail { height: min(430px, calc(100dvh - 56px)); max-height: none; }
.import-dialog-detail .import-main { min-height: 0; }
.import-dialog-detail .import-scroll { flex: 1; max-height: none; }
.import-dialog[open] { display: flex; }
.import-dialog::backdrop { background: #0006; }
.import-main { display: flex; flex: 1; flex-direction: column; min-width: 0; }
.import-heading { display: flex; align-items: center; justify-content: space-between; flex: 0 0 auto; padding: 22px 28px 16px; gap: 12px; }
.import-heading-main { display: flex; align-items: center; gap: 10px; min-width: 0; }
.import-heading-actions { display: flex; align-items: center; gap: 12px; }
.import-history-button { display: flex; align-items: center; gap: 6px; min-height: 32px; padding: 6px 9px; border-radius: 6px; color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.import-history-button:hover:not(:disabled) { color: var(--text); background: var(--hover); }
.import-history-button span { padding: 1px 5px; border-radius: 4px; color: var(--muted); background: var(--surface); font-size: 10px; }
.import-heading-detail { padding-bottom: 12px; }
.import-back-button { width: 32px; height: 32px; flex: 0 0 32px; display: grid; place-items: center; margin: 0; padding: 0; border: 0; border-radius: 6px; color: var(--muted); background: transparent; }
.import-back-button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.import-heading h2 { margin: 0; font-size: 21px; line-height: 1.3; font-weight: 600; }
.import-heading p { margin: 6px 0 0; font-size: 12px; color: var(--muted); }
.import-icon-button { width: 32px; height: 32px; flex: 0 0 32px; padding: 0; display: grid; place-items: center; border-radius: 999px; color: var(--muted); }
.import-icon-button:hover:not(:disabled) { background: var(--hover); color: var(--text); }
.import-scroll { flex: 1; min-height: 0; overflow-y: auto; padding: 0 28px 24px; overscroll-behavior: contain; scrollbar-gutter: stable; }
.import-dropzone { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 128px; padding: 16px 14px; border: 1px dashed var(--control-border); border-radius: 6px; background: var(--surface); }
.import-dropzone > svg { color: var(--green); }
.import-dropzone strong { font-size: 14px; font-weight: 600; }
.import-dropzone span { font-size: 12px; line-height: 1.5; color: var(--muted); max-width: 100%; overflow-wrap: anywhere; }
.import-dropzone small { font-size: 11px; color: var(--muted); }
.import-dropzone:hover:not(:disabled), .import-dropzone.dragging { background: var(--accent); border-color: var(--green); }
.import-section { margin-top: 20px; }
.import-section-heading { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 8px; }
.import-section-heading h3 { margin: 0; font-size: 13px; font-weight: 600; line-height: 1.6; }
.import-section-heading > span, .import-section-heading h3 span { font-size: 11px; font-weight: 400; color: var(--muted); }
.import-section-heading h3 span { display: block; margin-top: 3px; }
.import-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.import-source { display: flex; align-items: center; gap: 8px; min-height: 58px; padding: 9px 10px; border: 1px solid var(--line); border-radius: 5px; text-align: left; }
.import-source:hover:not(:disabled) { border-color: var(--control-border); background: var(--surface); }
.import-source > svg:first-child { flex-shrink: 0; }
.import-file-icon { display: block; width: 26px; height: 26px; flex: 0 0 26px; }
.import-file-icon :deep(svg) { display: block; width: 100%; height: 100%; }
.import-provider-icon { display: block; width: 19px; height: 19px; flex: 0 0 19px; fill: currentColor; }
.import-provider-icon :deep(svg) { display: block; width: 100%; height: 100%; }
.import-source > svg:last-child { margin-left: auto; color: var(--muted); flex-shrink: 0; }
.import-source > span { min-width: 0; }
.import-source strong { display: block; font-size: 12px; line-height: 1.35; font-weight: 500; overflow-wrap: anywhere; }
.import-source small { display: block; margin-top: 3px; font-size: 10px; line-height: 1.35; color: var(--muted); overflow-wrap: anywhere; }
.import-tone-green { color: var(--green); }.import-tone-blue { color: var(--syntax-blue); }.import-tone-red { color: var(--danger); }.import-tone-amber { color: var(--warning); }.import-tone-violet { color: var(--syntax-purple); }.import-tone-gray { color: var(--text-secondary); }
.import-alert { display: flex; align-items: flex-start; gap: 8px; padding: 10px 12px; margin: 0 0 16px; font-size: 12px; line-height: 1.6; color: var(--danger); background: var(--danger-bg); border-radius: 4px; overflow-wrap: anywhere; }
.import-alert svg { flex-shrink: 0; margin-top: 2px; }
.import-preview { margin-top: 22px; padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.import-source-label { color: var(--muted); font-size: 11px; }
.import-detail { max-width: none; margin: 0; padding: 4px 0 18px; }
.import-detail-card { padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 4px 16px #00000008; }
.import-directory-list { max-height: 210px; overflow-y: auto; }
.import-directory-entry { display: flex; align-items: center; gap: 9px; min-height: 32px; padding-right: 4px; font-size: 12px; }
.import-directory-entry svg { flex-shrink: 0; color: var(--muted); }.import-directory-entry svg:last-child { margin-left: auto; color: var(--green); }
.import-directory-entry span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.import-directory-entry small { margin-left: auto; color: var(--muted); font-size: 10px; }
.import-directory-folder { color: var(--text-secondary); }
.import-directory-folder svg { color: var(--warning); }
.import-destination { display: flex; align-items: center; gap: 10px; margin-top: 12px; padding: 11px 12px; border: 1px solid var(--line); border-radius: 12px; background: var(--paper); }
.import-destination > svg { width: 22px; height: 22px; flex: 0 0 auto; color: var(--muted); }
.import-destination > span { min-width: 0; flex: 1; }.import-destination strong, .import-destination small { display: block; }
.import-destination strong { font-size: 12px; font-weight: 600; }.import-destination small { margin-top: 4px; color: var(--muted); font-size: 11px; }
.import-destination select { width: 190px; max-width: 45%; padding: 8px 10px; border: 1px solid var(--control-border); border-radius: 8px; color: var(--text); background: var(--paper); }
.import-progress { margin-top: 12px; padding: 11px 12px; border-radius: 8px; background: var(--accent); }
.import-progress-heading { display: flex; justify-content: space-between; color: var(--muted); font-size: 11px; }.import-progress-heading strong { color: var(--text); font-weight: 600; }
.import-progress-track { height: 5px; margin-top: 9px; overflow: hidden; border-radius: 999px; background: var(--line); }.import-progress-track span { display: block; height: 100%; border-radius: inherit; background: var(--green-fill); transition: width .2s ease; }
.import-page-list { max-height: 175px; overflow-y: auto; scrollbar-gutter: stable; }
.import-page-list > div { display: flex; align-items: center; gap: 8px; min-height: 30px; font-size: 12px; }
.import-page-list svg { flex-shrink: 0; color: var(--muted); }.import-page-list svg:last-child { color: var(--green); margin-left: auto; }
.import-page-list span { overflow: hidden; white-space: nowrap; text-overflow: ellipsis; }
.import-issues { margin-top: 12px; color: var(--warning); font-size: 12px; }
.import-issues summary { cursor: pointer; }.import-issues summary svg { vertical-align: -3px; margin: 0 5px; }
.import-issues p { margin: 8px 0; line-height: 1.7; overflow-wrap: anywhere; }
.import-footer { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 14px 28px; border-top: 1px solid var(--line); background: var(--surface); }
.import-detail-footer { justify-content: flex-end; }
.import-secondary { min-height: 36px; padding: 8px 14px; border: 1px solid var(--control-border); border-radius: 8px; color: var(--text-secondary); background: var(--paper); font-size: 12px; }
.import-secondary:hover:not(:disabled) { background: var(--surface); color: var(--text); }
.import-footer label { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; min-width: 0; }
.import-footer label span { white-space: nowrap; }
.import-footer input { width: 130px; min-width: 60px; padding: 6px 8px; border: 1px solid var(--control-border); border-radius: 4px; color: var(--text); background: var(--paper); }
.import-submit { display: flex; align-items: center; justify-content: center; flex-shrink: 0; gap: 8px; min-height: 36px; padding: 8px 14px; border-radius: 8px; font-size: 12px; font-weight: 600; color: #fff; background: var(--green-fill); box-shadow: 0 4px 12px color-mix(in srgb, var(--green-fill) 28%, transparent); }
.import-submit:hover:not(:disabled) { background: var(--green-fill-hover); }
.import-record { border-bottom: 1px solid var(--line); padding: 20px 0; }
.import-record-heading { display: flex; align-items: center; gap: 12px; }.import-record-heading > div { min-width: 0; }.import-record-heading strong { display: block; font-size: 13px; overflow-wrap: anywhere; }.import-record-heading small { display: block; margin-top: 5px; color: var(--muted); font-size: 11px; }.import-record-heading button { margin-left: auto; }
.import-record > p { margin: 12px 0 0 32px; color: var(--muted); font-size: 12px; }
.import-history-description { margin: 0; color: var(--muted); font-size: 12px; }
.import-history-empty { display: flex; flex-direction: column; align-items: center; padding: 90px 16px; text-align: center; color: var(--muted); }
.import-history-empty h3 { margin: 16px 0 0; color: var(--text); font-size: 15px; font-weight: 500; }
.import-history-empty p { margin: 8px 0 20px; font-size: 12px; line-height: 1.6; }
.import-record-pages { margin: 12px 0 0 32px; color: var(--text-secondary); font-size: 12px; }
.import-record-pages summary { cursor: pointer; }
.import-record-pages ul { margin: 8px 0 0; padding: 0; list-style: none; }
.import-record-pages button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 6px 8px; border-radius: 5px; text-align: left; font-size: 12px; }
.import-record-pages button:hover { background: var(--hover); }
.import-record-pages svg { flex-shrink: 0; color: var(--muted); }
.import-record-pages span { min-width: 0; overflow-wrap: anywhere; }
.import-empty { text-align: center; padding: 30px 0; color: var(--muted); font-size: 13px; }
.import-spinning { animation: import-spin 1s linear infinite; }@keyframes import-spin { to { transform: rotate(360deg); } }
@media (max-width: 1000px) { .import-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }.import-heading { padding: 22px 24px 14px; }.import-scroll { padding: 0 24px 22px; }.import-footer { padding: 12px 24px; } }
@media (max-width: 650px) {
  .import-dialog { width: calc(100vw - 20px); height: calc(100dvh - 24px); }.import-dialog[open] { flex-direction: column; }
  .import-main { min-height: 0; }.import-heading { padding: 22px 18px 18px; }.import-heading h2 { font-size: 21px; }.import-scroll { padding: 0 18px 20px; }
  .import-dropzone { min-height: 165px; }.import-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }.import-source { min-height: 80px; padding: 10px 8px; gap: 7px; }.import-source > svg:last-child { display: none; }
  .import-detail { padding-top: 2px; }.import-detail-card { padding: 14px; }.import-destination { align-items: flex-start; flex-wrap: wrap; }.import-destination > span { flex: 1 1 calc(100% - 46px); }.import-destination select { width: 100%; max-width: none; margin-left: 31px; }.import-footer { padding: 12px 18px; flex-wrap: wrap; gap: 10px; }.import-detail-footer .import-secondary, .import-detail-footer .import-submit { flex: 1; }.import-submit { width: auto; }
}
</style>
