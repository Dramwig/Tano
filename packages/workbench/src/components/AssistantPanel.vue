<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';
import { ArrowLeft, ArrowUp, Bot, Check, Copy, FilePlus2, FileText, History, LoaderCircle, Pencil, Plus, RefreshCw, Reply, Search, Settings2, Square, Trash2, Undo2, X } from 'lucide-vue-next';
import MarkdownEditor from '@tano/editor';
import type { AssistantConnection, AssistantMessage, AssistantProposal, AssistantSource } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';
import { useWorkspaceStore } from '../stores/workspace';
import ChangeDiff from './ChangeDiff.vue';

const assistant = useAssistantStore();
const workspace = useWorkspaceStore();
const section = ref<'conversation' | 'settings' | 'history' | 'sources'>('conversation');
const query = ref('');
const textarea = ref<HTMLTextAreaElement>();
const messages = ref<HTMLElement>();
const notice = ref('');
const configError = ref('');
const savingConfig = ref(false);
const secret = ref('');
const settings = ref<Omit<AssistantConnection, 'hasKey'>>({ id: crypto.randomUUID(), name: '', kind: 'api', cliPath: '', endpoint: 'https://api.openai.com/v1', protocol: 'responses', tools: true, maxOutputTokens: 4096 });
const manualModel = ref(false), manualModelId = ref('');
const deleting = ref<string>();
const exportMessage = ref<AssistantMessage>();
const exportPath = ref('助手结果.md');
const visibleMessages = ref(30);
const sourceFiles = computed(() => workspace.workspace?.files.filter(file => file.kind === 'file' && /\.(?:md|markdown)$/i.test(file.path) &&
  !file.path.startsWith('.tano/') && file.path.toLocaleLowerCase().includes(query.value.toLocaleLowerCase())).slice(0, 100) ?? []);
