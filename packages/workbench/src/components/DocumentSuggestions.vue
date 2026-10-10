<script setup lang="ts">
import './review-card.css';
import { captureReviewRail, updateReviewRail, removeReviewRail } from './review-rail';
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, ref, watch } from 'vue';
import { Check, X } from 'lucide-vue-next';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import type { CommentMention, SuggestionDecorations } from '@tano/protocol';
import { suggestionReviewThread } from '@tano/protocol';
import CommentConversation from './CommentConversation.vue';
import ReviewCard from './ReviewCard.vue';
import type { CommentMessageEdit, CommentMessageRemoval } from '../workspace-comments';
import { useSuggestionStore } from '../stores/suggestions';
import { subscribeBackgroundRefresh } from '../background-refresh';
import type { OpenDocument } from '../stores/workspace';
import { preserveSuggestedSource } from '../document-suggestions';

const props = defineProps<{ document: OpenDocument; readonly: boolean; author: { id: string; name: string }; managed?: boolean; source?: boolean }>();
const store = useSuggestionStore();
const session = computed(() => store.get(props.document.id));
const projection = computed(() => store.projection(props.document.id));
const suggesting = computed(() => !!session.value?.mode && !props.managed);
const content = computed(() => suggesting.value ? projection.value.content : props.document.content);
function transformChange(raw: string, before: string, after: string) { return preserveSuggestedSource(raw, before, after); }
const locked = computed(() => props.readonly || !!session.value?.reviewing || (suggesting.value && (!!session.value?.loading || !!session.value?.error)));
const selected = ref('');
const conversations = new Map<string, InstanceType<typeof CommentConversation>>();
const host = ref<HTMLElement>();
const reviewOwner = {};
onBeforeUpdate(() => captureReviewRail(reviewOwner));
const railLayout = ref({ inline: false, left: 0 });
const anchorQuotes = ref<Record<string, string>>({});
const emptyMarks: SuggestionDecorations = { text: '', ranges: [] };
const richMarks = ref<SuggestionDecorations>(emptyMarks);
const sourceMarks = computed<SuggestionDecorations>(() => {
  if (!projection.value.ranges.length) return emptyMarks;
  return { text: content.value, ranges: suggesting.value ? projection.value.ranges : projection.value.ranges.map(range => ({
    id: range.id, from: range.baseFrom, to: range.baseTo, removed: '', inserted: range.text,
  })) };
});
const visible = computed(() => (session.value?.records ?? []).filter(item => item.status === 'pending' || item.status === 'applying'));
let parser: ReturnType<typeof createHeadlessMarkdown> | undefined;
// Reuse projections on polling/replies. Bound retained source and derived text.
const projections = new Map<string, string>();
let projectionSize = 0;
async function project(text: string) {
  const cached = projections.get(text);
  if (cached !== undefined) return cached;
  const codec = await (parser ??= createHeadlessMarkdown());
  const ready = projections.get(text);
  if (ready !== undefined) return ready;
  const result = codec.projectComments(text);
  if (!projections.has(text)) {
    projections.set(text, result);
    projectionSize += text.length + result.length;
    while (projections.size > 32 || projectionSize > 1_000_000) {
      const first = projections.keys().next().value!;
      projectionSize -= first.length + projections.get(first)!.length;
      projections.delete(first);
    }
  }
  return result;
}
function publishMarks(marks: SuggestionDecorations) {
  if (!marks.ranges.length) { richMarks.value = emptyMarks; return; }
  if (marks.text !== richMarks.value.text || JSON.stringify(marks.ranges) !== JSON.stringify(richMarks.value.ranges))
    richMarks.value = marks;
}
let generation = 0;
let observer: ResizeObserver | undefined;
let mutations: MutationObserver | undefined;
let frame = 0;
function alignCards() {
  cancelAnimationFrame(frame);
  frame = requestAnimationFrame(() => {
    const rail = host.value?.querySelector<HTMLElement>('.suggestion-rail');
    if (!rail) { removeReviewRail(reviewOwner); return; }
    const parent = host.value?.closest<HTMLElement>('.document-main');
    const prose = host.value?.querySelector<HTMLElement>('.ProseMirror, .cm-content');
    const bounds = parent?.getBoundingClientRect();
    const body = prose?.getBoundingClientRect();
    const left = body && bounds ? body.right - bounds.left + 24 : 0;
    const inline = !!bounds && !!body && left + 320 + 3 <= bounds.width - 16;
    if (railLayout.value.inline !== inline || railLayout.value.left !== left) {
      railLayout.value = { inline, left };
      void nextTick(alignCards);
      return;
    }
    const origin = inline ? bounds!.top : rail.getBoundingClientRect().top;
    const entries: { id: string; element: HTMLElement; anchor: number; selected: boolean }[] = [];
    for (const card of rail.querySelectorAll<HTMLElement>('[data-review-id]')) {
      const id = card.dataset.reviewId!;
      const mark = [...(host.value?.querySelectorAll<HTMLElement>('[data-suggestion-id]') ?? [])].find(element => element.dataset.suggestionId === id);
      const quote = anchorQuotes.value[id];
      const block = quote && prose ? [...prose.children].find(element => element.textContent?.replace(/\s/g, '').includes(quote)) : undefined;
      observer?.observe(card);
      entries.push({ id: 'suggestion:' + id, element: card, selected: selected.value === id,
        anchor: inline ? (mark ?? block ?? prose)!.getBoundingClientRect().top - origin : 0 });
    }
    if (inline && parent) updateReviewRail(reviewOwner, parent, entries);
    else removeReviewRail(reviewOwner);
  });
}
onMounted(() => {
  if (typeof ResizeObserver !== 'undefined' && host.value) {
    observer = new ResizeObserver(alignCards);
    observer.observe(host.value);
    const parent = host.value.closest('.document-main');
    if (parent) observer.observe(parent);
  }
  if (host.value) {
    mutations = new MutationObserver(records => {
      if (records.some(record => !(record.target instanceof Element) || !record.target.closest('.review-card'))) alignCards();
    });
    mutations.observe(host.value, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['style', 'class'] });
    host.value.addEventListener('tano-table-layout', alignCards);
  }
  window.addEventListener('resize', alignCards);
  window.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('keydown', escapeCard);
});
watch([richMarks, visible, selected], () => { void nextTick(alignCards); }, { deep: true });
let anchorGeneration = 0;
watch([visible, () => props.source], async ([records, source]) => {
  const revision = ++anchorGeneration;
  if (!records.length) { anchorQuotes.value = {}; return; }
  try {
    const quotes: Record<string, string> = {};
    for (const item of records) {
      if (revision !== anchorGeneration) return;
      const fragment = item.base.slice(item.from, item.to > item.from ? item.to : item.from + 80);
      quotes[item.id] = (source ? fragment : await project(fragment)).replace(/\s/g, '').slice(0, 24);
    }
    if (revision === anchorGeneration) { anchorQuotes.value = quotes; void nextTick(alignCards); }
  } catch { /* Inline marks remain the primary anchor when a fragment cannot be parsed. */ }
}, { immediate: true, deep: true });
watch(() => props.document.id, () => {
  generation++; anchorGeneration++; projections.clear(); projectionSize = 0;
  void store.load(props.document.id);
}, { immediate: true });
watch(() => props.managed, managed => { if (managed && session.value) session.value.mode = false; });
const stopPolling = subscribeBackgroundRefresh(() => store.load(props.document.id, true));
watch([sourceMarks, () => props.source], async ([snapshot, source]) => {
  const revision = ++generation;
  if (source || !snapshot.ranges.length) { publishMarks(emptyMarks); return; }
  try {
    const text = await project(snapshot.text);
    const ranges: SuggestionDecorations['ranges'] = [];
    for (const range of snapshot.ranges) {
      if (revision !== generation) return;
      const without = snapshot.text.slice(0, range.from) + (range.inserted ?? range.removed) + snapshot.text.slice(range.to);
      const original = await project(without);
      let from = 0, to = text.length, oldTo = original.length;
      while (from < to && from < oldTo && text[from] === original[from]) from++;
      while (to > from && oldTo > from && text[to - 1] === original[oldTo - 1]) { to--; oldTo--; }
      ranges.push(range.inserted === undefined
        ? { id: range.id, from, to, removed: original.slice(from, oldTo) }
        : { id: range.id, from, to, removed: '', inserted: original.slice(from, oldTo) });
    }
    if (revision === generation) publishMarks({ text, ranges });
  } catch { if (revision === generation) publishMarks(emptyMarks); }
}, { immediate: true });
onBeforeUnmount(() => { removeReviewRail(reviewOwner); generation++; anchorGeneration++; stopPolling(); cancelAnimationFrame(frame); observer?.disconnect(); mutations?.disconnect(); window.removeEventListener('resize', alignCards); window.removeEventListener('pointerdown', outsidePointer, true); window.removeEventListener('keydown', escapeCard); host.value?.removeEventListener('tano-table-layout', alignCards); void parser?.then(codec => codec.destroy()); });
function outsidePointer(event: PointerEvent) {
  if (event.target instanceof Element && !event.target.closest('.suggestion-card, .comment-more-menu, [data-suggestion-id]')) selected.value = '';
}
function escapeCard(event: KeyboardEvent) { if (event.key === 'Escape') selected.value = ''; }
async function action(run: () => Promise<unknown>) {
  try { await run(); } catch (error) { if (session.value) session.value.error = String(error); }
}
async function focus(id: string, scroll = true) {
  selected.value = id;
  if (scroll) [...(host.value?.querySelectorAll<HTMLElement>('[data-suggestion-id]') ?? [])].find(element => element.dataset.suggestionId === id)?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  await nextTick();
  await conversations.get(id)?.focusReply();
}
function clicked(event: MouseEvent) {
  const mark = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-suggestion-id]') : null;
  if (mark?.dataset.suggestionId) void focus(mark.dataset.suggestionId, false);
}
async function reply(id: string, body: string, mentions: CommentMention[]) {
  await action(async () => {
    await store.changeReply(props.document.id, id, { type: 'reply', threadId: id,
      id: crypto.randomUUID(), body, author: props.author, mentions });
    conversations.get(id)?.clearReply();
  });
}
async function editReply(id: string, change: CommentMessageEdit) {
  await action(async () => {
    await store.changeReply(props.document.id, id, { type: 'edit', threadId: id, authorId: props.author.id, ...change });
    conversations.get(id)?.finishEdit();
  });
}
async function removeReply(id: string, change: CommentMessageRemoval) {
  await action(() => store.changeReply(props.document.id, id, { type: 'delete', threadId: id, authorId: props.author.id, ...change }));
}
</script>

