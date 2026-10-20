<script setup lang="ts">
import { t } from '../i18n';
import { computed, ref } from 'vue';
import { CalendarPlus, Repeat2 } from 'lucide-vue-next';
import { parseTaskRepeat } from '@tano/protocol';
import type { WorkspaceObject } from '@tano/protocol';
import type { ObjectRecord } from '../workspace-objects';
import type { RepeatPreview } from '../task-repeat';
import { useWorkspaceStore } from '../stores/workspace';
const props = defineProps<{ object: WorkspaceObject; record: ObjectRecord; disabled: boolean; dirty: boolean; workspaceId: string }>();
const emit = defineEmits<{ change: [value: unknown]; openRecord: [record: ObjectRecord] }>();
const store = useWorkspaceStore(), preview = ref<RepeatPreview | null>(), busy = ref(false), error = ref('');
const rule = computed(() => {
  const value = props.object.properties.repeatSourceId
    ? store.objects.find(record => record.object.id === props.object.properties.repeatSourceId)?.object.properties.repeat
    : props.object.properties.repeat;
  return value === undefined ? null : parseTaskRepeat(value);
});
const anchor = computed(() => String(props.object.properties.date ?? props.object.properties.due ?? ''));
function update(key: string, value: unknown) {
  preview.value = undefined; error.value = '';
  if (key === 'frequency' && !value) { emit('change', undefined); return; }
  try { emit('change', parseTaskRepeat({ version: 1, frequency: 'weekly', interval: 1, anchor: anchor.value, ...rule.value, [key]: value })); }
  catch (reason) { error.value = String(reason); }
}
async function prepare() {
  busy.value = true; error.value = '';
  try { preview.value = await store.repeatPreview(props.record, props.workspaceId); if (!preview.value) error.value = t('重复规则已结束'); }
  catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
async function create() {
  if (!preview.value) return;
  busy.value = true; error.value = '';
  try { emit('openRecord', await store.createRepeat(preview.value, props.workspaceId)); }
  catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
const people = computed(() => preview.value?.relations.filter(row => row.type === 'assigned').map(row => store.objects.find(item => item.object.id === row.source.id)?.object.name ?? t('不可用')).join('、') || t('未分配'));
</script>
<template>
  <section class="task-repeat" :aria-label="t('重复任务')">
    <label><Repeat2 :size="14" />{{ t('重复') }}<select :value="rule?.frequency ?? ''" :disabled="disabled || busy || !!object.properties.repeatSourceId" @change="update('frequency', ($event.target as HTMLSelectElement).value)"><option value="">{{ t('不重复') }}</option><option value="daily">{{ t('每天') }}</option><option value="weekly">{{ t('每周') }}</option><option value="monthly">{{ t('每月') }}</option></select></label>
    <template v-if="rule"><label>{{ t('间隔') }}<input type="number" min="1" max="99" :value="rule.interval" :disabled="disabled || busy || !!object.properties.repeatSourceId" @change="update('interval', Number(($event.target as HTMLInputElement).value))" /></label><label>{{ t('结束日期') }}<input type="date" :value="rule.until ?? ''" :disabled="disabled || busy || !!object.properties.repeatSourceId" @change="update('until', ($event.target as HTMLInputElement).value || undefined)" /></label><button type="button" :disabled="disabled || dirty || busy || object.properties.completed !== true" @click="prepare"><CalendarPlus :size="14" />{{ t('预览下一次') }}</button></template>
    <div v-if="preview" class="repeat-preview"><strong>{{ preview.object.name }}</strong><span>{{ t('下一次：') }}{{ preview.object.properties.date ?? preview.object.properties.due }}</span><span>{{ t('负责人：') }}{{ people }}</span><span>{{ t('关联：') }}{{ preview.relations.length }} {{ t('项') }}</span><div><button type="button" :disabled="disabled || dirty || busy" @click="create">{{ t('确认创建下一次') }}</button><button type="button" :disabled="busy" @click="preview = undefined">{{ t('取消') }}</button></div></div>
    <p v-if="error" role="alert">{{ error }}</p>
  </section>
</template>
<style scoped>
.task-repeat { display: flex; flex-wrap: wrap; align-items: end; gap: 12px 18px; border-top: 1px solid var(--line); padding-top: 16px; margin-top: 18px; font-size: 12px; }
label { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; min-width: 0; }
select, input { min-height: 30px; max-width: 150px; min-width: 0; border: 1px solid var(--line); border-radius: 5px; padding: 4px 7px; background: var(--paper); color: var(--text); font: inherit; }
input[type=number] { width: 56px; } button { display: inline-flex; gap: 5px; align-items: center; font: inherit; color: var(--green); }
.repeat-preview { display: grid; gap: 8px; flex-basis: 100%; padding: 12px 0; border-top: 1px solid var(--line); }
.repeat-preview > div { display: flex; gap: 16px; } p { margin: 0; color: var(--danger); flex-basis: 100%; overflow-wrap: anywhere; }
</style>
