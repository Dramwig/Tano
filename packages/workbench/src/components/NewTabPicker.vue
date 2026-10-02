<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  ArrowDown,
  ArrowUp,
  BookOpen,
  CornerDownLeft,
  FilePlus2,
  FileText,
  Search,
  X,
} from 'lucide-vue-next';
import { basename, isMarkdown, isWorkspaceInternalPath } from '@tano/protocol';
import type { FileEntry } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';

const emit = defineEmits<{ close: []; 'new-document': [] }>();
const store = useWorkspaceStore();
const query = ref('');
const input = ref<HTMLInputElement>();
const list = ref<HTMLElement>();
const selected = ref(0);
const opening = ref(false);
const error = ref('');
const previousFocus = document.activeElement as HTMLElement | null;
const title = (path: string) => basename(path).replace(/\.(md|markdown)$/i, '');
const openIds = computed(() => new Set(store.documents.map((doc) => doc.id)));
const matches = computed(() => {
  const terms = query.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  return (store.workspace?.files ?? [])
    .filter(
      (file) =>
        file.kind === 'file' &&
        isMarkdown(file.path) &&
        !isWorkspaceInternalPath(file.path) &&
        terms.every((term) => file.path.toLocaleLowerCase().includes(term)),
    )
    .sort(
      (a, b) =>
        Number(openIds.value.has(b.id)) - Number(openIds.value.has(a.id)) ||
        b.modified - a.modified ||
        a.path.localeCompare(b.path, 'zh-CN'),
    );
});
type Choice = { id: string; label: string; group: string; file?: FileEntry };
const choices = computed<Choice[]>(() => [
  ...(!store.workspace?.readOnly ? [{ id: 'create', label: '新建文档', group: '' }] : []),
  ...matches.value.slice(0, 60).map((file) => ({
    id: `file-${file.id}`,
    label: title(file.path),
    file,
    group: query.value.trim() ? '搜索结果' : openIds.value.has(file.id) ? '已打开' : '最近修改',
  })),
]);

watch([query, choices], () => {
  selected.value =
    query.value.trim() && choices.value[0]?.id === 'create' && choices.value.length > 1 ? 1 : 0;
});
watch(
  () => store.workspace?.id,
  () => emit('close'),
);
onMounted(() => input.value?.focus());
onBeforeUnmount(() => {
  if (previousFocus?.isConnected) previousFocus.focus();
});

async function choose(choice: Choice) {
  if (opening.value || store.busy) return;
  if (!choice.file) {
    emit('new-document');
    return;
  }
  opening.value = true;
  error.value = '';
  try {
    await store.openFile(choice.file);
    if (store.activeId === choice.file.id) emit('close');
    else error.value = store.fatal || '无法打开这篇文档，请重试。';
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    opening.value = false;
  }
}

