<script setup lang="ts">
import { t } from '../i18n';
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue';
import { Check, FileText, Link2, Pencil, X } from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import { referenceCandidates, referenceMarkdown } from '@tano/protocol';
import type { ReferenceIdentity, ReferenceTarget } from '@tano/protocol';

const props = defineProps<{ modelValue: string; disabled?: boolean; targets: readonly ReferenceTarget[]; preview?: boolean }>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; openReference: [identity: ReferenceIdentity]; openLink: [reference: string]; openWikiLink: [target: string] }>();
const textarea = ref<HTMLTextAreaElement>();
const descriptionId = `description-${getCurrentInstance()?.uid}`;
const searchInput = ref<HTMLInputElement>();
const picking = ref(false);
const query = ref('');
const error = ref('');
const editing = ref(!props.preview);
let range = { from: 0, to: 0 };
const candidates = computed(() => referenceCandidates(props.targets.filter(target => target.type === 'document'), query.value).slice(0, 30));
watch(() => props.disabled, disabled => { picking.value = false; if (disabled && props.preview) editing.value = false; });
watch(() => props.modelValue, () => { picking.value = false; error.value = ''; });
async function edit() {
  if (props.disabled) return;
  editing.value = true;
  await nextTick();
  textarea.value?.focus();
  textarea.value?.setSelectionRange(props.modelValue.length, props.modelValue.length);
}
function previewClicked(event: MouseEvent) {
  if ((event.target as Element).closest('a, button, input')) return;
  if (window.getSelection()?.toString()) return;
  void edit();
}
async function pick() {
  if (props.disabled) return;
  if (!editing.value) await edit();
  range = { from: textarea.value?.selectionStart ?? props.modelValue.length, to: textarea.value?.selectionEnd ?? props.modelValue.length };
  query.value = ''; error.value = ''; picking.value = !picking.value;
  await nextTick(); searchInput.value?.focus();
}
async function insert(target: ReferenceTarget) {
  if (props.disabled || !props.targets.some(item => item.type === target.type && item.id === target.id && item.workspace === target.workspace && !item.archived)) return;
  const link = referenceMarkdown(target, target.name);
  const value = props.modelValue.slice(0, range.from) + link + props.modelValue.slice(range.to);
  if (value.length > 20000) { error.value = t('描述不能超过 20000 字符'); return; }
  emit('update:modelValue', value);
  picking.value = false;
  await nextTick();
  textarea.value?.focus(); textarea.value?.setSelectionRange(range.from + link.length, range.from + link.length);
}
</script>

<template>
  <div class="description-editor" :class="{ 'with-preview': preview, 'is-editing': editing }">
    <div class="description-heading">
      <label :for="descriptionId">{{ t('描述') }}</label>
      <div class="description-actions">
        <button v-if="targets.some(target => target.type === 'document')" type="button" class="icon-button" :aria-label="t('插入文档引用')" :data-tooltip="t('插入文档引用')" :disabled="disabled" :aria-expanded="picking" @mousedown.prevent @click="pick"><Link2 :size="15" /></button>
        <button v-if="preview && !disabled" type="button" class="icon-button" :aria-label="editing ? t('完成描述编辑') : t('编辑描述')" :data-tooltip="editing ? t('完成描述编辑') : t('编辑描述')" @click="editing ? (editing = false, picking = false) : edit()"><Check v-if="editing" :size="15" /><Pencil v-else :size="15" /></button>
      </div>
    </div>
    <textarea v-if="editing" :id="descriptionId" ref="textarea" :value="modelValue" :disabled="disabled" rows="5" maxlength="20000" :aria-label="t('描述')" @input="emit('update:modelValue', ($event.target as HTMLTextAreaElement).value)" />
    <div v-else class="description-preview" :tabindex="disabled ? undefined : 0" role="group" :aria-label="t('描述内容')" @click="previewClicked" @keydown.enter.self.prevent="edit()">
      <MarkdownEditor v-if="modelValue.trim()" :model-value="modelValue" :document-id="descriptionId" :reference-targets="targets" readonly :reveal-markdown="false" open-links-on-tap :resolve-image="() => null" @open-reference="emit('openReference', $event)" @open-link="emit('openLink', $event)" @open-wiki-link="emit('openWikiLink', $event)" @error="error = $event" />
      <span v-else class="description-empty">{{ disabled ? t('暂无描述') : t('添加描述') }}</span>
    </div>
    <div v-if="picking" class="description-picker" @keydown.esc.stop.prevent="picking = false; textarea?.focus()">
      <div class="description-search"><input ref="searchInput" v-model="query" :aria-label="t('搜索引用文档')" :placeholder="t('搜索文档')" @keydown.enter.prevent="candidates[0] && insert(candidates[0])" /><button type="button" class="icon-button" :aria-label="t('关闭引用选择')" :data-tooltip="t('关闭引用选择')" @click="picking = false; textarea?.focus()"><X :size="16" /></button></div>
      <div class="description-candidates">
        <button v-for="target in candidates" :key="target.id" type="button" @click="insert(target)"><FileText :size="16" /><span>{{ target.name }}<small>{{ target.path }}</small></span></button>
        <p v-if="!candidates.length">{{ t('没有匹配的文档') }}</p>
      </div>
    </div>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.description-heading, .description-search { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.description-editor { min-width: 0; }
.description-actions { display: flex; align-items: center; gap: 2px; }
textarea { width: 100%; resize: vertical; min-height: 96px; font: inherit; }
.description-picker { border: 1px solid var(--line); padding: 8px; border-radius: 6px; margin-top: 6px; }
.description-search input { width: 100%; min-width: 0; }
.description-candidates { max-height: 220px; overflow: auto; }
.description-candidates button { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; padding: 8px; }
.description-candidates span { min-width: 0; overflow-wrap: anywhere; }
.description-candidates small { display: block; opacity: .65; }
.description-preview { min-height: 100px; padding: 4px 0; cursor: text; overflow-wrap: anywhere; }
.description-empty { color: var(--muted); font-size: 13px; }
.with-preview .description-heading { min-height: 28px; margin-bottom: 10px; }
.with-preview .description-preview :deep(.tano-prose) { padding: 0; margin: 0; max-width: none; min-height: 0; font-family: inherit; font-size: 14px; line-height: 1.8; }
.with-preview .description-preview :deep(.tano-prose > :first-child) { margin-top: 0; }
.with-preview .description-preview :deep(.tano-prose > :last-child) { margin-bottom: 0; }
.with-preview .description-preview :deep(.tano-prose p) { margin: 0 0 10px; }
.with-preview .description-preview :deep(.tano-prose blockquote) { margin: 12px 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--line); color: var(--text-secondary); background: transparent; }
.with-preview .description-preview :deep(.tano-prose blockquote p) { margin: 0; }
.with-preview .description-preview :deep(.tano-prose :is(h1, h2, h3, h4, h5, h6)) { font-size: 16px; line-height: 1.6; margin: 14px 0 8px; }
.with-preview .description-preview :deep(.tano-prose img) { display: none; }
.with-preview .description-preview :deep(.tano-reference) { font-size: 12px; }
.with-preview .description-preview :deep(.tano-block-handle) { display: none; }
.with-preview .description-preview :deep(.frontmatter-panel) { display: none; }
.with-preview .description-preview:focus-visible { outline: 2px solid var(--green); outline-offset: 6px; border-radius: 4px; }
</style>
