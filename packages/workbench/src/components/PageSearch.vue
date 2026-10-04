<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { ArrowDown, ArrowUp, CornerDownLeft, Repeat2, X } from 'lucide-vue-next';
import type { PageSearchEditor } from '@tano/editor/search';

const props = defineProps<{
  editor?: PageSearchEditor;
  content: string;
  revision?: number;
  readonly?: boolean;
}>();
const opened = ref(false);
const input = ref<HTMLInputElement>();
const query = ref('');
const index = ref(0);
const count = ref(0);
const notFound = computed(() => query.value.length > 0 && count.value === 0);
const replacing = ref(false);
const replacement = ref('');
const replacementInput = ref<HTMLInputElement>();
const notice = ref('');

function refresh(scroll: boolean) {
  count.value = props.editor?.search(query.value, index.value, scroll) ?? 0;
  const clamped = Math.max(0, Math.min(index.value, count.value - 1));
  if (clamped !== index.value) {
    index.value = clamped;
    props.editor?.search(query.value, index.value, scroll);
  }
}
async function open(replace = false) {
  const selected = props.editor?.searchSelection();
  if (selected && !selected.includes('\n')) query.value = selected;
  opened.value = true;
  replacing.value = replace;
  await nextTick();
  input.value?.focus();
  input.value?.select();
  await nextTick();
  refresh(true);
}
async function toggleReplace() {
  replacing.value = !replacing.value;
  await nextTick();
  if (replacing.value) replacementInput.value?.focus();
  else input.value?.focus();
}
async function replaceMatch(all = false) {
  if (props.readonly || !count.value || !query.value || !props.editor) return;
  const result = props.editor.replaceSearch(
    query.value,
    replacement.value,
    all ? 'all' : index.value,
  );
  index.value = result.index;
  notice.value = result.replaced ? `已替换 ${result.replaced} 处` : '';
  await nextTick();
  refresh(true);
}
function replacementKeydown(event: KeyboardEvent) {
  if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  event.stopPropagation();
  void replaceMatch();
}
function close() {
  opened.value = false;
  props.editor?.search('', 0, false);
  props.editor?.focus();
}
function navigate(direction: number) {
  if (!count.value) return;
  index.value = (index.value + direction + count.value) % count.value;
  refresh(true);
}
function keydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    close();
  }
  if (
    (event.key === 'Enter' && event.target === input.value) ||
    ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'g')
  ) {
    event.preventDefault();
    navigate(event.shiftKey ? -1 : 1);
  }
}
watch(query, () => {
  index.value = 0;
  notice.value = '';
  if (opened.value) refresh(true);
});
watch(
  () => [props.content, props.editor, props.revision],
  async (_, previous) => {
    if (previous?.[1] && previous[1] !== props.editor)
      (previous[1] as PageSearchEditor).search('', 0, false);
    await nextTick();
    if (opened.value) refresh(false);
  },
  { flush: 'post' },
);
onBeforeUnmount(() => props.editor?.search('', 0, false));
defineExpose({ open, close, navigate, isOpen: () => opened.value });
</script>

