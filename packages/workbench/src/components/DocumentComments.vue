<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { MessageSquare, Reply, X } from 'lucide-vue-next';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import { makeCommentAnchor, rebaseCommentAnchor, resolveCommentAnchor } from '@tano/editor/comment-anchors';
import type { CommentAnchor, CommentFile, CommentKind, CommentMessage, CommentMention, CommentSpan, CommentThread } from '@tano/protocol';
import type { CommentGeometry } from '@tano/editor/comment-projection';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import type { OpenDocument } from '../stores/workspace';
import { loadCommentFile, saveCommentChange } from '../workspace-comments';
import type { CommentAuthor, CommentChange, CommentMessageEdit, CommentMessageRemoval } from '../workspace-comments';
import CommentComposer from './CommentComposer.vue';
import CommentConversation from './CommentConversation.vue';

const props = defineProps<{
  workspaceId: string;
  document: OpenDocument;
  readonly: boolean;
  author: CommentAuthor;
  captureSelection: () => { basis: 'prose' | 'source'; text: string; spans: CommentSpan[] } | null;
  focusAnchor: (anchor: CommentAnchor) => void;
  editorElement?: HTMLElement;
  geometry: (anchors?: readonly { id: string; anchor: CommentAnchor }[]) => CommentGeometry | null;
  assistant?: boolean;
}>();
const emit = defineEmits<{
  annotations: [value: { id: string; anchor: CommentAnchor }[]];
  assistant: [request: { kind: CommentKind; thread: CommentThread; quote?: string }];
}>();
const adapter = useWorkbenchRuntime().adapter;
const workspace = useWorkspaceStore();
const annotations = ref<CommentFile>();
const discussions = ref<CommentFile>();
const working = ref<Record<string, CommentAnchor | null>>({});
const projection = ref<{ source: string; prose: string }>();
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const annotationDraft = ref('');
const discussionDraft = ref('');
const discussionReply = ref<{ threadId: string; message: CommentMessage }>();
const selected = ref<CommentAnchor>();
const section = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const composer = ref<InstanceType<typeof CommentComposer>>();
const discussionComposer = ref<InstanceType<typeof CommentComposer>>();
const conversations = new Map<string, InstanceType<typeof CommentConversation>>();
const openIds = ref<string[]>([]);
const openBlockKey = ref<string>();
const popupCollapsed = ref(false);
const layout = ref<{ blocks: { key: string; ids: string[]; top: number; bottom: number }[]; buttonLeft: number; popupLeft: number; popupWidth: number }>({ blocks: [], buttonLeft: 0, popupLeft: 0, popupWidth: 520 });
let layoutFrame = 0;
let resizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let generation = 0;
let projectionTask: Promise<void> = Promise.resolve();
let documentEpoch = 0;
let contentRevision = 0;
let poll: ReturnType<typeof setInterval> | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
const parserPromise = createHeadlessMarkdown();
onBeforeUnmount(() => {
  if (annotations.value) void saveAnchors();
  generation++;
  documentEpoch++;
  clearInterval(poll);
  clearTimeout(saveTimer);
  cancelAnimationFrame(layoutFrame);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  window.removeEventListener('resize', scheduleLayout);
  window.removeEventListener('pointerdown', outsidePointer, true);
  window.removeEventListener('keydown', escapePopup);
  window.removeEventListener('tano:open-comment', openComment);
  props.editorElement?.removeEventListener('click', markClicked);
  void parserPromise.then(parser => parser.destroy());
});

function publish() {
  const anchors = (annotations.value?.threads ?? []).flatMap(thread => {
    const anchor = working.value[thread.id];
    return !thread.detached && !thread.resolved && anchor ? [{ id: thread.id, anchor }] : [];
  });
  if (selected.value) anchors.push({ id: '@draft', anchor: selected.value });
  emit('annotations', anchors);
  scheduleLayout();
}
watch(selected, publish);

async function project(content: string) {
  const parser = await parserPromise;
  return { source: content, prose: parser.projectComments(content) };
}

