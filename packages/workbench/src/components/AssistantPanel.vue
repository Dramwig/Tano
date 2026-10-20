<script setup lang="ts">
import { t, uiLocale } from '../i18n';
import { assistantCopy, assistantTaskPrompts } from '../assistant/language';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlignLeft, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, ChevronsRight, CircleCheck, Copy, Cpu, createLucideIcon, FilePlus2, FileText, History, Languages, LoaderCircle, MessageCircle, MessageCirclePlus, Minus, MoreHorizontal, Paperclip, Pencil, Plug, Plus, RefreshCw, Reply, Quote, Search, Settings2, Square, Terminal, Trash2, Undo2, X } from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import type { AssistantMessage, AssistantProposal, AssistantReasoningSelection, AssistantSource, ReferenceIdentity } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
import { isAssistantFile } from '../assistant/files';
import { assistantToolLabel, assistantAnswerText } from '../assistant/results';
import type { AssistantDisplayMode } from '../assistant/store';
import { useWorkspaceStore } from '../stores/workspace';
import AssistantChangeList from './AssistantChangeList.vue';
import AssistantModelIcon from './AssistantModelIcon.vue';
import AssistantGenerationHint from './AssistantGenerationHint.vue';
import AssistantButterfly from './AssistantButterfly.vue';
import AssistantQuestionCard from './AssistantQuestionCard.vue';
import AssistantMessageBody from './AssistantMessageBody.vue';

const assistant = useAssistantStore();
const workspace = useWorkspaceStore();
const props = defineProps<{ compact?: boolean; fullscreenTarget?: string | HTMLElement }>();
const emit = defineEmits<{ openReference: [identity: ReferenceIdentity]; revealSelection: [source: AssistantSource]; openSettings: [] }>();
// Keep the destination while disabled so re-enabling Teleport updates its target.
const teleportTarget = computed<string | HTMLElement>(previous => assistant.displayMode === 'sidebar' ? previous ?? 'body'
  : assistant.displayMode === 'fullscreen' ? props.fullscreenTarget ?? 'body' : 'body');
const section = ref<'conversation' | 'history'>('conversation');
const query = ref('');
const textarea = ref<HTMLTextAreaElement>();
const messages = ref<HTMLElement>();
const welcomeButterfly = ref<InstanceType<typeof AssistantButterfly>>();
const notice = ref('');
const manualModelId = ref('');
const deleting = ref<string>();
const exportMessage = ref<AssistantMessage>();
const exportPath = ref(t('助手结果.md'));
const visibleMessages = ref(30);
const panel = ref<HTMLElement>();
const popover = ref<'model' | 'reasoning' | 'add' | 'history' | 'more' | 'mode' | 'translation' | null>(null);
function displayIcon(name: string, region: { x: string; y: string; width: string; height: string }) {
  return createLucideIcon(name, [
    ['rect', { x: '2', y: '4', width: '20', height: '16', rx: '2', key: 'frame' }],
    ['rect', { ...region, rx: '0.5', fill: 'currentColor', stroke: 'none', class: 'assistant-mode-region', key: 'region' }],
  ]);
}
const displayModes = [
  { id: 'sidebar', get label() { return t('侧栏'); }, icon: displayIcon('AssistantSidebar', { x: '15', y: '6', width: '5', height: '12' }) },
  { id: 'floating', get label() { return t('浮动'); }, icon: displayIcon('AssistantFloating', { x: '15', y: '12', width: '5', height: '6' }) },
  { id: 'fullscreen', get label() { return t('全屏'); }, icon: displayIcon('AssistantFullscreen', { x: '4', y: '6', width: '16', height: '12' }) },
] as const;
const displayModeIcon = computed(() => displayModes.find(mode => mode.id === assistant.displayMode)!.icon);
const floatingRect = ref<{ left: number; top: number; width: number; height: number }>();
const floatingStyle = computed(() => !props.compact && assistant.displayMode === 'floating' && floatingRect.value ? {
  left: `${floatingRect.value.left}px`, top: `${floatingRect.value.top}px`,
  width: `${floatingRect.value.width}px`, height: `${floatingRect.value.height}px`, right: 'auto', bottom: 'auto',
} : {});
let floatingGesture: { pointer: number; target: HTMLElement; x: number; y: number; rect: NonNullable<typeof floatingRect.value> } | undefined;
const modelView = ref<'main' | 'connections' | 'manual'>('main');
const modelQuery = ref('');
const searchingModels = ref(false);
const addView = ref<'main' | 'sources'>('main');
const historyQuery = ref('');
const searchingHistory = ref(false);
const menuMaxHeight = ref(440);
const menuPosition = ref({ left: '0px', bottom: '0px' });
const showLatest = ref(false);
let popoverTrigger: HTMLButtonElement | undefined;
let composerObserver: ResizeObserver | undefined;
const title = computed(() => assistant.session?.messages.length ? assistant.session.title : t('新助手会话'));
const modelLabel = computed(() => assistant.modelId === 'cli-default' ? t('CLI 默认模型') : assistant.modelId || t('选择模型'));
const controlsLocked = computed(() => assistant.busy || assistant.applying || assistant.loading);
const reasoningChoices: { id: AssistantReasoningSelection; label: string; short: string; detail: string }[] = [
  { id: 'low', get label() { return t('低'); }, get short() { return t('低'); }, get detail() { return t('日常问答，优先速度'); } },
  { id: 'medium', get label() { return t('中'); }, get short() { return t('中'); }, get detail() { return t('平衡速度与质量'); } },
  { id: 'high', get label() { return t('高'); }, get short() { return t('高'); }, get detail() { return t('复杂分析'); } },
  { id: 'xhigh', get label() { return t('很高'); }, get short() { return t('很高'); }, get detail() { return t('更深入推理'); } },
  { id: 'max', get label() { return t('最高'); }, get short() { return t('最高'); }, get detail() { return t('更多推理，更长等待'); } },
  { id: 'ultra', get label() { return t('极高'); }, get short() { return t('极高'); }, get detail() { return t('更多推理，更长等待'); } },
  { id: 'cli-default', get label() { return t('沿用 CLI 设置'); }, get short() { return t('默认'); }, get detail() { return t('使用本机 Codex 的推理配置'); } },
];
const reasoningLabel = computed(() => reasoningChoices.find(choice => choice.id === assistant.reasoningEffort)?.short ?? t('默认'));
const modelOptions = computed(() => {
  const models = [...assistant.models];
  if (assistant.modelId && !models.includes(assistant.modelId)) models.unshift(assistant.modelId);
  return models;
});
const listedModels = computed(() => modelOptions.value.filter(id => id.toLocaleLowerCase().includes(modelQuery.value.toLocaleLowerCase())));
const historyGroups = computed(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const groups = [{ get label() { return t('今天'); }, sessions: [] as typeof assistant.sessions }, { get label() { return t('昨天'); }, sessions: [] as typeof assistant.sessions }, { get label() { return t('更早'); }, sessions: [] as typeof assistant.sessions }];
  for (const session of [...assistant.sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!session.title.toLocaleLowerCase().includes(historyQuery.value.toLocaleLowerCase())) continue;
    groups[session.updatedAt >= today.getTime() ? 0 : session.updatedAt >= yesterday.getTime() ? 1 : 2]!.sessions.push(session);
  }
  return groups.filter(group => group.sessions.length);
});
const starters = computed(() => {
  const copy = assistantCopy(uiLocale.value).starters;
  const prompts = assistantTaskPrompts.starters;
  return [
    { label: copy.summary, prompt: prompts.summary, icon: AlignLeft },
    { label: copy.polish, prompt: prompts.polish, icon: Pencil },
    { label: copy.translate, prompt: null, icon: Languages },
    { label: copy.tasks, prompt: prompts.tasks, icon: CircleCheck },
  ];
});
const translationTargets = computed(() => {
  const copy = assistantCopy(uiLocale.value).starters;
  const prompts = assistantTaskPrompts.starters;
  return [
    { label: copy.translateEnglish, prompt: prompts.translateEnglish },
    { label: copy.translateChinese, prompt: prompts.translateChinese },
  ];
});
const sourceFiles = computed(() => workspace.workspace?.files.filter(file => file.kind === 'file' && isAssistantFile(file.path) &&
  file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).slice(0, 100) ?? []);