async function onSearchKeydown(event: KeyboardEvent) {
  if (event.isComposing) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    const choice = choices.value[selected.value];
    if (choice) await choose(choice);
  } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    if (!choices.value.length) return;
    selected.value =
      (selected.value + (event.key === 'ArrowDown' ? 1 : -1) + choices.value.length) %
      choices.value.length;
    await nextTick();
    list.value?.querySelector('.new-tab-choice-selected')?.scrollIntoView({ block: 'nearest' });
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      class="new-tab-backdrop"
      @mousedown.self="emit('close')"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <section class="modal new-tab-picker" role="dialog" aria-modal="true" aria-label="打开文件">
        <div class="new-tab-search">
          <Search :size="21" :stroke-width="1.6" />
          <input
            ref="input"
            v-model="query"
            placeholder="在当前标签页中打开…"
            aria-label="搜索文档标题或路径"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls="new-tab-choices"
            :aria-activedescendant="choices[selected] ? `new-tab-choice-${selected}` : undefined"
            @keydown="onSearchKeydown"
          />
          <button
            class="icon-button"
            aria-label="关闭打开文件面板"
            title="关闭 · Esc"
            @click="emit('close')"
          >
            <X :size="17" />
          </button>
        </div>
        <div class="new-tab-context">
          <BookOpen :size="14" /><span>{{ store.workspace?.name }}</span
          ><i />按标题或路径搜索
        </div>
        <div
          id="new-tab-choices"
          ref="list"
          class="new-tab-choices"
          role="listbox"
          aria-label="选择要打开的文档"
          :aria-busy="opening"
        >
          <template v-for="(choice, index) in choices" :key="choice.id">
            <div
              v-if="choice.group && choice.group !== choices[index - 1]?.group"
              class="new-tab-group"
              role="presentation"
            >
              {{ choice.group }}
            </div>
            <button
              :id="`new-tab-choice-${index}`"
              class="new-tab-choice"
              :class="{ 'new-tab-choice-selected': selected === index }"
              type="button"
              role="option"
              :aria-selected="selected === index"
              :disabled="opening || store.busy"
              :title="choice.file?.path"
              @pointermove="selected = index"
              @focus="selected = index"
              @click="choose(choice)"
            >
              <component :is="choice.file ? FileText : FilePlus2" :size="18" :stroke-width="1.6" />
              <span class="new-tab-choice-title">{{ choice.label }}</span>
              <span v-if="choice.file" class="new-tab-choice-path">{{
                choice.file.path.includes('/')
                  ? choice.file.path.slice(0, choice.file.path.lastIndexOf('/'))
                  : store.workspace?.name
              }}</span>
              <span v-if="choice.file && openIds.has(choice.file.id)" class="new-tab-open-label"
                >已打开</span
              >
              <CornerDownLeft v-if="selected === index" class="new-tab-enter" :size="14" />
            </button>
          </template>
          <div v-if="!matches.length" class="new-tab-empty">
            <Search :size="26" :stroke-width="1.3" />
            <p>{{ query.trim() ? '没有找到匹配的文档' : '工作区里还没有文档' }}</p>
            <span>{{
              query.trim()
                ? '试试其他标题或文件夹名称'
                : store.workspace?.readOnly
                  ? '这是一个只读工作区'
                  : '从新建一篇文档开始'
            }}</span>
          </div>
        </div>
        <p v-if="error" class="new-tab-error" role="alert">{{ error }}</p>
        <footer class="new-tab-footer">
          <span><ArrowUp :size="12" /><ArrowDown :size="12" />选择</span
          ><span><CornerDownLeft :size="13" />打开</span><span>Esc 关闭</span
          ><span class="new-tab-count">{{
            opening ? '正在打开…' : `${Math.min(matches.length, 60)} / ${matches.length} 篇文档`
          }}</span>
        </footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.new-tab-backdrop {
  position: fixed;
  inset: 36px 0 0;
  z-index: 65;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding: clamp(36px, 8vh, 80px) 24px 24px;
  background: #24272b08;
}
.new-tab-picker {
  display: flex;
  flex-direction: column;
  width: 600px;
  height: min(640px, calc(100dvh - 140px));
  max-height: 100%;
  padding: 0;
  overflow: hidden;
  border-radius: 18px;
  border-color: var(--line);
  box-shadow:
    0 18px 60px #20232624,
    0 4px 12px #20232612;
}
.new-tab-search {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px 4px 20px;
  color: var(--muted);
}
.new-tab-search input {
  flex: 1;
  min-width: 0;
  padding: 10px 0;
  border: 0;
  border-radius: 0;
  background: transparent;
  font-size: 16px;
  outline: none;
}
.new-tab-search:focus-within > svg {
  color: var(--green);
}
.new-tab-search input::placeholder {
  color: var(--muted);
}
.new-tab-context {
  display: flex;
  align-items: center;
  gap: 7px;
  padding: 10px 20px 17px;
  color: var(--muted);
  font-size: 12px;
}
.new-tab-context > span {
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.new-tab-context i {
  height: 11px;
  margin: 0 3px;
  border-left: 1px solid var(--line);
}
.new-tab-choices {
  flex: 1;
  min-height: 0;
  padding: 0 12px 18px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
.new-tab-group {
  padding: 23px 10px 9px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 500;
}
.new-tab-choice {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 38px;
  padding: 8px 11px;
  border-radius: 9px;
  text-align: left;
  font-size: 13px;
}
.new-tab-choice-selected {
  background: var(--hover);
}
.new-tab-choice > svg {
  color: var(--text-secondary);
}
.new-tab-choice-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.new-tab-choice-path {
  flex: 1;
  min-width: 30px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--muted);
  font-size: 12px;
}
.new-tab-open-label {
  margin-left: auto;
  color: var(--muted);
  font-size: 10px;
  white-space: nowrap;
}
.new-tab-enter {
  margin-left: auto;
  color: var(--muted) !important;
}
.new-tab-choice:focus-visible {
  outline-offset: -2px;
}
.new-tab-empty {
  display: grid;
  justify-items: center;
  padding: 55px 12px;
  color: var(--muted);
}
.new-tab-empty p {
  margin: 14px 0 6px;
  color: var(--text-secondary);
  font-size: 14px;
}
.new-tab-empty span {
  font-size: 12px;
}
.new-tab-error {
  padding: 0 22px;
  color: var(--danger);
  font-size: 12px;
}
.new-tab-footer {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 16px;
  padding: 13px 16px;
  border-top: 1px solid var(--line);
  color: var(--muted);
  font-size: 11px;
}
.new-tab-footer > span {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}
.new-tab-count {
  margin-left: auto;
}
</style>
