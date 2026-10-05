<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { AlignLeft, ArrowDown, ArrowLeft, ArrowUp, Check, ChevronDown, ChevronRight, ChevronsRight, CircleCheck, Copy, Cpu, FilePlus2, FileText, History, Languages, LoaderCircle, MessageCircle, MessageCirclePlus, MoreHorizontal, Paperclip, Pencil, Plug, Plus, RefreshCw, Reply, Search, Settings2, ShieldCheck, Square, Terminal, Trash2, Undo2, X } from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import type { AssistantMessage, AssistantProposal, AssistantSource, ReferenceIdentity } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
import { useWorkspaceStore } from '../stores/workspace';
import ChangeDiff from './ChangeDiff.vue';
import TaskProposalPreview from './TaskProposalPreview.vue';

const assistant = useAssistantStore();
const workspace = useWorkspaceStore();
const props = withDefaults(defineProps<{ openSourcesInNewTab?: boolean }>(), {
  openSourcesInNewTab: true,
});
const emit = defineEmits<{ openReference: [identity: ReferenceIdentity]; openSettings: [] }>();
const section = ref<'conversation' | 'history'>('conversation');
const query = ref('');
const textarea = ref<HTMLTextAreaElement>();
const messages = ref<HTMLElement>();
const notice = ref('');
const manualModelId = ref('');
const deleting = ref<string>();
const exportMessage = ref<AssistantMessage>();
const exportPath = ref('助手结果.md');
const visibleMessages = ref(30);
const proposalChecks = ref<Record<string, boolean>>({});
const panel = ref<HTMLElement>();
const popover = ref<'model' | 'permissions' | 'add' | 'history' | 'more' | null>(null);
const modelView = ref<'main' | 'all' | 'connections' | 'manual'>('main');
const modelQuery = ref('');
const addView = ref<'main' | 'sources'>('main');
const historyQuery = ref('');
const searchingHistory = ref(false);
const menuMaxHeight = ref(440);
const menuPosition = ref({ left: '0px', bottom: '0px' });
const showLatest = ref(false);
let popoverTrigger: HTMLButtonElement | undefined;
let composerObserver: ResizeObserver | undefined;
const title = computed(() => assistant.session?.messages.length ? assistant.session.title : '新助手会话');
const modelLabel = computed(() => assistant.modelId === 'cli-default' ? 'CLI 默认模型' : assistant.modelId || '选择模型');
const controlsLocked = computed(() => assistant.busy || assistant.applying || assistant.loading);
const permissionChoices = [
  { id: 'references', label: '仅参考文档', short: '仅参考', detail: '读取已添加的文档与工作区约定', search: false, structures: false },
  { id: 'notes', label: '检索工作区笔记', short: '检索笔记', detail: '可搜索和读取当前工作区的 Markdown 文档', search: true, structures: false },
  { id: 'workspace', label: '完整工作区上下文', short: '工作区', detail: '可检索笔记、读取对象，提出任务与关系建议', search: true, structures: true },
] as const;
const permission = computed(() => permissionChoices.find(choice => choice.search === assistant.allowSearch && choice.structures === assistant.allowStructures));
const modelOptions = computed(() => {
  const models = [...assistant.models];
  if (assistant.modelId && !models.includes(assistant.modelId)) models.unshift(assistant.modelId);
  return models;
});
const listedModels = computed(() => modelView.value === 'all' ? modelOptions.value.filter(id => id.toLocaleLowerCase().includes(modelQuery.value.toLocaleLowerCase())) : modelOptions.value.slice(0, 5));
const historyGroups = computed(() => {
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
  const groups = [{ label: '今天', sessions: [] as typeof assistant.sessions }, { label: '昨天', sessions: [] as typeof assistant.sessions }, { label: '更早', sessions: [] as typeof assistant.sessions }];
  for (const session of [...assistant.sessions].sort((a, b) => b.updatedAt - a.updatedAt)) {
    if (!session.title.toLocaleLowerCase().includes(historyQuery.value.toLocaleLowerCase())) continue;
    groups[session.updatedAt >= today.getTime() ? 0 : session.updatedAt >= yesterday.getTime() ? 1 : 2]!.sessions.push(session);
  }
  return groups.filter(group => group.sessions.length);
});
const starters = [
  { label: '总结这篇笔记', icon: AlignLeft, prompt: '请总结这篇笔记，提炼核心观点与重点。' },
  { label: '润色这篇笔记', icon: Pencil, prompt: '请润色这篇笔记，保留原意，让表达更清晰自然。先给出修改建议。' },
  { label: '翻译成英文', icon: Languages, prompt: '请将这篇笔记翻译成英文，保留原有的 Markdown 格式。' },
  { label: '提取待办事项', icon: CircleCheck, prompt: '请从这篇笔记中提取待办事项，列出行动、负责人和截止时间；未明确的信息请标为待确认。' },
];
const sourceFiles = computed(() => workspace.workspace?.files.filter(file => file.kind === 'file' && /\.(?:md|markdown)$/i.test(file.path) &&
  !file.path.startsWith('.tano/') && file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).slice(0, 100) ?? []);
