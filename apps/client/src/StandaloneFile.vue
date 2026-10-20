<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { save as chooseSave } from '@tauri-apps/plugin-dialog';
import MarkdownEditor from '@tano/editor';
import SourceEditor from '@tano/workbench/components/SourceEditor.vue';
import { StandaloneSession, type Snapshot, type WriteResult } from './standalone-session';

const session = ref<StandaloneSession>();
const path = ref('');
const error = ref('');
const status = ref('');
const source = ref(false);
const saving = ref(false);
const closing = ref(false);
const appWindow = getCurrentWindow();
const draftKey = `tano.standalone.draft.${appWindow.label}`;
const name = computed(() => path.value.split(/[\\/]/).pop() ?? 'Markdown');
const displayPath = computed(() => path.value.startsWith('\\\\?\\UNC\\')
  ? `\\\\${path.value.slice(8)}`
  : path.value.startsWith('\\\\?\\') ? path.value.slice(4) : path.value);
watch(name, value => { document.title = `${value} — Tano`; });
let unlistenClose: (() => void) | undefined;
let unlistenFocus: (() => void) | undefined;
let disposed = false;
let draftTimer: ReturnType<typeof setTimeout> | undefined;

function preserveDraft() {
  const current = session.value;
  if (!current) return;
  try {
    if (current.dirty) localStorage.setItem(draftKey, JSON.stringify({ base: current.base, content: current.content }));
    else localStorage.removeItem(draftKey);
  } catch { error.value = '本地草稿无法保存，请保存文件或另存副本后再关闭。'; }
}
watch(() => session.value?.content, () => {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(preserveDraft, 300);
});
async function refresh() {
  if (!session.value || saving.value) return;
  try {
    const result = await invoke<{ path: string; snapshot: Snapshot }>('standalone_read');
    session.value.acceptExternal(result.snapshot);
    preserveDraft();
  } catch (cause) { error.value = String(cause); }
}
async function save() {
  if (!session.value || saving.value) return false;
  saving.value = true;
  error.value = '';
  status.value = '';
  try {
    const saved = await session.value.save((content, expected) => invoke<WriteResult>('standalone_write', { content, expected }));
    preserveDraft();
    if (saved) status.value = '已保存';
    return saved;
  } catch (cause) { error.value = String(cause); return false; }
  finally { saving.value = false; }
}
async function copy() {
  if (!session.value || saving.value) return;
  try {
    const destination = await chooseSave({
      defaultPath: displayPath.value.replace(/\.(md|markdown)$/i, '-副本.md'),
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }],
    });
    if (!destination) return;
    await invoke('standalone_copy', { path: destination, content: session.value.content });
    status.value = '副本已保存，原文件保持不变';
  } catch (cause) { error.value = String(cause); }
}
async function saveAndClose() { if (await save()) await appWindow.close(); }
async function discardAndClose() {
  localStorage.removeItem(draftKey);
  if (session.value) session.value.content = session.value.base.content;
  await appWindow.close();
}
function keydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    void save();
  }
}
function beforeUnload(event: BeforeUnloadEvent) {
  preserveDraft();
  if (session.value?.dirty) { event.preventDefault(); event.returnValue = ''; }
}
onMounted(async () => {
  window.addEventListener('keydown', keydown);
  window.addEventListener('beforeunload', beforeUnload);
  try {
    const opened = await invoke<{ path: string; snapshot: Snapshot }>('standalone_read');
    path.value = opened.path;
    const model = new StandaloneSession(opened.snapshot);
    const draft = localStorage.getItem(draftKey);
    if (draft) {
      try {
        const parsed = JSON.parse(draft);
        if (typeof parsed.content !== 'string' || typeof parsed.base?.content !== 'string' || typeof parsed.base?.hash !== 'string') {
          throw new Error('Invalid draft');
        }
        model.base = parsed.base;
        model.content = parsed.content;
        model.acceptExternal(opened.snapshot);
        status.value = '已恢复本地草稿';
      } catch {
        // Keep the unreadable bytes before normal draft persistence resumes.
        localStorage.setItem(`${draftKey}.unreadable.${Date.now()}`, draft);
        error.value = '本地草稿损坏，原记录已备份，当前显示磁盘文件。';
      }
    }
    session.value = model;
    unlistenClose = await appWindow.onCloseRequested(event => {
      if (session.value?.dirty || saving.value) { event.preventDefault(); preserveDraft(); closing.value = true; }
    });
    unlistenFocus = await appWindow.onFocusChanged(({ payload }) => { if (payload) void refresh(); });
    if (disposed) { unlistenClose(); unlistenFocus(); }
  } catch (cause) { error.value = String(cause); }
});
onBeforeUnmount(() => {
  disposed = true;
  clearTimeout(draftTimer);
  preserveDraft();
  unlistenClose?.();
  unlistenFocus?.();
  window.removeEventListener('keydown', keydown);
  window.removeEventListener('beforeunload', beforeUnload);
});
</script>

