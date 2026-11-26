<script setup lang="ts">
import { useWindowContext } from '../../windows/context';
const { window, document } = useWindowContext();

import { vSurfaceMotion } from '@tano/editor/surface-motion';
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue';
import { X } from 'lucide-vue-next';
import { useWorkspaceStore } from '../../stores/workspace';
import type { FileMetadataState } from '../file-metadata';
import { t } from '../../i18n/i18n';
import DocumentScrollbar from '../../documents/components/DocumentScrollbar.vue';
import { isMarkdown, referenceKey } from '@tano/protocol';
const props = defineProps<{ fileId: string; workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();
const store = useWorkspaceStore();
const file = computed(() => store.workspace?.id === props.workspaceId ? store.fileRegistry?.get(props.fileId) : undefined);
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
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
  <div v-surface-motion="'FileMetadataPanel:0'" class="file-metadata-backdrop" data-surface-role="backdrop" @click.self="!busy && emit('close')" @keydown.esc.stop="!busy && emit('close')">
    <section ref="panel" role="dialog" aria-modal="true" :aria-label="t('文件属性')" class="file-metadata-panel" data-surface-role="dialog" @keydown="trapFocus">
      <div ref="scrollElement" class="file-metadata-scroll"><div>
      <div class="heading"><h2>{{ t('文件属性') }}</h2><button type="button" class="icon-button" :aria-label="t('关闭')" :disabled="busy" @click="emit('close')"><X :size="18" /></button></div>
      <template v-if="file">
        <dl class="summary-meta"><dt>{{ t('路径') }}</dt><dd>{{ file.path }}</dd><dt>{{ t('大小') }}</dt><dd>{{ formatSize(file.size) }}</dd></dl>
        <p v-if="isMarkdown(file.path)" class="meta-hint">{{ t('Markdown 属性在文档内编辑，关联来自正文引用。') }}</p>
        <template v-else>
        <form @submit.prevent="save">
          <label>{{ t('负责人') }}<input v-model="owner" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" maxlength="200" /></label>
          <label>{{ t('状态') }}<input v-model="status" list="file-status-options" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" maxlength="100" /></label>
          <datalist id="file-status-options"><option>{{ t('待处理') }}</option><option>{{ t('进行中') }}</option><option>{{ t('已完成') }}</option></datalist>
          <label>{{ t('标签（逗号分隔）') }}<input v-model="tags" :disabled="busy || !state || workspaceId !== store.workspace?.id || store.workspace?.readOnly || file.readOnly" /></label>
          <details class="technical-details">
            <summary>{{ t('技术详情') }}</summary>
            <dl class="tech-meta"><dt>File ID</dt><dd><code>{{ file.id }}</code></dd><dt>MIME</dt><dd><code>{{ file.mimeType }}</code></dd><dt>SHA-256</dt><dd><code>{{ file.revision || '—' }}</code></dd></dl>
            <label>{{ t('属性（JSON）') }}<textarea class="panel-scrollbar" v-model="properties" rows="6" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly" spellcheck="false" /></label>
          </details>
          <div class="form-actions"><button type="submit" class="primary-button" :disabled="busy || !state || store.workspace?.readOnly || file.readOnly">{{ t('保存') }}</button></div>
        </form>
        <section class="relations-section" :aria-label="t('关联对象')">
          <h3>{{ t('关联对象') }}</h3>
          <ul v-if="links.length" class="link-list"><li v-for="row in links" :key="row.id"><span>{{ targets.find(target => referenceKey(target) === referenceKey(linkedTarget(row)))?.name ?? referenceKey(linkedTarget(row)) }}</span><button type="button" class="secondary-button" :disabled="busy || store.workspace?.readOnly" @click="removeLink(row)">{{ t('移除关联') }}</button></li></ul>
          <div class="link-picker">
            <select v-model="linkTarget" :aria-label="t('选择对象')" :disabled="busy || store.workspace?.readOnly || !store.capabilities.features.objectReferences"><option value="">{{ t('选择对象') }}</option><option v-for="target in targets" :key="referenceKey(target)" :value="referenceKey(target)">{{ target.name }} · {{ target.type }}</option></select>
            <button type="button" class="secondary-button" :disabled="busy || !linkTarget || store.workspace?.readOnly" @click="addLink">{{ t('添加关联') }}</button>
          </div>
          <p v-if="!store.capabilities.features.objectReferences" class="meta-hint">{{ t('请在工作区设置中启用「工作区对象与引用」。') }}</p>
        </section>
        </template>
        <details v-if="isMarkdown(file.path)" class="technical-details">
          <summary>{{ t('技术详情') }}</summary>
          <dl class="tech-meta"><dt>File ID</dt><dd><code>{{ file.id }}</code></dd><dt>MIME</dt><dd><code>{{ file.mimeType }}</code></dd><dt>SHA-256</dt><dd><code>{{ file.revision || '—' }}</code></dd></dl>
        </details>
      </template>
      <p v-else role="status">{{ t('文件已移动或删除。') }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      </div></div>
      <DocumentScrollbar :scroll-element="scrollElement" />
    </section>
  </div>
</template>
<style scoped>
@layer components {
.file-metadata-backdrop { position: fixed; inset: 0; z-index: 1200; background: #0006; display: grid; place-items: center; padding: 16px; }
.file-metadata-panel { background: var(--surface, var(--paper)); color: var(--text); width: min(520px, 100%); max-height: 90dvh; overflow: hidden; display: flex; padding: 0; border: 1px solid var(--line); border-radius: 12px; box-shadow: 0 12px 40px #0003; }
.file-metadata-scroll { flex: 1; min-width: 0; min-height: 0; overflow: auto; padding: 22px 24px; }
.heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.heading h2 { margin: 0; font-size: 16px; font-weight: 600; }
dl { display: grid; grid-template-columns: 76px 1fr; gap: 6px 10px; font-size: 13px; margin: 10px 0 14px; }
dt { color: var(--muted); }
dd { margin: 0; overflow-wrap: anywhere; }
code { font: 12px/1.4 var(--font-mono); color: var(--text-secondary, var(--muted)); }
.meta-hint { font-size: 12px; color: var(--muted); margin: 8px 0 12px; }
label { display: grid; gap: 6px; margin: 12px 0; font-size: 13px; }
input, textarea, select { width: 100%; box-sizing: border-box; background: var(--paper); color: var(--text); border: 1px solid var(--line); border-radius: 6px; padding: 8px; font: inherit; }
textarea { font: 12.5px/1.5 var(--font-mono); }
.technical-details { margin: 14px 0; padding: 10px 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); }
.technical-details > summary { cursor: pointer; font-size: 12.5px; font-weight: 500; color: var(--muted); user-select: none; }
.tech-meta { margin: 10px 0 6px; font-size: 12px; }
.form-actions { display: flex; justify-content: flex-end; margin-top: 12px; }
.relations-section { margin-top: 18px; padding-top: 14px; border-top: 1px solid var(--line); }
.relations-section h3 { margin: 0 0 10px; font-size: 13.5px; font-weight: 600; }
.link-list { list-style: none; padding: 0; margin: 0 0 10px; display: grid; gap: 6px; }
.link-list li { display: flex; align-items: center; justify-content: space-between; gap: 8px; font-size: 13px; padding: 6px 8px; border: 1px solid var(--line); border-radius: 6px; background: var(--paper); }
.link-picker { display: flex; gap: 8px; align-items: center; }
.link-picker select { flex: 1; min-width: 0; }
.link-picker button { flex-shrink: 0; }
[role=alert] { color: var(--danger, #b33); overflow-wrap: anywhere; font-size: 13px; }
}
</style>
