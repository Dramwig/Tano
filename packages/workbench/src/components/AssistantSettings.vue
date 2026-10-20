<script setup lang="ts">
import { t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Bot, Check, Eye, EyeOff, LoaderCircle, MoreHorizontal, Pencil, Plus, Trash2, Wifi, X } from 'lucide-vue-next';
import type { AssistantConnection } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';

const assistant = useAssistantStore();
const emit = defineEmits<{ changed: [] }>();
const saving = ref(false);
const error = ref('');
const notice = ref('');
const secret = ref('');
const secretVisible = ref(false);
const secretEditing = ref(false);
const editor = ref<HTMLDialogElement>();
const deletionDialog = ref<HTMLDialogElement>();
const cancelDeletionButton = ref<HTMLButtonElement>();
const pendingDeletion = ref<Pick<AssistantConnection, 'id' | 'name'> | null>(null);
const removing = ref(false);
const nameInput = ref<HTMLInputElement>();
const addButton = ref<HTMLButtonElement>();
const menuConnectionId = ref('');
const menu = ref<HTMLElement>();
const menuPosition = ref({ left: '0px', top: '0px' });
const testingId = ref('');
let menuTrigger: HTMLButtonElement | undefined;
let checkController: AbortController | undefined;
let previousFocus: HTMLElement | null = null;
let deletionTrigger: HTMLButtonElement | undefined;
type ConnectionDraft = Omit<AssistantConnection, 'hasKey'>;

function blankConnection(): ConnectionDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: 'api',
    cliPath: '',
    endpoint: 'https://api.openai.com/v1',
    protocol: 'responses',
    autoAdapt: true,
    tools: true,
    maxOutputTokens: 4096,
  };
}

const draft = ref<ConnectionDraft | null>(null);

const editing = computed(() => draft.value !== null);
const hasSavedSecret = computed(() => assistant.connections.some(connection => connection.id === draft.value?.id && connection.hasKey));
const secretToggleLabel = computed(() => secretVisible.value ? t('隐藏 API 密钥') : t('显示 API 密钥'));
const menuConnection = computed(() => assistant.connections.find(connection => connection.id === menuConnectionId.value));

function closeMenu(restoreFocus = false) {
  menuConnectionId.value = '';
  if (restoreFocus && menuTrigger?.isConnected) menuTrigger.focus({ preventScroll: true });
  menuTrigger = undefined;
}

async function toggleMenu(connection: AssistantConnection, event: Event) {
  if (menuConnectionId.value === connection.id) { closeMenu(true); return; }
  closeMenu();
  menuTrigger = event.currentTarget as HTMLButtonElement;
  menuConnectionId.value = connection.id;
  await nextTick();
  if (!menu.value || !menuTrigger) return;
  const bounds = menuTrigger.getBoundingClientRect();
  const width = menu.value.offsetWidth, height = menu.value.offsetHeight;
  menuPosition.value = {
    left: `${Math.max(8, Math.min(bounds.right - width, window.innerWidth - width - 8))}px`,
    top: `${Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - height - 8))}px`,
  };
  menu.value.focus({ preventScroll: true });
  if (event instanceof KeyboardEvent && event.key === 'ArrowDown') menuKey(event);
}

function dismissMenu(event: Event) {
  if (!(event.target instanceof Node) || (!menu.value?.contains(event.target) && !menuTrigger?.contains(event.target))) closeMenu();
}

function menuKey(event: KeyboardEvent) {
  if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); }
  else if (event.key === 'Tab') closeMenu(true);
  else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const buttons = [...(menu.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1)
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
}

async function checkConnection(connection: AssistantConnection) {
  if (testingId.value || saving.value) return;
  closeMenu(true);
  const controller = new AbortController();
  checkController = controller;
  testingId.value = connection.id;
  error.value = '';
  notice.value = t('正在检测「{0}」…', [connection.name]);
  try {
    const count = await assistant.checkConnection(connection.id, controller.signal);
    if (controller.signal.aborted) return;
    notice.value = connection.managed ? t('平台已开放 {0} 个模型，可在助手中选择使用。', [count]) : connection.kind && connection.kind !== 'api'
      ? t('「{0}」的 CLI 可执行文件可用；登录状态与模型连通需在会话中确认。', [connection.name])
      : t('「{0}」连接成功，已读取 {1} 个模型。检测范围为模型列表接口，模型调用权限需在会话中确认。', [connection.name, count]);
  } catch (cause) {
    if (controller.signal.aborted) return;
    notice.value = '';
    error.value = t('「{0}」检测失败：{1}', [connection.name, cause instanceof Error ? cause.message : String(cause)]);
  } finally {
    if (checkController === controller) { testingId.value = ''; checkController = undefined; }
  }
}

