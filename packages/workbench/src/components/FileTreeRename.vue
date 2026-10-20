<script setup lang="ts">
import { t } from '../i18n';
import { nextTick, onBeforeUnmount, onMounted, ref, useId } from 'vue';
import { isDataTableFilePath, type FileEntry } from '@tano/protocol';

const props = defineProps<{
  file: FileEntry;
  rename: (file: FileEntry, name: string) => Promise<void>;
}>();
const emit = defineEmits<{ finish: [] }>();
// Keep the original path so an external move cannot silently change our target.
const file = { ...props.file };
const draft = ref(file.name);
const input = ref<HTMLInputElement>();
const saving = ref(false);
const error = ref('');
const errorId = useId();
const composing = ref(false);
let finished = false;
onBeforeUnmount(() => {
  finished = true;
});
onMounted(() => {
  input.value?.focus({ preventScroll: true });
  const extension = isDataTableFilePath(file.path)
    ? file.name.length - '.table.json'.length
    : file.kind === 'file'
      ? file.name.lastIndexOf('.')
      : -1;
  input.value?.setSelectionRange(0, extension > 0 ? extension : file.name.length);
  if (input.value) input.value.scrollLeft = 0;
});

function finish(restoreFocus: boolean) {
  if (finished) return;
  finished = true;
  const rowContainer = input.value?.closest('li');
  emit('finish');
  if (restoreFocus)
    void nextTick(() => rowContainer?.querySelector<HTMLElement>(':scope > .tree-row')?.focus());
}
async function commit(restoreFocus: boolean) {
  if (saving.value || composing.value || finished) return;
  if (draft.value.trim() === file.name) {
    finish(restoreFocus);
    return;
  }
  saving.value = true;
  error.value = '';
  try {
    await props.rename(file, draft.value);
    finish(restoreFocus);
  } catch (cause) {
    if (finished) return;
    error.value = cause instanceof Error ? cause.message : String(cause);
    await nextTick();
    input.value?.focus({ preventScroll: true });
  } finally {
    saving.value = false;
  }
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || composing.value || event.keyCode === 229) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    void commit(true);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    if (!saving.value) finish(true);
  }
}
function compositionEnd() {
  composing.value = false;
  if (document.activeElement !== input.value) void commit(false);
}
</script>

<template>
  <span
    class="tree-rename-field"
    :aria-busy="saving"
    @click.stop
    @contextmenu.stop
    @keydown.stop="keydown"
  >
    <input
      ref="input"
      v-model="draft"
      class="tree-rename-input"
      :aria-label="file.kind === 'directory' ? t('文件夹名称') : t('文件名称')"
      :aria-invalid="!!error"
      :aria-describedby="error ? errorId : undefined"
      :readonly="saving"
      autocomplete="off"
      spellcheck="false"
      maxlength="220"
      @input="error = ''"
      @blur="commit(false)"
      @compositionstart="composing = true"
      @compositionend="compositionEnd"
    />
    <span v-if="error" :id="errorId" class="tree-rename-error" role="alert">{{ error }}</span>
  </span>
</template>

<style scoped>
.tree-rename-field {
  position: relative;
  flex: 1;
  min-width: 0;
}
.tree-rename-input {
  display: block;
  width: 100%;
  min-width: 0;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 0;
  outline: 1px solid var(--green);
  outline-offset: 0;
  background: var(--surface);
  color: inherit;
  font: inherit;
  user-select: text;
}
.tree-rename-input[aria-invalid='true'] {
  outline-color: var(--danger);
}
.tree-rename-input::selection {
  background: Highlight;
  color: HighlightText;
}
.tree-rename-error {
  position: absolute;
  z-index: 1;
  top: calc(100% + 4px);
  left: 0;
  display: block;
  width: 100%;
  padding: 4px 6px;
  border: 1px solid var(--danger);
  border-radius: 3px;
  background: var(--paper);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
</style>