const displayed = computed(() => assistant.session?.messages.slice(-visibleMessages.value) ?? []);
const messageSources = computed(() => {
  const messages = assistant.session?.messages ?? [];
  const sourcesByMessage = new Map<string, AssistantSource[]>();
  for (const [index, message] of messages.entries()) {
    const sources = message.sources ?? [];
    const previous = messages[index - 1];
    if (message.role !== 'assistant' || previous?.role !== 'user') {
      sourcesByMessage.set(message.id, sources);
      continue;
    }
    // Older conversations kept all reference documents on the reply without attachment IDs.
    const attached = new Set(message.attachedSourceIds ?? sources.map(source => source.id));
    sourcesByMessage.set(previous.id, [...(previous.sources ?? []), ...sources.filter(source => attached.has(source.id))]);
    sourcesByMessage.set(message.id, sources.filter(source => !attached.has(source.id)));
  }
  return sourcesByMessage;
});
async function changeConnection(id: string) {
  try { await assistant.selectConnection(id); modelView.value = 'main'; }
  catch (error) { assistant.error = String(error); }
}
async function changeModel(id: string) {
  try { await assistant.selectModel(id); closePopover(true); }
  catch (error) { assistant.error = String(error); }
}
async function changeReasoning(value: AssistantReasoningSelection) {
  try { await assistant.selectReasoningEffort(value); closePopover(true); }
  catch (error) { assistant.error = String(error); }
}
function inputModel() {
  manualModelId.value = assistant.modelId; modelView.value = 'manual';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>(`[aria-label="${t('当前对话的模型 ID')}"]`)?.focus());
}
function chooseRecoveryModel() {
  closePopover();
  panel.value?.querySelector<HTMLButtonElement>(`[aria-label="${t('选择助手模型')}"]`)?.click();
}
function setModelView(view: 'main' | 'connections') {
  modelView.value = view;
  void nextTick(() => panel.value?.querySelector<HTMLButtonElement>('#assistant-model-options [data-menu-item]:not(:disabled)')?.focus());
}
function searchModels() {
  searchingModels.value = !searchingModels.value;
  if (!searchingModels.value) modelQuery.value = '';
  void nextTick(() => panel.value?.querySelector<HTMLElement>(searchingModels.value ? '#assistant-model-search' : `[aria-label="${t('搜索模型列表')}"]`)?.focus());
}
function toggleSource(id: string) {
  if (assistant.busy) return;
  if (assistant.files.includes(id)) {
    assistant.files = assistant.files.filter(file => file !== id);
    if (assistant.selection?.fileId === id) assistant.selection = null;
  } else if (assistant.files.length < 20) assistant.files.push(id);
  else notice.value = t('一次最多选择 20 篇文档');
}
async function openSource(source: AssistantSource) {
  notice.value = '';
  try {
    if (!workspace.workspace || workspace.workspace.id !== source.workspaceId) throw new Error(t('请在原工作区打开引用'));
    const snapshot = await workspace.assistantSnapshot({ id: workspace.workspace.id, path: workspace.workspace.path }, source.fileId);
    const file = workspace.workspace.files.find(file => file.id === source.fileId);
    if (!file) throw new Error(t('来源文档已移除'));
    if (workspace.active?.id !== file.id) {
      const pane = workspace.panes.find(pane => pane.id === workspace.activePaneId);
      const matches = workspace.tabs.filter(tab => tab.document?.id === file.id);
      const existing = matches.find(tab => pane?.tabs.includes(tab.id)) ?? matches[0];
      if (existing) workspace.activeId = existing.id;
      else await workspace.openFile({ ...file, path: snapshot.path });
    }
    if (source.selection) emit('revealSelection', source);
    if (snapshot.hash !== source.hash) notice.value = t('来源已更新；回答基于生成时的版本');
  } catch (error) { notice.value = String(error); }
}
function answerMarkdown(message: AssistantMessage) {
  return message.content.replace(/\[来源:(S\d+)\]/g, (_match, id: string) => message.sources?.some(source => source.id === id)
    ? t('[来源 {0}](#assistant-source-{1})', [id, id]) : t('（来源未提供）'));
}
function sourceLink(message: AssistantMessage, reference: string) {
  const id = /^#assistant-source-(S\d+)$/.exec(reference)?.[1];
  const source = message.sources?.find(source => source.id === id);
  if (source) void openSource(source);
  else notice.value = t('此链接未关联本次提供的来源');
}
function openAnswerReference(identity: ReferenceIdentity) {
  if (assistant.session?.workspaceId !== workspace.workspace?.id) { notice.value = t('请在原工作区打开引用'); return; }
  emit('openReference', identity);
}
async function copy(message: AssistantMessage) {
  try { await navigator.clipboard.writeText(assistantAnswerText(message)); notice.value = t('已复制'); }
  catch { notice.value = t('无法访问剪贴板'); }
}
async function draftReply(message: AssistantMessage) {
  try {
    await assistant.replyTarget?.draft(assistantAnswerText(message));
    notice.value = t('回答已填入回复草稿');
  } catch (error) { notice.value = String(error); }
}
async function exportAnswer() {
  const message = exportMessage.value;
  if (!message || !assistantAnswerText(message).trim() || !workspace.workspace || assistant.applying || assistant.busy) return;
  const proposal: AssistantProposal = { id: crypto.randomUUID(), runId: message.id,
    workspaceId: workspace.workspace.id, kind: 'create', path: exportPath.value, base: '', content: assistantAnswerText(message),
    reason: t('将助手回答保存为 Markdown 文档'), status: 'ready' };
  message.proposals ??= []; message.proposals.push(proposal); exportMessage.value = undefined;
  await assistant.review(proposal);
}
function sendKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void assistant.send(); }
}
function togglePopover(kind: NonNullable<typeof popover.value>, event: MouseEvent) {
  popoverTrigger = event.currentTarget as HTMLButtonElement;
  if (popover.value === kind) { closePopover(true); return; }
  modelView.value = 'main'; modelQuery.value = ''; searchingModels.value = false; addView.value = 'main'; query.value = '';
  historyQuery.value = ''; searchingHistory.value = false;
  popover.value = kind;
  void nextTick(() => {
    updateMenuPosition();
    panel.value?.querySelector<HTMLButtonElement>('.assistant-popover [data-menu-item]:not(:disabled)')?.focus();
  });
  if (kind === 'history') void assistant.loadExternal().catch(error => assistant.error = String(error));
}
function closePopover(focus = false) {
  const wasOpen = popover.value !== null;
  popover.value = null;
  if (focus && wasOpen) popoverTrigger?.focus();
}
function selectDisplayMode(mode: AssistantDisplayMode) {
  closePopover(true);
  assistant.setDisplayMode(mode);
}
function startFloatingGesture(event: PointerEvent) {
  if (props.compact || assistant.displayMode !== 'floating' || event.button !== 0 || !panel.value ||
    (event.target as Element).closest('button, input, .assistant-popover')) return;
  const { left, top, width, height } = panel.value.getBoundingClientRect();
  const target = event.currentTarget as HTMLElement;
  floatingGesture = { pointer: event.pointerId, target, x: event.clientX, y: event.clientY, rect: { left, top, width, height } };
  floatingRect.value = { left, top, width, height };
  target.setPointerCapture(event.pointerId);
  event.preventDefault();
}
function moveFloatingGesture(event: PointerEvent) {
  const gesture = floatingGesture;
  if (!gesture || gesture.pointer !== event.pointerId) return;
  const dx = event.clientX - gesture.x, dy = event.clientY - gesture.y;
  const rect = { ...gesture.rect };
  rect.left = Math.max(8, Math.min(window.innerWidth - rect.width - 8, rect.left + dx));
  rect.top = Math.max(8, Math.min(window.innerHeight - rect.height - 8, rect.top + dy));
  floatingRect.value = rect;
}
function endFloatingGesture() {
  const gesture = floatingGesture;
  floatingGesture = undefined;
  if (gesture?.target.hasPointerCapture(gesture.pointer)) gesture.target.releasePointerCapture(gesture.pointer);
}
function outsidePopover(event: PointerEvent) {
  if (!(event.target instanceof Element) || !panel.value?.contains(event.target) ||
    !event.target.closest('.assistant-popover, [data-assistant-popover]')) closePopover();
}
function openHistory() {
  closePopover(); section.value = 'history';
  void assistant.loadExternal().catch(error => assistant.error = String(error));
}
function selectHistory(id: string) {
  assistant.selectSession(id); closePopover();
  void nextTick(() => textarea.value?.focus());
}
function historyTime(timestamp: number) {
  const age = Math.max(0, Date.now() - timestamp);
  if (age < 60_000) return t('刚刚');
  if (age < 3_600_000) return t('{0} 分钟前', [Math.floor(age / 60_000)]);
  if (age < 86_400_000) return t('{0} 小时前', [Math.floor(age / 3_600_000)]);
  return new Date(timestamp).toLocaleDateString(uiLocale.value, { month: 'numeric', day: 'numeric' });
}
function searchHistory() {
  searchingHistory.value = !searchingHistory.value;
  if (!searchingHistory.value) historyQuery.value = '';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>(`[aria-label="${t('搜索助手会话')}"]`)?.focus());
}
function openSources() {
  addView.value = 'sources';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>(`[aria-label="${t('搜索参考文档')}"]`)?.focus());
}
function addCurrentNote() {
  const id = workspace.active?.id;
  if (id && !assistant.files.includes(id)) toggleSource(id);
  closePopover(true);
}
function menuKey(event: KeyboardEvent) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) || !(event.target instanceof HTMLButtonElement)) return;
  const menu = event.target.closest('.assistant-popover');
  if (!menu) return;
  const items = [...menu.querySelectorAll<HTMLButtonElement>('[data-menu-item]:not(:disabled)')];
  if (!items.length) return;
  const index = items.indexOf(event.target);
  const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
  event.preventDefault(); items[next]?.focus();
}
function startNewSession() {
  assistant.newSession(); closePopover(); notice.value = '';
  void nextTick(() => textarea.value?.focus());
}
function preparePrompt(prompt: string) {
  closePopover();
  const fileId = workspace.active?.id;
  if (fileId && !assistant.files.includes(fileId)) {
    if (assistant.files.length >= 20) { notice.value = t('一次最多选择 20 篇文档，请先移除一篇参考文档'); return; }
    assistant.files.push(fileId);
  }
  assistant.setBuiltInPrompt(prompt);
  void nextTick(() => textarea.value?.focus());
}
function resizeInput() {
  if (!textarea.value) return;
  // Let each display mode's CSS minimum size the empty composer.
  textarea.value.style.height = '0px';
  textarea.value.style.height = `${Math.min(168, textarea.value.scrollHeight)}px`;
  updateMenuPosition();
}
function updateMenuPosition() {
  if (!['model', 'reasoning', 'add'].includes(popover.value ?? '') || !popoverTrigger) return;
  const element = panel.value;
  const composer = element?.querySelector('.assistant-composer-area');
  const menu = composer?.querySelector('.assistant-popover');
  if (!element || !composer || !menu) return;
  const composerBounds = composer.getBoundingClientRect();
  const triggerBounds = popoverTrigger.getBoundingClientRect();
  const menuWidth = menu.getBoundingClientRect().width;
  const desiredLeft = ['model', 'reasoning'].includes(popover.value ?? '') ? triggerBounds.right - composerBounds.left - menuWidth : triggerBounds.left - composerBounds.left;
  menuPosition.value = {
    left: `${Math.max(0, Math.min(desiredLeft, composerBounds.width - menuWidth))}px`,
    bottom: `${composerBounds.bottom - triggerBounds.top + 8}px`,
  };
  const topBoundary = element.querySelector('.assistant-heading')?.getBoundingClientRect().bottom ?? element.getBoundingClientRect().top;
  menuMaxHeight.value = Math.max(80, triggerBounds.top - topBoundary - 16);
}
function resized() {
  if (floatingRect.value) {
    const rect = floatingRect.value;
    const width = Math.min(rect.width, window.innerWidth - 16), height = Math.min(rect.height, window.innerHeight - 16);
    floatingRect.value = { width, height,
      left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)),
      top: Math.max(8, Math.min(rect.top, window.innerHeight - height - 8)) };
  }
  updateScroll(); updateMenuPosition();
}
function updateScroll() {
  const element = messages.value;
  showLatest.value = !!element && element.scrollHeight - element.scrollTop - element.clientHeight > 120;
}
function scrollToLatest() {
  if (messages.value) messages.value.scrollTop = messages.value.scrollHeight;
  updateScroll();
}
function messageTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString(uiLocale.value, { hour: '2-digit', minute: '2-digit' });
}
function answerReady() {
  void nextTick(updateScroll);
}
onMounted(() => {
  window.addEventListener('pointerdown', outsidePopover);
  window.addEventListener('resize', resized);
  if (typeof ResizeObserver !== 'undefined') {
    composerObserver = new ResizeObserver(updateMenuPosition);
    if (panel.value) composerObserver.observe(panel.value);
    const composer = panel.value?.querySelector('.assistant-composer-area');
    if (composer) composerObserver.observe(composer);
  }
  void nextTick(() => { resizeInput(); scrollToLatest(); textarea.value?.focus(); });
});
onBeforeUnmount(() => {
  endFloatingGesture();
  composerObserver?.disconnect();
  window.removeEventListener('pointerdown', outsidePopover);
  window.removeEventListener('resize', resized);
});
watch(() => assistant.prompt, () => { void nextTick(resizeInput); });
watch(() => assistant.pendingUserInput?.request.id, (id, previous) => {
  if (id) closePopover();
  void nextTick(() => { scrollToLatest(); resizeInput(); if (!id && previous) textarea.value?.focus({ preventScroll: true }); });
});
watch(() => [assistant.files.length, assistant.selection?.text], () => { void nextTick(updateMenuPosition); });
watch(section, () => { closePopover(); void nextTick(() => { resizeInput(); scrollToLatest(); }); });
watch(() => assistant.opened, open => { if (open) void nextTick(() => textarea.value?.focus()); });
watch(() => [assistant.displayMode, props.fullscreenTarget], () => {
  endFloatingGesture();
  void nextTick(() => { resized(); resizeInput(); textarea.value?.focus(); });
}, { flush: 'post' });
watch(() => [assistant.session?.id, assistant.connectionId], () => { modelView.value = 'main'; modelQuery.value = ''; searchingModels.value = false; });
watch(() => assistant.session?.id, () => { visibleMessages.value = 30; void nextTick(scrollToLatest); });
watch(() => [controlsLocked.value, assistant.connection?.kind], () => {
  if (popover.value === 'reasoning' && (controlsLocked.value || assistant.connection?.kind !== 'codex-cli')) closePopover();
});
watch(() => [assistant.session?.messages.map(message => `${message.content.length}:${message.activity?.length}`).join(','), assistant.busy, assistant.applying, assistant.progress], () => {
  const element = messages.value;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160)
    void nextTick(scrollToLatest);
});
</script>