<template>
  <main class="standalone-file">
    <header class="standalone-header">
      <div class="standalone-name"><strong>{{ name }}{{ session?.dirty ? ' · 未保存' : '' }}</strong><span :title="displayPath">{{ displayPath || '正在打开文件…' }}</span></div>
      <button :disabled="!session" :aria-pressed="source" @click="source = !source">{{ source ? '阅读编辑' : '源码' }}</button>
      <button :disabled="!session || saving" @click="copy">另存副本</button>
      <button :disabled="!session?.dirty || saving" @click="save">{{ saving ? '保存中…' : '保存' }}</button>
    </header>
    <p v-if="error" class="standalone-message" role="alert">{{ error }}</p>
    <p v-if="status" class="standalone-message" role="status">{{ status }}</p>
    <section v-if="session?.conflict" class="standalone-conflict" role="alert">
      <strong>文件有冲突：你的编辑和磁盘版本均已保留。</strong>
      <p>请对照磁盘内容整理编辑后另存副本。原文件不会被自动覆盖。</p>
      <details><summary>查看磁盘版本</summary><pre>{{ session.conflict.content }}</pre></details>
    </section>
    <div v-if="session" class="standalone-document">
      <SourceEditor v-if="source" v-model="session.content" :readonly="false" :local-native="true" :show-all-line-numbers="true" />
      <MarkdownEditor v-else v-model="session.content" :document-id="appWindow.label" @error="error = $event" @edit-source="source = true" />
    </div>
    <div v-if="closing" class="standalone-overlay">
      <section role="dialog" aria-modal="true" aria-labelledby="unsaved-title" class="standalone-dialog">
        <h2 id="unsaved-title">保存对 {{ name }} 的修改？</h2>
        <p>文件中还有未保存的编辑。</p>
        <div><button @click="closing = false">取消</button><button :disabled="saving" @click="discardAndClose">不保存</button><button :disabled="saving" @click="saveAndClose">保存并关闭</button></div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.standalone-file { height: 100%; display: flex; flex-direction: column; padding-top: var(--desktop-titlebar-height, 38px); color: var(--text); background: var(--paper); }
.standalone-header { display: flex; align-items: center; gap: 10px; padding: 18px 24px; border-bottom: 1px solid var(--line); }
.standalone-name { flex: 1; min-width: 0; display: grid; gap: 5px; }
.standalone-name span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--text-secondary); font-size: 12px; }
button { padding: 7px 13px; border: 1px solid var(--line); border-radius: 7px; background: var(--paper); color: inherit; cursor: pointer; }
button:disabled { opacity: .45; cursor: default; }
button[aria-pressed="true"] { background: var(--sidebar); }
.standalone-message { margin: 8px 24px; font-size: 13px; }
.standalone-conflict { padding: 12px 24px; background: #fff2cc; color: #654913; }
.standalone-conflict p { margin: 6px 0; }
.standalone-conflict pre { max-height: 180px; overflow: auto; white-space: pre-wrap; }
.standalone-document { flex: 1; min-height: 0; overflow: auto; padding: 32px max(32px, calc((100% - 820px) / 2)); }
.standalone-overlay { position: fixed; inset: 0; z-index: 100; background: #0005; display: grid; place-items: center; }
.standalone-dialog { background: var(--paper); border-radius: 12px; padding: 24px; max-width: 480px; }
.standalone-dialog div { display: flex; justify-content: flex-end; gap: 8px; }
</style>