async function load() {
  const request = ++generation;
  const revision = contentRevision;
  loading.value = true;
  error.value = '';
  try {
    const [annotationFile, discussionFile] = await Promise.all([
      loadCommentFile(adapter, 'annotation', props.document.id),
      loadCommentFile(adapter, 'discussion', props.document.id),
    ]);
    const baseContent = props.document.base.content;
    const baseHash = props.document.base.hash;
    const base = await project(baseContent);
    const currentContent = props.document.content;
    const current = currentContent === baseContent ? base : await project(currentContent);
    if (request !== generation || props.document.base.hash !== baseHash) return;
    const firstLoad = !annotations.value;
    const previousWorking = working.value;
    const previousThreads = new Map(annotations.value?.threads.map(thread => [thread.id, thread]));
    annotations.value = annotationFile.file;
    discussions.value = discussionFile.file;
    projection.value = current;
    working.value = Object.fromEntries(annotationFile.file.threads.map(thread => {
      if (thread.detached || !thread.anchor || thread.anchor.baseHash !== baseHash ||
          props.document.content !== currentContent || revision !== contentRevision ||
          (firstLoad && contentRevision > 0) ||
          (previousWorking[thread.id] === null &&
            previousThreads.get(thread.id)?.anchor?.baseHash === thread.anchor.baseHash)) return [thread.id, null];
      const resolved = resolveCommentAnchor(thread.anchor, base[thread.anchor.basis]);
      return [thread.id, resolved && current !== base
        ? rebaseCommentAnchor(resolved, base[resolved.basis], current[resolved.basis]) : resolved];
    }));
    publish();
    if (annotationFile.file.threads.some(thread => !thread.detached && thread.anchor &&
        (thread.anchor.baseHash !== baseHash || working.value[thread.id] === null))) scheduleAnchorSave();
  } catch (reason) {
    if (request === generation) error.value = reason instanceof Error ? reason.message : String(reason);
  } finally {
    if (request === generation) loading.value = false;
  }
}

watch(() => [props.workspaceId, props.document.id], () => {
  documentEpoch++;
  contentRevision = 0;
  annotations.value = undefined;
  discussions.value = undefined;
  projection.value = undefined;
  working.value = {};
  selected.value = undefined;
  annotationDraft.value = '';
  discussionDraft.value = '';
  discussionReply.value = undefined;
  closePopup();
  publish();
  void load();
}, { immediate: true });
watch(() => props.document.content, (content) => {
  contentRevision++;
  const epoch = documentEpoch;
  projectionTask = projectionTask.then(async () => {
    if (epoch !== documentEpoch) return;
    const next = await project(content);
    if (epoch !== documentEpoch) return;
    const previous = projection.value;
    projection.value = next;
    if (!previous || !annotations.value) return;
    const updated = { ...working.value };
    for (const thread of annotations.value.threads) {
      const anchor = updated[thread.id];
      if (!anchor || thread.detached) continue;
      updated[thread.id] = rebaseCommentAnchor(anchor, previous[anchor.basis], next[anchor.basis]);
    }
    working.value = updated;
    if (selected.value) {
      const anchor = rebaseCommentAnchor(selected.value,
        previous[selected.value.basis], next[selected.value.basis]);
      selected.value = anchor ?? undefined;
      if (!anchor) error.value = '选中的内容已删除，请重新选择批注位置';
    }
    publish();
    scheduleAnchorSave();
  }).catch(reason => {
    if (epoch === documentEpoch) error.value = reason instanceof Error ? reason.message : String(reason);
  });
}, { flush: 'sync' });
watch(() => props.document.base.hash, () => {
  scheduleAnchorSave();
  if (!annotations.value) void load();
});
onMounted(() => {
  window.addEventListener('tano:open-comment', openComment);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('keydown', escapePopup);
  poll = setInterval(() => {
    if (!busy.value && !loading.value && props.document.content === props.document.base.content &&
        !(annotations.value?.threads.some(thread => working.value[thread.id] && thread.anchor && !thread.detached &&
          thread.anchor.baseHash !== props.document.base.hash))) void load();
  }, 5000);
  scheduleLayout();
});
watch(() => props.editorElement, (element, previous) => {
  previous?.removeEventListener('click', markClicked);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  element?.addEventListener('click', markClicked);
  if (element && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(element);
  }
  if (element && typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(scheduleLayout);
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true });
  }
  scheduleLayout();
}, { immediate: true, flush: 'post' });

function scheduleAnchorSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { void saveAnchors(); }, 700);
}
async function saveAnchors() {
  if (props.readonly || !annotations.value || props.document.content !== props.document.base.content ||
      props.document.saving || props.document.conflict || props.document.missing) return;
  for (const thread of annotations.value.threads) {
    if (thread.detached || !thread.anchor ||
        (thread.anchor.baseHash === props.document.base.hash && working.value[thread.id])) continue;
    const current = working.value[thread.id];
    try {
      const next = await saveCommentChange(adapter, 'annotation', props.document.id, {
        type: 'reanchor', threadId: thread.id, expectedBaseHash: thread.anchor.baseHash,
        anchor: current ? { ...current, baseHash: props.document.base.hash } : null,
      });
      annotations.value = next;
      if (!current) working.value = { ...working.value, [thread.id]: null };
    } catch (reason) {
      error.value = reason instanceof Error ? reason.message : String(reason);
      return;
    }
  }
  publish();
}

const activeAnnotations = computed(() => (annotations.value?.threads ?? [])
  .filter(thread => !thread.detached && working.value[thread.id]));
const resolvedAnnotations = computed(() => activeAnnotations.value.filter(thread => thread.resolved));
const openThreads = computed(() => activeAnnotations.value.filter(thread => openIds.value.includes(thread.id)));
const openBlock = computed(() => layout.value.blocks.find(block => block.key === openBlockKey.value));
const popupTop = computed(() => (openBlock.value?.bottom ?? 0) + 8);
const popupMounted = computed(() => !!openBlock.value && (!!selected.value || !!openThreads.value.length));
const popupVisible = computed(() => popupMounted.value && !popupCollapsed.value);
watch(activeAnnotations, () => {
  if (!selected.value && openIds.value.length && !openThreads.value.length) closePopup();
  scheduleLayout();
});

