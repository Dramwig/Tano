<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { FileEntry } from '@tano/protocol';
import { basename } from '@tano/protocol';
import { useWorkbenchRuntime } from '../runtime';

const props = defineProps<{ file?: FileEntry; url: string | null }>();
const { adapter } = useWorkbenchRuntime();
const text = ref('');
const loading = ref(false);
const error = ref('');
const failed = ref(false);
const type = computed(() => {
  const path = props.file?.path ?? '';
  if (/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i.test(path)) return 'image';
  if (/\.(mp4|webm|mov)$/i.test(path)) return 'video';
  if (/\.(mp3|wav|ogg|m4a|flac)$/i.test(path)) return 'audio';
  if (/\.pdf$/i.test(path)) return 'pdf';
  if (/\.(txt|log|csv|tsv|json|ya?ml|xml|html?|css|js|ts|tsx|jsx|vue|py|rs|toml|ini|sh|sql)$/i.test(path)) return 'text';
  return 'other';
});
watch(() => [props.file?.id, props.file?.path, props.file?.modified, props.url], async (_next, _old, onCleanup) => {
  let current = true;
  const controller = new AbortController();
  onCleanup(() => { current = false; controller.abort(); });
  text.value = error.value = '';
  failed.value = false;
  loading.value = false;
  const file = props.file;
  if (!file || type.value !== 'text') return;
  if (file.size > 2 * 1024 * 1024) { error.value = '文件较大，请导出后查看。'; return; }
  loading.value = true;
  try {
    let content: string;
    if (props.url) {
      const response = await fetch(props.url, { signal: controller.signal });
      if (!response.ok) throw new Error('无法读取附件');
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 2 * 1024 * 1024) throw new Error('文件较大，请导出后查看。');
      content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } else content = (await adapter.read(file.path)).content;
    if (current) text.value = content;
  } catch (reason) {
    if (current) error.value = reason instanceof Error ? reason.message : '无法读取附件';
  } finally { if (current) loading.value = false; }
}, { immediate: true });
</script>

<template>
  <main class="attachment-preview" aria-label="附件预览">
    <p v-if="!file" role="status">文件已移动或删除。</p>
    <p v-else-if="loading" role="status">正在读取附件…</p>
    <p v-else-if="error" role="status">{{ error }}</p>
    <pre v-else-if="type === 'text'">{{ text }}</pre>
    <img v-else-if="type === 'image' && url && !failed" :src="url" :alt="basename(file.path)" @error="failed = true" />
    <video v-else-if="type === 'video' && url && !failed" :src="url" controls preload="metadata" @error="failed = true" />
    <audio v-else-if="type === 'audio' && url && !failed" :src="url" controls preload="metadata" @error="failed = true" />
    <iframe v-else-if="type === 'pdf' && url && !failed" :src="url" :title="basename(file.path)" sandbox="" @error="failed = true" />
    <p v-else role="status">{{ failed ? '附件暂不可用，可导出后查看。' : '此文件暂不支持预览。' }}</p>
  </main>
</template>

<style scoped>
.attachment-preview { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 24px; color: var(--text); }
pre { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 14px/1.7 Consolas, monospace; }
img, video { display: block; max-width: 100%; max-height: 100%; margin: 0 auto; object-fit: contain; }
audio { display: block; width: min(100%, 480px); }
iframe { display: block; width: 100%; height: 100%; min-height: 200px; border: 0; }
p { color: var(--muted); font-size: 14px; }
@media (max-width: 640px) { .attachment-preview { padding: 16px; } }
</style>
