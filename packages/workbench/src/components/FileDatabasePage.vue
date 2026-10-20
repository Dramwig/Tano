<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { Table2, Filter, Save, SlidersHorizontal } from 'lucide-vue-next';
import { emptyFileMetadata, fileMetadataPath, queryFileDatabase, groupFileDatabase, isMarkdown } from '@tano/protocol';
import type { FileEntry, FileMetadata, WorkspaceViewDefinition } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import FileMetadataPanel from './FileMetadataPanel.vue';
import DocumentScrollbar from './DocumentScrollbar.vue';
import { t } from '../i18n';
const props = defineProps<{ view: WorkspaceViewDefinition }>();
const emit = defineEmits<{ 'open-file': [file: FileEntry]; 'edit-document-properties': [file: FileEntry] }>();
const store = useWorkspaceStore();
const scrollElement = ref<HTMLElement>();
const draft = ref(JSON.parse(JSON.stringify(props.view)) as WorkspaceViewDefinition);
const base = ref(store.workspaceViews.find(record => record.view.id === props.view.id)?.snapshot);
const query = computed(() => draft.value.database!);
// Compare parsed data: portable JSON may be indented or have different property order.
const changed = computed(() => !base.value || JSON.stringify(draft.value) !== JSON.stringify(JSON.parse(base.value.content)));
const error = ref(''); const loading = ref(false); const saving = ref(false); const selected = ref('');
const metadata = ref<Record<string, FileMetadata>>({});
const referenceCounts = ref<Record<string, number>>({});
const errors = ref<string[]>([]);
const files = computed(() => store.workspace?.id === props.view.workspaceId ? store.fileRegistry?.userFiles() ?? [] : []);
const rows = computed(() => files.value.map(file => ({ file, metadata: metadata.value[file.id] ?? emptyFileMetadata(file.id) })));
const results = computed(() => queryFileDatabase(rows.value, query.value));
const groups = computed(() => groupFileDatabase(results.value, query.value.groupBy));
const fields = computed(() => [
  { key: 'path', label: '路径' }, { key: 'name', label: '名称' }, { key: 'type', label: '格式' },
  { key: 'tags', label: '标签' }, { key: 'property:owner', label: '负责人' }, { key: 'property:status', label: '状态' },
  { key: 'size', label: '大小' }, { key: 'modified', label: '修改时间' },
  ...[...new Set(Object.values(metadata.value).flatMap(m => Object.keys(m.properties)))].filter(k => !['owner', 'status'].includes(k)).sort().map(key => ({ key: `property:${key}`, label: key })),
]);
const external = computed(() => store.workspaceViews.find(record => record.view.id === props.view.id));
const stale = computed(() => external.value?.snapshot.hash !== base.value?.hash);
function reload() {
  if (!external.value) return;
  draft.value = JSON.parse(JSON.stringify(external.value.view)); base.value = external.value.snapshot; error.value = '';
}
watch(() => props.view, () => { if (!changed.value) reload(); });
watch(() => [props.view.workspaceId, files.value.map(f => `${f.id}:${f.path}:${f.contentHash ?? f.modified}`).join(','), store.referenceRevision, store.workspace?.files.filter(f => f.path.startsWith('.tano/files/')).map(f => `${f.path}:${f.contentHash ?? f.modified}`).join(',')], async (_, _old, onCleanup) => {
  let current = true; onCleanup(() => { current = false; }); loading.value = true;
  const next: Record<string, FileMetadata> = {}; const failures: string[] = [];
  const counts: Record<string, number> = {};
  const paths = new Set(store.workspace?.files.map(entry => entry.path));
  for (const file of files.value) {
    if (!isMarkdown(file.path) && !paths.has(fileMetadataPath(file.id))) continue;
    try { const state = await store.readFileMetadata(file.id, props.view.workspaceId); next[file.id] = state.file; if (state.referenceCount !== undefined) counts[file.id] = state.referenceCount; }
    catch (reason) { failures.push(`${file.path}: ${String(reason)}`); }
    if (!current) return;
  }
  metadata.value = next; referenceCounts.value = counts; errors.value = failures; loading.value = false;
}, { immediate: true });
async function save() {
  if (!base.value) return;
  saving.value = true; error.value = '';
  try { base.value = await store.saveFileDatabase(JSON.parse(JSON.stringify(draft.value)), base.value); }
  catch (reason) { error.value = String(reason); } finally { saving.value = false; }
}
function linkCount(id: string) {
  if (files.value.some(file => file.id === id && isMarkdown(file.path))) return referenceCounts.value[id] ?? 0;
  return store.relations.filter(row => [row.source, row.target].some(e => ['asset', 'document'].includes(e.type) && e.id === id)).length;
}
function editProperties(file: FileEntry) {
  if (isMarkdown(file.path)) emit('edit-document-properties', file);
  else selected.value = file.id;
}
</script>
<template>
  <div class="file-database-shell">
  <main ref="scrollElement" class="file-database" :aria-label="view.name"><div class="database-content">
    <header><div class="database-heading"><Table2 :size="22" /><h1><input v-model="draft.name" :aria-label="t('视图名称')" maxlength="200" required /></h1><span class="database-count">{{ results.length }} / {{ files.length }} {{ t('个文件') }}</span></div><p>{{ query.directory || t('工作区根目录') }} · {{ t('直接查询原文件，不复制源文件') }}</p></header>
    <form class="database-query" @submit.prevent="save">
      <label class="checkbox"><input v-model="query.recursive" type="checkbox" />{{ t('包含子目录') }}</label>
      <div v-for="(filter, index) in query.filters" :key="index" class="filter-row">
        <select v-model="filter.field" :aria-label="t('筛选字段')"><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select>
        <select v-model="filter.operator" :aria-label="t('筛选条件')"><option value="contains">{{ t('包含') }}</option><option value="equals">{{ t('等于') }}</option><option value="empty">{{ t('为空') }}</option></select>
        <input v-if="filter.operator !== 'empty'" v-model="filter.value" :aria-label="t('筛选值')" maxlength="1000" />
        <button type="button" :aria-label="t('移除筛选')" @click="query.filters.splice(index, 1)">×</button>
      </div>
      <div class="query-actions">
        <button type="button" :disabled="query.filters.length >= 20" @click="query.filters.push({ field: 'path', operator: 'contains', value: '' })"><Filter :size="14" />{{ t('添加筛选') }}</button>
        <label>{{ t('排序') }}<select v-model="query.sort.field" :aria-label="t('排序')"><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select></label>
        <select v-model="query.sort.direction" :aria-label="t('排序方向')"><option value="asc">{{ t('升序') }}</option><option value="desc">{{ t('降序') }}</option></select>
        <label>{{ t('分组') }}<select v-model="query.groupBy" :aria-label="t('分组')"><option value="">{{ t('不分组') }}</option><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select></label>
        <button type="submit" :disabled="saving || !changed || store.workspace?.readOnly"><Save :size="14" />{{ saving ? t('保存中…') : t('保存视图') }}</button>
        <span v-if="changed">{{ t('设置尚未保存') }}</span>
      </div>
    </form>
    <p v-if="stale" role="status">{{ t('视图已在外部更新，当前设置仍保留。') }}<button @click="reload">{{ t('丢弃当前设置并重新载入') }}</button></p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-if="loading" role="status">{{ t('正在读取文件属性…') }}</p>
    <p v-for="message in errors" :key="message" role="alert">{{ message }}</p>
    <p v-if="!results.length && !loading">{{ t('没有符合条件的文件，请调整筛选或向目录添加文件。') }}</p>
    <section v-for="group in groups" :key="group.name">
      <h2 v-if="query.groupBy">{{ group.name || t('未设置') }} <small>{{ group.rows.length }}</small></h2>
      <div class="database-scroll panel-scrollbar"><table><colgroup><col class="column-file" /><col class="column-format" /><col class="column-tags" /><col class="column-owner" /><col class="column-status" /><col class="column-links" /><col class="column-actions" /></colgroup><thead><tr><th>{{ t('文件') }}</th><th>{{ t('格式') }}</th><th>{{ t('标签') }}</th><th>{{ t('负责人') }}</th><th>{{ t('状态') }}</th><th>{{ t('关联') }}</th><th>{{ t('属性') }}</th></tr></thead>
        <tbody><tr v-for="row in group.rows" :key="row.file.id" :data-file-id="row.file.id">
          <td :title="row.file.path"><button class="file-link" @click="emit('open-file', row.file)">{{ row.file.name }}</button><small>{{ row.file.path }}</small></td><td>{{ row.file.handlerId }}</td><td :title="row.metadata.tags.join(' · ')">{{ row.metadata.tags.join(' · ') || '—' }}</td><td :title="String(row.metadata.properties.owner ?? '')">{{ row.metadata.properties.owner ?? '—' }}</td><td :title="String(row.metadata.properties.status ?? '')">{{ row.metadata.properties.status ?? '—' }}</td><td>{{ linkCount(row.file.id) }}</td><td><button class="row-properties" :aria-label="`${t('编辑属性')}：${row.file.name}`" :title="isMarkdown(row.file.path) ? t('在文档中编辑属性') : t('编辑属性')" @click="editProperties(row.file)"><SlidersHorizontal :size="15" /></button></td>
        </tr></tbody></table></div>
    </section>
    <Teleport to="body"><FileMetadataPanel v-if="selected" :file-id="selected" :workspace-id="view.workspaceId" @close="selected = ''" /></Teleport>
  </div></main>
  <DocumentScrollbar :scroll-element="scrollElement" />
  </div>