<template>
  <div
    v-if="opened"
    class="page-search"
    role="search"
    aria-label="页内搜索"
    @keydown.stop="keydown"
  >
    <div class="page-search-row">
      <input
        ref="input"
        v-model="query"
        aria-label="在当前页面中查找"
        placeholder="在页面中查找"
        autocomplete="off"
        spellcheck="false"
      />
      <template v-if="!notFound">
        <span class="page-search-count" role="status" aria-live="polite" aria-atomic="true"
          >{{ count ? index + 1 : 0 }} / {{ count }}</span
        >
        <button
          type="button"
          :disabled="!count"
          aria-label="上一个匹配"
          title="上一个匹配 (Shift+Enter)"
          @click="navigate(-1)"
        >
          <ArrowUp :size="15" :stroke-width="1.7" />
        </button>
        <button
          type="button"
          :disabled="!count"
          aria-label="下一个匹配"
          title="下一个匹配 (Enter)"
          @click="navigate(1)"
        >
          <ArrowDown :size="15" :stroke-width="1.7" />
        </button>
        <button
          type="button"
          :class="{ active: replacing }"
          :aria-pressed="replacing"
          aria-label="展开或收起替换"
          title="替换 (Ctrl+H)"
          @click="toggleReplace"
        >
          <Repeat2 :size="15" :stroke-width="1.7" />
        </button>
      </template>
      <span v-else class="page-search-not-found" role="status" aria-live="polite">not found</span>
      <button type="button" aria-label="关闭页内搜索" title="关闭 (Esc)" @click="close">
        <X :size="15" :stroke-width="1.7" />
      </button>
    </div>
    <div v-if="replacing" class="page-search-replace">
      <input
        ref="replacementInput"
        v-model="replacement"
        aria-label="替换为"
        placeholder="替换为…"
        :disabled="readonly"
        autocomplete="off"
        spellcheck="false"
        @keydown="replacementKeydown"
      />
      <div class="page-search-replace-actions">
        <span class="page-search-notice" role="status" aria-live="polite">{{
          readonly ? '当前文档为只读' : notice
        }}</span>
        <button
          type="button"
          class="replace-all"
          :disabled="readonly || !count"
          @click="replaceMatch(true)"
        >
          全部替换
        </button>
        <button
          type="button"
          class="replace-current"
          :disabled="readonly || !count"
          @click="replaceMatch()"
        >
          替换<CornerDownLeft :size="14" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.page-search {
  position: absolute;
  top: 102px;
  right: 20px;
  z-index: 25;
  width: min(300px, calc(100% - 32px));
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--paper);
  box-shadow:
    0 3px 10px #0000000a,
    0 12px 28px #00000014;
}
.page-search-row {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 6px 6px 6px 10px;
}
.page-search input {
  flex: 1;
  min-width: 0;
  width: 0;
  padding: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: var(--text);
  font: inherit;
  font-size: 13px;
}
.page-search input::placeholder {
  color: var(--muted);
  opacity: 0.65;
}
.page-search-count {
  flex-shrink: 0;
  padding-inline: 4px;
  margin-right: 6px;
  color: var(--muted);
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}
.page-search-not-found {
  flex-shrink: 0;
  padding-inline: 4px;
  color: var(--muted);
  font-size: 11px;
  white-space: nowrap;
}
.page-search button {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: auto;
  height: 24px;
  padding: 0 2px;
  border: 0;
  border-radius: 5px;
  color: var(--muted);
  background: transparent;
  cursor: pointer;
}
.page-search button:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.page-search button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 1px;
}
.page-search button:disabled {
  opacity: 0.35;
  cursor: default;
}
.page-search button.active {
  color: var(--green);
}
.page-search button.active:hover:not(:disabled) {
  color: var(--green);
  background: var(--accent);
}
.page-search-replace {
  padding: 10px 12px 8px;
  border-top: 1px solid var(--line);
}
.page-search-replace > input {
  width: 100%;
  height: 22px;
}
.page-search-replace-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  margin-top: 8px;
}
.page-search-notice {
  flex: 1;
  min-width: 0;
  color: var(--muted);
  font-size: 11px;
}
.page-search-replace-actions button {
  width: auto;
  height: 28px;
  padding: 0 6px;
  display: flex;
  gap: 4px;
  font-size: 12px;
  white-space: nowrap;
}
.page-search-replace-actions .replace-current {
  color: white;
  background: var(--green-fill);
  border-radius: 8px;
}
.page-search-replace-actions .replace-current:hover:not(:disabled) {
  color: white;
  background: var(--green-fill-hover);
}
@media (max-width: 700px) {
  .page-search {
    top: 66px;
    right: 16px;
  }
}
</style>
