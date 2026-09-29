<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useId, watch } from 'vue';
import { basename, parentPath, pathKey, validatePath } from '@tano/protocol';
import type { FileEntry } from '@tano/protocol';

const props = defineProps<{
  workspaceId: string;
  documentId: string;
  path: string;
  files: FileEntry[];
  readonly: boolean;
  rename: (workspaceId: string, id: string, from: string, to: string) => Promise<void>;
}>();
const emit = defineEmits<{ enter: [workspaceId: string, documentId: string] }>();
let disposed = false;
onBeforeUnmount(() => { disposed = true; });
const errorId = useId();
const title = computed(() => basename(props.path).replace(/\.(md|markdown)$/i, ''));
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
  if (!draft.value.trim()) return '请输入文档标题';
  if (/[\/\\]/.test(draft.value)) return '标题不能包含路径分隔符';
  const invalid = validatePath(destination.value);
  if (invalid) return invalid;
  if (props.files.some((file) => file.id !== props.documentId &&
    pathKey(file.path) === pathKey(destination.value))) return '已经存在一个同名文件';
  return '';
});
const error = computed(() => validation.value || saveError.value);

function reset() {
  draft.value = title.value;
  edited.value = false;
  saveError.value = '';
}
watch(() => props.path, reset);

function input(event: Event) {
  draft.value = (event.target as HTMLInputElement).value;
  edited.value = true;
  saveError.value = '';
}
async function commit(): Promise<boolean> {
  if (props.readonly || saving.value || composing.value || validation.value) return false;
  if (!edited.value) return true;
  if (destination.value === props.path) {
    reset();
    return true;
  }
  saving.value = true;
  saveError.value = '';
  try {
    await props.rename(props.workspaceId, props.documentId, props.path, destination.value);
    reset();
    return true;
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    saveError.value = /已经存在|已存在|already exists|同名/i.test(message)
      ? '已经存在一个同名文件' : message;
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
    <input
      class="document-title-input"
      :value="draft"
      :readonly="readonly || saving"
      aria-label="文档标题"
      :aria-invalid="!!error"
      :aria-describedby="error ? errorId : undefined"
      placeholder="未命名"
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
</template>
