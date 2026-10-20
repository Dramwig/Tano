<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { objectViewText, objectViewValue, referenceKey, viewEngine } from '@tano/protocol';
import type { WorkspaceObject, WorkspaceViewDefinition, ReferenceIdentity, ObjectViewLayout } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { t } from '../i18n';
import ObjectPanel from './ObjectPanel.vue';
const props = defineProps<{ view: WorkspaceViewDefinition }>();
const emit = defineEmits<{ 'open-object': [identity: ReferenceIdentity] }>();
const store = useWorkspaceStore();
const draft = ref(JSON.parse(JSON.stringify(props.view)) as WorkspaceViewDefinition);
const base = ref(store.workspaceViews.find(record => record.view.id === props.view.id)?.snapshot);
const query = computed(() => draft.value.objectDatabase!);
const dirty = computed(() => !base.value || JSON.stringify(draft.value) !== JSON.stringify(JSON.parse(base.value.content)));
const latest = computed(() => store.workspaceViews.find(record => record.view.id === props.view.id));
const stale = computed(() => latest.value?.snapshot.hash !== base.value?.hash);
const error = ref(''); const busy = ref(false); const panel = ref<{ id?: string; type?: string }>();
const writable = computed(() => store.workspace?.id === props.view.workspaceId && !store.workspace?.readOnly && store.capabilities.features.objectReferences);
const records = computed(() => store.workspace?.id === props.view.workspaceId ? store.objects : []);
const projection = computed(() => viewEngine.query(records.value.map(record => record.object), query.value, store.relations));
const types = computed(() => store.objectDefinitions.filter(type => type.storage === 'record' && !type.retired));
const fields = computed(() => {
  const names = new Map([['name', '名称'], ['type', '类型'], ['description', '描述'], ['archived', '归档'], ['property:status', '状态']]);
  for (const type of types.value) for (const field of type.fields) names.set(`property:${field.key}`, field.label);
  for (const record of records.value) for (const key of Object.keys(record.object.properties)) if (key.length > 0 && key.length <= 100 && !names.has(`property:${key}`)) names.set(`property:${key}`, key);
  return [...names].map(([key, label]) => ({ key, label }));
});
const statuses = computed(() => [...new Set(['待处理', '进行中', '已完成', ...records.value.map(r => objectViewText(r.object.properties.status)).filter(Boolean)])]);
const layouts: { id: ObjectViewLayout; label: string }[] = [{ id: 'table', label: '表格' }, { id: 'board', label: '看板' }, { id: 'gallery', label: '画廊' }];
const relationTarget = computed({ get: () => query.value.relatedTo ? referenceKey(query.value.relatedTo) : '', set: value => {
  const target = store.referenceTargets.find(target => referenceKey(target) === value);
  if (target) query.value.relatedTo = { type: target.type, id: target.id }; else delete query.value.relatedTo;
} });
function reload() { if (latest.value) { draft.value = JSON.parse(JSON.stringify(latest.value.view)); base.value = latest.value.snapshot; error.value = ''; } }
watch(() => props.view, () => { if (!dirty.value) reload(); });
async function save() {
  if (!base.value || busy.value) return;
  busy.value = true; error.value = '';
  try { base.value = await store.saveFileDatabase(JSON.parse(JSON.stringify(draft.value)), base.value); }
  catch (reason) { error.value = String(reason); } finally { busy.value = false; }
}
function countLinks(row: WorkspaceObject) { return store.relations.filter(edge => [edge.source, edge.target].some(endpoint => referenceKey(endpoint) === referenceKey(row))).length; }
function label(type: string) { return types.value.find(definition => definition.type === type)?.label ?? type; }
async function setStatus(row: WorkspaceObject, event: Event) {
  const record = records.value.find(record => record.object.id === row.id);
  if (!record || !writable.value || busy.value) return;
  const status = (event.target as HTMLSelectElement).value;
  busy.value = true; error.value = '';
  try {
    const value = JSON.parse(JSON.stringify(row)) as WorkspaceObject;
    value.properties.status = status;
    if (value.type === 'task') value.properties.completed = ['已完成', 'done', 'completed'].includes(status);
    await store.updateObject(record, value, props.view.workspaceId);
  } catch (reason) { error.value = String(reason); (event.target as HTMLSelectElement).value = objectViewText(row.properties.status); }
  finally { busy.value = false; }
}
</script>
<template>
  <main class="object-database" :aria-label="view.name">
    <header><div><p>{{ t('对象数据库') }}</p><h1>{{ view.name }}</h1><p>{{ t('同一批记录，多个视图；切换视图不会复制对象或关系。') }}</p></div><strong>{{ projection.rows.length }} {{ t('条记录') }}</strong></header>
    <nav :aria-label="t('切换对象视图')"><button v-for="layout in layouts" :key="layout.id" :aria-pressed="query.layout === layout.id" @click="query.layout = layout.id">{{ t(layout.label) }}</button></nav>
    <form class="query" @submit.prevent="save">
      <label>{{ t('视图名称') }}<input v-model="draft.name" required maxlength="200" /></label>
      <fieldset><legend>{{ t('对象类型') }}</legend><label v-for="type in types" :key="type.type"><input v-model="query.types" type="checkbox" :value="type.type" />{{ t(type.label) }}</label></fieldset>
      <label><input v-model="query.includeArchived" type="checkbox" />{{ t('包含已归档记录') }}</label>
      <div v-for="(filter, index) in query.filters" :key="index" class="controls">
        <select v-model="filter.field" :aria-label="t('筛选字段')"><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select>
        <select v-model="filter.operator" :aria-label="t('筛选条件')"><option value="contains">{{ t('包含') }}</option><option value="equals">{{ t('等于') }}</option><option value="empty">{{ t('为空') }}</option></select>
        <input v-if="filter.operator !== 'empty'" v-model="filter.value" :aria-label="t('筛选值')" maxlength="2000" />
        <button type="button" :aria-label="t('移除筛选')" @click="query.filters.splice(index, 1)">×</button>
      </div>
      <div class="controls">
        <button type="button" :disabled="query.filters.length >= 20" @click="query.filters.push({ field: 'name', operator: 'contains', value: '' })">{{ t('添加筛选') }}</button>
        <label>{{ t('排序') }}<select v-model="query.sort.field" :aria-label="t('排序')"><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select></label>
        <select v-model="query.sort.direction" :aria-label="t('排序方向')"><option value="asc">{{ t('升序') }}</option><option value="desc">{{ t('降序') }}</option></select>
        <label>{{ t('分组') }}<select v-model="query.groupBy" :aria-label="t('分组')"><option v-for="field in fields" :key="field.key" :value="field.key">{{ t(field.label) }}</option></select></label>
        <label>{{ t('关联到') }}<select v-model="relationTarget" :aria-label="t('关联到')"><option value="">{{ t('全部') }}</option><option v-for="target in store.referenceTargets" :key="referenceKey(target)" :value="referenceKey(target)">{{ target.name }} · {{ target.type }}</option></select></label>
        <button type="submit" :disabled="busy || !dirty || !writable">{{ t('保存视图') }}</button><span v-if="dirty">{{ t('设置尚未保存') }}</span>
      </div>
    </form>
    <p v-if="stale" role="status">{{ t('视图已在外部更新，当前设置仍保留。') }}<button @click="reload">{{ t('丢弃当前设置并重新载入') }}</button></p>
    <p v-if="error" role="alert">{{ error }}</p>
    <p v-for="message in store.objectErrors" :key="message" role="alert">{{ message }}</p>
    <div class="controls"><button v-for="type in types" :key="type.type" :disabled="!writable || busy" @click="panel = { type: type.type }">{{ t('新建{0}', [t(type.label)]) }}</button></div>
    <p v-if="!projection.rows.length">{{ t('没有符合条件的对象记录。') }}</p>
    <div v-if="query.layout === 'table'" class="table-scroll"><table><thead><tr><th>{{ t('名称') }}</th><th>{{ t('类型') }}</th><th>{{ t('状态') }}</th><th>{{ t('描述') }}</th><th>{{ t('关联') }}</th></tr></thead><tbody>
      <tr v-for="row in projection.rows" :key="referenceKey(row)" :data-object-id="row.id"><td><button @click="panel = { id: row.id }">{{ row.name }}</button></td><td>{{ t(label(row.type)) }}</td><td><select :value="row.properties.status ?? ''" :aria-label="`${t('状态')}：${row.name}`" :disabled="!writable || busy || row.properties.syncReadOnly === true" @change="setStatus(row, $event)"><option value="">{{ t('未设置') }}</option><option v-for="status in statuses" :key="status">{{ status }}</option></select></td><td>{{ row.description }}</td><td>{{ countLinks(row) }}</td></tr>
    </tbody></table></div>
    <div v-else-if="query.layout === 'board'" class="board"><section v-for="group in projection.groups" :key="group.name" class="column"><h2>{{ group.name || t('未设置') }} <small>{{ group.rows.length }}</small></h2><article v-for="row in group.rows" :key="referenceKey(row)" :data-object-id="row.id"><button @click="panel = { id: row.id }">{{ row.name }}</button><p>{{ t(label(row.type)) }}</p><p>{{ row.description }}</p><label>{{ t('状态') }}<select :value="row.properties.status ?? ''" :aria-label="`${t('状态')}：${row.name}`" :disabled="!writable || busy || row.properties.syncReadOnly === true" @change="setStatus(row, $event)"><option value="">{{ t('未设置') }}</option><option v-for="status in statuses" :key="status">{{ status }}</option></select></label><small>{{ countLinks(row) }} {{ t('关联') }}</small></article></section></div>
    <div v-else class="gallery"><article v-for="row in projection.rows" :key="referenceKey(row)" :data-object-id="row.id"><p>{{ t(label(row.type)) }} · {{ objectViewText(objectViewValue(row, 'property:status')) || t('未设置') }}</p><h2><button @click="panel = { id: row.id }">{{ row.name }}</button></h2><p class="description">{{ row.description }}</p><small>{{ countLinks(row) }} {{ t('关联') }}</small></article></div>
    <Teleport to="body"><ObjectPanel v-show="!!panel" :open="!!panel" :selected-id="panel?.id" :initial-type="panel?.type" @close="panel = undefined" @open-reference="emit('open-object', $event)" @open-resource="emit('open-object', $event)" /></Teleport>
  </main>