<template>
  <Teleport :to="teleportTarget" :disabled="assistant.displayMode === 'sidebar'">
  <aside ref="panel" v-show="assistant.displayMode !== 'fullscreen' || !!fullscreenTarget" class="assistant-panel" :class="`assistant-panel-${assistant.displayMode}`" :style="{ '--assistant-menu-max-height': `${menuMaxHeight}px`, ...floatingStyle }" :aria-label="t('Tano 助手')" @keydown.esc="closePopover(true)" @keydown="menuKey">
    <header class="assistant-heading" @pointerdown="startFloatingGesture" @pointermove="moveFloatingGesture" @pointerup="endFloatingGesture" @pointercancel="endFloatingGesture" @lostpointercapture="endFloatingGesture">
      <button v-if="section !== 'conversation'" class="icon-button" :aria-label="t('返回助手对话')" :data-tooltip="t('返回对话')" @click="section = 'conversation'"><ArrowLeft :size="17" /></button>
      <h2 v-if="section !== 'conversation'">{{ t('会话记录') }}</h2>
      <h2 v-else class="assistant-title-heading">
        <button class="assistant-title" :data-tooltip="title" :aria-label="t('打开助手会话记录')" :aria-expanded="popover === 'history'" aria-controls="assistant-history-options" data-assistant-popover @click="togglePopover('history', $event)"><span>{{ title }}</span><ChevronDown :size="16" /></button>
      </h2>
      <template v-if="section === 'conversation'">
        <button v-if="assistant.pendingUserInput" class="icon-button" :data-tooltip="t('停止询问')" :aria-label="t('停止助手生成')" @click="assistant.stop()"><Square :size="16" /></button>
        <button v-else class="icon-button" :data-tooltip="t('新建会话')" :aria-label="t('新建助手会话')" :disabled="assistant.busy || assistant.applying" @click="startNewSession"><MessageCirclePlus :size="18" /></button>
      </template>
      <button class="icon-button assistant-display-mode" :data-tooltip="t('切换助手显示模式')" :aria-label="t('切换助手显示模式')" :aria-expanded="popover === 'mode'" aria-controls="assistant-display-options" data-assistant-popover @click="togglePopover('mode', $event)"><component :is="displayModeIcon" :size="18" :stroke-width="1.5" /></button>
      <div v-if="popover === 'mode'" id="assistant-display-options" class="assistant-popover assistant-mode-menu" role="menu" :aria-label="t('助手显示模式')">
        <template v-for="mode in displayModes" :key="mode.id">
          <div v-if="mode.id === 'fullscreen'" class="assistant-menu-divider" role="separator" />
          <button class="assistant-menu-item" role="menuitemradio" :aria-checked="assistant.displayMode === mode.id" :class="{ selected: assistant.displayMode === mode.id }" data-menu-item @click="selectDisplayMode(mode.id)"><component :is="mode.icon" class="assistant-mode-icon" :size="16" :stroke-width="1.5" /><span class="assistant-menu-label">{{ mode.label }}</span><Check v-if="assistant.displayMode === mode.id" :size="14" class="assistant-menu-check" /></button>
        </template>
      </div>
      <template v-if="section === 'conversation'">
        <button class="icon-button" :data-tooltip="t('更多选项')" :aria-label="t('助手更多选项')" :aria-expanded="popover === 'more'" aria-controls="assistant-more-options" data-assistant-popover @click="togglePopover('more', $event)"><MoreHorizontal :size="19" /></button>
        <div v-if="popover === 'more'" id="assistant-more-options" class="assistant-popover assistant-more-menu">
          <button data-menu-item @click="openHistory"><History :size="16" />{{ t('管理会话') }}</button>
          <button v-if="!assistant.demo" data-menu-item @click="closePopover(); emit('openSettings')"><Settings2 :size="16" />{{ t('助手设置') }}</button>
        </div>
      </template>
      <button class="icon-button" :data-tooltip="t('收起助手')" :aria-label="t('收起助手')" @click="assistant.opened = false"><ChevronsRight v-if="assistant.displayMode === 'sidebar'" :size="19" /><Minus v-else :size="17" /></button>
      <div v-if="popover === 'history'" id="assistant-history-options" class="assistant-popover assistant-history-menu" role="dialog" :aria-label="t('最近助手会话')">
        <div class="assistant-popover-heading"><span>{{ t('会话记录') }}</span><button class="icon-button" :class="{ selected: searchingHistory }" :aria-label="t('搜索会话记录')" :data-tooltip="t('搜索会话')" @click="searchHistory"><Search :size="16" /></button></div>
        <label v-if="searchingHistory" class="assistant-menu-search"><Search :size="15" /><input v-model="historyQuery" :aria-label="t('搜索助手会话')" :placeholder="t('搜索会话')" /></label>
        <div class="assistant-menu-scroll panel-scrollbar">
          <section v-for="group in historyGroups" :key="group.label" class="assistant-history-group">
            <h3>{{ group.label }}</h3>
            <button v-for="session in group.sessions" :key="session.id" class="assistant-menu-item assistant-session-option" :class="{ selected: assistant.session?.id === session.id }" :data-tooltip="session.title" :aria-pressed="assistant.session?.id === session.id" :disabled="controlsLocked" data-menu-item @click="selectHistory(session.id)"><MessageCircle :size="17" /><span class="assistant-menu-label">{{ session.title }}</span><small>{{ historyTime(session.updatedAt) }}</small></button>
          </section>
          <p v-if="!historyGroups.length" class="assistant-menu-empty">{{ historyQuery ? t('没有找到匹配的会话') : t('暂无会话记录') }}</p>
        </div>
        <div class="assistant-menu-divider" />
        <button class="assistant-menu-item" data-menu-item @click="openHistory"><History :size="16" /><span class="assistant-menu-label">{{ t('管理会话') }}</span><span v-if="assistant.externalSessions.length" class="assistant-menu-count">{{ assistant.externalSessions.length }} {{ t('条外部提案') }}</span><ChevronRight :size="15" /></button>
      </div>
    </header>
    <div v-if="assistant.demo" class="assistant-demo-label">{{ t('浏览器演示 · 模型响应为模拟数据') }}</div>
    <p v-if="notice" class="assistant-notice" role="status">{{ notice }}</p>
    <p v-if="assistant.error" class="assistant-error" role="alert">{{ assistant.error }}</p>

    <div v-if="section === 'history'" class="assistant-history">
      <div v-if="!assistant.demo" class="assistant-proposal-actions"><span>{{ t('外部 MCP 提案') }}</span><button class="icon-button" :aria-label="t('刷新外部 MCP 提案')" :data-tooltip="t('刷新提案')" :disabled="assistant.busy || assistant.applying" @click="assistant.loadExternal()"><RefreshCw :size="15" /></button></div>
      <div v-for="external in assistant.externalSessions" :key="external.id" class="assistant-history-row"><button :disabled="assistant.busy || assistant.applying" @click="assistant.importExternal(external).then(() => section = 'conversation').catch(error => assistant.error = String(error))"><strong>{{ external.title }}</strong><small>{{ t('外部 Agent · 待审阅') }}</small></button></div>
      <p v-if="!assistant.sessions.length" class="assistant-empty">{{ t('暂无会话记录') }}</p>
      <div v-for="session in assistant.sessions" :key="session.id" class="assistant-history-row">
        <button :disabled="assistant.busy || assistant.applying" @click="assistant.selectSession(session.id); section = 'conversation'">
          <strong>{{ session.title }}</strong><small>{{ new Date(session.updatedAt).toLocaleString(uiLocale) }}</small>
        </button>
        <button class="icon-button" :disabled="assistant.busy || assistant.applying" :aria-label="t('删除会话 {0}', [session.title])" :data-tooltip="t('删除会话')" @click="deleting = session.id"><Trash2 :size="15" /></button>
      </div>
      <div v-if="deleting" class="assistant-delete-confirm" role="alertdialog" :aria-label="t('删除助手会话')">
        <p>{{ t('删除这条会话及其修改记录？') }}</p>
        <button class="secondary-button" @click="deleting = undefined">{{ t('取消') }}</button>
        <button class="primary-button destructive" @click="assistant.deleteSession(deleting).catch(error => assistant.error = String(error)); deleting = undefined">{{ t('删除会话') }}</button>
      </div>
    </div>

    <template v-else>
      <div class="assistant-transcript">
      <div ref="messages" class="assistant-messages panel-scrollbar" role="log" :aria-label="t('助手对话')" @scroll="updateScroll">
        <p v-if="assistant.loading" class="assistant-empty"><LoaderCircle :size="16" class="spinning" />{{ t('正在读取会话') }}</p>
        <div v-else-if="!assistant.session?.messages.length" class="assistant-welcome">
          <!-- Reserved for platform AI settings; currently greets with a flutter. -->
          <button type="button" class="assistant-welcome-mark" :aria-label="t('同页 AI 设置（即将推出）')" :data-tooltip="t('同页 AI 设置（即将推出）')" @click="welcomeButterfly?.flutter()">
            <AssistantButterfly ref="welcomeButterfly" class="assistant-welcome-butterfly" />
          </button>
          <h3>{{ t('今天想从哪里开始？') }}</h3>
          <div class="assistant-starters">
            <div v-for="starter in starters" :key="starter.label" class="assistant-starter">
              <button :disabled="controlsLocked || !workspace.active" :data-assistant-popover="starter.prompt === null ? '' : undefined" :aria-expanded="starter.prompt === null ? popover === 'translation' : undefined" :aria-controls="starter.prompt === null ? 'assistant-translation-options' : undefined" :aria-haspopup="starter.prompt === null ? 'menu' : undefined" @click="starter.prompt === null ? togglePopover('translation', $event) : preparePrompt(starter.prompt)"><component :is="starter.icon" :size="18" /><span>{{ starter.label }}</span><ChevronDown v-if="starter.prompt === null" :size="14" /></button>
              <div v-if="starter.prompt === null && popover === 'translation'" id="assistant-translation-options" class="assistant-popover assistant-translation-menu" role="menu" :aria-label="starter.label">
                <button v-for="target in translationTargets" :key="target.prompt" class="assistant-menu-item" role="menuitem" data-menu-item :disabled="controlsLocked || !workspace.active" @click="preparePrompt(target.prompt)">{{ target.label }}</button>
              </div>
            </div>
          </div>
        </div>
        <button v-if="(assistant.session?.messages.length ?? 0) > visibleMessages" class="assistant-text-action" @click="visibleMessages += 30">{{ t('查看较早消息') }}</button>
        <div v-if="displayed.length" class="assistant-conversation-meta">{{ t('同页助手 ·') }} {{ messageTime(displayed[0]!.createdAt) }}</div>
        <article v-for="message in displayed" :key="message.id" class="assistant-message" :class="`assistant-message-${message.role}`" :aria-label="message.role === 'user' ? t('你的消息') : t('助手回答')">
          <div v-if="message.role === 'user' && messageSources.get(message.id)?.length" class="assistant-citations assistant-attachments" :aria-label="t('已发送的引用')">
            <template v-for="source in messageSources.get(message.id)" :key="source.id">
              <button v-if="!source.selection" :data-tooltip="source.path" @click="openSource(source)"><FileText :size="12" />{{ source.path }}</button>
              <button v-if="source.selection" class="assistant-sent-selection" :data-tooltip="`${source.path}\n${source.selection.text}`" :aria-label="t('引用文字：{0}', [source.selection.text])" @click="openSource(source)"><Quote :size="12" /><span>{{ source.selection.text }}</span></button>
            </template>
          </div>
          <div v-if="message.role === 'user'" class="assistant-message-text">{{ message.content }}</div>
          <AssistantMessageBody v-else :message="message">
            <template #input="{ input }"><AssistantQuestionCard v-if="input.id !== assistant.pendingUserInput?.request.id" :request="input" /></template>
            <template #text="{ content, id }"><div class="assistant-answer"><MarkdownEditor :model-value="answerMarkdown({ ...message, content })" :document-id="`assistant-${message.id}-${id}`" :reference-targets="assistant.session?.workspaceId === workspace.workspace?.id ? workspace.referenceTargets : []" readonly :reveal-markdown="false" open-links-on-tap :resolve-image="() => null" @open-link="sourceLink(message, $event)" @open-reference="openAnswerReference" @ready="answerReady" @error="notice = $event" /></div></template>
          </AssistantMessageBody>
          <p v-if="message.error || message.state === 'interrupted'" class="assistant-message-error">{{ message.error ?? t('上次运行已中断；不会自动恢复执行') }}</p>
          <details v-if="!message.activity && message.toolResults?.some(result => result.status === 'failed')" class="assistant-tool-errors">
            <summary>{{ t('工具执行记录：') }}{{ message.toolResults.filter(result => result.status === 'failed').length }} {{ t('次失败') }}</summary>
            <p v-for="(result, index) in message.toolResults.filter(result => result.status === 'failed')" :key="index">{{ assistantToolLabel(result.name) }}：{{ result.error }}</p>
          </details>
          <div v-if="message.state === 'failed' && message.error?.includes(t('模型服务返回 HTTP'))" class="assistant-recovery-actions">
            <button type="button" class="assistant-text-action" :disabled="controlsLocked" @click="chooseRecoveryModel"><Cpu :size="13" />{{ t('切换模型') }}</button>
            <button v-if="!assistant.demo" type="button" class="assistant-text-action" :disabled="controlsLocked" @click="closePopover(); emit('openSettings')"><Plug :size="13" />{{ t('模型连接') }}</button>
          </div>
          <div v-if="message.role === 'assistant' && messageSources.get(message.id)?.length" class="assistant-citations"><button v-for="source in messageSources.get(message.id)" :key="source.id" :data-tooltip="source.path" @click="openSource(source)"><FileText :size="12" />{{ source.id }} · {{ source.path }}</button></div>
          <small v-if="message.rules?.length" class="assistant-rules">{{ t('工作区约定：') }}{{ message.rules.join('、') }}</small>
          <AssistantChangeList v-if="message.proposals?.length" :proposals="message.proposals" :busy="assistant.busy || assistant.applying"
            @review="assistant.review" @reject="assistant.reject" @verify="assistant.verify" @undo="assistant.undo"
            @suggestions="assistant.publishSuggestions" @open-reference="openAnswerReference" />
          <div v-if="message.role === 'assistant' && !['running', 'waiting'].includes(message.state ?? '')" class="assistant-message-actions">
            <button class="icon-button" :data-tooltip="t('复制回答')" :aria-label="t('复制助手回答')" :disabled="!assistantAnswerText(message).trim()" @click="copy(message)"><Copy :size="14" /></button>
            <button v-if="assistant.replyTarget" class="icon-button" :data-tooltip="t('填写回复草稿：{0}', [assistant.replyTarget.label])" :aria-label="t('将助手回答填入回复草稿')" :disabled="assistant.busy || assistant.applying || !assistantAnswerText(message).trim()" @click="draftReply(message)"><Reply :size="14" /></button>
            <button class="icon-button" :data-tooltip="t('保存为文档')" :aria-label="t('将助手回答保存为文档')" :disabled="assistant.busy || assistant.applying || !assistantAnswerText(message).trim()" @click="exportMessage = message"><FilePlus2 :size="14" /></button>
            <small v-if="message.usage && (message.usage.input || message.usage.output) || message.timing" class="assistant-message-stats" :aria-label="t('回答统计')">
              <span v-if="message.usage && (message.usage.input || message.usage.output)" class="assistant-stat-group" :title="t('输入与输出的 token 用量')">
                <span>{{ t('输入') }} {{ message.usage.input.toLocaleString(uiLocale) }}</span><span aria-hidden="true">·</span><span>{{ t('输出') }} {{ message.usage.output.toLocaleString(uiLocale) }} token</span>
              </span>
              <span v-if="message.timing" class="assistant-stat-group">
                <template v-if="message.timing.firstContentMs !== undefined"><span>{{ t('首段') }} {{ (message.timing.firstContentMs / 1000).toFixed(1) }} {{ t('秒') }}</span><span aria-hidden="true">·</span></template><span>{{ t('总计') }} {{ (message.timing.totalMs / 1000).toFixed(1) }} {{ t('秒') }}</span>
              </span>
            </small>
          </div>
        </article>
        <div v-if="assistant.busy || assistant.applying" class="assistant-progress">
          <span class="assistant-progress-status" role="status"><LoaderCircle v-if="!assistant.pendingUserInput" :size="14" class="spinning" /><span>{{ assistant.applying ? t('正在处理修改') : assistant.progress }}</span></span>
          <AssistantGenerationHint v-if="assistant.busy && !assistant.applying && !assistant.pendingUserInput" :connection-kind="assistant.connection?.kind" />
        </div>
      </div>
      <button v-if="showLatest" class="assistant-jump-latest" :data-tooltip="t('回到最新消息')" :aria-label="t('滚动到最新消息')" @click="scrollToLatest"><ArrowDown :size="20" /></button>
      </div>
      <form v-if="exportMessage" class="assistant-export" @submit.prevent="exportAnswer"><label>{{ t('文档路径') }}<input v-model="exportPath" required maxlength="220" /></label><button class="secondary-button" type="button" @click="exportMessage = undefined">{{ t('取消') }}</button><button class="primary-button"><FilePlus2 :size="14" />{{ t('生成保存建议') }}</button></form>
      <div class="assistant-composer-area" :class="{ 'assistant-composer-area-question': assistant.pendingUserInput }">
        <div v-if="popover === 'model'" id="assistant-model-options" class="assistant-popover assistant-model-menu" :style="menuPosition" :aria-label="t('模型选择')">
          <div class="assistant-popover-heading">
            <button v-if="modelView !== 'main'" class="icon-button" :data-tooltip="t('返回模型列表')" :aria-label="t('返回模型列表')" @click="setModelView('main')"><ArrowLeft :size="16" /></button>
            <span>{{ modelView === 'connections' ? t('模型连接') : modelView === 'manual' ? t('指定模型') : t('选择模型') }}</span>
            <button v-if="modelView === 'main'" class="icon-button" :class="{ selected: searchingModels }" :aria-label="t('搜索模型列表')" :data-tooltip="searchingModels ? t('收起搜索') : t('搜索模型')" :aria-expanded="searchingModels" aria-controls="assistant-model-search" @click="searchModels"><Search :size="15" /></button>
            <button v-if="modelView === 'main'" class="icon-button" :aria-label="t('刷新模型列表')" :data-tooltip="t('刷新模型列表')" :disabled="assistant.modelsLoading || controlsLocked" @click="assistant.refreshModels()"><LoaderCircle v-if="assistant.modelsLoading" :size="15" class="spinning" /><RefreshCw v-else :size="15" /></button>
          </div>
          <template v-if="modelView === 'connections'">
            <div class="assistant-menu-scroll panel-scrollbar">
              <button v-for="connection in assistant.connections" :key="connection.id" class="assistant-menu-item assistant-detail-option" :class="{ selected: assistant.connectionId === connection.id }" :aria-pressed="assistant.connectionId === connection.id" :disabled="controlsLocked" data-menu-item @click="changeConnection(connection.id)"><Plug v-if="!connection.kind || connection.kind === 'api'" :size="17" /><Terminal v-else :size="17" /><span class="assistant-menu-label"><span>{{ connection.name }}</span><small>{{ connection.managed ? t('平台提供') : connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : t('API 连接') }}</small></span><Check v-if="assistant.connectionId === connection.id" :size="16" class="assistant-menu-check" /></button>
            </div>
            <div v-if="!assistant.demo && assistant.canConfigure !== false" class="assistant-menu-divider" />
            <button v-if="!assistant.demo && assistant.canConfigure !== false" class="assistant-menu-item" data-menu-item @click="closePopover(); emit('openSettings')"><Plus :size="17" /><span class="assistant-menu-label">{{ t('添加模型连接') }}</span></button>
          </template>
          <template v-else-if="modelView === 'manual'">
            <form class="assistant-manual-model" @submit.prevent="changeModel(manualModelId)">
              <label for="assistant-model-id">{{ t('模型 ID') }}</label>
              <div><input id="assistant-model-id" v-model="manualModelId" :aria-label="t('当前对话的模型 ID')" :placeholder="t('模型 ID')" maxlength="200" autocomplete="off" :disabled="controlsLocked" /><button class="icon-button" :aria-label="t('确认对话模型')" :data-tooltip="t('确认模型')" :disabled="!manualModelId.trim() || controlsLocked"><Check :size="16" /></button></div>
            </form>
          </template>
          <template v-else>
            <button class="assistant-menu-item assistant-detail-option assistant-connection-option" :aria-label="t('选择模型连接')" :disabled="controlsLocked" data-menu-item @click="setModelView('connections')"><Plug :size="17" /><span class="assistant-menu-label"><span>{{ assistant.connection?.name ?? (assistant.connectionId ? t('连接已移除') : t('选择模型连接')) }}</span><small>{{ assistant.connection?.kind === 'codex-cli' ? 'Codex CLI' : assistant.connection?.kind === 'claude-cli' ? 'Claude CLI' : assistant.demo ? t('浏览器模拟') : t('模型连接') }}</small></span><ChevronRight :size="16" /></button>
            <div class="assistant-menu-divider" />
            <label v-if="searchingModels" class="assistant-menu-search"><Search :size="15" /><input id="assistant-model-search" v-model="modelQuery" :aria-label="t('搜索模型')" :placeholder="t('搜索模型')" /></label>
            <div class="assistant-menu-scroll panel-scrollbar" :aria-label="t('模型列表')">
              <button v-for="model in listedModels" :key="model" class="assistant-menu-item assistant-model-option" :class="{ selected: assistant.modelId === model }" :data-tooltip="model" :aria-label="t('使用模型 {0}', [model])" :aria-pressed="assistant.modelId === model" :disabled="controlsLocked" data-menu-item @click="changeModel(model)"><AssistantModelIcon :model="model" /><span class="assistant-menu-label">{{ model === 'cli-default' ? t('CLI 默认模型') : model }}</span><span v-if="!assistant.models.includes(model)" class="assistant-menu-badge">{{ t('自定义') }}</span><Check v-if="assistant.modelId === model" :size="16" class="assistant-menu-check" /></button>
              <p v-if="assistant.modelsLoading && !listedModels.length" class="assistant-menu-empty"><LoaderCircle :size="15" class="spinning" />{{ t('正在读取模型') }}</p>
              <p v-else-if="!listedModels.length" class="assistant-menu-empty">{{ modelQuery ? t('没有找到匹配的模型') : assistant.connection ? t('暂无可用模型') : t('请选择模型连接') }}</p>
            </div>
            <p v-if="assistant.modelsError" class="assistant-model-error" role="alert">{{ assistant.modelsError }}</p>
            <div class="assistant-menu-divider" />
            <button v-if="assistant.connection && !assistant.connection.managed" class="assistant-menu-item" :aria-label="t('手动指定对话模型')" :disabled="controlsLocked" data-menu-item @click="inputModel"><Pencil :size="16" /><span class="assistant-menu-label">{{ t('手动指定模型') }}</span></button>
            <button v-if="!assistant.connections.length && !assistant.demo && assistant.canConfigure !== false" class="assistant-menu-item" data-menu-item @click="closePopover(); emit('openSettings')"><Plus :size="16" /><span class="assistant-menu-label">{{ t('添加模型连接') }}</span></button>
          </template>
        </div>
        <div v-if="popover === 'add'" id="assistant-add-options" class="assistant-popover assistant-add-menu" :style="menuPosition" :aria-label="addView === 'sources' ? t('选择参考文档') : t('添加内容')">
          <template v-if="addView === 'main'">
            <button class="assistant-menu-item" data-menu-item :disabled="controlsLocked" @click="openSources"><Paperclip :size="18" /><span class="assistant-menu-label">{{ t('添加参考文档') }}</span><ChevronRight :size="15" /></button>
            <button class="assistant-menu-item" data-menu-item :disabled="controlsLocked || !workspace.active" @click="addCurrentNote"><FileText :size="18" /><span class="assistant-menu-label">{{ t('引用当前笔记') }}</span><Check v-if="workspace.active && assistant.files.includes(workspace.active.id)" :size="16" class="assistant-menu-check" /></button>
            <div class="assistant-menu-divider" />
            <button class="assistant-menu-item" :disabled="assistant.demo || assistant.canConfigure === false || controlsLocked" data-menu-item @click="closePopover(); emit('openSettings')"><Plug :size="18" /><span class="assistant-menu-label">{{ t('添加模型连接') }}</span><span v-if="assistant.demo" class="assistant-menu-badge">{{ t('桌面版') }}</span></button>
          </template>
          <template v-else>
            <div class="assistant-popover-heading"><button class="icon-button" :aria-label="t('返回添加内容')" :data-tooltip="t('返回')" @click="addView = 'main'"><ArrowLeft :size="16" /></button><span>{{ t('参考文档') }}</span><small>{{ assistant.files.length }} / 20</small><button class="icon-button" :aria-label="t('完成参考文档选择')" :data-tooltip="t('完成')" @click="closePopover(true)"><Check :size="16" /></button></div>
            <label class="assistant-menu-search"><Search :size="15" /><input v-model="query" :aria-label="t('搜索参考文档')" :placeholder="t('搜索文档路径')" /></label>
            <div class="assistant-menu-scroll panel-scrollbar">
              <button v-for="file in sourceFiles" :key="file.id" class="assistant-menu-item assistant-source-option" :class="{ selected: assistant.files.includes(file.id) }" :aria-pressed="assistant.files.includes(file.id)" :data-tooltip="file.path" :disabled="controlsLocked" data-menu-item @click="toggleSource(file.id)"><FileText :size="16" /><span class="assistant-menu-label">{{ file.path }}</span><Check v-if="assistant.files.includes(file.id)" :size="16" class="assistant-menu-check" /></button>
              <p v-if="!sourceFiles.length" class="assistant-menu-empty">{{ query ? t('没有找到匹配的文档或数据表') : t('暂无 Markdown 文档或数据表') }}</p>
            </div>
          </template>
        </div>
        <div v-if="popover === 'reasoning' && assistant.connection?.kind === 'codex-cli'" id="assistant-reasoning-options" class="assistant-popover assistant-reasoning-menu" :style="menuPosition" role="dialog" :aria-label="t('当前对话的推理强度')">
          <div class="assistant-menu-heading"><span>{{ t('推理强度') }}</span></div>
          <div role="radiogroup" :aria-label="t('推理强度')">
            <button v-for="choice in reasoningChoices" :key="choice.id" type="button" role="radio" :aria-label="choice.label" :aria-checked="assistant.reasoningEffort === choice.id" class="assistant-menu-item assistant-detail-option" :class="{ selected: assistant.reasoningEffort === choice.id }" :disabled="controlsLocked" data-menu-item @click="changeReasoning(choice.id)"><span class="assistant-menu-label"><span>{{ choice.label }}</span><small>{{ choice.detail }}</small></span><Check v-if="assistant.reasoningEffort === choice.id" :size="16" /></button>
          </div>
          <p class="assistant-menu-help">{{ t('用于当前对话。可用强度取决于所选模型。') }}</p>
        </div>
      <AssistantQuestionCard v-if="assistant.pendingUserInput" :key="assistant.pendingUserInput.request.id" :request="assistant.pendingUserInput.request" />
      <form v-else class="assistant-composer" @submit.prevent="closePopover(); assistant.send()">
        <div v-if="assistant.files.length || assistant.selection" class="assistant-contexts">
          <button v-for="id in assistant.files.filter(id => id !== assistant.selection?.fileId)" :key="id" type="button" class="assistant-context" :disabled="assistant.busy" :data-tooltip="t('移除参考：{0}', [workspace.workspace?.files.find(file => file.id === id)?.path ?? id])" @click="toggleSource(id)"><FileText :size="13" /><span>{{ workspace.workspace?.files.find(file => file.id === id)?.name ?? t('已移除文档') }}</span><X :size="12" /></button>
          <div v-if="assistant.selection" class="assistant-context assistant-selection" :title="`${workspace.workspace?.files.find(file => file.id === assistant.selection?.fileId)?.path ?? assistant.selection.fileId}\n${assistant.selection.text}`" :aria-label="t('引用文字：{0}', [assistant.selection.text])"><Quote :size="13" /><span>{{ assistant.selection.text }}</span><button type="button" class="icon-button" :aria-label="t('清除助手选区')" :data-tooltip="t('清除选区')" :disabled="assistant.busy" @click="assistant.selection = null"><X :size="13" /></button></div>
        </div>
        <textarea ref="textarea" v-model="assistant.prompt" rows="2" maxlength="20000" :aria-label="t('给助手的任务')" :placeholder="t('问问同页助手…')" @keydown="sendKey" />
        <div class="assistant-compose-actions">
          <button type="button" class="icon-button assistant-compose-tool" :data-tooltip="t('添加内容')" :aria-label="t('添加内容')" :disabled="controlsLocked" :aria-expanded="popover === 'add'" aria-controls="assistant-add-options" data-assistant-popover @click="togglePopover('add', $event)"><Plus :size="20" /></button>
          <button type="button" class="assistant-compose-model" :data-tooltip="`${assistant.connection?.name ?? t('模型连接')} · ${modelLabel}`" :aria-label="t('选择助手模型')" :aria-expanded="popover === 'model'" aria-controls="assistant-model-options" data-assistant-popover @click="togglePopover('model', $event)"><span>{{ modelLabel }}</span></button>
          <button v-if="assistant.connection?.kind === 'codex-cli'" type="button" class="assistant-compose-reasoning" :data-tooltip="t('推理强度：{0}', [reasoningLabel])" :aria-label="t('选择推理强度')" :disabled="controlsLocked" :aria-expanded="popover === 'reasoning'" aria-controls="assistant-reasoning-options" data-assistant-popover @click="togglePopover('reasoning', $event)"><span>{{ reasoningLabel }}</span></button>
          <button v-if="assistant.busy" type="button" class="icon-button assistant-stop" :aria-label="t('停止助手生成')" :data-tooltip="t('停止生成')" @click="assistant.stop()"><Square :size="16" /></button><button v-else class="primary-button assistant-send" :aria-label="t('发送给助手')" :data-tooltip="t('发送')" :disabled="!assistant.prompt.trim() || !assistant.connection || !assistant.modelId || assistant.loading || assistant.applying"><ArrowUp :size="18" /></button>
        </div>
      </form>
      </div>
    </template>
  </aside>
  </Teleport>