const displayed = computed(() => assistant.session?.messages.slice(-visibleMessages.value) ?? []);
const statusLabels = { ready: '待审阅', applying: '正在保存', applied: '已应用', rejected: '已放弃', conflicted: '存在冲突', unknown: '结果待核对' };
async function changeConnection(id: string) {
  try { await assistant.selectConnection(id); modelView.value = 'main'; }
  catch (error) { assistant.error = String(error); }
}
async function changeModel(id: string) {
  try { await assistant.selectModel(id); closePopover(true); }
  catch (error) { assistant.error = String(error); }
}
function inputModel() {
  manualModelId.value = assistant.modelId; modelView.value = 'manual';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>('[aria-label="当前对话的模型 ID"]')?.focus());
}
function setModelView(view: 'main' | 'connections') {
  modelView.value = view;
  void nextTick(() => panel.value?.querySelector<HTMLButtonElement>('#assistant-model-options [data-menu-item]:not(:disabled)')?.focus());
}
function showAllModels() {
  modelView.value = 'all';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>('[aria-label="搜索模型"]')?.focus());
}
function toggleSource(id: string) {
  if (assistant.busy) return;
  if (assistant.files.includes(id)) {
    assistant.files = assistant.files.filter(file => file !== id);
    if (assistant.selection?.fileId === id) assistant.selection = null;
  } else if (assistant.files.length < 20) assistant.files.push(id);
  else notice.value = '一次最多选择 20 篇文档';
}
async function openSource(source: AssistantSource) {
  notice.value = '';
  try {
    if (!workspace.workspace || workspace.workspace.id !== source.workspaceId) throw new Error('请在原工作区打开引用');
    const snapshot = await workspace.assistantSnapshot({ id: workspace.workspace.id, path: workspace.workspace.path }, source.fileId);
    const file = workspace.workspace.files.find(file => file.id === source.fileId);
    if (!file) throw new Error('来源文档已移除');
    if (props.openSourcesInNewTab) await workspace.openFileInNewTab({ ...file, path: snapshot.path });
    else await workspace.openFile({ ...file, path: snapshot.path });
    if (snapshot.hash !== source.hash) notice.value = '来源已更新；回答基于生成时的版本';
  } catch (error) { notice.value = String(error); }
}
function answerMarkdown(message: AssistantMessage) {
  return message.content.replace(/\[来源:(S\d+)\]/g, (_match, id: string) => message.sources?.some(source => source.id === id)
    ? `[来源 ${id}](#assistant-source-${id})` : '（来源未提供）');
}
function sourceLink(message: AssistantMessage, reference: string) {
  const id = /^#assistant-source-(S\d+)$/.exec(reference)?.[1];
  const source = message.sources?.find(source => source.id === id);
  if (source) void openSource(source);
  else notice.value = '此链接未关联本次提供的来源';
}
function openAnswerReference(identity: ReferenceIdentity) {
  if (assistant.session?.workspaceId !== workspace.workspace?.id) { notice.value = '请在原工作区打开引用'; return; }
  emit('openReference', identity);
}
async function copy(message: AssistantMessage) {
  try { await navigator.clipboard.writeText(message.content); notice.value = '已复制'; }
  catch { notice.value = '无法访问剪贴板'; }
}
async function draftReply(message: AssistantMessage) {
  try {
    await assistant.replyTarget?.draft(message.content);
    notice.value = '回答已填入回复草稿';
  } catch (error) { notice.value = String(error); }
}
async function exportAnswer() {
  const message = exportMessage.value;
  if (!message || !workspace.workspace || assistant.applying || assistant.busy) return;
  const proposal: AssistantProposal = { id: crypto.randomUUID(), runId: message.id,
    workspaceId: workspace.workspace.id, kind: 'create', path: exportPath.value, base: '', content: message.content,
    reason: '将助手回答保存为 Markdown 文档', status: 'ready' };
  message.proposals ??= []; message.proposals.push(proposal); exportMessage.value = undefined;
  await assistant.review(proposal);
}
function sendKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); void assistant.send(); }
}
function togglePopover(kind: NonNullable<typeof popover.value>, event: MouseEvent) {
  popoverTrigger = event.currentTarget as HTMLButtonElement;
  if (popover.value === kind) { closePopover(true); return; }
  modelView.value = 'main'; modelQuery.value = ''; addView.value = 'main'; query.value = '';
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
  if (age < 60_000) return '刚刚';
  if (age < 3_600_000) return `${Math.floor(age / 60_000)} 分钟前`;
  if (age < 86_400_000) return `${Math.floor(age / 3_600_000)} 小时前`;
  return new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
}
function searchHistory() {
  searchingHistory.value = !searchingHistory.value;
  if (!searchingHistory.value) historyQuery.value = '';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>('[aria-label="搜索助手会话"]')?.focus());
}
function selectPermission(choice: typeof permissionChoices[number]) {
  if (controlsLocked.value) return;
  assistant.allowSearch = choice.search; assistant.allowStructures = choice.structures;
  closePopover(true);
}
function openSources() {
  addView.value = 'sources';
  void nextTick(() => panel.value?.querySelector<HTMLInputElement>('[aria-label="搜索参考文档"]')?.focus());
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
  const fileId = workspace.active?.id;
  if (fileId && !assistant.files.includes(fileId)) {
    if (assistant.files.length >= 20) { notice.value = '一次最多选择 20 篇文档，请先移除一篇参考文档'; return; }
    assistant.files.push(fileId);
  }
  assistant.prompt = prompt;
  void nextTick(() => textarea.value?.focus());
}
function resizeInput() {
  if (!textarea.value) return;
  textarea.value.style.height = 'auto';
  textarea.value.style.height = `${Math.min(168, Math.max(52, textarea.value.scrollHeight))}px`;
  updateMenuPosition();
}
function updateMenuPosition() {
  if (!['model', 'permissions', 'add'].includes(popover.value ?? '') || !popoverTrigger) return;
  const element = panel.value;
  const composer = element?.querySelector('.assistant-composer-area');
  const menu = composer?.querySelector('.assistant-popover');
  if (!element || !composer || !menu) return;
  const composerBounds = composer.getBoundingClientRect();
  const triggerBounds = popoverTrigger.getBoundingClientRect();
  const menuWidth = menu.getBoundingClientRect().width;
  const desiredLeft = popover.value === 'model' ? triggerBounds.right - composerBounds.left - menuWidth : triggerBounds.left - composerBounds.left;
  menuPosition.value = {
    left: `${Math.max(0, Math.min(desiredLeft, composerBounds.width - menuWidth))}px`,
    bottom: `${composerBounds.bottom - triggerBounds.top + 8}px`,
  };
  const topBoundary = element.querySelector('.assistant-heading')?.getBoundingClientRect().bottom ?? element.getBoundingClientRect().top;
  menuMaxHeight.value = Math.max(80, triggerBounds.top - topBoundary - 16);
}
function resized() {
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
  return new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
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
  void nextTick(() => { resizeInput(); scrollToLatest(); });
});
onBeforeUnmount(() => {
  composerObserver?.disconnect();
  window.removeEventListener('pointerdown', outsidePopover);
  window.removeEventListener('resize', resized);
});
watch(() => assistant.prompt, () => { void nextTick(resizeInput); });
watch(() => [assistant.files.length, assistant.selection?.text], () => { void nextTick(updateMenuPosition); });
watch(section, () => { closePopover(); void nextTick(() => { resizeInput(); scrollToLatest(); }); });
watch(() => assistant.opened, open => { if (open) void nextTick(() => textarea.value?.focus()); });
watch(() => [assistant.session?.id, assistant.connectionId], () => { modelView.value = 'main'; });
watch(() => assistant.session?.id, () => { visibleMessages.value = 30; void nextTick(scrollToLatest); });
watch(() => assistant.session?.messages.map(message => message.content.length).join(','), () => {
  const element = messages.value;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160)
    void nextTick(scrollToLatest);
});
</script>

