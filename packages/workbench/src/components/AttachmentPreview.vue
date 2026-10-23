<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import { computed, ref, watch } from 'vue';
import type { FileEntry } from '@tano/protocol';
import { basename, fileHandlers } from '@tano/protocol';
import { codePreviewTokens } from '@tano/editor/code-preview';
import { csvPreview, verifyPreviewBytes } from '../file-preview';
import PdfPreview from './PdfPreview.vue';
import { nativeAttachments } from '../attachments';
import { useWorkbenchRuntime } from '../runtime';

const props = defineProps<{ file?: FileEntry; url: string | null; workspaceId?: string }>();
const runtime = useWorkbenchRuntime();
const { adapter } = runtime;
const attachments = runtime.attachments ?? (runtime.native && adapter.mode === 'desktop' ? nativeAttachments : undefined);
const text = ref('');
const loading = ref(false);
const error = ref('');
const failed = ref(false);
const handler = computed(() => fileHandlers.resolve(props.file?.path ?? ''));
const type = computed(() => handler.value.preview);
const pdfBytes = ref<Uint8Array>();
const mediaUrl = ref('');
const csv = computed(() => type.value === 'csv' ? csvPreview(text.value, props.file?.path ?? '') : null);
const json = computed(() => {
  if (type.value !== 'json' || !text.value) return { content: text.value, error: '' };
  try { return { content: JSON.stringify(JSON.parse(text.value), null, 2), error: '' }; }
  catch (reason) { return { content: text.value, error: String(reason) }; }
});
const tokens = computed(() => codePreviewTokens(type.value === 'json' ? json.value.content : text.value,
  props.file?.path.split('.').at(-1)?.toLowerCase() ?? ''));
watch([() => props.workspaceId, () => props.file?.id, () => props.file?.path, () => props.file?.modified, () => props.file?.size, () => props.file?.contentHash, () => props.url], async (_next, _old, onCleanup) => {
  let current = true;
  const controller = new AbortController();
  let objectUrl = '';
  onCleanup(() => { current = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); });
  text.value = error.value = '';
  failed.value = false;
  loading.value = false;
  pdfBytes.value = undefined; mediaUrl.value = '';
  const file = props.file;
  const kind = type.value;
  const mime = handler.value.mimeType;
  if (!file || !['text', 'csv', 'json', 'code', 'pdf', 'image'].includes(kind)) return;
  const limit = (kind === 'pdf' || kind === 'image' ? 50 : 2) * 1024 * 1024;
  if (file.size > limit) { error.value = t('文件较大，请导出后查看。'); return; }
  loading.value = true;
  try {
    let bytes: Uint8Array;
    if (attachments?.readAttachment && props.workspaceId) {
      bytes = await attachments.readAttachment(props.workspaceId, file.path);
    } else if (props.url) {
      const response = await fetch(props.url, { signal: controller.signal });
      if (!response.ok) throw new Error(t('无法读取附件'));
      bytes = new Uint8Array(await response.arrayBuffer());
    } else bytes = new TextEncoder().encode((await adapter.read(file.path)).content);
    if (!current) return;
    if (bytes.byteLength > limit) throw new Error(t('文件较大，请导出后查看。'));
    verifyPreviewBytes(bytes, kind, mime);
    if (kind === 'pdf') pdfBytes.value = bytes;
    else if (kind === 'image') {
      objectUrl = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: mime }));
      mediaUrl.value = objectUrl;
    } else {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      if (content.includes('\0')) throw new Error(t('此文件暂不支持预览。'));
      text.value = content;
    }
  } catch (reason) {
    if (current) error.value = reason instanceof Error ? reason.message : t('无法读取附件');
  } finally { if (current) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <main class="attachment-preview" :aria-label="t('附件预览')">
    <p v-if="!file" role="status">{{ t('文件已移动或删除。') }}</p>
    <LoadingSkeleton v-else-if="loading" variant="document" :rows="8" />
    <p v-else-if="error" role="status">{{ error }}</p>
    <template v-else-if="type === 'csv' && csv">
      <p v-if="csv.error" role="alert">{{ csv.error }}</p>
      <p v-if="csv.truncated" role="status">{{ t('预览仅显示前 500 行、100 列。') }}</p>
      <table :aria-label="t('CSV 预览')"><tbody><tr v-for="(row, index) in csv.rows" :key="index"><th scope="row">{{ index + 1 }}</th><td v-for="(cell, column) in row" :key="column">{{ cell }}</td></tr></tbody></table>
    </template>
    <template v-else-if="type === 'json' || type === 'code'"><p v-if="json.error" role="alert">{{ json.error }}</p><pre><code><span v-for="(token, index) in tokens" :key="index" :class="token.className">{{ token.text }}</span></code></pre></template>
    <pre v-else-if="type === 'text'">{{ text }}</pre>
    <img v-else-if="type === 'image' && mediaUrl && !failed" :src="mediaUrl" :alt="basename(file.path)" @error="failed = true" />
    <video v-else-if="type === 'video' && url && !failed" :src="url" controls preload="metadata" @error="failed = true" />
    <audio v-else-if="type === 'audio' && url && !failed" :src="url" controls preload="metadata" @error="failed = true" />
    <PdfPreview v-else-if="type === 'pdf' && pdfBytes" :bytes="pdfBytes" />
    <p v-else role="status">{{ failed ? t('附件暂不可用，可导出后查看。') : t('此文件暂不支持预览。') }}</p>
  </main>
</template>

<style scoped>
.attachment-preview { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 24px; color: var(--text); }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.7 var(--font-mono); }
table { border-collapse: collapse; font-size: 13px; } th, td { border: 1px solid var(--line); padding: 6px 12px; text-align: left; white-space: pre-wrap; min-width: 50px; max-width: 400px; overflow-wrap: anywhere; } th { color: var(--muted); font-weight: normal; }
.token.comment { color: var(--muted); } .token.keyword, .token.boolean { color: #a35ac9; } .token.string { color: #418450; } .token.number, .token.function { color: #387bb2; }
img, video { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; object-fit: contain; }
audio { display: block; width: min(100%, 480px); }
iframe { display: block; width: 100%; height: 100%; min-height: 200px; border: 0; }
p { color: var(--muted); font-size: 14px; }
@media (max-width: 640px) { .attachment-preview { padding: 16px; } }
</style>
