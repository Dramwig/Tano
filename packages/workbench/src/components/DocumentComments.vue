<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import { t } from '../i18n';
import './review-card.css';
import { computed, nextTick, onBeforeUnmount, onBeforeUpdate, onMounted, onUpdated, ref, watch } from 'vue';
import { captureReviewRail, updateReviewRail, removeReviewRail } from './review-rail';
import { MessageSquare, Reply, X } from 'lucide-vue-next';
import { createHeadlessMarkdown } from '@tano/editor/headless';
import { makeCommentAnchor, rebaseCommentAnchor, resolveCommentAnchor } from '@tano/editor/comment-anchors';
import type { CommentAnchor, CommentFile, CommentKind, CommentMessage, CommentMention, CommentSpan, CommentThread } from '@tano/protocol';
import type { CommentGeometry } from '@tano/editor/comment-projection';
import { useWorkbenchRuntime } from '../runtime';
import { useWorkspaceStore } from '../stores/workspace';
import { recordHelpCompleted } from '../help-checklist';
import type { OpenDocument } from '../stores/workspace';
import { loadCommentFile, saveCommentChange } from '../workspace-comments';
import { refreshWorkspace, subscribeBackgroundRefresh } from '../background-refresh';
import type { CommentAuthor, CommentChange, CommentMessageEdit, CommentMessageRemoval } from '../workspace-comments';
import CommentComposer from './CommentComposer.vue';
import CommentConversation from './CommentConversation.vue';
import ReviewCard from './ReviewCard.vue';

const props = withDefaults(defineProps<{
  workspaceId: string;
  document: OpenDocument;
  readonly: boolean;
  author: CommentAuthor;
  captureSelection: () => { basis: 'prose' | 'source'; text: string; spans: CommentSpan[] } | null;
  focusAnchor: (anchor: CommentAnchor) => void;
  editorElement?: HTMLElement;
  geometry: (anchors?: readonly { id: string; anchor: CommentAnchor }[]) => CommentGeometry | null;
  assistant?: boolean;
  discussionVisible?: boolean;
}>(), { discussionVisible: true });
const emit = defineEmits<{
  annotations: [value: { id: string; anchor: CommentAnchor }[]];
  assistant: [request: { kind: CommentKind; thread: CommentThread; quote?: string }];
  'update:discussionVisible': [value: boolean];
}>();
const adapter = useWorkbenchRuntime().adapter;
const workspace = useWorkspaceStore();
const annotations = ref<CommentFile>();
const discussions = ref<CommentFile>();
const working = ref<Record<string, CommentAnchor | null>>({});
const loading = ref(false);
const busy = ref(false);
const error = ref('');
const drafts = ref<{ id: string; anchor?: CommentAnchor; body: string }[]>([]);
const activeDraftId = ref<string>();
const activeDraft = computed(() => drafts.value.find(draft => draft.id === activeDraftId.value));
const discussionDraft = ref('');
const discussionRequested = ref(false);
const discussionReply = ref<{ threadId: string; message: CommentMessage }>();
const selected = computed(() => activeDraft.value?.anchor);
const section = ref<HTMLElement>();
const discussionSection = ref<HTMLElement>();
const popup = ref<HTMLElement>();
const composers = new Map<string, InstanceType<typeof CommentComposer>>();
const discussionComposer = ref<InstanceType<typeof CommentComposer>>();
const conversations = new Map<string, InstanceType<typeof CommentConversation>>();
const annotationCards = new Map<string, HTMLElement>();
const reviewOwner = {};
const openIds = ref<string[]>([]);
const openBlockKey = ref<string>();
const popupCollapsed = ref(false);
const layout = ref<{ blocks: { key: string; ids: string[]; top: number; bottom: number }[]; buttonLeft: number; popupLeft: number; popupWidth: number; rail: boolean; railLeft: number; cardTops: Record<string, number> }>({ blocks: [], buttonLeft: 0, popupLeft: 0, popupWidth: 520, rail: false, railLeft: 0, cardTops: {} });
const railWidth = 320;
const railGap = 24;
let layoutFrame = 0;
let resizeObserver: ResizeObserver | undefined;
let cardResizeObserver: ResizeObserver | undefined;
let mutationObserver: MutationObserver | undefined;
let generation = 0;
let projectionTask: Promise<void> = Promise.resolve();
let documentEpoch = 0;
let contentRevision = 0;
let stopPolling: (() => void) | undefined;
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let parserPromise: ReturnType<typeof createHeadlessMarkdown> | undefined;
const projections = new Map<string, Promise<string>>();
let publishedAnnotations: string | undefined;
onBeforeUnmount(() => {
  if (annotations.value) void saveAnchors();
  generation++;
  documentEpoch++;
  stopPolling?.();
  clearTimeout(saveTimer);
  cancelAnimationFrame(layoutFrame);
  resizeObserver?.disconnect();
  cardResizeObserver?.disconnect();
  removeReviewRail(reviewOwner);
  mutationObserver?.disconnect();
  window.removeEventListener('resize', scheduleLayout);
  window.removeEventListener('pointerdown', outsidePointer, true);
  window.removeEventListener('keydown', escapePopup);
  window.removeEventListener('tano:open-comment', openComment);
  props.editorElement?.removeEventListener('click', markClicked);
  props.editorElement?.removeEventListener('tano-table-layout', scheduleLayout);
  void parserPromise?.then(parser => parser.destroy());
});