const displayed = computed(() => assistant.session?.messages.slice(-visibleMessages.value) ?? []);
const statusLabels = { ready: '待审阅', applying: '正在保存', applied: '已应用', rejected: '已放弃', conflicted: '存在冲突', unknown: '结果待核对' };
function editConnection(connection?: AssistantConnection) {
  settings.value = connection ? { id: connection.id, name: connection.name, endpoint: connection.endpoint,
    kind: connection.kind ?? 'api', cliPath: connection.cliPath ?? '',
    protocol: connection.protocol ?? 'chat-completions', tools: connection.tools, maxOutputTokens: connection.maxOutputTokens }
    : { id: crypto.randomUUID(), name: '', kind: 'api', cliPath: '', endpoint: 'https://api.openai.com/v1', protocol: 'responses', tools: true, maxOutputTokens: 4096 };
  secret.value = ''; configError.value = ''; section.value = 'settings';
}
async function saveConnection() {
  savingConfig.value = true; configError.value = '';
  try {
    const cli = settings.value.kind !== 'api';
    await assistant.saveConnection({ ...settings.value, endpoint: cli ? '' : settings.value.endpoint }, cli ? undefined : secret.value);
    secret.value = ''; notice.value = '模型连接已保存'; section.value = 'conversation';
  } catch (error) { configError.value = String(error); }
  finally { savingConfig.value = false; }
}
async function removeConnection(id: string) {
  try { await assistant.removeConnection(id); editConnection(); }
  catch (error) { configError.value = String(error); }
}
async function changeConnection(event: Event) {
  try { await assistant.selectConnection((event.target as HTMLSelectElement).value); }
  catch (error) { assistant.error = String(error); }
}
async function changeModel(id: string) {
  try { await assistant.selectModel(id); manualModel.value = false; }
  catch (error) { assistant.error = String(error); }
}
function inputModel() {
  manualModelId.value = assistant.modelId; manualModel.value = true;
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
    await workspace.openFileInNewTab({ ...file, path: snapshot.path });
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
watch(() => assistant.opened, open => { if (open) void nextTick(() => textarea.value?.focus()); });
watch(() => [assistant.session?.id, assistant.connectionId], () => { manualModel.value = false; });
watch(() => assistant.session?.messages.map(message => message.content.length).join(','), () => {
  const element = messages.value;
  if (element && element.scrollHeight - element.scrollTop - element.clientHeight < 160)
    void nextTick(() => { element.scrollTop = element.scrollHeight; });
});
</script>

<template>
  <aside class="assistant-panel" aria-label="Tano 助手">
    <header class="assistant-heading">
      <button v-if="section !== 'conversation'" class="icon-button" aria-label="返回助手对话" title="返回对话" @click="section = 'conversation'; secret = ''"><ArrowLeft :size="17" /></button>
      <Bot v-else :size="19" />
      <h2>{{ section === 'settings' ? '模型连接' : section === 'history' ? '会话记录' : section === 'sources' ? '参考文档' : '助手' }}</h2>
      <template v-if="section === 'conversation'">
        <button class="icon-button" title="新建会话" aria-label="新建助手会话" :disabled="assistant.busy || assistant.applying" @click="assistant.newSession()"><Plus :size="17" /></button>
        <button class="icon-button" title="会话记录" aria-label="助手会话记录" @click="section = 'history'; assistant.loadExternal()"><History :size="17" /></button>
        <button v-if="!assistant.demo" class="icon-button" title="模型连接" aria-label="配置模型连接" @click="editConnection(assistant.connection)"><Settings2 :size="17" /></button>
      </template>
      <button class="icon-button" title="关闭助手" aria-label="关闭助手侧栏" @click="assistant.opened = false; secret = ''"><X :size="17" /></button>
    </header>
    <div v-if="assistant.demo" class="assistant-demo-label">浏览器演示 · 模型响应为模拟数据</div>
    <p v-if="notice" class="assistant-notice" role="status">{{ notice }}</p>
    <p v-if="assistant.error" class="assistant-error" role="alert">{{ assistant.error }}</p>

    <template v-if="section === 'settings'">
      <div class="assistant-settings">
        <div class="assistant-connection-list">
          <div v-for="connection in assistant.connections" :key="connection.id">
            <button @click="editConnection(connection)">{{ connection.name }}<small>{{ connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : connection.endpoint }}</small></button>
            <button class="icon-button" :disabled="assistant.busy" :aria-label="`删除连接 ${connection.name}`" title="删除模型连接" @click="removeConnection(connection.id)"><Trash2 :size="15" /></button>
          </div>
          <button class="assistant-text-action" @click="editConnection()"><Plus :size="15" />添加连接</button>
        </div>
        <form @submit.prevent="saveConnection">
          <label>连接名称<input v-model="settings.name" required maxlength="120" autocomplete="off" /></label>
          <label>连接方式<select v-model="settings.kind" @change="secret = ''"><option value="api">API</option><option value="codex-cli">Codex CLI</option><option value="claude-cli">Claude CLI</option></select></label>
          <template v-if="settings.kind === 'api'">
            <label>API 服务地址<input v-model="settings.endpoint" required type="url" maxlength="2000" autocomplete="off" /></label>
            <label>接口协议<select v-model="settings.protocol"><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label>
            <label>API 密钥<input v-model="secret" type="password" maxlength="2000" autocomplete="new-password" :placeholder="assistant.connections.some(connection => connection.id === settings.id && connection.hasKey) ? '已保存；留空保留当前密钥' : ''" /></label>
          </template>
          <label v-else>CLI 可执行文件路径<input v-model="settings.cliPath" maxlength="2000" autocomplete="off" placeholder="留空自动查找" /></label>
          <label class="assistant-checkbox"><input v-model="settings.tools" type="checkbox" />工具调用与修改建议</label>
          <label v-if="settings.kind === 'api'">最大输出 token<input v-model.number="settings.maxOutputTokens" type="number" min="256" max="32768" required /></label>
          <p v-if="configError" class="form-error" role="alert">{{ configError }}</p>
          <button class="primary-button" :disabled="savingConfig || assistant.busy"><LoaderCircle v-if="savingConfig" :size="15" class="spinning" /><Check v-else :size="15" />保存连接</button>
        </form>
      </div>
    </template>

    <div v-else-if="section === 'history'" class="assistant-history">
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

    <template v-else-if="section === 'sources'">
      <label class="assistant-source-search"><Search :size="16" /><input v-model="query" aria-label="搜索参考文档" placeholder="搜索文档路径" /></label>
      <div class="assistant-source-picker">
        <label v-for="file in sourceFiles" :key="file.id"><input type="checkbox" :checked="assistant.files.includes(file.id)" :disabled="assistant.busy" @change="toggleSource(file.id)" /><FileText :size="15" /><span>{{ file.path }}</span></label>
      </div>
    </template>

    <template v-else>
      <div class="assistant-model-row">
        <select v-if="assistant.connections.length" :value="assistant.connectionId" aria-label="助手模型连接" :disabled="assistant.busy || assistant.applying || assistant.loading" @change="changeConnection">
          <option value="" disabled>选择连接</option>
          <option v-if="assistant.connectionId && !assistant.connection" :value="assistant.connectionId">连接已移除</option>
          <option v-for="connection in assistant.connections" :key="connection.id" :value="connection.id">{{ connection.name }}</option>
        </select>
        <button v-else class="assistant-text-action" @click="editConnection()"><Plus :size="15" />配置模型连接</button>
        <template v-if="assistant.connection">
          <form v-if="manualModel" class="assistant-model-picker" @submit.prevent="changeModel(manualModelId)">
            <input v-model="manualModelId" aria-label="当前对话的模型 ID" placeholder="模型 ID" maxlength="200" autocomplete="off" :disabled="assistant.busy || assistant.applying" />
            <button class="icon-button" aria-label="确认对话模型" title="确认模型" :disabled="!manualModelId.trim() || assistant.busy || assistant.applying"><Check :size="16" /></button>
            <button class="icon-button" type="button" aria-label="取消指定模型" title="取消" @click="manualModel = false"><X :size="16" /></button>
          </form>
          <div v-else class="assistant-model-picker">
            <select :value="assistant.modelId" aria-label="当前对话模型" :disabled="assistant.modelsLoading || assistant.busy || assistant.applying || assistant.loading" @change="changeModel(($event.target as HTMLSelectElement).value)">
              <option value="" disabled>{{ assistant.modelsLoading ? '正在读取模型…' : '选择模型' }}</option>
              <option v-if="assistant.modelId && !assistant.models.includes(assistant.modelId)" :value="assistant.modelId">{{ assistant.modelId }}（未列出）</option>
              <option v-for="model in assistant.models" :key="model" :value="model">{{ model === 'cli-default' ? 'CLI 默认模型' : model }}</option>
            </select>
            <button class="icon-button" aria-label="刷新模型列表" title="刷新模型列表" :disabled="assistant.modelsLoading || assistant.busy || assistant.applying" @click="assistant.reloadModels()"><LoaderCircle v-if="assistant.modelsLoading" :size="16" class="spinning" /><RefreshCw v-else :size="16" /></button>
            <button class="icon-button" aria-label="手动指定对话模型" title="手动指定模型" :disabled="assistant.busy || assistant.applying || assistant.loading" @click="inputModel"><Pencil :size="16" /></button>
          </div>
          <p v-if="assistant.modelsError" class="assistant-model-error" role="alert">{{ assistant.modelsError }}</p>
        </template>
      </div>
      <div class="assistant-contexts">
        <label class="assistant-search-grant"><input v-model="assistant.allowSearch" type="checkbox" :disabled="assistant.busy" />允许检索当前工作区</label>
        <label v-if="workspace.capabilities.features.objectReferences" class="assistant-search-grant"><input v-model="assistant.allowStructures" type="checkbox" :disabled="assistant.busy" />允许读取工作区对象、建议事件与关系</label>
        <button class="assistant-text-action" :disabled="assistant.busy" @click="section = 'sources'"><FilePlus2 :size="15" />参考文档 <span>{{ assistant.files.length }}</span></button>
        <button v-for="id in assistant.files" :key="id" class="assistant-context" :disabled="assistant.busy" :title="`移除参考：${workspace.workspace?.files.find(file => file.id === id)?.path ?? id}`" @click="toggleSource(id)"><FileText :size="13" /><span>{{ workspace.workspace?.files.find(file => file.id === id)?.name ?? '已移除文档' }}</span><X :size="12" /></button>
        <div v-if="assistant.selection" class="assistant-selection"><span>{{ assistant.selection.text }}</span><button class="icon-button" aria-label="清除助手选区" title="清除选区" :disabled="assistant.busy" @click="assistant.selection = null"><X :size="13" /></button></div>
      </div>
      <div ref="messages" class="assistant-messages" role="log" aria-label="助手对话">
        <p v-if="assistant.loading" class="assistant-empty"><LoaderCircle :size="16" class="spinning" />正在读取会话</p>
        <p v-else-if="!assistant.session?.messages.length" class="assistant-empty">{{ assistant.connection ? (assistant.modelId ? '新会话' : '尚未选择模型') : '尚未配置模型连接' }}</p>
        <button v-if="(assistant.session?.messages.length ?? 0) > visibleMessages" class="assistant-text-action" @click="visibleMessages += 30">查看较早消息</button>
        <article v-for="message in displayed" :key="message.id" class="assistant-message" :class="`assistant-message-${message.role}`">
          <div class="assistant-message-heading"><strong>{{ message.role === 'user' ? '你' : '助手' }}</strong><small>{{ message.model ?? '' }}</small></div>
          <div v-if="message.role === 'user' || message.state === 'running'" class="assistant-message-text">{{ message.content }}</div>
          <div v-else-if="message.content" class="assistant-answer"><MarkdownEditor :model-value="answerMarkdown(message)" :document-id="`assistant-${message.id}`" readonly :reveal-markdown="false" open-links-on-tap :resolve-image="() => null" @open-link="sourceLink(message, $event)" @error="notice = $event" /></div>
          <p v-if="message.error || message.state === 'interrupted'" class="assistant-message-error">{{ message.error ?? '上次运行已中断；不会自动恢复执行' }}</p>
          <div v-if="message.sources?.length" class="assistant-citations"><button v-for="source in message.sources" :key="source.id" :title="source.path" @click="openSource(source)"><FileText :size="12" />{{ source.id }} · {{ source.path }}</button></div>
          <small v-if="message.rules?.length" class="assistant-rules">工作区约定：{{ message.rules.join('、') }}</small>
          <section v-for="proposal in message.proposals" :key="proposal.id" class="assistant-proposal" :aria-label="`修改建议 ${proposal.path}`">
            <div class="assistant-proposal-heading"><strong>{{ proposal.kind === 'object' ? '工作区事件' : proposal.kind === 'relation' ? '新增关系' : proposal.kind === 'create' ? '新建' : '修改' }} · {{ proposal.preview?.path ?? proposal.path }}</strong><small>{{ statusLabels[proposal.status] }}</small></div>
            <p>{{ proposal.reason }}</p>
            <p v-if="proposal.error" class="assistant-message-error">{{ proposal.error }}</p>
            <ChangeDiff v-if="proposal.preview" :before="proposal.preview.before" :after="proposal.preview.after" />
            <div class="assistant-proposal-actions">
              <template v-if="['ready', 'conflicted'].includes(proposal.status)">
                <button class="secondary-button" :disabled="assistant.busy || assistant.applying" @click="assistant.review(proposal)"><Search :size="14" />查看差异</button>
                <button v-if="proposal.preview && proposal.status === 'ready'" class="primary-button" :disabled="assistant.busy || assistant.applying" @click="assistant.review(proposal, true)"><Check :size="14" />应用修改</button>
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
      <form v-if="exportMessage" class="assistant-export" @submit.prevent="exportAnswer"><label>文档路径<input v-model="exportPath" required maxlength="220" /></label><button class="secondary-button" type="button" @click="exportMessage = undefined">取消</button><button class="primary-button"><FilePlus2 :size="14" />生成保存建议</button></form>
      <form class="assistant-composer" @submit.prevent="assistant.send()">
        <div v-if="assistant.busy || assistant.applying" class="assistant-progress" role="status"><LoaderCircle :size="14" class="spinning" />{{ assistant.applying ? '正在处理修改' : assistant.progress }}</div>
        <textarea ref="textarea" v-model="assistant.prompt" rows="3" maxlength="20000" aria-label="给助手的任务" placeholder="与助手讨论这份笔记…" @keydown="sendKey" />
        <div class="assistant-compose-actions"><span>{{ assistant.modelId === 'cli-default' ? 'CLI 默认模型' : assistant.modelId }}</span><button v-if="assistant.busy" type="button" class="icon-button" aria-label="停止助手生成" title="停止生成" @click="assistant.stop()"><Square :size="16" /></button><button v-else class="primary-button assistant-send" aria-label="发送给助手" title="发送" :disabled="!assistant.prompt.trim() || !assistant.connection || !assistant.modelId || assistant.loading || assistant.applying"><ArrowUp :size="18" /></button></div>
      </form>
    </template>
  </aside>
</template>

<style scoped>
.assistant-panel { flex: 0 0 380px; width: 380px; min-width: 0; min-height: 0; display: flex; flex-direction: column; border-left: 1px solid var(--line); background: var(--paper); color: var(--text); padding-top: var(--desktop-titlebar-height, 0px); }
.assistant-heading { display: flex; align-items: center; gap: 7px; min-height: 48px; padding: 8px 12px; border-bottom: 1px solid var(--line); }
.assistant-heading h2 { flex: 1; font-size: 15px; margin: 0; }
.assistant-heading .icon-button { flex: 0 0 28px; width: 28px; height: 28px; }
.assistant-demo-label { padding: 6px 14px; color: var(--warning); background: var(--warning-bg); font-size: 11px; }
.assistant-error, .assistant-notice { margin: 0; padding: 8px 14px; font-size: 12px; overflow-wrap: anywhere; }
.assistant-error { color: var(--danger); background: var(--danger-bg); }
.assistant-notice { color: var(--text-secondary); background: var(--surface); }
.assistant-model-row { display: flex; flex-direction: column; gap: 6px; padding: 10px 14px 4px; }
.assistant-model-row select { width: 100%; min-width: 0; padding: 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--text); background: var(--paper); font-size: 12px; }
.assistant-model-picker { display: flex; align-items: center; gap: 5px; min-height: 32px; }
.assistant-model-picker select, .assistant-model-picker input { flex: 1; min-width: 0; }
.assistant-model-picker input { padding: 6px; border: 1px solid var(--line); border-radius: 4px; color: var(--text); background: var(--paper); font: inherit; font-size: 12px; }
.assistant-model-picker .icon-button { flex: 0 0 28px; width: 28px; height: 28px; }
.assistant-model-error { margin: 0; color: var(--danger); font-size: 11px; overflow-wrap: anywhere; }
.assistant-contexts { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; padding: 6px 14px 10px; border-bottom: 1px solid var(--line); }
.assistant-search-grant { width: 100%; display: flex; align-items: center; gap: 5px; font-size: 11px; color: var(--text-secondary); }
.assistant-text-action { display: inline-flex; align-items: center; gap: 5px; border: 0; padding: 4px 0; color: var(--text-secondary); background: transparent; font-size: 12px; }
.assistant-context { display: inline-flex; align-items: center; gap: 4px; max-width: 180px; padding: 3px 5px; border: 0; border-bottom: 1px solid var(--line); color: var(--text-secondary); background: transparent; font-size: 11px; }
.assistant-context span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.assistant-selection { display: flex; align-items: center; gap: 5px; width: 100%; border-left: 2px solid var(--green); padding-left: 8px; color: var(--muted); font-size: 12px; }
.assistant-selection span { flex: 1; min-width: 0; max-height: 54px; overflow: auto; overflow-wrap: anywhere; }
.assistant-messages { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; padding: 0 14px 16px; }
.assistant-empty { margin: 28px 0; color: var(--muted); font-size: 13px; text-align: center; }
.assistant-message { padding: 17px 0 12px; border-bottom: 1px solid var(--line); }
.assistant-message-heading { display: flex; align-items: center; gap: 8px; margin-bottom: 7px; font-size: 12px; }
.assistant-message-heading small { overflow-wrap: anywhere; color: var(--muted); }
.assistant-message-text { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13px; line-height: 1.75; }
.assistant-message-user { color: var(--text-secondary); }
.assistant-answer { font-size: 13px; line-height: 1.7; overflow-wrap: anywhere; }
.assistant-answer :deep(.ProseMirror) { padding: 0; min-height: 0; font-size: 13px; }
.assistant-answer :deep(.frontmatter-panel) { display: none; }
.assistant-answer :deep(h1), .assistant-answer :deep(h2), .assistant-answer :deep(h3) { font-size: 16px; line-height: 1.5; margin: 12px 0 6px; }
.assistant-answer :deep(pre) { max-width: 100%; overflow: auto; font-size: 11px; }
.assistant-answer :deep(p) { margin: 6px 0; }
.assistant-message-error { font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; color: var(--danger); }
.assistant-citations { display: flex; gap: 5px; flex-wrap: wrap; margin-top: 8px; }
.assistant-citations button { display: inline-flex; align-items: center; gap: 3px; max-width: 100%; padding: 3px 0; background: transparent; border: 0; color: var(--green); font-size: 11px; text-align: left; overflow-wrap: anywhere; }
.assistant-citations svg { flex-shrink: 0; }
.assistant-rules { display: block; margin-top: 8px; color: var(--muted); font-size: 11px; overflow-wrap: anywhere; }
.assistant-proposal { margin-top: 12px; border-top: 1px solid var(--line); padding-top: 10px; }
.assistant-proposal-heading { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: baseline; font-size: 12px; }
.assistant-proposal-heading strong { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.assistant-proposal-heading small { color: var(--muted); }
.assistant-proposal > p { font-size: 12px; line-height: 1.6; margin: 8px 0; }
.assistant-proposal :deep(.change-diff) { max-height: 280px; overflow: auto; }
.assistant-proposal :deep(.diff-line) { font-size: 10px; }
.assistant-proposal-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 8px; }
.assistant-proposal-actions button { min-height: 29px; font-size: 11px; padding: 5px 8px; }
.assistant-message-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; color: var(--muted); }
.assistant-message-actions .icon-button { width: 27px; height: 27px; }
.assistant-message-actions small { max-width: 100%; margin-left: auto; font-size: 10px; overflow-wrap: anywhere; }
.assistant-composer { border-top: 1px solid var(--line); padding: 12px 14px; }
.assistant-composer textarea { width: 100%; resize: vertical; min-height: 70px; max-height: 180px; border: 1px solid var(--control-border); border-radius: 5px; background: var(--paper); color: var(--text); padding: 9px; font: inherit; font-size: 13px; line-height: 1.6; }
.assistant-compose-actions { display: flex; align-items: center; gap: 8px; justify-content: space-between; margin-top: 6px; }
.assistant-compose-actions span { min-width: 0; overflow-wrap: anywhere; color: var(--muted); font-size: 10px; }
.assistant-send { flex: 0 0 32px; width: 32px; height: 32px; padding: 5px; }
.assistant-progress { display: flex; align-items: center; gap: 5px; margin-bottom: 6px; color: var(--muted); font-size: 11px; }
.assistant-settings, .assistant-history { flex: 1; overflow: auto; padding: 14px; }
.assistant-settings form { display: grid; gap: 14px; padding-top: 14px; }
.assistant-settings label, .assistant-export label { display: grid; gap: 6px; font-size: 12px; }
.assistant-settings input:not([type=checkbox]), .assistant-settings select, .assistant-export input { width: 100%; min-width: 0; padding: 8px; border: 1px solid var(--control-border); border-radius: 4px; background: var(--paper); color: var(--text); font: inherit; }
.assistant-settings .assistant-checkbox { display: flex; align-items: center; gap: 6px; }
.assistant-connection-list > div, .assistant-history-row { display: flex; gap: 6px; align-items: center; border-bottom: 1px solid var(--line); }
.assistant-connection-list > div > button:first-child, .assistant-history-row > button:first-child { flex: 1; min-width: 0; padding: 10px 0; display: grid; gap: 4px; color: var(--text); border: 0; background: transparent; text-align: left; overflow-wrap: anywhere; }
.assistant-connection-list small, .assistant-history-row small { font-size: 11px; color: var(--muted); }
.assistant-history-row strong { font-size: 13px; font-weight: 500; }
.assistant-source-search { display: flex; align-items: center; gap: 8px; margin: 12px 14px; padding: 7px; border: 1px solid var(--control-border); border-radius: 4px; }
.assistant-source-search input { min-width: 0; width: 100%; border: 0; background: transparent; color: var(--text); outline: none; }
.assistant-source-picker { flex: 1; overflow: auto; padding: 0 14px; }
.assistant-source-picker label { display: flex; align-items: flex-start; gap: 7px; padding: 9px 0; font-size: 12px; border-bottom: 1px solid var(--line); }
.assistant-source-picker label span { min-width: 0; overflow-wrap: anywhere; }
.assistant-source-picker svg, .assistant-source-picker input { flex-shrink: 0; }
.assistant-delete-confirm, .assistant-export { border-top: 1px solid var(--line); padding: 14px; font-size: 12px; }
.assistant-export { display: flex; flex-wrap: wrap; gap: 8px; }
.assistant-export label { flex-basis: 100%; }
@media (max-width: 1100px) { .assistant-panel { flex-basis: 340px; width: 340px; } }
@media (max-width: 700px) { .assistant-panel { position: absolute; inset: 0; z-index: 45; width: 100%; border-left: 0; padding-top: 0; } }
</style>