</template>

<style scoped>
.assistant-panel { flex: 0 1 clamp(360px, 32vw, 480px); width: clamp(360px, 32vw, 480px); min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--paper); color: var(--text); }
.assistant-heading { position: relative; display: flex; flex: 0 0 auto; align-items: center; gap: 3px; min-height: 54px; padding: 8px 16px; background: var(--paper); }
.assistant-heading h2 { flex: 1; min-width: 0; font-size: 14px; font-weight: 500; margin: 0; }
.assistant-heading .icon-button { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 6px; color: var(--text-secondary); }
.assistant-title { display: inline-flex; align-items: center; gap: 9px; max-width: 100%; padding: 6px 5px; border-radius: 6px; color: var(--text); font-size: 14px; font-weight: 500; text-align: left; }
.assistant-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-title svg { flex-shrink: 0; color: var(--text-secondary); }
.assistant-title:hover, .assistant-title[aria-expanded='true'] { background: var(--surface); }
.assistant-demo-label { flex: 0 0 auto; padding: 4px 22px 7px; color: var(--muted); font-size: 10px; }
.assistant-error, .assistant-notice { margin: 0; padding: 10px 20px; font-size: 12px; line-height: 1.55; overflow-wrap: anywhere; }
.assistant-error { color: var(--danger); background: var(--danger-bg); }
.assistant-notice { color: var(--text-secondary); background: var(--surface); }
.assistant-popover { position: absolute; z-index: 5; padding: 4px 6px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 28px rgb(0 0 0 / 10%); font-size: 12px; line-height: 16px; }
.assistant-more-menu { top: calc(100% - 4px); right: 17px; width: 180px; }
.assistant-mode-menu { z-index: 10; top: calc(100% - 4px); right: 50px; width: 184px; }
.assistant-mode-menu .assistant-mode-icon { width: 16px; height: 16px; }
.assistant-display-mode :deep(.assistant-mode-region), .assistant-mode-menu :deep(.assistant-mode-region) { fill: var(--text); }
.assistant-display-mode[aria-expanded='true'] { background: var(--surface); }
.assistant-more-menu > button { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; padding: 4px 7px; border-radius: 6px; font-size: 12px; line-height: 16px; text-align: left; }
.assistant-more-menu > button > svg { width: 14px; height: 14px; }
.assistant-more-menu > button:hover { background: var(--surface); }
.assistant-model-menu, .assistant-add-menu { z-index: 70; max-height: min(440px, var(--assistant-menu-max-height)); overflow: auto; }
.assistant-model-menu { width: min(332px, 100%); }
.assistant-reasoning-menu { z-index: 70; width: min(270px, 100%); max-height: min(440px, var(--assistant-menu-max-height)); overflow: auto; }
.assistant-add-menu { width: min(306px, 100%); }
.assistant-history-menu { top: calc(100% + 2px); left: 12px; width: min(360px, calc(100% - 24px)); max-height: min(440px, calc(100dvh - 90px)); overflow: auto; }
.assistant-model-menu, .assistant-add-menu, .assistant-history-menu { display: flex; flex-direction: column; overflow: hidden; }
.assistant-model-menu > :not(.assistant-menu-scroll), .assistant-add-menu > :not(.assistant-menu-scroll), .assistant-history-menu > :not(.assistant-menu-scroll) { flex-shrink: 0; }
.assistant-popover-heading { display: flex; align-items: center; gap: 6px; padding: 0 7px 4px; color: var(--muted); font-size: 11px; }
.assistant-popover-heading > span { flex: 1; min-width: 0; }
.assistant-popover-heading small { color: var(--muted); font-size: 11px; white-space: nowrap; }
.assistant-popover-heading .icon-button { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 5px; }
.assistant-popover-heading .icon-button > svg { width: 14px; height: 14px; }
.assistant-menu-item { display: flex; align-items: center; gap: 6px; width: 100%; min-height: 26px; padding: 4px 7px; border-radius: 6px; color: var(--text-secondary); font-size: 12px; line-height: 16px; text-align: left; }
.assistant-menu-item:hover:not(:disabled), .assistant-menu-item.selected { background: var(--surface); color: var(--text); }
.assistant-menu-item > svg { flex-shrink: 0; width: 14px; height: 14px; color: var(--muted); }
.assistant-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-menu-check { color: var(--text) !important; }
.assistant-menu-count { color: var(--muted); font-size: 11px; white-space: nowrap; }
.assistant-menu-badge { flex-shrink: 0; padding: 2px 4px; border-radius: 3px; color: var(--muted); background: var(--hover); font-size: 10px; line-height: 1.2; }
.assistant-menu-divider { height: 1px; margin: 3px -6px; background: var(--line); }
.assistant-history-group h3 { margin: 0; padding: 4px 7px 3px; color: var(--muted); font-size: 11px; font-weight: 500; }
.assistant-menu-scroll { flex: 1 1 auto; max-height: 258px; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.assistant-menu-empty { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0; padding: 16px 7px; color: var(--muted); font-size: 12px; }
.assistant-detail-option { align-items: flex-start; }
.assistant-detail-option > svg { margin-top: 1px; }
.assistant-detail-option .assistant-menu-label { display: grid; gap: 2px; }
.assistant-detail-option .assistant-menu-label > span { overflow: hidden; text-overflow: ellipsis; }
.assistant-detail-option small { color: var(--muted); font-size: 11px; line-height: 16px; font-weight: 400; }
.assistant-model-error { margin: 4px 7px; color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
.assistant-menu-search { display: flex; align-items: center; gap: 6px; margin: 2px 7px 4px; padding: 4px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
.assistant-menu-search input { width: 100%; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--text); font-size: 12px; }
.assistant-menu-search svg { flex-shrink: 0; width: 14px; height: 14px; }
.assistant-model-menu .assistant-menu-search { margin: 3px 7px 6px; padding: 5px 7px; border: 1px solid var(--line); border-radius: 6px; background: var(--surface); }
.assistant-model-menu .assistant-menu-search input { outline: none; box-shadow: none; }
.assistant-manual-model { display: grid; gap: 6px; padding: 4px 7px 6px; font-size: 12px; }
.assistant-manual-model > div { display: flex; align-items: center; gap: 5px; }
.assistant-manual-model input { flex: 1; width: 100%; min-width: 0; padding: 6px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--text); }
.assistant-session-option small { flex-shrink: 0; color: var(--muted); font-size: 11px; }
.assistant-history-group + .assistant-history-group { margin-top: 3px; }
.assistant-contexts { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; max-height: 116px; overflow: auto; padding: 0 0 8px; }
.assistant-text-action { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 5px 0; color: var(--text-secondary); background: transparent; font-size: 12px; }
.assistant-text-action:hover { color: var(--green); }
.assistant-context { display: inline-flex; align-items: center; gap: 5px; max-width: min(220px, 100%); padding: 4px 7px; border: 1px solid var(--assistant-composer-line); border-radius: 5px; color: var(--assistant-composer-muted); background: color-mix(in srgb, var(--surface) 55%, var(--paper)); font-size: 11px; }
.assistant-context:hover { border-color: var(--line); background: var(--surface); color: var(--text-secondary); }
.assistant-context span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-context svg { flex-shrink: 0; }
.assistant-selection .icon-button { flex-shrink: 0; width: 12px; height: 13px; min-width: 0; padding: 0; color: inherit; }
.assistant-sent-selection span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-transcript { position: relative; flex: 1; min-height: 0; display: flex; }
.assistant-messages { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: auto; overscroll-behavior: contain; padding: 12px 26px 18px; }
.assistant-empty { margin: auto; padding: 30px 12px; color: var(--muted); font-size: 13px; text-align: center; }
.assistant-welcome { flex-shrink: 0; margin-top: auto; padding: 30px 0 0; }
.assistant-welcome-mark { display: grid; place-items: center; width: 54px; height: 54px; padding: 0; margin-bottom: 18px; border: 1px solid var(--line); border-radius: 50%; background: var(--paper); box-shadow: 0 4px 12px rgb(0 0 0 / 6%); cursor: pointer; touch-action: manipulation; -webkit-tap-highlight-color: transparent; }
.assistant-welcome-mark:focus-visible { outline: 2px solid var(--green); outline-offset: 4px; }
@media (hover: hover) { .assistant-welcome-mark:hover { border-color: var(--control-border); box-shadow: 0 4px 16px rgb(0 0 0 / 9%); } }
.assistant-welcome-butterfly { width: 30px; height: 30px; }
.assistant-welcome h3 { margin: 0 0 17px; font-size: 19px; line-height: 1.5; font-weight: 600; }
.assistant-starters { display: grid; gap: 1px; }
.assistant-starter { position: relative; }
.assistant-starter > button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 38px; padding: 7px 8px; margin-left: -8px; border-radius: 6px; color: var(--text-secondary); text-align: left; font-size: 14px; }
.assistant-translation-menu { bottom: 100%; left: 22px; width: min(200px, calc(100% - 22px)); }
.assistant-starters button svg { flex-shrink: 0; }
.assistant-starters button:hover:not(:disabled) { background: var(--surface); color: var(--text); }
.assistant-conversation-meta { flex: 0 0 auto; padding: 4px 0 18px; color: var(--muted); font-size: 11px; text-align: center; }
.assistant-message { flex-shrink: 0; width: 100%; padding: 10px 0 4px; }
.assistant-message-user { display: flex; flex-direction: column; align-items: flex-end; color: var(--text-secondary); }
.assistant-message-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.75; }
.assistant-message-user .assistant-message-text { max-width: 88%; padding: 10px 16px; border-radius: 22px; background: var(--surface); color: var(--text); }
.assistant-message-assistant { padding-top: 24px; }
.assistant-answer { min-width: 0; font-size: 14px; line-height: 1.75; overflow-wrap: anywhere; }
.assistant-answer :deep(.ProseMirror) { padding: 0; min-height: 0; font-size: 14px; line-height: 1.75; }
.assistant-answer :deep(.frontmatter-panel) { display: none; }
.assistant-answer :deep(h1), .assistant-answer :deep(h2), .assistant-answer :deep(h3) { font-size: 16px; line-height: 1.5; margin: 12px 0 6px; }
.assistant-answer :deep(pre) { max-width: 100%; overflow: auto; font-size: 11px; }
.assistant-answer :deep(p) { margin: 6px 0; }
.assistant-answer :deep(ul), .assistant-answer :deep(ol) { padding-left: 23px; }
.assistant-answer :deep(li) { margin: 5px 0; }
.assistant-message-error { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--danger); }
.assistant-citations { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 10px; }
.assistant-citations button { display: inline-flex; align-items: center; gap: 4px; max-width: 100%; padding: 5px 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); color: var(--green); font-size: 11px; text-align: left; overflow-wrap: anywhere; }
.assistant-citations button:hover { background: var(--accent); }
.assistant-citations svg { flex-shrink: 0; }
.assistant-attachments { justify-content: flex-end; max-width: 88%; margin: 0 0 8px; }
.assistant-rules { display: block; margin-top: 9px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.assistant-tool-errors { margin: 10px 0; font-size: 12px; line-height: 1.6; color: var(--muted); }
.assistant-tool-errors summary { cursor: pointer; }
.assistant-tool-errors p { overflow-wrap: anywhere; }
.assistant-proposal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.assistant-proposal-actions button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 30px; padding: 5px 8px; font-size: 11px; line-height: 16px; }
.assistant-proposal-actions .icon-button { padding: 0; }
.assistant-message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 11px; color: var(--muted); }
.assistant-message-actions .icon-button { width: 28px; height: 28px; border-radius: 8px; }
.assistant-message-stats { flex: 1 1 240px; min-width: 0; display: flex; flex-wrap: wrap; justify-content: flex-end; align-items: center; gap: 2px 12px; margin-left: auto; font-size: 11px; line-height: 18px; font-variant-numeric: tabular-nums; opacity: 0; transition: opacity 120ms ease; }
.assistant-stat-group { display: inline-flex; align-items: baseline; gap: 4px; white-space: nowrap; }
.assistant-message-assistant:hover .assistant-message-stats,
.assistant-message-assistant:has(:focus-visible) .assistant-message-stats { opacity: 1; }
@media (hover: none) { .assistant-message-stats { opacity: 1; } }
.assistant-jump-latest { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--text); color: var(--paper); box-shadow: 0 3px 10px rgb(0 0 0 / 12%); }
.assistant-jump-latest:hover { color: var(--paper); background: var(--text-secondary); }
.assistant-composer-area { position: relative; flex: 0 0 auto; min-width: 0; margin: 4px 18px 18px; }
.assistant-composer-area-question { display: flex; flex-direction: column; flex-shrink: 1; min-height: 0; max-height: min(60%, 460px); }
.assistant-composer { --assistant-composer-muted: color-mix(in srgb, var(--muted) 80%, var(--paper)); --assistant-composer-placeholder: color-mix(in srgb, var(--muted) 45%, var(--paper)); --assistant-composer-line: color-mix(in srgb, var(--line) 65%, var(--paper)); padding: 12px 12px 9px; border: 1px solid var(--assistant-composer-line); border-radius: 18px; background: var(--paper); box-shadow: 0 2px 6px rgb(0 0 0 / 2%); transition: border-color 120ms ease; }
.assistant-composer:focus-within { border-color: color-mix(in srgb, var(--line) 90%, var(--paper)); }
:global(:root[data-theme='dark'] .assistant-composer) { --assistant-composer-placeholder: var(--assistant-composer-muted); }
.assistant-composer textarea { display: block; width: 100%; resize: none; min-height: 52px; max-height: 168px; border: 0; background: transparent; color: var(--text); padding: 0; font: inherit; font-size: 14px; line-height: 1.65; }
.assistant-composer textarea::placeholder { color: var(--assistant-composer-placeholder); opacity: 1; }
.assistant-composer textarea:focus { outline: none; }
.assistant-compose-actions { display: flex; align-items: center; gap: 1px; min-height: 30px; margin-top: 7px; }
.assistant-compose-tool { flex: 0 0 28px; width: 28px; height: 28px; border-radius: 6px; color: var(--assistant-composer-muted); }
.assistant-compose-tool[aria-expanded='true'] { background: var(--surface); }
.assistant-compose-tool:hover, .assistant-compose-tool[aria-expanded='true'] { color: var(--text-secondary); }
.assistant-compose-model { display: inline-flex; align-items: center; min-width: 0; max-width: 52%; margin-left: auto; padding: 6px 5px; border-radius: 10px; color: var(--assistant-composer-muted); font-size: 12px; }
.assistant-compose-model span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-compose-model:hover, .assistant-compose-model[aria-expanded='true'] { background: var(--surface); color: var(--text-secondary); }
.assistant-compose-reasoning { display: inline-flex; align-items: center; flex-shrink: 0; padding: 6px 4px; border-radius: 10px; color: var(--assistant-composer-muted); font-size: 12px; white-space: nowrap; }
.assistant-compose-reasoning:hover:not(:disabled), .assistant-compose-reasoning[aria-expanded='true'] { background: var(--surface); color: var(--text-secondary); }
.assistant-send, .assistant-stop { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; min-height: 30px; padding: 0; margin-left: 4px; border-radius: 50%; }
.assistant-send { background: var(--text); color: var(--paper); }
.assistant-send:hover:not(:disabled) { background: var(--text-secondary); }
.assistant-send:disabled { background: color-mix(in srgb, var(--surface) 55%, var(--paper)); color: color-mix(in srgb, var(--control-border) 60%, var(--paper)); opacity: 1; }
.assistant-progress { display: flex; flex-shrink: 0; align-items: flex-start; gap: 16px; margin: 12px 0 6px; color: var(--muted); font-size: 11px; line-height: 1.6; }
.assistant-progress-status { display: flex; align-items: center; gap: 5px; min-width: 0; max-width: 50%; overflow-wrap: anywhere; }
.assistant-progress-status svg { flex-shrink: 0; }
.assistant-recovery-actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 4px 0 10px; }
.assistant-history { flex: 1; overflow: auto; padding: 20px; }
.assistant-history-row { display: flex; gap: 6px; align-items: center; border-bottom: 1px solid var(--line); }
.assistant-history-row > button:first-child { flex: 1; min-width: 0; padding: 12px 0; display: grid; gap: 4px; color: var(--text); border: 0; background: transparent; text-align: left; overflow-wrap: anywhere; }
.assistant-history-row small { font-size: 11px; color: var(--muted); }
.assistant-history-row strong { font-size: 13px; font-weight: 500; }
.assistant-delete-confirm, .assistant-export { border-top: 1px solid var(--line); padding: 16px 20px; font-size: 12px; }
.assistant-export { display: flex; flex-wrap: wrap; gap: 8px; }
.assistant-export label { flex-basis: 100%; }
.assistant-export input { width: 100%; min-width: 0; margin-top: 6px; padding: 8px 10px; border: 1px solid var(--line); border-radius: 6px; color: var(--text); background: var(--paper); }
@media (max-width: 1100px) { .assistant-panel { flex-basis: 360px; width: 360px; } }
@media (max-width: 700px) { .assistant-panel { position: absolute; inset: 0; z-index: 45; width: 100%; border-left: 0; } .assistant-composer-area { margin: 4px 14px 14px; } .assistant-messages { padding-left: 22px; padding-right: 22px; } }
.assistant-panel-floating { position: fixed; inset: auto 24px 24px auto; z-index: 50; flex: none; width: min(460px, calc(100vw - 32px)); height: min(520px, calc(100dvh - 80px)); border: 1px solid var(--line); border-radius: 24px; box-shadow: 0 4px 8px rgb(0 0 0 / 3%), 0 12px 32px rgb(0 0 0 / 8%); overflow: hidden; }
.assistant-panel-floating .assistant-heading { min-height: 48px; padding: 8px 12px; cursor: move; touch-action: none; user-select: none; }
.assistant-panel-floating .assistant-title { font-size: 13px; }
.assistant-panel-floating .assistant-demo-label { padding: 0 24px 6px; }
.assistant-panel-floating .assistant-messages { padding: 12px 24px 16px; }
.assistant-panel-floating .assistant-welcome { padding-top: 24px; }
.assistant-panel-floating .assistant-welcome-mark { width: 48px; height: 48px; margin-bottom: 16px; border: 0; box-shadow: none; }
.assistant-panel-floating .assistant-welcome-butterfly { width: 36px; height: 36px; }
.assistant-panel-floating .assistant-welcome h3 { margin-bottom: 12px; font-size: 17px; }
.assistant-panel-floating .assistant-starters button { min-height: 35px; gap: 10px; font-size: 13px; }
.assistant-panel-floating .assistant-conversation-meta { padding-bottom: 12px; }
.assistant-panel-floating .assistant-message-user .assistant-message-text { padding: 8px 14px; border-radius: 18px; }
.assistant-panel-floating .assistant-composer-area { margin: 0 14px 14px; }
.assistant-panel-floating .assistant-composer { padding: 12px 12px 8px; box-shadow: none; }
.assistant-panel-floating .assistant-composer textarea { min-height: 40px; }
.assistant-panel-floating .assistant-compose-actions { margin-top: 4px; }
.assistant-panel-floating .assistant-context { padding: 3px 6px; }
.assistant-panel-fullscreen { position: relative; inset: auto; z-index: auto; flex: 1; width: 100%; height: 100%; border-left: 0; }
.assistant-panel-fullscreen .assistant-messages { width: 100%; max-width: 820px; margin-inline: auto; }
.assistant-panel-fullscreen .assistant-composer-area { width: calc(100% - 36px); max-width: 768px; margin: 4px auto 18px; }
.assistant-panel-fullscreen .assistant-welcome { padding-bottom: 24px; }
@media (max-width: 700px) { .assistant-panel-floating { right: 16px; bottom: 16px; } .assistant-panel-fullscreen .assistant-composer-area { width: calc(100% - 28px); margin-bottom: 14px; } }
</style>