onBeforeUpdate(() => captureReviewRail(reviewOwner));
onUpdated(scheduleLayout);

function publish() {
  const anchors = (annotations.value?.threads ?? []).flatMap(thread => {
    const anchor = working.value[thread.id];
    return !thread.detached && !thread.resolved && anchor ? [{ id: thread.id, anchor }] : [];
  });
  for (const draft of drafts.value) if (draft.anchor) anchors.push({ id: draft.id, anchor: draft.anchor });
  const snapshot = JSON.stringify(anchors);
  if (snapshot !== publishedAnnotations) {
    publishedAnnotations = snapshot;
    emit('annotations', anchors);
  }
  scheduleLayout();
}
watch(() => drafts.value.map(draft => ({ id: draft.id, anchor: draft.anchor })), publish, { deep: true });

async function project(content: string, basis: CommentAnchor['basis']) {
  if (basis === 'source') return content;
  let projection = projections.get(content);
  if (!projection) {
    parserPromise ??= createHeadlessMarkdown();
    projection = parserPromise.then(parser => parser.projectComments(content));
    projections.set(content, projection);
    // Keep the before/after pair for sequential edits and unchanged polling.
    if (projections.size > 2) projections.delete(projections.keys().next().value!);
    void projection.catch(() => {
      if (projections.get(content) === projection) projections.delete(content);
    });
  }
  return projection;
}

async function projectChange(before: string, after: string, anchors: readonly CommentAnchor[]) {
  const texts = new Map<CommentAnchor['basis'], { before: string; after: string }>();
  for (const basis of new Set(anchors.map(anchor => anchor.basis))) {
    texts.set(basis, { before: await project(before, basis), after: await project(after, basis) });
  }
  return texts;
}

