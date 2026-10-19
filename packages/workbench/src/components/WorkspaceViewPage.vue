<script setup lang="ts">
import { computed } from 'vue';
import { AlertTriangle, ArrowUpRight, Boxes, FileText, Image as ImageIcon, Table2 } from 'lucide-vue-next';
import { basename, isMarkdown } from '@tano/protocol';
import type { FileEntry, ReferenceIdentity, WorkspaceViewDefinition } from '@tano/protocol';
import { t } from '../i18n';
import { useWorkspaceStore } from '../stores/workspace';

const props = defineProps<{ view: WorkspaceViewDefinition }>();
const emit = defineEmits<{
  'open-file': [file: FileEntry];
  'open-object': [identity: ReferenceIdentity];
}>();
const store = useWorkspaceStore();

const kindLabel = computed(() => ({
  files: t('文件视图'),
  objects: t('对象视图'),
  table: t('表格视图'),
  graph: t('关系视图'),
}[props.view.kind]));
const sourceRows = computed(() => props.view.sources.map((source) => {
  if (source.layer === 'file') {
    const file = store.workspace?.files.find((entry) => entry.id === source.fileId && entry.kind === 'file');
    return {
      key: `file:${source.fileId}`,
      layer: 'file' as const,
      label: file?.path ?? t('文件已不存在'),
      detail: file ? `${basename(file.path)} · ${file.size} bytes` : t('稳定文件 ID 未解析'),
      file,
      missing: !file,
    };
  }
  const target = store.referenceTargets.find((entry) => entry.type === source.type && entry.id === source.id);
  const record = store.objects.find((entry) => entry.object.type === source.type && entry.object.id === source.id);
  return {
    key: `object:${source.type}/${source.id}`,
    layer: 'object' as const,
    label: target?.name ?? record?.object.name ?? `${source.type}/${source.id}`,
    detail: target?.path ?? record?.path ?? t('对象已不存在'),
    identity: { type: source.type, id: source.id },
    missing: !target && !record,
  };
}));
const missingCount = computed(() => sourceRows.value.filter((row) => row.missing).length);
function open(row: (typeof sourceRows.value)[number]) {
  if (row.file) emit('open-file', row.file);
  else if (row.identity && !row.missing) emit('open-object', row.identity);
}
function fileIcon(row: (typeof sourceRows.value)[number]) {
  if (row.layer === 'object') return Boxes;
  if (row.file && isMarkdown(row.file.path)) return FileText;
  if (row.file?.path.match(/\.(png|jpe?g|gif|webp|svg)$/i)) return ImageIcon;
  return FileText;
}
</script>

<template>
  <main class="workspace-view-page" :aria-label="view.name">
    <header class="workspace-view-header">
      <div>
        <p class="workspace-view-kicker"><Table2 :size="15" />{{ kindLabel }}</p>
        <h1>{{ view.name }}</h1>
        <p class="workspace-view-description">
          {{ t('这是由稳定文件 ID 和对象 ID 重建的投影。打开来源时，Tano 会解析当前路径和内容版本。') }}
        </p>
      </div>
      <span class="workspace-view-count">{{ sourceRows.length }} {{ t('个来源') }}</span>
    </header>

    <div v-if="view.query" class="workspace-view-query">
      <span>{{ t('查询提示') }}</span>{{ view.query }}
    </div>
    <div v-if="missingCount" class="workspace-view-warning" role="status">
      <AlertTriangle :size="16" />
      {{ t('{0} 个来源当前无法解析，原始视图文件仍已保留。', [missingCount]) }}
    </div>

    <section class="workspace-view-sources" :aria-label="t('视图来源')">
      <button
        v-for="row in sourceRows"
        :key="row.key"
        type="button"
        class="workspace-view-source"
        :class="{ missing: row.missing }"
        :disabled="row.missing"
        @click="open(row)"
      >
        <component :is="fileIcon(row)" :size="19" />
        <span class="workspace-view-source-copy">
          <strong>{{ row.label }}</strong>
          <small>{{ row.layer === 'file' ? t('File · 真实文件来源') : t('Object · 结构化语义来源') }}</small>
          <small class="workspace-view-source-detail">{{ row.detail }}</small>
        </span>
        <ArrowUpRight v-if="!row.missing" :size="16" />
        <span v-else class="workspace-view-missing">{{ t('不可用') }}</span>
      </button>
    </section>
  </main>
</template>

<style scoped>
.workspace-view-page { height: 100%; overflow: auto; padding: clamp(28px, 6vw, 72px) clamp(20px, 7vw, 96px); box-sizing: border-box; background: var(--surface); }
.workspace-view-header { max-width: 960px; margin: 0 auto 24px; display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; }
.workspace-view-kicker { display: flex; align-items: center; gap: 7px; margin: 0 0 10px; color: var(--muted); font-size: 12px; }
h1 { margin: 0; font-size: clamp(24px, 4vw, 36px); letter-spacing: -.03em; }
.workspace-view-description { max-width: 680px; margin: 10px 0 0; color: var(--muted); line-height: 1.65; font-size: 14px; }
.workspace-view-count { flex-shrink: 0; border: 1px solid var(--line); border-radius: 999px; padding: 6px 10px; color: var(--muted); font-size: 12px; }
.workspace-view-query, .workspace-view-warning { max-width: 960px; margin: 0 auto 12px; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.workspace-view-query span { margin-right: 8px; font-weight: 600; color: var(--text); }
.workspace-view-warning { display: flex; align-items: center; gap: 8px; border-color: color-mix(in srgb, var(--warning) 45%, var(--line)); color: var(--warning); }
.workspace-view-sources { max-width: 960px; margin: 18px auto 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 280px), 1fr)); gap: 10px; }
.workspace-view-source { display: flex; align-items: flex-start; gap: 10px; min-width: 0; text-align: left; border: 1px solid var(--line); border-radius: 12px; padding: 14px; background: var(--surface-raised, var(--surface)); color: var(--text); transition: border-color .15s, background .15s; }
.workspace-view-source:not(:disabled):hover { border-color: var(--accent); background: var(--surface-hover, var(--surface)); }
.workspace-view-source > svg:last-child { flex-shrink: 0; margin-left: auto; color: var(--muted); }
.workspace-view-source-copy { min-width: 0; flex: 1; }
.workspace-view-source-copy strong, .workspace-view-source-copy small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.workspace-view-source-copy strong { font-size: 14px; font-weight: 600; }
.workspace-view-source-copy small { margin-top: 4px; color: var(--muted); font-size: 11px; }
.workspace-view-source-detail { overflow-wrap: anywhere; white-space: normal !important; }
.workspace-view-source.missing { opacity: .62; cursor: default; }
.workspace-view-missing { flex-shrink: 0; color: var(--muted); font-size: 11px; }
@media (max-width: 620px) { .workspace-view-header { display: block; } .workspace-view-count { display: inline-block; margin-top: 14px; } }
</style>
