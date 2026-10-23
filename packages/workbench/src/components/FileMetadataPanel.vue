<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { useWorkspaceStore } from '../stores/workspace';
import type { FileMetadataState } from '../file-metadata';
import { t } from '../i18n';
import DocumentScrollbar from './DocumentScrollbar.vue';
import { isMarkdown, referenceKey } from '@tano/protocol';
const props = defineProps<{ fileId: string; workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore();
const file = computed(() => store.workspace?.id === props.workspaceId ? store.fileRegistry?.get(props.fileId) : undefined);
const state = ref<FileMetadataState>();
const tags = ref(''); const properties = ref('{}'); const error = ref(''); const busy = ref(false);
const owner = ref(''); const status = ref(''); const linkTarget = ref('');
const identity = computed(() => ({ type: file.value && isMarkdown(file.value.path) ? 'document' : 'asset', id: props.fileId }));
const targets = computed(() => store.referenceTargets.filter(target => !target.archived && referenceKey(target) !== referenceKey(identity.value)));
const links = computed(() => store.relations.filter(row => row.type === 'related' &&
  [row.source, row.target].some(endpoint => referenceKey(endpoint) === referenceKey(identity.value))));
function linkedTarget(row: (typeof links.value)[number]) {
  return referenceKey(row.source) === referenceKey(identity.value) ? row.target : row.source;
}
async function addLink() {
  const target = targets.value.find(target => referenceKey(target) === linkTarget.value);
  if (!target || props.workspaceId !== store.workspace?.id) return;
  busy.value = true; error.value = '';
  try { await store.createRelation('related', identity.value, target); linkTarget.value = ''; }
  catch (reason) { error.value = String(reason); } finally { busy.value = false; }
}
async function removeLink(row: (typeof links.value)[number]) {
  if (props.workspaceId !== store.workspace?.id) return;
  busy.value = true; error.value = '';
  try { await store.removeRelation(row); } catch (reason) { error.value = String(reason); } finally { busy.value = false; }
}
function populate(loaded: FileMetadataState) {
  state.value = loaded; tags.value = loaded.file.tags.join(', ');
  const { owner: responsible, status: progress, ...custom } = loaded.file.properties;
  owner.value = String(responsible ?? ''); status.value = String(progress ?? ''); properties.value = JSON.stringify(custom, null, 2);
}
const panel = ref<HTMLElement>();
const scrollElement = ref<HTMLElement>();
const previousFocus = document.activeElement as HTMLElement | null;
onMounted(() => panel.value?.querySelector<HTMLButtonElement>('button')?.focus());
onBeforeUnmount(() => previousFocus?.isConnected && previousFocus.focus());
function trapFocus(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const controls = [...(panel.value?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [role=scrollbar][tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
  const target = event.shiftKey ? controls.at(-1) : controls[0];
  if ((event.shiftKey && document.activeElement === controls[0]) || (!event.shiftKey && document.activeElement === controls.at(-1))) {
    event.preventDefault(); target?.focus();
  }
}
watch(() => [props.workspaceId, props.fileId], async (_, _old, onCleanup) => {
  let current = true; onCleanup(() => { current = false; });
  state.value = undefined; error.value = '';
  try {
    const loaded = await store.readFileMetadata(props.fileId, props.workspaceId);
    if (!current) return;
    populate(loaded);
  } catch (reason) { if (current) error.value = String(reason); }
}, { immediate: true });
async function save() {
  if (!state.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const custom = JSON.parse(properties.value);
    if (!custom || typeof custom !== 'object' || Array.isArray(custom)) throw new Error('属性必须是 JSON 对象');
    if (Object.hasOwn(custom, 'owner') || Object.hasOwn(custom, 'status')) throw new Error('请使用上方负责人和状态输入框编辑 owner、status');
    const saved = await store.updateFileMetadata({ base: state.value.base, file: { ...state.value.file,
      tags: [...new Set(tags.value.split(/[,，]/).map(tag => tag.trim()).filter(Boolean))], properties: { ...custom, owner: owner.value.trim(), status: status.value.trim() } } }, props.workspaceId);
    populate(saved);
  } catch (reason) { error.value = String(reason); }
  finally { busy.value = false; }
}
</script>
<template>
  <div class="file-metadata-backdrop" @click.self="!busy && emit('close')" @keydown.esc.stop="!busy && emit('close')">
    <section ref="panel" role="dialog" aria-modal="true" :aria-label="t('文件属性')" class="file-metadata-panel" @keydown="trapFocus">
      <div ref="scrollElement" class="file-metadata-scroll"><div>
      <div class="heading"><strong>{{ t('文件属性') }}</strong><button :disabled="busy" @click="emit('close')">{{ t('关闭') }}</button></div>
      <template v-if="file">
        <dl><dt>{{ t('路径') }}</dt><dd>{{ file.path }}</dd><dt>File ID</dt><dd>{{ file.id }}</dd><dt>MIME</dt><dd>{{ file.mimeType }}</dd><dt>{{ t('大小') }}</dt><dd>{{ file.size }} bytes</dd><dt>SHA-256</dt><dd>{{ file.revision || '—' }}</dd></dl>
        <p v-if="isMarkdown(file.path)">{{ t('Markdown 属性在文档内编辑，关联来自正文引用。') }}</p>
        <template v-else>
        <form @submit.prevent="save">
          <label>{{ t('负责人') }}<input v-model="owner" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" maxlength="200" /></label>
          <label>{{ t('状态') }}<input v-model="status" list="file-status-options" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" maxlength="100" /></label>
          <datalist id="file-status-options"><option>{{ t('待处理') }}</option><option>{{ t('进行中') }}</option><option>{{ t('已完成') }}</option></datalist>
          <label>{{ t('标签（逗号分隔）') }}<input v-model="tags" :disabled="busy || !state || workspaceId !== store.workspace?.id || store.workspace?.readOnly || file.readOnly" /></label>
          <label>{{ t('属性（JSON）') }}<textarea class="panel-scrollbar" v-model="properties" rows="8" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" spellcheck="false" /></label>
          <button type="submit" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly">{{ t('保存') }}</button>
        </form>
        <section :aria-label="t('关联对象')">
          <h3>{{ t('关联对象') }}</h3>
          <ul><li v-for="row in links" :key="row.id">{{ targets.find(target => referenceKey(target) === referenceKey(linkedTarget(row)))?.name ?? referenceKey(linkedTarget(row)) }} <button :disabled="busy || store.workspace?.readOnly" @click="removeLink(row)">{{ t('移除关联') }}</button></li></ul>
          <label>{{ t('选择对象') }}<select v-model="linkTarget" :aria-label="t('选择对象')" :disabled="busy || store.workspace?.readOnly || !store.capabilities.features.objectReferences"><option value="">{{ t('选择对象') }}</option><option v-for="target in targets" :key="referenceKey(target)" :value="referenceKey(target)">{{ target.name }} · {{ target.type }}</option></select></label>
          <button :disabled="busy || !linkTarget || store.workspace?.readOnly" @click="addLink">{{ t('添加关联') }}</button>
          <p v-if="!store.capabilities.features.objectReferences">{{ t('请在工作区设置中启用 Level 2 对象引用。') }}</p>
        </section>
        </template>
      </template>
      <p v-else role="status">{{ t('文件已移动或删除。') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      </div></div>
      <DocumentScrollbar :scroll-element="scrollElement" />
    </section>
  </div>
</template>
<style scoped>
.file-metadata-backdrop { position: fixed; inset: 0; z-index: 1200; background: #0006; display: grid; place-items: center; padding: 16px; }
.file-metadata-panel { background: var(--surface, var(--paper)); color: var(--text); width: min(520px, 100%); max-height: 90dvh; overflow: hidden; display: flex; padding: 0; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px #0003; }
.file-metadata-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 24px; }
.heading { display: flex; justify-content: space-between; align-items: center; }
dl { display: grid; grid-template-columns: 80px 1fr; gap: 8px; font-size: 13px; } dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
label { display: grid; gap: 6px; margin: 12px 0; } input, textarea { width: 100%; box-sizing: border-box; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px; } textarea { font: 13px/1.5 var(--font-mono); }
button { padding: 6px 12px; } [role=alert] { color: var(--danger, #b33); overflow-wrap: anywhere; }
</style>