</template>
<style scoped>
.file-database-shell { display: flex; height: 100%; min-height: 0; overflow: hidden; background: var(--paper); }
.file-database { flex: 1; height: 100%; min-width: 0; box-sizing: border-box; overflow: auto; padding: 22px 28px 24px; background: var(--paper); color: var(--text); }
.database-heading { display: flex; align-items: center; gap: 10px; }
.database-heading > svg { flex: none; color: var(--green); }
h1 { flex: 1; min-width: 0; margin: 0; font-size: 23px; font-weight: 650; }
h1 input { width: 100%; min-width: 0; font-size: inherit; font-weight: inherit; border-color: transparent; padding: 3px; background: transparent; }
header p { margin: 8px 0 14px 35px; color: var(--muted); font-size: 12px; line-height: 1.5; }
.database-count { color: var(--muted); white-space: nowrap; font-size: 11px; }
.database-query { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; margin: 0 0 14px; padding: 8px 0 12px; border-bottom: 1px solid var(--line); }
label, .query-actions, .filter-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 12px; }
label { color: var(--muted); }
.filter-row { flex-basis: 100%; }
input, select, button { color: var(--text); background: transparent; border: 1px solid transparent; border-radius: 5px; padding: 5px 7px; font: inherit; }
button { display: inline-flex; align-items: center; justify-content: center; gap: 5px; cursor: pointer; font-size: 12px; }
button:not(:disabled):hover, select:hover { background: var(--hover); }
button:disabled { opacity: .45; cursor: default; }
input { max-width: 100%; box-sizing: border-box; }
.filter-row input, .filter-row select { border-color: var(--line); background: var(--paper); }
input[type=checkbox] { accent-color: var(--green); margin: 0; }
input:focus-visible, select:focus-visible, button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.query-actions > span { color: var(--muted); font-size: 11px; }
.database-scroll { overflow-x: auto; }
table { width: 100%; min-width: 900px; table-layout: fixed; border-collapse: collapse; font-size: 12px; text-align: left; }
th, td { padding: 8px 9px; border-bottom: 1px solid var(--line); border-right: 1px solid color-mix(in srgb, var(--line) 65%, transparent); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.column-file { width: 32%; }
.column-format { width: 100px; }
.column-owner, .column-status { width: 110px; }
.column-links { width: 64px; }
.column-actions { width: 50px; }
th:last-child, td:last-child { border-right: 0; }
th { color: var(--muted); font-weight: 400; white-space: nowrap; background: var(--paper); }
tbody tr:hover { background: var(--sidebar); }
td small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block; margin-top: 4px; color: var(--muted); font-size: 11px; }
.file-link { display: block; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; justify-content: flex-start; padding: 0; border: 0; background: transparent; color: var(--text); text-align: left; }
.file-link:hover { color: var(--green); text-decoration: underline; background: transparent !important; }
.row-properties { color: var(--muted); padding: 5px; }
h2 { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 600; margin: 18px 0 8px; }
h2 small { color: var(--muted); font-size: 11px; font-weight: 400; }
[role=alert] { color: var(--danger); font-size: 13px; }
@media(max-width: 620px) { .file-database { padding: 16px 12px 20px; } h1 { font-size: 18px; } .database-heading { flex-wrap: wrap; } .database-count { margin-left: 32px; } header p { margin-left: 32px; } .filter-row input { width: 100%; } .database-query { gap: 10px; } }
</style>