function resetSecret() {
  secret.value = '';
  secretVisible.value = false;
  secretEditing.value = false;
}

watch(secret, value => { if (!value) secretVisible.value = false; });

watch(editing, open => {
  if (!open) return;
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  editor.value?.showModal();
  nameInput.value?.focus();
}, { flush: 'post' });

watch(pendingDeletion, connection => {
  if (!connection) return;
  deletionDialog.value?.showModal();
  cancelDeletionButton.value?.focus();
}, { flush: 'post' });

function editConnection(connection: AssistantConnection) {
  if (connection.managed || testingId.value === connection.id) return;
  closeMenu(true);
  draft.value = {
    id: connection.id,
    name: connection.name,
    endpoint: connection.endpoint,
    kind: connection.kind ?? 'api',
    cliPath: connection.cliPath ?? '',
    reasoningEffort: connection.reasoningEffort,
    protocol: connection.protocol ?? 'chat-completions',
    autoAdapt: connection.autoAdapt ?? true,
    tools: connection.tools,
    maxOutputTokens: connection.maxOutputTokens,
  };
  resetSecret();
  error.value = '';
  notice.value = '';
}

function addConnection() {
  closeMenu();
  draft.value = blankConnection();
  resetSecret();
  error.value = '';
  notice.value = '';
}

function closeEditor() {
  if (saving.value) return;
  editor.value?.close();
  draft.value = null;
  resetSecret();
  error.value = '';
  notice.value = '';
  const target = previousFocus;
  previousFocus = null;
  void nextTick(() => (target?.isConnected ? target : addButton.value)?.focus());
}

async function saveConnection() {
  if (!draft.value || saving.value || assistant.busy || assistant.loading) return;
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const cli = draft.value.kind !== 'api';
    await assistant.saveConnection(
      { ...draft.value, endpoint: cli ? '' : draft.value.endpoint,
        reasoningEffort: draft.value.kind === 'codex-cli' ? draft.value.reasoningEffort : undefined },
      cli ? undefined : secret.value,
    );
    saving.value = false;
    closeEditor();
    notice.value = t('模型连接已保存');
    emit('changed');
  } catch (cause) {
    error.value = String(cause);
  } finally {
    saving.value = false;
  }
}

function confirmRemoval(connection: AssistantConnection, event: Event) {
  if (connection.managed || saving.value || removing.value || assistant.busy || assistant.loading || testingId.value === connection.id) return;
  closeMenu();
  error.value = '';
  notice.value = '';
  deletionTrigger = event.currentTarget as HTMLButtonElement;
  pendingDeletion.value = { id: connection.id, name: connection.name };
}

function closeDeletion() {
  if (removing.value) return;
  deletionDialog.value?.close();
  pendingDeletion.value = null;
  error.value = '';
  const target = deletionTrigger;
  deletionTrigger = undefined;
  void nextTick(() => (target?.isConnected ? target : addButton.value)?.focus());
}

async function removeConnection() {
  const connection = pendingDeletion.value;
  if (!connection || saving.value || removing.value || assistant.busy || assistant.loading || testingId.value === connection.id) return;
  removing.value = true;
  error.value = '';
  try {
    await assistant.removeConnection(connection.id);
    removing.value = false;
    closeDeletion();
    emit('changed');
  } catch (cause) {
    error.value = String(cause);
  } finally {
    removing.value = false;
  }
}

onMounted(() => {
  document.addEventListener('pointerdown', dismissMenu, true);
  document.addEventListener('focusin', dismissMenu);
  window.addEventListener('scroll', dismissMenu, true);
  window.addEventListener('resize', dismissMenu);
  void assistant.reloadConnections().catch(cause => {
    error.value = String(cause);
  });
});
onBeforeUnmount(() => {
  editor.value?.close();
  deletionDialog.value?.close();
  checkController?.abort();
  document.removeEventListener('pointerdown', dismissMenu, true);
  document.removeEventListener('focusin', dismissMenu);
  window.removeEventListener('scroll', dismissMenu, true);
  window.removeEventListener('resize', dismissMenu);
});
</script>