function quote(anchor: CommentAnchor) {
  return anchor.spans.map(span => span.text).join(' … ').replaceAll('\ufffc', '附件或图片');
}
function count(ids: string[]) {
  return activeAnnotations.value.filter(thread => !thread.resolved && ids.includes(thread.id))
    .reduce((total, thread) => total + thread.messages.length, 0);
}
function scheduleLayout() {
  if (layoutFrame) return;
  layoutFrame = requestAnimationFrame(() => { layoutFrame = 0; updateLayout(); });
}
function updateLayout() {
  const parent = section.value?.closest<HTMLElement>('.document-main');
  if (!parent) return;
  const anchors = activeAnnotations.value.filter(thread => !thread.resolved)
    .map(thread => ({ id: thread.id, anchor: working.value[thread.id]! }));
  if (selected.value) anchors.push({ id: '@draft', anchor: selected.value });
  const geometry = props.geometry(anchors);
  if (!geometry) { layout.value = { ...layout.value, blocks: [] }; return; }
  const bounds = parent.getBoundingClientRect();
  const blocks: typeof layout.value.blocks = [];
  for (const block of geometry.blocks) {
    const nearby = blocks.find(item => Math.abs(item.top - (block.top - bounds.top)) < 6);
    if (nearby) {
      nearby.ids = [...new Set([...nearby.ids, ...block.ids])];
      nearby.bottom = Math.max(nearby.bottom, block.bottom - bounds.top);
    } else blocks.push({ ...block, top: block.top - bounds.top, bottom: block.bottom - bounds.top });
  }
  const width = Math.max(0, Math.min(520, bounds.width - 32));
  const center = (geometry.left + geometry.right) / 2 - bounds.left;
  layout.value = {
    blocks,
    buttonLeft: Math.min(geometry.right - bounds.left + 12, bounds.width - 48),
    popupLeft: Math.max(16, Math.min(center - width / 2, bounds.width - width - 16)),
    popupWidth: width,
  };
  const current = blocks.find(block => block.key === openBlockKey.value &&
    (selected.value ? block.ids.includes('@draft') : block.ids.some(id => openIds.value.includes(id))));
  if (!current && (selected.value || openIds.value.length)) {
    openBlockKey.value = blocks.find(block => selected.value ? block.ids.includes('@draft') :
      block.ids.some(id => openIds.value.includes(id)))?.key;
  }
}
function closePopup() { openIds.value = []; openBlockKey.value = undefined; selected.value = undefined; popupCollapsed.value = false; }
function openBlockComments(key: string, ids: string[]) {
  if (openBlockKey.value === key && !selected.value) { popupCollapsed.value = !popupCollapsed.value; return; }
  selected.value = undefined;
  openIds.value = ids.filter(id => id !== '@draft');
  openBlockKey.value = key;
  popupCollapsed.value = false;
}
function outsidePointer(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('.annotation-popup, .comment-more-menu, .annotation-count, .annotation-create-button, [data-comment-id]')) return;
  popupCollapsed.value = true;
}
function escapePopup(event: KeyboardEvent) { if (event.key === 'Escape') popupCollapsed.value = true; }
function markClicked(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest('[data-comment-id]') : null;
  const id = target?.getAttribute('data-comment-id');
  if (!id) return;
  if (id === '@draft') { popupCollapsed.value = false; return; }
  updateLayout();
  const parent = section.value?.closest<HTMLElement>('.document-main');
  const top = event.clientY - (parent?.getBoundingClientRect().top ?? 0);
  const block = layout.value.blocks.find(item => item.ids.includes(id) && top >= item.top && top <= item.bottom)
    ?? layout.value.blocks.find(item => item.ids.includes(id));
  if (block) openBlockComments(block.key, block.ids);
}
function showDiscussion() {
  section.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
async function openComment(event: Event) {
  const target = (event as CustomEvent<{ fileId: string; threadId: string; kind: CommentKind }>).detail;
  if (!target || target.fileId !== props.document.id) return;
  await load();
  if (target.kind === 'annotation') {
    openIds.value = [target.threadId];
    popupCollapsed.value = false;
    const anchor = working.value[target.threadId];
    if (anchor) props.focusAnchor(anchor);
    updateLayout();
  }
  await nextTick();
  const conversation = section.value?.querySelector<HTMLElement>(`[data-comment-thread="${CSS.escape(target.threadId)}"]`);
  conversation?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function beginAnnotation() {
  if (props.readonly) return;
  error.value = '';
  const selection = props.captureSelection();
  if (!selection || !selection.spans.length) {
    error.value = '请先选择文字，或将光标放在要批注的块中';
    showDiscussion();
    return;
  }
  try {
    selected.value = makeCommentAnchor(selection.basis, selection.text, selection.spans, props.document.base.hash);
    popupCollapsed.value = false;
    openIds.value = [];
    openBlockKey.value = undefined;
    await nextTick();
    updateLayout();
    await composer.value?.focus();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
}
async function assistantReply(kind: CommentKind, threadId: string, body: string) {
  if (props.readonly || busy.value) throw new Error('讨论当前无法填写回复');
  const thread = (kind === 'annotation' ? annotations.value : discussions.value)?.threads.find(thread => thread.id === threadId);
  if (!thread) throw new Error('原讨论已移除');
  if (body.length > 20_000) throw new Error('回答超过评论长度限制，请先缩短回答');
  if (kind === 'annotation') {
    if (!working.value[threadId]) throw new Error('原批注位置已变化，请重新打开批注');
    const block = layout.value.blocks.find(block => block.ids.includes(threadId));
    if (!block) throw new Error('无法定位原批注');
    openIds.value = [threadId]; openBlockKey.value = block.key; popupCollapsed.value = false;
    await nextTick();
    const conversation = conversations.get(threadId);
    if (!conversation) throw new Error('请重新打开原批注');
    conversation.setReply(body);
  } else {
    if (discussionDraft.value.trim()) throw new Error('讨论回复已有草稿，请先发布或清除');
    await beginDiscussionReply(threadId, thread.messages[0]);
    discussionDraft.value = body;
  }
}
defineExpose({ beginAnnotation, showDiscussion, assistantReply });

async function beginDiscussionReply(threadId: string, message: CommentMessage) {
  if (busy.value || props.readonly) return;
  discussionReply.value = { threadId, message };
  error.value = '';
  await discussionComposer.value?.focus();
}
async function cancelDiscussionReply() {
  if (busy.value) return;
  discussionReply.value = undefined;
  await discussionComposer.value?.focus();
}
async function submitDiscussion(mentions: CommentMention[] = []) {
  const target = discussionReply.value;
  if (!target) { await start('discussion', mentions); return; }
  const body = discussionDraft.value;
  if (!body.trim()) return;
  const epoch = documentEpoch;
  const saved = await saveChange('discussion', {
    type: 'reply', threadId: target.threadId, id: crypto.randomUUID(), body, author: props.author, replyTo: target.message.id, mentions,
  });
  if (saved && epoch === documentEpoch && discussionReply.value === target && discussionDraft.value === body) {
    discussionDraft.value = '';
    discussionReply.value = undefined;
  }
}

async function start(kind: CommentKind, mentions: CommentMention[] = []) {
  if (busy.value || props.readonly) return;
  if (kind === 'annotation' && !selected.value) return;
  const body = (kind === 'annotation' ? annotationDraft.value : discussionDraft.value).trim();
  if (!body) { error.value = '请输入评论内容'; return; }
  busy.value = true;
  error.value = '';
  try {
    if (!(await workspace.flush())) throw new Error('正文尚未保存，请先处理保存错误');
    if (kind === 'annotation') {
      const current = await project(props.document.content);
      if (!selected.value || !selected.value.spans.every(span =>
        current[selected.value!.basis].slice(span.from, span.to) === span.text))
        throw new Error('选中的内容已经变化，请重新选择批注位置');
    }
    const id = crypto.randomUUID();
    const anchor = selected.value && kind === 'annotation'
      ? { ...selected.value, baseHash: props.document.base.hash } : undefined;
    const next = await saveCommentChange(adapter, kind, props.document.id,
      { type: 'start', id, body, author: props.author, anchor, mentions });
    if (kind === 'annotation') {
      annotations.value = next;
      working.value = { ...working.value, [id]: anchor ?? null };
      openIds.value = [id];
      selected.value = undefined;
      publish();
      annotationDraft.value = '';
    } else { discussions.value = next; discussionDraft.value = ''; }
    selected.value = undefined;
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
  finally { busy.value = false; }
}

async function change(kind: CommentKind, threadId: string, action: 'reply' | 'resolve', body = '', resolved = false, mentions: CommentMention[] = []) {
  if (action === 'reply' && !body) return;
  const saved = await saveChange(kind, action === 'reply'
    ? { type: 'reply', threadId, id: crypto.randomUUID(), body, author: props.author, mentions }
    : { type: 'resolve', threadId, resolved });
  if (saved && action === 'reply') conversations.get(threadId)?.clearReply();
}
async function editMessage(kind: CommentKind, threadId: string, edit: CommentMessageEdit) {
  if (await saveChange(kind, { type: 'edit', threadId, authorId: props.author.id, ...edit }))
    conversations.get(threadId)?.finishEdit();
}
async function removeMessage(kind: CommentKind, threadId: string, removal: CommentMessageRemoval) {
  await saveChange(kind, { type: 'delete', threadId, authorId: props.author.id, ...removal });
}
async function saveChange(kind: CommentKind, change: CommentChange) {
  if (busy.value || props.readonly) return false;
  const epoch = documentEpoch;
  busy.value = true;
  error.value = '';
  try {
    const next = await saveCommentChange(adapter, kind, props.document.id, change);
    if (epoch !== documentEpoch) return false;
    if (kind === 'annotation') { annotations.value = next; publish(); }
    else discussions.value = next;
    return true;
  } catch (reason) {
    if (epoch === documentEpoch) error.value = reason instanceof Error ? reason.message : String(reason);
    return false;
  }
  finally { busy.value = false; }
}
</script>

<template>
  <section ref="section" class="document-discussion" aria-label="文档讨论">
    <button v-for="block in layout.blocks.filter(item => count(item.ids))" :key="block.key" type="button"
      class="annotation-count" :class="{ 'is-open': openBlockKey === block.key && popupVisible }"
      :style="{ left: `${layout.buttonLeft}px`, top: `${block.top + 2}px` }"
      :aria-label="`查看 ${count(block.ids)} 条局部批注`" :title="`${count(block.ids)} 条局部批注`"
      :aria-expanded="openBlockKey === block.key && popupVisible" @mousedown.prevent @click="openBlockComments(block.key, block.ids)">
      <MessageSquare :size="15" /><span>{{ count(block.ids) }}</span>
    </button>
    <div v-if="popupMounted" v-show="popupVisible" ref="popup" class="annotation-popup" role="dialog" aria-label="局部批注"
      :style="{ top: `${popupTop}px`, left: `${layout.popupLeft}px`, width: `${layout.popupWidth}px` }">
      <div class="annotation-popup-content">
        <CommentConversation v-for="thread in openThreads" :key="thread.id"
          :ref="value => value ? conversations.set(thread.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(thread.id)"
          :thread="thread" :quote="quote(working[thread.id]!)" local :readonly="readonly" :busy="busy" :author-id="author.id" :author-name="author.name"
          :assistant="assistant" @assistant="emit('assistant', { kind: 'annotation', thread, quote: quote(working[thread.id]!) })"
          @reply="(body, mentions) => change('annotation', thread.id, 'reply', body, false, mentions)"
          @edit="editMessage('annotation', thread.id, $event)" @remove="removeMessage('annotation', thread.id, $event)"
          @resolve="change('annotation', thread.id, 'resolve', '', $event)" />
        <blockquote v-if="selected" class="annotation-selected">{{ quote(selected) }}</blockquote>
        <CommentComposer v-if="selected && !readonly" ref="composer" v-model="annotationDraft" :author-name="author.name"
          label="添加批注" :busy="busy" compact @submit="start('annotation', $event)" />
      </div>
      <p v-if="error" class="comment-error" role="alert">{{ error }}</p>
    </div>
    <header class="document-discussion-header"><h2>文档讨论</h2><span v-if="discussions?.threads.length">{{ discussions.threads.reduce((total, thread) => total + thread.messages.length, 0) }}</span></header>
    <p v-if="error && !popupVisible" class="comment-error" role="alert">{{ error }}</p>
    <p v-if="loading && !discussions" class="discussion-loading">正在读取讨论...</p>
    <div class="document-discussion-messages">
      <CommentConversation v-for="thread in discussions?.threads ?? []" :key="thread.id"
        :ref="value => value ? conversations.set(thread.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(thread.id)"
        :thread="thread" :readonly="readonly" :busy="busy" :author-id="author.id" :author-name="author.name"
        :assistant="assistant" @assistant="emit('assistant', { kind: 'discussion', thread })"
        @reply-request="beginDiscussionReply(thread.id, $event)"
        @edit="editMessage('discussion', thread.id, $event)" @remove="removeMessage('discussion', thread.id, $event)" />
    </div>
    <details v-if="resolvedAnnotations.length" class="resolved-annotations">
      <summary>已解决的批注 · {{ resolvedAnnotations.length }}</summary>
      <CommentConversation v-for="thread in resolvedAnnotations" :key="thread.id" :thread="thread"
        :quote="quote(working[thread.id]!)" local :readonly="readonly" :busy="busy" :author-id="author.id" :author-name="author.name"
        :assistant="assistant" @assistant="emit('assistant', { kind: 'annotation', thread, quote: quote(working[thread.id]!) })"
        :ref="value => value ? conversations.set(thread.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(thread.id)"
        @reply="(body, mentions) => change('annotation', thread.id, 'reply', body, false, mentions)"
        @edit="editMessage('annotation', thread.id, $event)" @remove="removeMessage('annotation', thread.id, $event)"
        @resolve="change('annotation', thread.id, 'resolve', '', $event)" />
    </details>
    <div v-if="!readonly" class="document-discussion-compose">
      <div v-if="discussionReply" class="discussion-reply-target" role="status">
        <Reply :size="14" aria-hidden="true" />
        <span :title="`回复 ${discussionReply.message.authorName}：${discussionReply.message.body}`">回复 {{ discussionReply.message.authorName }}：{{ discussionReply.message.body }}</span>
        <button type="button" aria-label="取消回复" title="取消回复" :disabled="busy" @click="cancelDiscussionReply"><X :size="14" /></button>
      </div>
      <CommentComposer ref="discussionComposer" v-model="discussionDraft" :author-name="author.name"
        :label="discussionReply ? '回复评论' : '输入评论'" :busy="busy" @submit="submitDiscussion" />
    </div>
  </section>
</template>

<style scoped>
.document-discussion { max-width: 780px; margin: 48px auto 0; padding-top: 24px; color: var(--text); font-family: 'Inter Variable', 'Microsoft YaHei', sans-serif; }
.document-discussion-header { display: flex; align-items: baseline; gap: 10px; border-bottom: 1px solid var(--line); padding-bottom: 12px; }
.document-discussion-header h2 { font-size: 19px; font-weight: 500; line-height: 28px; margin: 0; }
.document-discussion-header > span { color: var(--muted); font-size: 13px; }
.document-discussion-compose { margin-top: 24px; }
.discussion-reply-target { display: flex; align-items: center; gap: 6px; min-width: 0; margin-bottom: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.discussion-reply-target > svg { flex: none; }
.discussion-reply-target > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discussion-reply-target button { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border: 0; border-radius: 4px; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.discussion-reply-target button:hover { background: var(--hover); color: var(--text); }
.discussion-reply-target button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.discussion-reply-target button:disabled { opacity: .5; cursor: default; }
.discussion-loading { font-size: 13px; color: var(--muted); }
.resolved-annotations { margin-top: 16px; padding-top: 12px; border-top: 1px solid var(--line); }
.resolved-annotations summary { color: var(--muted); font-size: 12px; cursor: pointer; margin-bottom: 12px; }
.annotation-count { position: absolute; z-index: 4; width: 42px; height: 26px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 500; cursor: pointer; }
.annotation-count:hover, .annotation-count.is-open { background: color-mix(in srgb, #edc142 16%, var(--paper)); color: var(--text); }
.annotation-count:focus-visible { outline: 2px solid #d5ad2d; outline-offset: 2px; }
.annotation-popup { position: absolute; z-index: 12; box-sizing: border-box; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 24px #00000012, 0 2px 6px #00000005; padding: 12px 16px 14px; }
.annotation-popup-content { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; }
.annotation-selected { margin: 0 0 12px 38px; border-left: 2px solid #eabf35; padding: 2px 10px; max-height: 80px; overflow: auto; font-size: 12px; line-height: 1.6; color: var(--muted); white-space: pre-wrap; overflow-wrap: anywhere; }
.comment-error { margin: 10px 0; color: #a63636; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 600px) { .document-discussion { margin-top: 32px; } .annotation-popup { padding: 10px 12px 12px; } .annotation-popup-content { max-height: 320px; } }
</style>