</template>
<style scoped>
.object-database { height: 100%; overflow: auto; box-sizing: border-box; padding: 28px; background: var(--surface); color: var(--text); } header { display: flex; justify-content: space-between; align-items: center; gap: 18px; } header p, small { color: var(--muted); } h1 { font-size: 26px; } h2 { font-size: 17px; } nav, .controls, fieldset { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; } nav { margin: 20px 0; } button, input, select { color: var(--text); background: var(--paper); border: 1px solid var(--line); border-radius: 6px; padding: 7px 10px; font: inherit; max-width: 100%; box-sizing: border-box; } button { cursor: pointer; } button[aria-pressed=true] { background: var(--accent); font-weight: 600; } button:disabled { opacity: .5; cursor: default; } label { display: inline-flex; gap: 6px; align-items: center; font-size: 13px; } fieldset { border: 0; padding: 0; } legend { font-size: 13px; margin-bottom: 8px; } .query { display: grid; gap: 12px; padding: 16px; margin-bottom: 16px; border: 1px solid var(--line); border-radius: 10px; } .table-scroll { overflow-x: auto; margin-top: 18px; } table { min-width: 720px; width: 100%; border-collapse: collapse; text-align: left; } th, td { padding: 12px; border-bottom: 1px solid var(--line); font-size: 13px; max-width: 350px; overflow-wrap: anywhere; } .board { display: flex; gap: 16px; overflow-x: auto; margin-top: 18px; } .column { flex: 0 0 280px; } article { padding: 16px; margin-bottom: 12px; border: 1px solid var(--line); border-radius: 10px; overflow-wrap: anywhere; } article p { font-size: 13px; line-height: 1.6; white-space: pre-wrap; } .gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 250px), 1fr)); gap: 16px; margin-top: 20px; } .description { max-height: 160px; overflow: auto; } [role=alert] { color: var(--danger, #b33); } @media(max-width:620px) { .object-database { padding: 16px; } header { display: block; } }
</style>
