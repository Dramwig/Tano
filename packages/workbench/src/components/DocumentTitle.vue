<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, ref, useId, watch } from 'vue';
import { basename, parentPath, pathKey, validatePath } from '@tano/protocol';
import type { FileEntry } from '@tano/protocol';
import { splitFrontmatter } from '@tano/editor/syntax';
import { frontmatterValue, updateFrontmatterProperty } from '@tano/editor/frontmatter-display';
import type { PageTitleSource } from '../page-title-source';
import DocumentAppearance from './DocumentAppearance.vue';

const props = withDefaults(defineProps<{
  workspaceId: string;
  documentId: string;
  path: string;
  titleSource?: PageTitleSource;
  modelValue?: string;
  files: FileEntry[];
  readonly: boolean;
  mode?: 'demo' | 'web' | 'local';
  resolveImage?: (reference: string) => string | null;
  uploadCover?: (file: File) => Promise<{ url: string }>;
  resourceRevision?: string | number;
  rename: (workspaceId: string, id: string, from: string, to: string) => Promise<void>;
}>(), { titleSource: 'frontmatter-first', modelValue: '' });
const emit = defineEmits<{
  enter: [workspaceId: string, documentId: string];
  'update:modelValue': [value: string];
  comment: [];
}>();
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const errorId = useId();
const yamlTitle = computed(() => {
  if (props.titleSource === 'filename') return null;
  try {
    return frontmatterValue(splitFrontmatter(props.modelValue).prefix, 'title');
  } catch {
    return null;
  }
});
const yamlTitleText = computed(() => {
  const property = yamlTitle.value;
  return property && ['text', 'date', 'datetime'].includes(property.kind)
    ? property.value.trim().replace(/[\r\n]+/g, ' ') : '';
});
const resolvedTitleSource = computed(() => props.titleSource === 'frontmatter' ||
  (props.titleSource === 'frontmatter-first' && yamlTitleText.value) ? 'frontmatter' : 'filename');
const title = computed(() => resolvedTitleSource.value === 'frontmatter'
  ? yamlTitleText.value : basename(props.path).replace(/\.(md|markdown)$/i, ''));
let titleBase = '';
let titleSourceBase = resolvedTitleSource.value;
const draft = ref(title.value);
const saving = ref(false);
const saveError = ref('');
const composing = ref(false);
const edited = ref(false);
const destination = computed(() => {
  const folder = parentPath(props.path);
  const extension = props.path.match(/\.(md|markdown)$/i)?.[0] ?? '.md';
  return `${folder ? `${folder}/` : ''}${draft.value.trim().normalize('NFC')}${extension}`;
});
const validation = computed(() => {
  if (!edited.value) return '';
  if (resolvedTitleSource.value !== titleSourceBase)
    return t('标题来源已改变，请按 Esc 重新载入后重试');
  if (!draft.value.trim()) return t('请输入文档标题');
  if (resolvedTitleSource.value === 'frontmatter') return '';
  if (/[\/\\]/.test(draft.value)) return t('标题不能包含路径分隔符');
  const invalid = validatePath(destination.value);
  if (invalid) return invalid;
  if (props.files.some((file) => file.id !== props.documentId &&
    pathKey(file.path) === pathKey(destination.value))) return t('已经存在一个同名文件');
  return '';
});
const error = computed(() => validation.value || saveError.value);

function reset() {
  draft.value = title.value;
  edited.value = false;
  saveError.value = '';
}
watch([() => props.path, () => props.titleSource], reset);
watch(title, () => { if (!edited.value) reset(); });

function input(event: Event) {
  if (!edited.value) {
    titleBase = JSON.stringify(yamlTitle.value);
    titleSourceBase = resolvedTitleSource.value;
  }
  draft.value = (event.target as HTMLInputElement).value;
  edited.value = true;
  saveError.value = '';
}
async function commit(): Promise<boolean> {
  if (props.readonly || saving.value || composing.value || validation.value) return false;
  if (!edited.value) return true;
  if (resolvedTitleSource.value === 'filename' && destination.value === props.path) {
    reset();
    return true;
  }
  saving.value = true;
  saveError.value = '';
  try {
    if (resolvedTitleSource.value === 'frontmatter') {
      if (JSON.stringify(yamlTitle.value) !== titleBase)
        throw new Error(t('YAML title 已被修改，请按 Esc 重新载入后重试'));
      if (draft.value.trim() === title.value) { reset(); return true; }
      const { prefix } = splitFrontmatter(props.modelValue);
      if (!prefix && /^\uFEFF?(?:---|\+\+\+)\r?\n/.test(props.modelValue))
        throw new Error(t('文档开头的属性无法解析，请在源码中修改'));
      const markdown = updateFrontmatterProperty(
        props.modelValue, yamlTitle.value ? 'title' : null, 'title', 'text', draft.value.trim(),
      );
      if (frontmatterValue(splitFrontmatter(markdown).prefix, 'title')?.value !== draft.value.trim())
        throw new Error(t('YAML title 无法更新，请在源码中修改'));
      emit('update:modelValue', markdown);
      await nextTick();
    } else {
      await props.rename(props.workspaceId, props.documentId, props.path, destination.value);
    }
    reset();
    return true;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    saveError.value = /已经存在|已存在|already exists|同名/i.test(message)
      ? t('已经存在一个同名文件') : message;
    return false;
  } finally {
    saving.value = false;
  }
}
async function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    const { workspaceId, documentId } = props;
    if (await commit() && !disposed && !props.readonly) emit('enter', workspaceId, documentId);
  } else if (event.key === 'Escape' && !saving.value) {
    event.preventDefault();
    event.stopPropagation();
    reset();
  }
}
</script>

<template>
  <div class="document-title" :aria-busy="saving">
    <DocumentAppearance :model-value="modelValue" :readonly="readonly || saving" :mode="mode"
      :resolve-image="resolveImage" :upload-cover="uploadCover" :resource-revision="resourceRevision"
      @update:model-value="emit('update:modelValue', $event)" @comment="emit('comment')" />
    <div class="document-title-content">
    <input
      class="document-title-input"
      :value="draft"
      :readonly="readonly || saving"
      :aria-label="t('文档标题')"
      :aria-invalid="!!error"
      :aria-describedby="error ? errorId : undefined"
      :placeholder="t('未命名')"
      autocomplete="off"
      spellcheck="false"
      @input="input"
      @blur="commit"
      @keydown="keydown"
      @compositionstart="composing = true"
      @compositionend="composing = false"
    />
    <div v-if="error" :id="errorId" class="document-title-error" role="alert">{{ error }}</div>
    </div>
  </div>
</template>