<template>
  <section ref="host" class="document-suggestions" @click="clicked">
    <div v-if="session?.saving" class="suggestion-toolbar">
      <span role="status">正在保存建议…</span>
    </div>
    <div v-if="session?.error" class="suggestion-error" role="alert">{{ session.error }}
      <button type="button" @click="action(() => store.persist(session!))">重试保存</button>
      <button type="button" @click="action(() => store.load(document.id, true))">重新载入</button>
      <button type="button" :disabled="session.saving || session.reviewing" @click="action(() => store.preserveLocalCopy(document.id))">另存本机建议副本</button>
    </div>
    <div class="suggestion-layout" :class="{ 'has-suggestions': visible.length }">
      <div class="suggestion-content">
        <slot :content="content" :edit="(value: string) => store.edit(document.id, value, author)" :suggesting="suggesting"
          :readonly="locked" :rich-marks="richMarks" :source-marks="sourceMarks" :view-key="`${suggesting}:${session?.viewVersion ?? 0}`"
          :transform-change="suggesting ? transformChange : undefined" />
      </div>
      <aside v-if="visible.length" class="suggestion-rail" :class="{ 'is-inline': railLayout.inline }"
        :style="railLayout.inline ? { left: `${railLayout.left}px` } : undefined" aria-label="文档修改建议">
        <ReviewCard v-for="item in visible" :key="item.id" :data-review-id="item.id" class="suggestion-card"
          :expanded="selected === item.id" label="编辑建议" @activate="focus(item.id)">
          <div class="review-card-content">
          <CommentConversation
            :ref="value => value ? conversations.set(item.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(item.id)"
            :thread="suggestionReviewThread(item)" local :preview="selected !== item.id"
            :readonly="readonly || managed" :busy="!!session?.saving || !!session?.reviewing"
            :author-id="author.id" :author-name="author.name" @expand="focus(item.id)"
            @reply="(body, mentions) => reply(item.id, body, mentions)"
            @edit="editReply(item.id, $event)" @remove="removeReply(item.id, $event)">
          <template #first-tools>
            <div v-if="item.status === 'pending' || item.status === 'applying'" class="review-card-tools" role="group" aria-label="建议操作">
              <button type="button" :disabled="readonly || managed || session?.saving || session?.reviewing || projection.conflicts.includes(item.id)"
                :aria-label="item.status === 'applying' ? '核对写入结果' : session?.previews[item.id] ? '接受更新后的建议' : '接受建议'"
                :title="item.status === 'applying' ? '核对写入结果' : '接受建议'" @click.stop="action(() => store.accept(document.id, item.id))"><Check :size="15" /></button>
              <button v-if="item.status === 'pending'" type="button" :disabled="readonly || managed || session?.saving || session?.reviewing"
                aria-label="拒绝建议" title="拒绝建议"
                @click.stop="action(() => store.reject(document.id, item.id))"><X :size="15" /></button>
            </div>
            <span v-else>{{ item.status === 'accepted' ? '已接受' : '已拒绝／撤回' }}</span>
          </template>
          <template #first-body>
          <p class="suggestion-change panel-scrollbar">
            <del v-if="item.to > item.from">{{ item.base.slice(item.from, item.to) }}</del><ins v-if="item.text">{{ item.text }}</ins>
          </p>
          <template v-if="selected === item.id">
          <p v-if="item.reason">{{ item.reason }}</p>
          <p v-if="projection.conflicts.includes(item.id)" class="suggestion-warning">原文已变化或建议重叠，需核对后重新提出。</p>
          <p v-if="item.status === 'applying'" class="suggestion-warning">写入结果待核对，不会重复应用。请保留记录并核对正式正文。</p>
          <details v-if="item.application && item.status === 'applying'"><summary>查看写入前后</summary><pre class="panel-scrollbar">{{ item.application.before }}</pre><pre class="panel-scrollbar">{{ item.application.after }}</pre></details>
          <details v-if="session?.previews[item.id]" open><summary>正文有变化，请审阅后再次接受</summary>
            <pre class="panel-scrollbar">{{ session.previews[item.id]!.before }}</pre><pre class="panel-scrollbar">{{ session.previews[item.id]!.after }}</pre></details>
          </template>
          </template>
          </CommentConversation>
          </div>
        </ReviewCard>
      </aside>
    </div>
  </section>