<template>
  <aside ref="panel" class="assistant-panel" :style="{ '--assistant-menu-max-height': `${menuMaxHeight}px` }" aria-label="Tano 助手" @keydown.esc="closePopover(true)" @keydown="menuKey">
    <header class="assistant-heading">
      <button v-if="section !== 'conversation'" class="icon-button" aria-label="返回助手对话" title="返回对话" @click="section = 'conversation'"><ArrowLeft :size="17" /></button>
      <h2 v-if="section !== 'conversation'">会话记录</h2>
      <h2 v-else class="assistant-title-heading">
        <button class="assistant-title" :title="title" aria-label="打开助手会话记录" :aria-expanded="popover === 'history'" aria-controls="assistant-history-options" data-assistant-popover @click="togglePopover('history', $event)"><span>{{ title }}</span><ChevronDown :size="16" /></button>
      </h2>
      <template v-if="section === 'conversation'">
        <button class="icon-button" title="新建会话" aria-label="新建助手会话" :disabled="assistant.busy || assistant.applying" @click="startNewSession"><MessageCirclePlus :size="18" /></button>
        <button class="icon-button" title="更多选项" aria-label="助手更多选项" :aria-expanded="popover === 'more'" aria-controls="assistant-more-options" data-assistant-popover @click="togglePopover('more', $event)"><MoreHorizontal :size="19" /></button>
        <div v-if="popover === 'more'" id="assistant-more-options" class="assistant-popover assistant-more-menu">
          <button data-menu-item @click="openHistory"><History :size="16" />管理会话</button>
          <button v-if="!assistant.demo" data-menu-item @click="closePopover(); emit('openSettings')"><Settings2 :size="16" />助手设置</button>
        </div>
      </template>
      <button class="icon-button" title="收起助手" aria-label="关闭助手侧栏" @click="assistant.opened = false"><ChevronsRight :size="19" /></button>
      <div v-if="popover === 'history'" id="assistant-history-options" class="assistant-popover assistant-history-menu" role="dialog" aria-label="最近助手会话">
        <div class="assistant-popover-heading"><span>会话记录</span><button class="icon-button" :class="{ selected: searchingHistory }" aria-label="搜索会话记录" title="搜索会话" @click="searchHistory"><Search :size="16" /></button></div>
        <label v-if="searchingHistory" class="assistant-menu-search"><Search :size="15" /><input v-model="historyQuery" aria-label="搜索助手会话" placeholder="搜索会话" /></label>
        <div class="assistant-menu-scroll panel-scrollbar">
          <section v-for="group in historyGroups" :key="group.label" class="assistant-history-group">
            <h3>{{ group.label }}</h3>
            <button v-for="session in group.sessions" :key="session.id" class="assistant-menu-item assistant-session-option" :class="{ selected: assistant.session?.id === session.id }" :title="session.title" :aria-pressed="assistant.session?.id === session.id" :disabled="controlsLocked" data-menu-item @click="selectHistory(session.id)"><MessageCircle :size="17" /><span class="assistant-menu-label">{{ session.title }}</span><small>{{ historyTime(session.updatedAt) }}</small></button>
          </section>
          <p v-if="!historyGroups.length" class="assistant-menu-empty">{{ historyQuery ? '没有找到匹配的会话' : '暂无会话记录' }}</p>
        </div>
        <div class="assistant-menu-divider" />
        <button class="assistant-menu-item" data-menu-item @click="openHistory"><History :size="16" /><span class="assistant-menu-label">管理会话</span><span v-if="assistant.externalSessions.length" class="assistant-menu-count">{{ assistant.externalSessions.length }} 条外部提案</span><ChevronRight :size="15" /></button>
      </div>
    </header>
    <div v-if="assistant.demo" class="assistant-demo-label">浏览器演示 · 模型响应为模拟数据</div>
    <p v-if="notice" class="assistant-notice" role="status">{{ notice }}</p>
    <p v-if="assistant.error" class="assistant-error" role="alert">{{ assistant.error }}</p>

    <div v-if="section === 'history'" class="assistant-history">
      <div v-if="!assistant.demo" class="assistant-proposal-actions"><span>外部 MCP 提案</span><button class="icon-button" aria-label="刷新外部 MCP 提案" title="刷新提案" :disabled="assistant.busy || assistant.applying" @click="assistant.loadExternal()"><RefreshCw :size="15" /></button></div>
      <div v-for="external in assistant.externalSessions" :key="external.id" class="assistant-history-row"><button :disabled="assistant.busy || assistant.applying" @click="assistant.importExternal(external).then(() => section = 'conversation').catch(error => assistant.error = String(error))"><strong>{{ external.title }}</strong><small>外部 Agent · 待审阅</small></button></div>
      <p v-if="!assistant.sessions.length" class="assistant-empty">暂无会话记录</p>
      <div v-for="session in assistant.sessions" :key="session.id" class="assistant-history-row">
        <button :disabled="assistant.busy || assistant.applying" @click="assistant.selectSession(session.id); section = 'conversation'">
          <strong>{{ session.title }}</strong><small>{{ new Date(session.updatedAt).toLocaleString('zh-CN') }}</small>
        </button>
        <button class="icon-button" :disabled="assistant.busy || assistant.applying" :aria-label="`删除会话 ${session.title}`" title="删除会话" @click="deleting = session.id"><Trash2 :size="15" /></button>
      </div>
      <div v-if="deleting" class="assistant-delete-confirm" role="alertdialog" aria-label="删除助手会话">
        <p>删除这条会话及其修改记录？</p>
        <button class="secondary-button" @click="deleting = undefined">取消</button>
        <button class="primary-button destructive" @click="assistant.deleteSession(deleting).catch(error => assistant.error = String(error)); deleting = undefined">删除会话</button>
      </div>
    </div>

    <template v-else>
      <div class="assistant-transcript">
      <div ref="messages" class="assistant-messages panel-scrollbar" role="log" aria-label="助手对话" @scroll="updateScroll">
        <p v-if="assistant.loading" class="assistant-empty"><LoaderCircle :size="16" class="spinning" />正在读取会话</p>
        <div v-else-if="!assistant.session?.messages.length" class="assistant-welcome">
          <div class="assistant-welcome-mark"><img :src="'/favicon-green.svg?v=3'" alt="同页助手" /></div>
          <h3>今天想从哪里开始？</h3>
          <div class="assistant-starters">
            <button v-for="starter in starters" :key="starter.label" :disabled="assistant.busy || assistant.applying || !workspace.active" @click="preparePrompt(starter.prompt)"><component :is="starter.icon" :size="18" /><span>{{ starter.label }}</span></button>
          </div>
        </div>
        <button v-if="(assistant.session?.messages.length ?? 0) > visibleMessages" class="assistant-text-action" @click="visibleMessages += 30">查看较早消息</button>
        <div v-if="displayed.length" class="assistant-conversation-meta">同页助手 · {{ messageTime(displayed[0]!.createdAt) }}</div>
        <article v-for="message in displayed" :key="message.id" class="assistant-message" :class="`assistant-message-${message.role}`" :aria-label="message.role === 'user' ? '你的消息' : '助手回答'">
          <div v-if="message.role === 'user' || message.state === 'running'" class="assistant-message-text">{{ message.content }}</div>
          <div v-else-if="message.content" class="assistant-answer"><MarkdownEditor :model-value="answerMarkdown(message)" :document-id="`assistant-${message.id}`" :reference-targets="assistant.session?.workspaceId === workspace.workspace?.id ? workspace.referenceTargets : []" readonly :reveal-markdown="false" open-links-on-tap :resolve-image="() => null" @open-link="sourceLink(message, $event)" @open-reference="openAnswerReference" @ready="answerReady" @error="notice = $event" /></div>
          <p v-if="message.error || message.state === 'interrupted'" class="assistant-message-error">{{ message.error ?? '上次运行已中断；不会自动恢复执行' }}</p>
          <div v-if="message.sources?.length" class="assistant-citations"><button v-for="source in message.sources" :key="source.id" :title="source.path" @click="openSource(source)"><FileText :size="12" />{{ source.id }} · {{ source.path }}</button></div>
          <small v-if="message.rules?.length" class="assistant-rules">工作区约定：{{ message.rules.join('、') }}</small>
          <section v-for="proposal in message.proposals" :key="proposal.id" class="assistant-proposal" :aria-label="`修改建议 ${proposal.path}`">
            <div class="assistant-proposal-heading"><strong>{{ proposal.kind === 'object' ? (proposal.base ? '修改任务' : '工作区事件') : proposal.kind === 'relation' ? '维护关系' : proposal.kind === 'create' ? '新建' : '修改' }} · {{ proposal.preview?.path ?? proposal.path }}</strong><small>{{ statusLabels[proposal.status] }}</small></div>
            <p>{{ proposal.reason }}</p>
            <TaskProposalPreview :proposal="proposal" @open-reference="openAnswerReference" @ready="proposalChecks[proposal.id] = $event" />
            <p v-if="proposal.error" class="assistant-message-error">{{ proposal.error }}</p>
            <ChangeDiff v-if="proposal.preview" :before="proposal.preview.before" :after="proposal.preview.after" />
            <div class="assistant-proposal-actions">
              <template v-if="['ready', 'conflicted'].includes(proposal.status)">
                <button class="secondary-button" :disabled="assistant.busy || assistant.applying" @click="assistant.review(proposal)"><Search :size="14" />查看差异</button>
                <button v-if="proposal.preview && proposal.status === 'ready'" class="primary-button" :disabled="assistant.busy || assistant.applying || proposalChecks[proposal.id] === false" @click="assistant.review(proposal, true)"><Check :size="14" />应用修改</button>
                <button class="icon-button" title="放弃建议" aria-label="放弃修改建议" :disabled="assistant.busy || assistant.applying" @click="assistant.reject(proposal)"><X :size="15" /></button>
              </template>
              <button v-if="proposal.status === 'unknown'" class="secondary-button" :disabled="assistant.applying" @click="assistant.verify(proposal)"><Search :size="14" />核对写入结果</button>
              <button v-if="proposal.status === 'applied' && !['object', 'relation'].includes(proposal.kind)" class="assistant-text-action" :disabled="assistant.busy || assistant.applying" @click="assistant.undo(proposal)"><Undo2 :size="14" />撤回内容</button>
            </div>
          </section>
          <div v-if="message.role === 'assistant' && message.state !== 'running'" class="assistant-message-actions">
            <button class="icon-button" title="复制回答" aria-label="复制助手回答" @click="copy(message)"><Copy :size="14" /></button>
            <button v-if="assistant.replyTarget" class="icon-button" :title="`填写回复草稿：${assistant.replyTarget.label}`" aria-label="将助手回答填入回复草稿" :disabled="assistant.busy || assistant.applying || !message.content" @click="draftReply(message)"><Reply :size="14" /></button>
            <button class="icon-button" title="保存为文档" aria-label="将助手回答保存为文档" :disabled="assistant.busy || assistant.applying || !message.content" @click="exportMessage = message"><FilePlus2 :size="14" /></button>
            <small v-if="message.usage && (message.usage.input || message.usage.output)">{{ message.usage.input }} 输入 / {{ message.usage.output }} 输出 token</small>
            <small v-if="message.timing"><template v-if="message.timing.firstContentMs !== undefined">首段 {{ (message.timing.firstContentMs / 1000).toFixed(1) }} 秒 · </template>用时 {{ (message.timing.totalMs / 1000).toFixed(1) }} 秒</small>
          </div>
        </article>
      </div>
      <button v-if="showLatest" class="assistant-jump-latest" title="回到最新消息" aria-label="滚动到最新消息" @click="scrollToLatest"><ArrowDown :size="20" /></button>
      </div>
      <form v-if="exportMessage" class="assistant-export" @submit.prevent="exportAnswer"><label>文档路径<input v-model="exportPath" required maxlength="220" /></label><button class="secondary-button" type="button" @click="exportMessage = undefined">取消</button><button class="primary-button"><FilePlus2 :size="14" />生成保存建议</button></form>
      <div class="assistant-composer-area">
        <div v-if="popover === 'model'" id="assistant-model-options" class="assistant-popover assistant-model-menu" :style="menuPosition" aria-label="模型选择">
          <div class="assistant-popover-heading">
            <button v-if="modelView !== 'main'" class="icon-button" title="返回模型列表" aria-label="返回模型列表" @click="setModelView('main')"><ArrowLeft :size="16" /></button>
            <span>{{ modelView === 'connections' ? '模型连接' : modelView === 'all' ? '全部模型' : modelView === 'manual' ? '指定模型' : '选择模型' }}</span>
            <button v-if="modelView === 'main' || modelView === 'all'" class="icon-button" aria-label="刷新模型列表" title="刷新模型列表" :disabled="assistant.modelsLoading || controlsLocked || !assistant.connection" @click="assistant.reloadModels()"><LoaderCircle v-if="assistant.modelsLoading" :size="15" class="spinning" /><RefreshCw v-else :size="15" /></button>
            <button class="icon-button" title="关闭模型选择" aria-label="关闭模型选择" @click="closePopover(true)"><X :size="15" /></button>
          </div>
          <template v-if="modelView === 'connections'">
            <div class="assistant-menu-scroll panel-scrollbar">
              <button v-for="connection in assistant.connections" :key="connection.id" class="assistant-menu-item assistant-detail-option" :class="{ selected: assistant.connectionId === connection.id }" :aria-pressed="assistant.connectionId === connection.id" :disabled="controlsLocked" data-menu-item @click="changeConnection(connection.id)"><Plug v-if="!connection.kind || connection.kind === 'api'" :size="17" /><Terminal v-else :size="17" /><span class="assistant-menu-label"><span>{{ connection.name }}</span><small>{{ connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : 'API 连接' }}</small></span><Check v-if="assistant.connectionId === connection.id" :size="16" class="assistant-menu-check" /></button>
            </div>
            <div v-if="!assistant.demo" class="assistant-menu-divider" />
            <button v-if="!assistant.demo" class="assistant-menu-item" data-menu-item @click="closePopover(); emit('openSettings')"><Plus :size="17" /><span class="assistant-menu-label">添加模型连接</span></button>
          </template>
          <template v-else-if="modelView === 'manual'">
            <form class="assistant-manual-model" @submit.prevent="changeModel(manualModelId)">
              <label for="assistant-model-id">模型 ID</label>
              <div><input id="assistant-model-id" v-model="manualModelId" aria-label="当前对话的模型 ID" placeholder="模型 ID" maxlength="200" autocomplete="off" :disabled="controlsLocked" /><button class="icon-button" aria-label="确认对话模型" title="确认模型" :disabled="!manualModelId.trim() || controlsLocked"><Check :size="16" /></button></div>
            </form>
          </template>
          <template v-else>
            <button v-if="modelView === 'main'" class="assistant-menu-item assistant-detail-option assistant-connection-option" aria-label="选择模型连接" :disabled="controlsLocked" data-menu-item @click="setModelView('connections')"><Plug :size="17" /><span class="assistant-menu-label"><span>{{ assistant.connection?.name ?? (assistant.connectionId ? '连接已移除' : '选择模型连接') }}</span><small>{{ assistant.connection?.kind === 'codex-cli' ? 'Codex CLI' : assistant.connection?.kind === 'claude-cli' ? 'Claude CLI' : assistant.demo ? '浏览器模拟' : '模型连接' }}</small></span><ChevronRight :size="16" /></button>
            <div v-if="modelView === 'main'" class="assistant-menu-divider" />
            <label v-if="modelView === 'all'" class="assistant-menu-search"><Search :size="15" /><input v-model="modelQuery" aria-label="搜索模型" placeholder="搜索模型" /></label>
            <div class="assistant-menu-scroll panel-scrollbar" aria-label="可用模型">
              <p v-if="modelView === 'main' && listedModels.length" class="assistant-menu-caption">可用模型</p>
              <button v-for="model in listedModels" :key="model" class="assistant-menu-item assistant-model-option" :class="{ selected: assistant.modelId === model }" :title="model" :aria-label="`使用模型 ${model}`" :aria-pressed="assistant.modelId === model" :disabled="controlsLocked" data-menu-item @click="changeModel(model)"><Terminal v-if="model === 'cli-default'" :size="16" /><Cpu v-else :size="16" /><span class="assistant-menu-label">{{ model === 'cli-default' ? 'CLI 默认模型' : model }}</span><span v-if="!assistant.models.includes(model)" class="assistant-menu-badge">自定义</span><Check v-if="assistant.modelId === model" :size="16" class="assistant-menu-check" /></button>
              <p v-if="assistant.modelsLoading && !listedModels.length" class="assistant-menu-empty"><LoaderCircle :size="15" class="spinning" />正在读取模型</p>
              <p v-else-if="!listedModels.length" class="assistant-menu-empty">{{ modelQuery ? '没有找到匹配的模型' : assistant.connection ? '暂无可用模型' : '请选择模型连接' }}</p>
            </div>
            <p v-if="assistant.modelsError" class="assistant-model-error" role="alert">{{ assistant.modelsError }}</p>
            <div class="assistant-menu-divider" />
            <button v-if="modelView === 'main' && modelOptions.length > 5" class="assistant-menu-item" aria-label="查看全部模型" data-menu-item @click="showAllModels"><span class="assistant-menu-label">其他模型</span><span class="assistant-menu-count">{{ modelOptions.length }}</span><ChevronRight :size="16" /></button>
            <button v-if="assistant.connection" class="assistant-menu-item" aria-label="手动指定对话模型" :disabled="controlsLocked" data-menu-item @click="inputModel"><Pencil :size="16" /><span class="assistant-menu-label">手动指定模型</span></button>
            <button v-if="!assistant.connections.length && !assistant.demo" class="assistant-menu-item" data-menu-item @click="closePopover(); emit('openSettings')"><Plus :size="16" /><span class="assistant-menu-label">添加模型连接</span></button>
          </template>
        </div>
        <div v-if="popover === 'permissions'" id="assistant-permission-options" class="assistant-popover assistant-permissions-menu" :style="menuPosition" aria-label="工作区访问权限">
          <div class="assistant-popover-heading"><span>助手可以访问哪些内容？</span><button class="icon-button" title="关闭访问权限" aria-label="关闭访问权限" @click="closePopover(true)"><X :size="15" /></button></div>
          <div role="radiogroup" aria-label="工作区访问范围">
            <template v-for="choice in permissionChoices" :key="choice.id">
              <button v-if="!choice.structures || workspace.capabilities.features.objectReferences" role="radio" :aria-checked="permission?.id === choice.id" class="assistant-menu-item assistant-detail-option assistant-permission-option" :class="{ selected: permission?.id === choice.id }" :disabled="controlsLocked" data-menu-item @click="selectPermission(choice)"><span class="assistant-menu-label"><span>{{ choice.label }}</span><small>{{ choice.detail }}</small></span><Check v-if="permission?.id === choice.id" :size="17" class="assistant-menu-check" /></button>
            </template>
          </div>
          <div class="assistant-menu-divider" />
          <p class="assistant-permission-note"><ShieldCheck :size="13" />修改建议由你审阅后应用</p>
        </div>
        <div v-if="popover === 'add'" id="assistant-add-options" class="assistant-popover assistant-add-menu" :style="menuPosition" :aria-label="addView === 'sources' ? '选择参考文档' : '添加内容'">
          <template v-if="addView === 'main'">
            <button class="assistant-menu-item" data-menu-item :disabled="controlsLocked" @click="openSources"><Paperclip :size="18" /><span class="assistant-menu-label">添加参考文档</span><ChevronRight :size="15" /></button>
            <button class="assistant-menu-item" data-menu-item :disabled="controlsLocked || !workspace.active" @click="addCurrentNote"><FileText :size="18" /><span class="assistant-menu-label">引用当前笔记</span><Check v-if="workspace.active && assistant.files.includes(workspace.active.id)" :size="16" class="assistant-menu-check" /></button>
            <label class="assistant-menu-item assistant-menu-toggle"><Search :size="18" /><span class="assistant-menu-label">检索工作区</span><input v-model="assistant.allowSearch" role="switch" type="checkbox" aria-label="允许检索当前工作区" :aria-checked="assistant.allowSearch" :disabled="controlsLocked" /><span class="assistant-switch" aria-hidden="true" /></label>
            <div class="assistant-menu-divider" />
            <button class="assistant-menu-item" :disabled="assistant.demo || controlsLocked" data-menu-item @click="closePopover(); emit('openSettings')"><Plug :size="18" /><span class="assistant-menu-label">添加模型连接</span><span v-if="assistant.demo" class="assistant-menu-badge">桌面版</span></button>
          </template>
          <template v-else>
            <div class="assistant-popover-heading"><button class="icon-button" aria-label="返回添加内容" title="返回" @click="addView = 'main'"><ArrowLeft :size="16" /></button><span>参考文档</span><small>{{ assistant.files.length }} / 20</small><button class="icon-button" aria-label="完成参考文档选择" title="完成" @click="closePopover(true)"><Check :size="16" /></button></div>
            <label class="assistant-menu-search"><Search :size="15" /><input v-model="query" aria-label="搜索参考文档" placeholder="搜索文档路径" /></label>
            <div class="assistant-menu-scroll panel-scrollbar">
              <button v-for="file in sourceFiles" :key="file.id" class="assistant-menu-item assistant-source-option" :class="{ selected: assistant.files.includes(file.id) }" :aria-pressed="assistant.files.includes(file.id)" :title="file.path" :disabled="controlsLocked" data-menu-item @click="toggleSource(file.id)"><FileText :size="16" /><span class="assistant-menu-label">{{ file.path }}</span><Check v-if="assistant.files.includes(file.id)" :size="16" class="assistant-menu-check" /></button>
              <p v-if="!sourceFiles.length" class="assistant-menu-empty">{{ query ? '没有找到匹配的文档' : '暂无 Markdown 文档' }}</p>
            </div>
          </template>
        </div>
      <form class="assistant-composer" @submit.prevent="closePopover(); assistant.send()">
        <div v-if="assistant.busy || assistant.applying" class="assistant-progress" role="status"><LoaderCircle :size="14" class="spinning" />{{ assistant.applying ? '正在处理修改' : assistant.progress }}</div>
        <div v-if="assistant.files.length || assistant.selection" class="assistant-contexts">
          <button v-for="id in assistant.files" :key="id" type="button" class="assistant-context" :disabled="assistant.busy" :title="`移除参考：${workspace.workspace?.files.find(file => file.id === id)?.path ?? id}`" @click="toggleSource(id)"><FileText :size="13" /><span>{{ workspace.workspace?.files.find(file => file.id === id)?.name ?? '已移除文档' }}</span><X :size="12" /></button>
          <div v-if="assistant.selection" class="assistant-selection"><span>{{ assistant.selection.text }}</span><button type="button" class="icon-button" aria-label="清除助手选区" title="清除选区" :disabled="assistant.busy" @click="assistant.selection = null"><X :size="13" /></button></div>
        </div>
        <textarea ref="textarea" v-model="assistant.prompt" rows="2" maxlength="20000" aria-label="给助手的任务" placeholder="问问同页助手…" @keydown="sendKey" />
        <div class="assistant-compose-actions">
          <button type="button" class="icon-button assistant-compose-tool" title="添加内容" aria-label="添加内容" :disabled="controlsLocked" :aria-expanded="popover === 'add'" aria-controls="assistant-add-options" data-assistant-popover @click="togglePopover('add', $event)"><Plus :size="20" /></button>
          <button type="button" class="assistant-compose-permission" :class="{ 'assistant-granted': assistant.allowSearch || assistant.allowStructures }" title="工作区访问权限" aria-label="工作区访问权限" :aria-expanded="popover === 'permissions'" aria-controls="assistant-permission-options" data-assistant-popover @click="togglePopover('permissions', $event)"><span>{{ permission?.short ?? '自定义' }}</span></button>
          <button type="button" class="assistant-compose-model" :title="`${assistant.connection?.name ?? '模型连接'} · ${modelLabel}`" aria-label="选择助手模型" :aria-expanded="popover === 'model'" aria-controls="assistant-model-options" data-assistant-popover @click="togglePopover('model', $event)"><span>{{ modelLabel }}</span><ChevronDown :size="13" /></button>
          <button v-if="assistant.busy" type="button" class="icon-button assistant-stop" aria-label="停止助手生成" title="停止生成" @click="assistant.stop()"><Square :size="16" /></button><button v-else class="primary-button assistant-send" aria-label="发送给助手" title="发送" :disabled="!assistant.prompt.trim() || !assistant.connection || !assistant.modelId || assistant.loading || assistant.applying"><ArrowUp :size="18" /></button>
        </div>
      </form>
      </div>
    </template>
  </aside>
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
.assistant-popover { position: absolute; z-index: 5; padding: 5px; border: 1px solid var(--line); border-radius: 8px; background: var(--paper); box-shadow: 0 8px 28px rgb(0 0 0 / 10%); }
.assistant-more-menu { top: calc(100% - 4px); right: 17px; width: 180px; }
.assistant-more-menu > button { display: flex; align-items: center; gap: 9px; width: 100%; padding: 9px 10px; border-radius: 5px; font-size: 13px; text-align: left; }
.assistant-more-menu > button:hover { background: var(--surface); }
.assistant-model-menu, .assistant-permissions-menu, .assistant-add-menu { z-index: 70; max-height: min(440px, var(--assistant-menu-max-height)); overflow: auto; }
.assistant-model-menu { width: min(332px, 100%); }
.assistant-permissions-menu { width: min(380px, 100%); }
.assistant-add-menu { width: min(306px, 100%); }
.assistant-history-menu { top: calc(100% + 2px); left: 12px; width: min(360px, calc(100% - 24px)); max-height: min(440px, calc(100dvh - 90px)); overflow: auto; }
.assistant-model-menu, .assistant-add-menu, .assistant-history-menu { display: flex; flex-direction: column; overflow: hidden; }
.assistant-model-menu > :not(.assistant-menu-scroll), .assistant-add-menu > :not(.assistant-menu-scroll), .assistant-history-menu > :not(.assistant-menu-scroll) { flex-shrink: 0; }
.assistant-popover-heading { display: flex; align-items: center; gap: 6px; padding: 4px 7px 7px; color: var(--muted); font-size: 12px; }
.assistant-popover-heading > span { flex: 1; min-width: 0; }
.assistant-popover-heading small { color: var(--muted); font-size: 11px; white-space: nowrap; }
.assistant-popover-heading .icon-button { flex: 0 0 24px; width: 24px; height: 24px; border-radius: 5px; }
.assistant-menu-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 34px; padding: 7px 9px; border-radius: 5px; color: var(--text-secondary); font-size: 14px; text-align: left; }
.assistant-menu-item:hover:not(:disabled), .assistant-menu-item.selected { background: var(--surface); color: var(--text); }
.assistant-menu-item > svg { flex-shrink: 0; color: var(--muted); }
.assistant-menu-label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-menu-check { color: var(--text) !important; }
.assistant-menu-count { color: var(--muted); font-size: 11px; white-space: nowrap; }
.assistant-menu-badge { flex-shrink: 0; padding: 2px 4px; border-radius: 3px; color: var(--muted); background: var(--hover); font-size: 10px; line-height: 1.2; }
.assistant-menu-divider { height: 1px; margin: 5px 8px; background: var(--line); }
.assistant-menu-caption, .assistant-history-group h3 { margin: 0; padding: 7px 9px 5px; color: var(--muted); font-size: 12px; font-weight: 500; }
.assistant-menu-scroll { flex: 1 1 auto; max-height: 258px; min-height: 0; overflow: auto; overscroll-behavior: contain; }
.assistant-menu-empty { display: flex; align-items: center; justify-content: center; gap: 6px; margin: 0; padding: 22px 9px; color: var(--muted); font-size: 12px; }
.assistant-detail-option { align-items: flex-start; }
.assistant-detail-option > svg { margin-top: 3px; }
.assistant-detail-option .assistant-menu-label { display: grid; gap: 3px; }
.assistant-detail-option .assistant-menu-label > span { overflow: hidden; text-overflow: ellipsis; }
.assistant-detail-option small { color: var(--muted); font-size: 12px; line-height: 1.5; font-weight: 400; }
.assistant-permission-option .assistant-menu-label { white-space: normal; overflow: visible; }
.assistant-permission-note { display: flex; align-items: center; gap: 6px; margin: 8px 9px 7px; color: var(--muted); font-size: 11px; }
.assistant-permission-note svg { flex-shrink: 0; }
.assistant-model-error { margin: 6px 9px; color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
.assistant-menu-search { display: flex; align-items: center; gap: 7px; margin: 2px 7px 7px; padding: 7px 0; border-bottom: 1px solid var(--line); color: var(--muted); }
.assistant-menu-search input { width: 100%; min-width: 0; border: 0; padding: 0; background: transparent; color: var(--text); font-size: 12px; }
.assistant-menu-search svg { flex-shrink: 0; }
.assistant-manual-model { display: grid; gap: 6px; padding: 5px 8px 8px; font-size: 12px; }
.assistant-manual-model > div { display: flex; align-items: center; gap: 5px; }
.assistant-manual-model input { flex: 1; width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--line); border-radius: 5px; background: var(--paper); color: var(--text); }
.assistant-session-option small { flex-shrink: 0; color: var(--muted); font-size: 11px; }
.assistant-history-group + .assistant-history-group { margin-top: 7px; }
.assistant-menu-toggle { position: relative; cursor: pointer; }
.assistant-menu-toggle input { position: absolute; right: 9px; width: 30px; height: 18px; opacity: 0; cursor: pointer; }
.assistant-switch { flex: 0 0 30px; width: 30px; height: 18px; padding: 2px; border-radius: 10px; background: var(--switch-off); pointer-events: none; transition: background 120ms ease; }
.assistant-switch::after { content: ''; display: block; width: 14px; height: 14px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgb(0 0 0 / 12%); transition: transform 120ms ease; }
.assistant-menu-toggle input:checked + .assistant-switch { background: var(--green-fill); }
.assistant-menu-toggle input:checked + .assistant-switch::after { transform: translateX(12px); }
.assistant-menu-toggle input:focus-visible + .assistant-switch { outline: 2px solid var(--green); outline-offset: 2px; }
.assistant-menu-toggle:has(input:disabled) { cursor: default; opacity: 0.45; }
.assistant-menu-toggle input:disabled { cursor: default; }
.assistant-contexts { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; max-height: 116px; overflow: auto; padding: 0 0 8px; }
.assistant-text-action { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 5px 0; color: var(--text-secondary); background: transparent; font-size: 12px; }
.assistant-text-action:hover { color: var(--green); }
.assistant-context { display: inline-flex; align-items: center; gap: 5px; max-width: min(220px, 100%); padding: 4px 7px; border: 1px solid var(--line); border-radius: 5px; color: var(--text-secondary); background: var(--surface); font-size: 11px; }
.assistant-context:hover { border-color: var(--control-border); background: var(--hover); }
.assistant-context span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-context svg { flex-shrink: 0; }
.assistant-selection { display: flex; align-items: center; gap: 7px; width: 100%; border-left: 2px solid var(--green); padding: 4px 0 4px 10px; color: var(--muted); font-size: 12px; }
.assistant-selection span { flex: 1; min-width: 0; max-height: 54px; overflow: auto; overflow-wrap: anywhere; }
.assistant-transcript { position: relative; flex: 1; min-height: 0; display: flex; }
.assistant-messages { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow: auto; overscroll-behavior: contain; padding: 12px 26px 18px; }
.assistant-empty { margin: auto; padding: 30px 12px; color: var(--muted); font-size: 13px; text-align: center; }
.assistant-welcome { flex-shrink: 0; margin-top: auto; padding: 30px 0 0; }
.assistant-welcome-mark { display: grid; place-items: center; width: 54px; height: 54px; margin-bottom: 18px; border: 1px solid var(--line); border-radius: 50%; background: var(--paper); box-shadow: 0 4px 12px rgb(0 0 0 / 6%); }
.assistant-welcome-mark img { width: 30px; height: 30px; }
.assistant-welcome h3 { margin: 0 0 17px; font-size: 19px; line-height: 1.5; font-weight: 600; }
.assistant-starters { display: grid; gap: 1px; }
.assistant-starters button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 38px; padding: 7px 8px; margin-left: -8px; border-radius: 6px; color: var(--text-secondary); text-align: left; font-size: 14px; }
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
.assistant-rules { display: block; margin-top: 9px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.assistant-proposal { margin-top: 14px; border: 1px solid var(--line); border-radius: 8px; padding: 12px; background: var(--surface); }
.assistant-proposal-heading { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 12px; }
.assistant-proposal-heading strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.assistant-proposal-heading small { color: var(--muted); }
.assistant-proposal > p { font-size: 12px; line-height: 1.6; margin: 8px 0; }
.assistant-proposal :deep(.change-diff) { max-height: 280px; overflow: auto; }
.assistant-proposal :deep(.diff-line) { font-size: 10px; }
.assistant-proposal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.assistant-proposal-actions button { min-height: 29px; font-size: 11px; padding: 5px 8px; }
.assistant-message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 11px; color: var(--muted); }
.assistant-message-actions .icon-button { width: 28px; height: 28px; border-radius: 8px; }
.assistant-message-actions small { max-width: 100%; margin-left: auto; font-size: 10px; overflow-wrap: anywhere; }
.assistant-jump-latest { position: absolute; bottom: 12px; left: 50%; transform: translateX(-50%); display: grid; place-items: center; width: 36px; height: 36px; border-radius: 50%; background: var(--text); color: var(--paper); box-shadow: 0 3px 10px rgb(0 0 0 / 12%); }
.assistant-jump-latest:hover { color: var(--paper); background: var(--text-secondary); }
.assistant-composer-area { position: relative; flex: 0 0 auto; min-width: 0; margin: 4px 18px 18px; }
.assistant-composer { padding: 12px 12px 9px; border: 1px solid var(--line); border-radius: 18px; background: var(--paper); box-shadow: 0 3px 10px rgb(0 0 0 / 4%); transition: border-color 120ms ease; }
.assistant-composer:focus-within { border-color: var(--control-border); }
.assistant-composer textarea { display: block; width: 100%; resize: none; min-height: 52px; max-height: 168px; border: 0; background: transparent; color: var(--text); padding: 0; font: inherit; font-size: 14px; line-height: 1.65; }
.assistant-composer textarea::placeholder { color: var(--muted); opacity: 0.65; }
.assistant-composer textarea:focus { outline: none; }
.assistant-compose-actions { display: flex; align-items: center; gap: 3px; min-height: 30px; margin-top: 7px; }
.assistant-compose-tool { flex: 0 0 28px; width: 28px; height: 28px; border-radius: 6px; color: var(--muted); }
.assistant-compose-permission { min-width: 0; max-width: 100px; padding: 6px 9px; border-radius: 6px; color: var(--text-secondary); font-size: 12px; white-space: nowrap; }
.assistant-compose-permission.assistant-granted { color: var(--green); }
.assistant-compose-permission:hover, .assistant-compose-permission[aria-expanded='true'], .assistant-compose-tool[aria-expanded='true'] { background: var(--surface); }
.assistant-compose-model { display: inline-flex; align-items: center; gap: 5px; min-width: 0; max-width: 52%; margin-left: auto; padding: 6px 7px; border-radius: 6px; color: var(--text-secondary); font-size: 12px; }
.assistant-compose-model span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-compose-model svg { flex-shrink: 0; }
.assistant-compose-model:hover, .assistant-compose-model[aria-expanded='true'] { background: var(--surface); }
.assistant-send, .assistant-stop { display: grid; place-items: center; flex: 0 0 30px; width: 30px; height: 30px; min-height: 30px; padding: 0; margin-left: 4px; border-radius: 50%; }
.assistant-send { background: var(--text); color: var(--paper); }
.assistant-send:hover:not(:disabled) { background: var(--text-secondary); }
.assistant-send:disabled { background: var(--surface); color: var(--control-border); opacity: 1; }
.assistant-progress { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; color: var(--muted); font-size: 11px; }
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
</style>