<template>
  <div class="settings-content assistant-settings-page">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('助手设置') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="t('个人偏好 · 当前设备')">
        <Bot :size="13" /><span>{{ t('个人偏好 · 当前设备') }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('查看可用模型连接。个人连接仅对你生效，平台提供的连接由管理员维护。') }}</p>

    <template v-if="!assistant.available">
      <p class="settings-notice" role="status">{{ t('当前运行环境未提供助手连接配置。') }}</p>
    </template>
    <template v-else-if="assistant.demo">
      <p class="settings-notice" role="status">{{ t('浏览器演示使用模拟连接，暂不支持修改模型连接。') }}</p>
    </template>
    <template v-else>
      <section class="settings-section" data-settings-key="assistant-connections" aria-labelledby="assistant-connections-title">
        <div class="assistant-connections-heading">
          <h3 id="assistant-connections-title">{{ t('模型连接') }}</h3>
          <button v-if="assistant.canConfigure !== false" ref="addButton" type="button" class="assistant-add-connection" aria-haspopup="dialog" @click="addConnection"><Plus :size="15" />{{ t('添加连接') }}</button>
        </div>
        <div class="settings-card assistant-settings-card">
          <div class="assistant-connection-list">
            <div v-for="connection in assistant.connections" :key="connection.id">
              <button type="button" aria-haspopup="dialog" :disabled="connection.managed || testingId === connection.id" @click="editConnection(connection)">
                <strong>{{ connection.name }}</strong>
                <small>{{ connection.managed ? t('平台提供，登录后即可使用') : connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : connection.endpoint }}</small>
              </button>
              <button
                type="button"
                class="icon-button"
                :disabled="saving || assistant.busy || assistant.loading || testingId === connection.id"
                v-if="!connection.managed"
                :aria-label="t('删除连接 {0}', [connection.name])"
                :data-tooltip="t('删除模型连接')"
                aria-haspopup="dialog"
                @click="confirmRemoval(connection, $event)"
              ><Trash2 :size="15" /></button>
              <button
                type="button"
                class="icon-button assistant-connection-more"
                :aria-label="t('更多操作 {0}', [connection.name])"
                :data-tooltip="t('更多操作')"
                aria-haspopup="menu"
                :aria-expanded="menuConnectionId === connection.id"
                :aria-controls="menuConnectionId === connection.id ? 'assistant-connection-actions' : undefined"
                @click="toggleMenu(connection, $event)"
                @keydown.down.prevent="toggleMenu(connection, $event)"
              ><LoaderCircle v-if="testingId === connection.id" :size="15" class="spinning" /><MoreHorizontal v-else :size="17" /></button>
            </div>
            <p v-if="!assistant.connections.length" class="assistant-settings-empty">{{ assistant.canConfigure !== false ? t('还没有模型连接，请先添加一个连接。') : t('平台暂未开放模型，请稍后刷新。') }}</p>
          </div>
        </div>
        <p v-if="!editing && !pendingDeletion && error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="!editing && notice" class="settings-notice" role="status">{{ notice }}</p>
      </section>
    </template>
  </div>

  <Teleport to="body">
    <dialog v-if="pendingDeletion" ref="deletionDialog" class="assistant-connection-dialog assistant-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="assistant-delete-title" aria-describedby="assistant-delete-description" @cancel.prevent="closeDeletion" @keydown.stop>
      <form class="assistant-connection-form" :aria-busy="removing" @submit.prevent="removeConnection">
        <header class="assistant-form-heading"><h2 id="assistant-delete-title">{{ t('删除模型连接') }}</h2></header>
        <div class="assistant-form-scroll">
          <p id="assistant-delete-description">{{ t('确定删除「{0}」吗？删除后如需使用，需要重新添加。', [pendingDeletion.name]) }}</p>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <footer class="assistant-form-actions">
          <button ref="cancelDeletionButton" type="button" class="secondary-button" :disabled="removing" @click="closeDeletion">{{ t('取消') }}</button>
          <button type="submit" class="secondary-button assistant-delete-button" :disabled="removing || assistant.busy || assistant.loading"><LoaderCircle v-if="removing" :size="15" class="spinning" />{{ removing ? t('删除中…') : t('确认删除') }}</button>
        </footer>
      </form>
    </dialog>
    <div v-if="menuConnection" id="assistant-connection-actions" ref="menu" class="dropdown compact-action-menu assistant-connection-menu" role="menu" tabindex="-1" :aria-label="t('{0} 操作', [menuConnection.name])" :style="menuPosition" @keydown.stop="menuKey">
      <button type="button" role="menuitem" :disabled="!!testingId || saving" @click="checkConnection(menuConnection)"><Wifi :size="15" />{{ testingId === menuConnection.id ? t('正在检测…') : menuConnection.managed ? t('刷新模型名单') : t('检测连通') }}</button>
      <button v-if="!menuConnection.managed" type="button" role="menuitem" :disabled="saving || assistant.busy || assistant.loading || testingId === menuConnection.id" @click="editConnection(menuConnection)"><Pencil :size="15" />{{ t('编辑连接') }}</button>
    </div>
    <dialog v-if="draft" ref="editor" class="assistant-connection-dialog" aria-labelledby="assistant-connection-editor-title" @cancel.prevent="closeEditor" @keydown.stop>
      <form class="assistant-connection-form" :aria-busy="saving" @submit.prevent="saveConnection">
        <header class="assistant-form-heading">
          <h2 id="assistant-connection-editor-title">{{ assistant.connections.some(connection => connection.id === draft?.id) ? t('编辑连接') : t('新建连接') }}</h2>
          <button type="button" class="assistant-close-form" :aria-label="t('关闭连接面板')" :data-tooltip="t('关闭')" :disabled="saving" @click="closeEditor"><X :size="18" /></button>
        </header>
        <div class="assistant-form-scroll">
          <fieldset :disabled="saving" class="assistant-form-fields">
            <label>{{ t('连接名称') }}<input ref="nameInput" v-model="draft.name" required maxlength="120" autocomplete="off" /></label>
            <label>{{ t('连接方式') }}<select v-model="draft.kind" @change="resetSecret"><option value="api">API</option><option value="codex-cli">Codex CLI</option><option value="claude-cli">Claude CLI</option></select></label>
            <template v-if="draft.kind === 'api'">
              <label>{{ t('API 服务地址') }}<input v-model="draft.endpoint" required type="url" maxlength="2000" autocomplete="off" /></label>
              <label>{{ t('首选接口协议') }}<select v-model="draft.protocol"><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label>
              <label class="assistant-settings-checkbox"><input v-model="draft.autoAdapt" type="checkbox" />{{ t('自动适配接口与参数') }}</label>
              <p v-if="draft.autoAdapt" class="settings-notice">{{ t('服务明确拒绝接口或兼容参数时，使用同一模型自动调整。模型权限受限时可改选模型或添加 Codex CLI 连接。') }}</p>
              <div class="assistant-secret-field">
                <label for="assistant-api-key">{{ t('API 密钥') }}</label>
                <div class="assistant-secret-input">
                  <input id="assistant-api-key" v-model="secret" :type="secretVisible ? 'text' : 'password'" maxlength="2000" autocomplete="new-password" autocapitalize="off" :spellcheck="false" :placeholder="hasSavedSecret && !secretEditing ? '••••••••••••••••••••••••••••••••' : ''" :title="hasSavedSecret && !secret ? t('已保存；留空保留当前密钥') : undefined" @focus="secretEditing = true" />
                  <button type="button" class="assistant-secret-toggle" :aria-label="secretToggleLabel" :aria-pressed="secretVisible" aria-controls="assistant-api-key" :disabled="!secret" :data-tooltip="!secret ? (hasSavedSecret ? t('已保存的密钥不回显，输入新密钥后可查看') : t('输入密钥后可查看')) : secretToggleLabel" @click="secretVisible = !secretVisible">
                    <EyeOff v-if="secretVisible" :size="16" /><Eye v-else :size="16" />
                  </button>
                </div>
              </div>
            </template>
            <label v-else>{{ t('CLI 可执行文件路径') }}<input v-model="draft.cliPath" maxlength="2000" autocomplete="off" :placeholder="t('留空自动查找')" /></label>
            <label class="assistant-settings-checkbox"><input v-model="draft.tools" type="checkbox" />{{ t('工具调用与文件操作') }}</label>
            <label v-if="draft.kind === 'api'">{{ t('最大输出 token') }}<input v-model.number="draft.maxOutputTokens" type="number" min="256" max="32768" required /></label>
          </fieldset>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <footer class="assistant-form-actions">
          <button type="button" class="secondary-button" :disabled="saving" @click="closeEditor">{{ t('取消') }}</button>
          <button type="submit" class="primary-button" :disabled="saving || assistant.busy || assistant.loading"><LoaderCircle v-if="saving" :size="15" class="spinning" /><Check v-else :size="15" />{{ saving ? t('正在保存…') : t('保存连接') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.assistant-connections-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 28px;
  margin-bottom: 12px;
  padding-left: 2px;
}
.assistant-connections-heading h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.assistant-settings-card {
  display: block;
  padding: 0 20px;
}
.assistant-connection-list {
  min-width: 0;
}
.assistant-connection-list > div {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 76px;
}
.assistant-connection-list > div + div {
  border-top: 1px solid var(--line);
}
.assistant-connection-list > div > button:first-child {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
  padding: 16px 0;
  color: var(--text);
  line-height: 1.5;
  text-align: left;
  overflow-wrap: anywhere;
}
.assistant-connection-list > div > button:first-child:hover {
  color: var(--green);
}
.assistant-connection-list strong {
  font-size: 13px;
  font-weight: 500;
}
.assistant-connection-list small {
  color: var(--muted);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.assistant-connection-more[aria-expanded='true'] {
  background: var(--hover);
  color: var(--text);
}
.assistant-connection-menu {
  position: fixed;
  z-index: 100;
  min-width: 160px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
}
.assistant-add-connection {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 5px;
  padding: 5px 0;
  color: var(--green);
  font-size: 12px;
}
.assistant-settings-empty {
  margin: 0;
  padding: 20px 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.assistant-connection-dialog {
  width: min(560px, calc(100vw - 32px));
  max-width: none;
  max-height: calc(100dvh - 32px);
  margin: auto;
  padding: 0;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--paper);
  color: var(--text);
  box-shadow: 0 25px 90px #1f232828;
}
.assistant-connection-dialog::backdrop {
  background: #1f232835;
  backdrop-filter: blur(2px);
}
.assistant-delete-dialog {
  width: min(440px, calc(100vw - 32px));
}
#assistant-delete-description {
  margin: 0;
  font-size: 14px;
  line-height: 1.7;
  overflow-wrap: anywhere;
}
.assistant-delete-button {
  color: var(--danger);
  background: var(--danger-bg);
}
.assistant-connection-form {
  display: flex;
  flex-direction: column;
  max-height: calc(100dvh - 34px);
  min-width: 0;
}
.assistant-form-scroll {
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 20px 24px;
}
.assistant-form-fields {
  display: grid;
  gap: 16px;
  min-width: 0;
  margin: 0;
  padding: 0;
  border: 0;
}
.assistant-form-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  flex-shrink: 0;
  padding: 18px 24px;
  border-bottom: 1px solid var(--line);
}
.assistant-form-heading h2 {
  margin: 0;
  color: var(--text);
  font-size: 18px;
  font-weight: 600;
}
.assistant-close-form {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  color: var(--muted);
}
.assistant-close-form:hover {
  background: var(--hover);
  color: var(--text);
}
.assistant-connection-form label {
  display: grid;
  gap: 6px;
  color: var(--text-secondary);
  font-size: 12px;
}
.assistant-connection-form input:not([type='checkbox']),
.assistant-connection-form select {
  box-sizing: border-box;
  width: 100%;
  min-width: 0;
  min-height: 34px;
  padding: 7px 10px;
  border: 1px solid var(--control-border);
  border-radius: 7px;
  background: var(--paper);
  color: var(--text);
  font: inherit;
}
.assistant-settings-checkbox {
  display: flex !important;
  align-items: center;
  gap: 7px !important;
}
.assistant-secret-field {
  display: grid;
  gap: 6px;
}
.assistant-secret-input {
  position: relative;
  min-width: 0;
}
.assistant-secret-input input:not([type='checkbox']) {
  padding-right: 40px;
}
.assistant-secret-input input::placeholder {
  color: var(--text);
  opacity: 1;
  letter-spacing: 1px;
}
.assistant-secret-input input::-ms-reveal {
  display: none;
}
.assistant-secret-toggle {
  position: absolute;
  top: 50%;
  right: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  transform: translateY(-50%);
  border-radius: 5px;
  color: var(--muted);
}
.assistant-secret-toggle:hover:not(:disabled) {
  background: var(--hover);
  color: var(--text);
}
.assistant-settings-checkbox input {
  margin: 0;
}
.assistant-connection-form .settings-notice {
  margin: 0;
}
.assistant-form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-shrink: 0;
  padding: 16px 24px;
  border-top: 1px solid var(--line);
}
@media (max-width: 600px) {
  .assistant-form-heading,
  .assistant-form-scroll,
  .assistant-form-actions {
    padding-right: 18px;
    padding-left: 18px;
  }
}
</style>