async function load() {
  const request = ++generation;
  const revision = contentRevision;
  loading.value = true;
  error.value = '';
  try {
    const snapshot = await refreshWorkspace(adapter);
    if (request !== generation || snapshot.id !== props.workspaceId) return;
    const [annotationFile, discussionFile] = await Promise.all([
      loadCommentFile(adapter, 'annotation', props.document.id, snapshot),
      loadCommentFile(adapter, 'discussion', props.document.id, snapshot),
    ]);
    if (request !== generation) return;
    const baseContent = props.document.base.content;
    const baseHash = props.document.base.hash;
    const currentContent = props.document.content;
    const firstLoad = !annotations.value;
    const previousWorking = working.value;
    const previousThreads = new Map(annotations.value?.threads.map(thread => [thread.id, thread]));
    const canResolve = (thread: CommentThread) => !thread.detached && thread.anchor?.baseHash === baseHash &&
      !(firstLoad && contentRevision > 0) &&
      !(previousWorking[thread.id] === null && previousThreads.get(thread.id)?.anchor?.baseHash === thread.anchor.baseHash);
    const texts = await projectChange(baseContent, currentContent,
      annotationFile.file.threads.filter(canResolve).map(thread => thread.anchor!));
    if (request !== generation || props.document.base.hash !== baseHash) return;
    annotations.value = annotationFile.file;
    discussions.value = discussionFile.file;
    working.value = Object.fromEntries(annotationFile.file.threads.map(thread => {
      if (!canResolve(thread) || props.document.content !== currentContent || revision !== contentRevision) return [thread.id, null];
      const text = texts.get(thread.anchor!.basis)!;
      const resolved = resolveCommentAnchor(thread.anchor!, text.before);
      return [thread.id, resolved && currentContent !== baseContent
        ? rebaseCommentAnchor(resolved, text.before, text.after) : resolved];
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

watch([() => props.workspaceId, () => props.document.id], () => {
  documentEpoch++;
  contentRevision = 0;
  annotations.value = undefined;
  discussions.value = undefined;
  projections.clear();
  working.value = {};
  activeDraftId.value = undefined;
  drafts.value = [];
  discussionDraft.value = '';
  discussionRequested.value = false;
  discussionReply.value = undefined;
  closePopup();
  publish();
  void load();
}, { immediate: true });
watch(() => props.document.content, (content, before) => {
  contentRevision++;
  // Discussions and detached annotations have no text positions to maintain.
  // Capture existing IDs now so queued edits cannot move a newly created draft.
  const threadIds = (annotations.value?.threads ?? [])
    .filter(thread => !thread.detached && working.value[thread.id]).map(thread => thread.id);
  const trackedDrafts = drafts.value.filter(draft => draft.anchor);
  if (!threadIds.length && !trackedDrafts.length) return;
  const epoch = documentEpoch;
  projectionTask = projectionTask.then(async () => {
    if (epoch !== documentEpoch) return;
    const anchors = [...threadIds.map(id => working.value[id]), ...trackedDrafts.map(draft => draft.anchor)]
      .filter((anchor): anchor is CommentAnchor => !!anchor);
    if (!anchors.length) return;
    const texts = await projectChange(before, content, anchors);
    if (epoch !== documentEpoch) return;
    const updated = { ...working.value };
    for (const id of threadIds) {
      const anchor = updated[id];
      if (!anchor) continue;
      const text = texts.get(anchor.basis)!;
      updated[id] = rebaseCommentAnchor(anchor, text.before, text.after);
    }
    working.value = updated;
    for (const draft of trackedDrafts) if (draft.anchor && drafts.value.includes(draft)) {
      const text = texts.get(draft.anchor.basis)!;
      const anchor = rebaseCommentAnchor(draft.anchor, text.before, text.after);
      draft.anchor = anchor ?? undefined;
      if (!anchor) error.value = t('选中的内容已删除，请重新选择批注位置');
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
  if (typeof ResizeObserver !== 'undefined') {
    cardResizeObserver = new ResizeObserver(scheduleLayout);
    for (const card of annotationCards.values()) cardResizeObserver.observe(card);
  }
  window.addEventListener('tano:open-comment', openComment);
  window.addEventListener('resize', scheduleLayout);
  window.addEventListener('pointerdown', outsidePointer, true);
  window.addEventListener('keydown', escapePopup);
  stopPolling = subscribeBackgroundRefresh(() => {
    if (!busy.value && !loading.value && props.document.content === props.document.base.content &&
        !(annotations.value?.threads.some(thread => working.value[thread.id] && thread.anchor && !thread.detached &&
          thread.anchor.baseHash !== props.document.base.hash))) return load();
  });
  scheduleLayout();
});
watch(() => props.editorElement, (element, previous) => {
  previous?.removeEventListener('click', markClicked);
  previous?.removeEventListener('tano-table-layout', scheduleLayout);
  resizeObserver?.disconnect();
  mutationObserver?.disconnect();
  element?.addEventListener('click', markClicked);
  element?.addEventListener('tano-table-layout', scheduleLayout);
  if (element && typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleLayout);
    resizeObserver.observe(element);
    const parent = section.value?.closest('.document-main');
    if (parent) resizeObserver.observe(parent);
  }
  if (element && typeof MutationObserver !== 'undefined') {
    mutationObserver = new MutationObserver(scheduleLayout);
    mutationObserver.observe(element, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class'] });
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
const pendingAnnotations = computed(() => activeAnnotations.value.filter(thread => !thread.resolved));
const pendingDiscussions = computed(() => (discussions.value?.threads ?? []).filter(thread => !thread.resolved));
const discussionShown = computed(() => props.discussionVisible && (
  pendingDiscussions.value.length > 0 || discussionRequested.value || !!discussionDraft.value || !!discussionReply.value
));
watch(() => pendingDiscussions.value.length, count => {
  if (count) discussionRequested.value = false;
});
watch(() => discussions.value?.threads.some(thread => thread.id === discussionReply.value?.threadId && thread.resolved), resolved => {
  if (resolved) discussionReply.value = undefined;
});
const openBlock = computed(() => layout.value.blocks.find(block => block.key === openBlockKey.value));
const openThreads = computed(() => {
  const ids = !layout.value.rail && !selected.value
    ? [...openIds.value, ...(openBlock.value?.ids ?? [])] : openIds.value;
  return pendingAnnotations.value.filter(thread => ids.includes(thread.id));
});
const visibleThreads = computed(() => layout.value.rail ? pendingAnnotations.value
  .filter(thread => layout.value.cardTops[thread.id] !== undefined)
  .sort((a, b) => layout.value.cardTops[a.id]! - layout.value.cardTops[b.id]!) : openThreads.value);
const popupTop = computed(() => (openBlock.value?.bottom ?? 0) + 8);
const popupMounted = computed(() => !!drafts.value.length || (!!openBlock.value && !!openThreads.value.length));
const popupVisible = computed(() => popupMounted.value && (!popupCollapsed.value || !!drafts.value.length));
const annotationMounted = computed(() => layout.value.rail ? !!pendingAnnotations.value.length || !!drafts.value.length : popupMounted.value);
function threadExpanded(id: string) { return !popupCollapsed.value && openIds.value.includes(id); }
function setAnnotationCard(id: string, value: unknown) {
  if (value && typeof value === 'object' && '$el' in value) value = value.$el;
  const previous = annotationCards.get(id);
  if (previous === value) return;
  if (previous) { cardResizeObserver?.unobserve(previous); }
  if (value instanceof HTMLElement) {
    annotationCards.set(id, value);
    cardResizeObserver?.observe(value);
  } else annotationCards.delete(id);
}
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
  for (const draft of drafts.value) if (draft.anchor) anchors.push({ id: draft.id, anchor: draft.anchor });
  const geometry = anchors.length ? props.geometry(anchors) : null;
  if (!geometry) { removeReviewRail(reviewOwner); if (layout.value.blocks.length || layout.value.rail) layout.value = { ...layout.value, blocks: [], rail: false }; return; }
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
  const railLeft = geometry.right - bounds.left + railGap;
  // Use existing space beside centered prose, including the selected card's 3px outset.
  const rail = blocks.length > 0 && railLeft + railWidth + 3 <= bounds.width - 16;
  const modeChanged = rail !== layout.value.rail;
  const cardTops: Record<string, number> = {};
  // A multi-block annotation has one card at its first anchor; expanded cards push later cards down.
  const positioned = new Set<string>();
  for (const block of [...blocks].sort((a, b) => a.top - b.top)) {
    for (const id of block.ids) {
      if (positioned.has(id)) continue;
      positioned.add(id);
      cardTops[id] = block.top;
    }
  }
  if (rail) updateReviewRail(reviewOwner, parent, [...positioned].flatMap(id => {
    const card = annotationCards.get(id);
    const block = blocks.find(block => block.ids.includes(id));
    if (!card || !block || card.style.display === 'none') return [];
    // Use the marked line, including wrapped text and paragraphs inside enhanced blocks.
    const mark = [...(props.editorElement?.querySelectorAll<HTMLElement>('[data-comment-id]') ?? [])]
      .find(element => element.dataset.commentId === id && element.getClientRects().length);
    const line = mark?.getClientRects()[0];
    return [{ id: 'comment:' + id, element: card, anchor: line ? line.top - bounds.top : block.top,
      selected: activeDraftId.value === id || threadExpanded(id) }];
  }));
  else removeReviewRail(reviewOwner);
  const nextLayout = {
    blocks,
    buttonLeft: Math.min(geometry.right - bounds.left + 12, bounds.width - 48),
    popupLeft: Math.max(16, Math.min(center - width / 2, bounds.width - width - 16)),
    popupWidth: width,
    rail,
    railLeft,
    cardTops,
  };
  if (JSON.stringify(nextLayout) !== JSON.stringify(layout.value)) layout.value = nextLayout;
  if (modeChanged) void nextTick(scheduleLayout);
  const current = blocks.find(block => block.key === openBlockKey.value &&
    (selected.value ? block.ids.includes(activeDraftId.value!) : block.ids.some(id => openIds.value.includes(id))));
  if (!current && (selected.value || openIds.value.length)) {
    openBlockKey.value = blocks.find(block => selected.value ? block.ids.includes(activeDraftId.value!) :
      block.ids.some(id => openIds.value.includes(id)))?.key;
  }
}
async function selectThread(id: string, focus = false) {
  if (threadExpanded(id) && !selected.value) {
    if (focus) await conversations.get(id)?.focusReply();
    return;
  }
  activeDraftId.value = undefined;
  openIds.value = [id];
  openBlockKey.value = layout.value.blocks.find(block => block.ids.includes(id))?.key;
  popupCollapsed.value = false;
  if (focus && working.value[id]) props.focusAnchor(working.value[id]!);
  scheduleLayout();
  if (focus) {
    await nextTick();
    await conversations.get(id)?.focusReply();
  }
}
function closePopup() { openIds.value = []; openBlockKey.value = undefined; activeDraftId.value = undefined; popupCollapsed.value = false; }
async function scrollPopupToThread(id: string) {
  await nextTick();
  if (layout.value.rail || !popupVisible.value) return;
  const content = popup.value?.querySelector<HTMLElement>('.annotation-popup-content');
  const card = annotationCards.get(id);
  if (content && card) content.scrollTop += card.getBoundingClientRect().top - content.getBoundingClientRect().top
    - (parseFloat(getComputedStyle(content).paddingTop) || 0);
}
function openBlockComments(key: string, ids: string[], threadId?: string) {
  const toggle = !threadId && openBlockKey.value === key && !selected.value;
  activeDraftId.value = undefined;
  openIds.value = ids.filter(id => !drafts.value.some(draft => draft.id === id));
  openBlockKey.value = key;
  popupCollapsed.value = toggle ? !popupCollapsed.value : false;
  if (threadId) void scrollPopupToThread(threadId);
}
function dismissPopup() {
  if (!busy.value) drafts.value = drafts.value.filter(draft => draft.body.trim());
  activeDraftId.value = undefined;
  openIds.value = [];
  popupCollapsed.value = !drafts.value.length;
  scheduleLayout();
}
async function annotationFocusout(id: string) {
  await nextTick();
  const draft = drafts.value.find(draft => draft.id === id);
  if (draft && !draft.body.trim() && !busy.value && !annotationCards.get(id)?.contains(document.activeElement)) {
    drafts.value = drafts.value.filter(draft => draft.id !== id);
    if (activeDraftId.value === id) activeDraftId.value = undefined;
  }
}
function outsidePointer(event: PointerEvent) {
  const target = event.target;
  if (!(target instanceof Element) || target.closest('.annotation-popup, .annotation-rail, .comment-more-menu, .annotation-count, .annotation-create-button, [data-comment-id]')) return;
  dismissPopup();
}
function escapePopup(event: KeyboardEvent) { if (event.key === 'Escape') dismissPopup(); }
async function selectDraft(id: string) {
  activeDraftId.value = id;
  openIds.value = [];
  popupCollapsed.value = false;
  updateLayout();
  await nextTick();
  await composers.get(id)?.focus();
}
function markClicked(event: MouseEvent) {
  const target = event.target instanceof Element ? event.target.closest('[data-comment-id]') : null;
  const id = target?.getAttribute('data-comment-id');
  if (!id) return;
  if (drafts.value.some(draft => draft.id === id)) {
    void selectDraft(id);
    return;
  }
  updateLayout();
  if (layout.value.rail) { void selectThread(id, true); return; }
  const parent = section.value?.closest<HTMLElement>('.document-main');
  const top = event.clientY - (parent?.getBoundingClientRect().top ?? 0);
  const block = layout.value.blocks.find(item => item.ids.includes(id) && top >= item.top && top <= item.bottom)
    ?? layout.value.blocks.find(item => item.ids.includes(id));
  if (block) {
    openBlockComments(block.key, block.ids, id);
    void nextTick(() => conversations.get(id)?.focusReply());
  }
}
async function showDiscussion() {
  discussionRequested.value = pendingDiscussions.value.length === 0;
  emit('update:discussionVisible', true);
  await nextTick();
  discussionSection.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  await discussionComposer.value?.focus();
}
function dismissEmptyDiscussion() {
  if (busy.value || pendingDiscussions.value.length || discussionDraft.value.trim()) return;
  discussionRequested.value = false;
  discussionDraft.value = '';
  discussionReply.value = undefined;
  error.value = '';
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
  } else {
    emit('update:discussionVisible', true);
  }
  await nextTick();
  if (target.kind === 'annotation' && !layout.value.rail) {
    await scrollPopupToThread(target.threadId);
    return;
  }
  const conversation = section.value?.querySelector<HTMLElement>(`[data-comment-thread="${CSS.escape(target.threadId)}"]`);
  conversation?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function beginAnnotation() {
  if (props.readonly) return;
  error.value = '';
  const selection = props.captureSelection();
  if (!selection || !selection.spans.length) {
    error.value = t('请先选择文字，或将光标放在要批注的块中');
    await showDiscussion();
    return;
  }
  try {
    const anchor = makeCommentAnchor(selection.basis, selection.text, selection.spans, props.document.base.hash);
    drafts.value = drafts.value.filter(draft => draft.body.trim());
    let draft = drafts.value.find(draft => draft.anchor?.basis === anchor.basis && JSON.stringify(draft.anchor.spans) === JSON.stringify(anchor.spans));
    if (!draft) {
      draft = { id: drafts.value.length ? `@draft-${crypto.randomUUID()}` : '@draft', anchor, body: '' };
      drafts.value.push(draft);
    }
    activeDraftId.value = draft.id;
    popupCollapsed.value = false;
    openIds.value = [];
    openBlockKey.value = undefined;
    await nextTick();
    updateLayout();
    await nextTick();
    await composers.get(draft.id)?.focus();
  } catch (reason) { error.value = reason instanceof Error ? reason.message : String(reason); }
}
async function assistantReply(kind: CommentKind, threadId: string, body: string) {
  if (props.readonly || busy.value) throw new Error(t('讨论当前无法填写回复'));
  const thread = (kind === 'annotation' ? annotations.value : discussions.value)?.threads.find(thread => thread.id === threadId);
  if (!thread) throw new Error(t('原讨论已移除'));
  if (body.length > 20_000) throw new Error(t('回答超过评论长度限制，请先缩短回答'));
  if (kind === 'annotation') {
    if (!working.value[threadId]) throw new Error(t('原批注位置已变化，请重新打开批注'));
    const block = layout.value.blocks.find(block => block.ids.includes(threadId));
    if (!block) throw new Error(t('无法定位原批注'));
    openIds.value = [threadId]; openBlockKey.value = block.key; popupCollapsed.value = false;
    await nextTick();
    const conversation = conversations.get(threadId);
    if (!conversation) throw new Error(t('请重新打开原批注'));
    conversation.setReply(body);
  } else {
    if (discussionDraft.value.trim()) throw new Error(t('讨论回复已有草稿，请先发布或清除'));
    await beginDiscussionReply(threadId, thread.messages[0]);
    discussionDraft.value = body;
  }
}
defineExpose({ beginAnnotation, showDiscussion, assistantReply });

async function beginDiscussionReply(threadId: string, message: CommentMessage) {
  if (busy.value || props.readonly) return;
  discussionReply.value = { threadId, message };
  error.value = '';
  emit('update:discussionVisible', true);
  await nextTick();
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

async function start(kind: CommentKind, mentions: CommentMention[] = [], draftId = activeDraftId.value) {
  if (busy.value || props.readonly) return;
  const epoch = documentEpoch;
  const fileId = props.document.id;
  const draft = kind === 'annotation' ? drafts.value.find(draft => draft.id === draftId) : undefined;
  if (kind === 'annotation' && !draft?.anchor) { error.value = t('请重新选择批注位置'); return; }
  const body = (kind === 'annotation' ? draft!.body : discussionDraft.value).trim();
  if (!body) { error.value = t('请输入评论内容'); return; }
  busy.value = true;
  error.value = '';
  try {
    if (!(await workspace.flush())) throw new Error(t('正文尚未保存，请先处理保存错误'));
    await projectionTask;
    if (epoch !== documentEpoch) return;
    if (kind === 'annotation') {
      if (!draft?.anchor) throw new Error(t('选中的内容已经变化，请重新选择批注位置'));
      const current = await project(props.document.content, draft.anchor.basis);
      if (!draft?.anchor || !draft.anchor.spans.every(span =>
        current.slice(span.from, span.to) === span.text))
        throw new Error(t('选中的内容已经变化，请重新选择批注位置'));
    }
    const id = crypto.randomUUID();
    const anchor = draft?.anchor && kind === 'annotation'
      ? { ...draft.anchor, baseHash: props.document.base.hash } : undefined;
    if (epoch !== documentEpoch) return;
    const next = await saveCommentChange(adapter, kind, fileId,
      { type: 'start', id, body, author: props.author, anchor, mentions });
    if (epoch !== documentEpoch) return;
    recordHelpCompleted(kind === 'annotation' ? 'annotation' : 'comment');
    if (kind === 'annotation') {
      annotations.value = next;
      working.value = { ...working.value, [id]: anchor ?? null };
      openIds.value = [id];
      drafts.value = drafts.value.filter(item => item.id !== draftId);
      if (activeDraftId.value === draftId) activeDraftId.value = undefined;
      publish();
    } else { discussions.value = next; discussionDraft.value = ''; discussionRequested.value = false; }
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
    if (change.type === 'reply') recordHelpCompleted('reply-comment');
    if (change.type === 'resolve' && change.resolved) recordHelpCompleted('resolve-comment');
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
  <div ref="section" class="document-review">
    <button v-for="block in layout.rail ? [] : layout.blocks.filter(item => count(item.ids))" :key="block.key" type="button"
      class="annotation-count" :class="{ 'is-open': openBlockKey === block.key && popupVisible }"
      :style="{ left: `${layout.buttonLeft}px`, top: `${block.top + 2}px` }"
      :aria-label="t('查看 {0} 条局部批注', [count(block.ids)])" :data-tooltip="t('{0} 条局部批注', [count(block.ids)])"
      :aria-expanded="openBlockKey === block.key && popupVisible" @mousedown.prevent @click="openBlockComments(block.key, block.ids)">
      <MessageSquare :size="15" /><span>{{ count(block.ids) }}</span>
    </button>
    <div v-if="annotationMounted" v-show="layout.rail || popupVisible" ref="popup" :class="layout.rail ? 'annotation-rail' : 'annotation-popup'"
      :role="layout.rail ? 'region' : 'dialog'" :aria-label="t('局部批注')"
      :style="{ top: `${layout.rail ? 0 : popupTop}px`, left: `${layout.rail ? layout.railLeft : layout.popupLeft}px`, width: `${layout.rail ? railWidth : layout.popupWidth}px` }">
      <div :class="{ 'annotation-popup-content panel-scrollbar': !layout.rail }">
        <ReviewCard v-for="thread in visibleThreads" :key="thread.id" :ref="value => setAnnotationCard(thread.id, value)"
          class="annotation-thread" :class="{ 'annotation-card': layout.rail }" :framed="layout.rail"
          :expanded="threadExpanded(thread.id)" :label="layout.rail ? t('批注：{0}', [thread.messages[0]?.body]) : undefined"
          @activate="selectThread(thread.id, true)">
          <div class="annotation-card-content">
            <CommentConversation
              :ref="value => value ? conversations.set(thread.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(thread.id)"
              :thread="thread" :quote="layout.rail ? undefined : quote(working[thread.id]!)" local :preview="layout.rail && !threadExpanded(thread.id)"
              :readonly="readonly" :busy="busy" :author-id="author.id" :author-name="author.name" @expand="selectThread(thread.id, true)"
              :assistant="assistant" @assistant="emit('assistant', { kind: 'annotation', thread, quote: quote(working[thread.id]!) })"
              @reply="(body, mentions) => change('annotation', thread.id, 'reply', body, false, mentions)"
              @edit="editMessage('annotation', thread.id, $event)" @remove="removeMessage('annotation', thread.id, $event)"
              @resolve="change('annotation', thread.id, 'resolve', '', $event)" />
            <p v-if="layout.rail && error && threadExpanded(thread.id)" class="comment-error" role="alert">{{ error }}</p>
          </div>
        </ReviewCard>
        <ReviewCard v-for="draft in drafts" :key="draft.id" :ref="value => setAnnotationCard(draft.id, value)" :data-annotation-draft="draft.id"
          class="annotation-draft" :class="{ 'annotation-card': layout.rail }" :framed="layout.rail" :expanded="activeDraftId === draft.id"
          :label="t('批注草稿')" @activate="selectDraft(draft.id)">
          <div class="annotation-card-content">
            <CommentComposer v-if="!readonly" :ref="value => value ? composers.set(draft.id, value as InstanceType<typeof CommentComposer>) : composers.delete(draft.id)" v-model="draft.body" :author-name="author.name"
              :label="t('添加批注')" :busy="busy" compact @submit="start('annotation', $event, draft.id)" @focusin="activeDraftId = draft.id; openIds = []" @focusout="annotationFocusout(draft.id)" />
            <p v-if="layout.rail && error" class="comment-error" role="alert">{{ error }}</p>
          </div>
        </ReviewCard>
      </div>
      <p v-if="error && !layout.rail" class="comment-error" role="alert">{{ error }}</p>
    </div>
    <p v-if="error && !popupVisible && !discussionShown" class="comment-error" role="alert">{{ error }}</p>
    <section v-show="discussionShown" ref="discussionSection" class="document-discussion" :aria-label="t('文档讨论')">
      <header class="document-discussion-header">
        <h2>{{ t('文档讨论') }}</h2><span v-if="pendingDiscussions.length">{{ pendingDiscussions.reduce((total, thread) => total + thread.messages.length, 0) }}</span>
        <button v-if="!pendingDiscussions.length && !discussionDraft.trim()" type="button" class="discussion-dismiss"
          :aria-label="t('关闭讨论输入')" :data-tooltip="t('关闭讨论输入')" :disabled="busy" @click="dismissEmptyDiscussion"><X :size="16" /></button>
      </header>
      <p v-if="error && !popupVisible" class="comment-error" role="alert">{{ error }}</p>
      <LoadingSkeleton v-if="loading && !discussions" :rows="3" />
      <div class="document-discussion-messages">
        <CommentConversation v-for="thread in pendingDiscussions" :key="thread.id"
          :ref="value => value ? conversations.set(thread.id, value as InstanceType<typeof CommentConversation>) : conversations.delete(thread.id)"
          :thread="thread" :readonly="readonly" :busy="busy" :author-id="author.id" :author-name="author.name"
          :assistant="assistant" @assistant="emit('assistant', { kind: 'discussion', thread })"
          @reply-request="beginDiscussionReply(thread.id, $event)"
          @edit="editMessage('discussion', thread.id, $event)" @remove="removeMessage('discussion', thread.id, $event)"
          @resolve="change('discussion', thread.id, 'resolve', '', $event)" />
      </div>
      <div v-if="!readonly" class="document-discussion-compose">
        <div v-if="discussionReply" class="discussion-reply-target" role="status">
          <Reply :size="14" aria-hidden="true" />
          <span :title="t('回复 {0}：{1}', [discussionReply.message.authorName, discussionReply.message.body])">{{ t('回复') }} {{ discussionReply.message.authorName }}：{{ discussionReply.message.body }}</span>
          <button type="button" :aria-label="t('取消回复')" :data-tooltip="t('取消回复')" :disabled="busy" @click="cancelDiscussionReply"><X :size="14" /></button>
        </div>
        <CommentComposer ref="discussionComposer" v-model="discussionDraft" :author-name="author.name"
          :label="discussionReply ? t('回复评论') : t('添加评论')" :busy="busy" compact @submit="submitDiscussion" />
      </div>
    </section>
  </div>
</template>

<style scoped>
.document-review { color: var(--text); font-family: 'Inter Variable', 'Microsoft YaHei', sans-serif; }
.document-discussion { box-sizing: border-box; max-width: var(--tano-content-measure, 780px); margin: 48px auto 0; padding: 24px var(--tano-block-padding-inline, 8px) 0; }
.document-discussion :deep(.tano-skeleton-list) { padding-inline: 0; }
.document-discussion-header { display: flex; align-items: baseline; gap: 10px; padding-bottom: 8px; }
.document-discussion-header h2 { font-size: 19px; font-weight: 500; line-height: 28px; margin: 0; }
.document-discussion-header > span { color: var(--muted); font-size: 13px; }
.discussion-dismiss { display: grid; place-items: center; margin-left: auto; padding: 4px; border: 0; border-radius: 4px; background: transparent; color: var(--muted); cursor: pointer; }
.discussion-dismiss:hover { background: var(--hover); color: var(--text); }
.document-discussion-compose { margin-top: 16px; }
.document-discussion-compose :deep(.comment-composer) { gap: 12px; }
.document-discussion-compose :deep(.comment-avatar) { width: 32px; height: 32px; }
.document-discussion-compose :deep(.comment-avatar svg) { width: 18px; height: 18px; }
.document-discussion-compose :deep(textarea) { min-height: 40px; padding-block: 10px; font-size: 14px; }
.discussion-reply-target { display: flex; align-items: center; gap: 6px; min-width: 0; margin-bottom: 8px; color: var(--muted); font-size: 12px; line-height: 20px; }
.discussion-reply-target > svg { flex: none; }
.discussion-reply-target > span { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.discussion-reply-target button { display: grid; place-items: center; flex: none; width: 24px; height: 24px; border: 0; border-radius: 4px; padding: 0; background: transparent; color: var(--muted); cursor: pointer; }
.discussion-reply-target button:hover { background: var(--hover); color: var(--text); }
.discussion-reply-target button:focus-visible { outline: 2px solid var(--green); outline-offset: 2px; }
.discussion-reply-target button:disabled { opacity: .5; cursor: default; }
.discussion-loading { font-size: 13px; color: var(--muted); }
.annotation-count { position: absolute; z-index: 4; width: 42px; height: 26px; display: flex; align-items: center; justify-content: center; gap: 6px; padding: 0; border: 0; border-radius: 4px; background: transparent; color: var(--muted); font-size: 12px; font-weight: 500; cursor: pointer; }
.annotation-count:hover, .annotation-count.is-open { background: color-mix(in srgb, #edc142 16%, var(--paper)); color: var(--text); }
.annotation-count:focus-visible { outline: 2px solid #d5ad2d; outline-offset: 2px; }
.annotation-popup { position: absolute; z-index: 12; box-sizing: border-box; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 24px #00000012, 0 2px 6px #00000005; overflow: hidden; }
.annotation-popup-content { max-height: 400px; overflow-y: auto; overscroll-behavior: contain; padding: 12px 0 14px; }
.annotation-popup-content > div { padding-inline: 16px; }
.annotation-draft.review-card { padding-block: 6px; }
.annotation-popup > .comment-error { margin: 10px 16px 14px; }
.annotation-popup-content > .annotation-thread + .annotation-thread { margin-top: 16px; padding-top: 16px; border-top: 1px solid var(--line); }
.annotation-rail { position: absolute; z-index: 4; --annotation-card-border: rgb(42 28 0 / 7%); }
.annotation-card { position: absolute; }
.annotation-card-content { display: flow-root; }
.comment-error { margin: 10px 0; color: #a63636; font-size: 12px; overflow-wrap: anywhere; }
@media (max-width: 600px) { .document-discussion { margin-top: 32px; } .annotation-popup-content { max-height: 320px; padding: 10px 0 12px; } .annotation-popup-content > div { padding-inline: 12px; } .annotation-popup > .comment-error { margin-inline: 12px; } }
</style>