</template>

<style scoped>
.document-suggestions { min-width: 0; }
.suggestion-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-bottom: 16px; font-size: 12px; color: var(--muted); }
.suggestion-content { min-width: 0; }
.suggestion-rail { display: flex; flex-direction: column; gap: 12px; min-width: 0; max-width: 780px; margin: 24px auto; }
.suggestion-rail.is-inline { position: absolute; top: 0; z-index: 4; width: 320px; margin: 0; }
.suggestion-rail.is-inline .suggestion-card { position: absolute; }
.suggestion-card { font-size: 13px; color: var(--text); overflow-wrap: anywhere; }
.suggestion-card button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.review-card-content { display: flow-root; }
.suggestion-change { display: block; width: 100%; margin: 5px 0 0; text-align: left; white-space: pre-wrap; box-sizing: border-box; font-size: 13px; line-height: 1.65; max-height: 200px; overflow: auto; overscroll-behavior: contain; }
.suggestion-card.is-expanded .suggestion-change { max-height: 400px; }
.suggestion-change del, .suggestion-change ins { color: var(--suggestion-color); background: var(--suggestion-bg); }
.suggestion-change ins { text-decoration: none; }
.suggestion-card pre { white-space: pre-wrap; max-height: 220px; overflow: auto; overscroll-behavior: contain; border: 1px solid var(--line); padding: 6px; }
.suggestion-warning, .suggestion-error { color: #aa6620; }
.suggestion-error { padding: 10px; border: 1px solid currentColor; border-radius: 8px; margin-bottom: 12px; font-size: 12px; }
.suggestion-error button { margin-left: 8px; text-decoration: underline; }
</style>
