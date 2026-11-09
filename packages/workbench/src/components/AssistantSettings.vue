<script setup lang="ts">
import { vSurfaceMotion, closeSurfaceDialog } from '@tano/editor/surface-motion';
import { uiLocale, t } from '../i18n';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowReactive, watch } from 'vue';
import { Bot, Copy, Save, ChevronDown, Eye, EyeOff, Gauge, LoaderCircle, MoreHorizontal, Pencil, Plus, Settings2, Trash2, TriangleAlert, Wifi } from 'lucide-vue-next';
import type { AssistantConnection } from '@tano/protocol';
import { useAssistantStore, type AssistantConnectionCheck } from '../assistant/store';
import AssistantUsage from './AssistantUsage.vue';
import '../assistant/settings-dialog.css';
import AssistantCcSwitchImport from './AssistantCcSwitchImport.vue';
import AssistantQuotaConfig from './AssistantQuotaConfig.vue';
import AssistantConnectionStatus from './AssistantConnectionStatus.vue';
import AssistantQuota from './AssistantQuota.vue';
import AssistantConnectionAvatar from './AssistantConnectionAvatar.vue';
import { connectionIconOptions } from '../assistant/connection-icons';

const assistant = useAssistantStore();
const emit = defineEmits<{ changed: [] }>();
const saving = ref(false);
const error = ref('');
const notice = ref('');
const secret = ref('');
const copySourceId = ref('');
const secretVisible = ref(false);
const secretEditing = ref(false);
const revealedSecret = ref('');
const secretLoading = ref(false);
let secretRequest = 0;

function editSecret(event: Event) {
  secretRequest++;
  secretLoading.value = false;
  revealedSecret.value = '';
  secret.value = (event.target as HTMLInputElement).value;
  if (!secret.value) secretVisible.value = false;
}

async function toggleSecret() {
  if (secretLoading.value) return;
  if (secretVisible.value) {
    secretVisible.value = false;
    revealedSecret.value = '';
    return;
  }
  if (secret.value) { secretVisible.value = true; return; }
  if (!draft.value || !hasSavedSecret.value) return;
  const request = ++secretRequest;
  secretLoading.value = true;
  error.value = '';
  try {
    const value = await assistant.readConnectionKey(copySourceId.value || draft.value.id);
    if (request !== secretRequest) return;
    revealedSecret.value = value;
    secretVisible.value = true;
    secretEditing.value = false;
  } catch {
    if (request === secretRequest) error.value = t('无法读取已保存的 API 密钥，请确认桌面版已更新并重试');
  } finally {
    if (request === secretRequest) secretLoading.value = false;
  }
}
const editor = ref<HTMLDialogElement>();
const avatarTrigger = ref<HTMLButtonElement>();
const avatarPopover = ref<HTMLElement>();
const avatarOpen = ref(false);
const avatarStyles = ['品牌', '线条', '彩色', '像素'] as const;
type AvatarStyle = typeof avatarStyles[number];
const avatarStyle = ref<AvatarStyle>('品牌');
function iconStyle(id?: string): AvatarStyle {
  if (id?.startsWith('agent-color-')) return '彩色';
  if (id?.startsWith('agent-pixel-')) return '像素';
  return id?.startsWith('agent-') ? '线条' : '品牌';
}
const visibleAvatarOptions = computed(() => connectionIconOptions.filter(option => iconStyle(option.id) === avatarStyle.value));
const avatarPosition = ref({ left: '0px', top: '0px' });

function closeAvatarPicker(restoreFocus = false) {
  avatarPopover.value?.hidePopover?.();
  avatarOpen.value = false;
  if (restoreFocus) avatarTrigger.value?.focus({ preventScroll: true });
}

async function toggleAvatarPicker() {
  if (avatarOpen.value) { closeAvatarPicker(true); return; }
  avatarStyle.value = iconStyle(draft.value?.icon);
  avatarOpen.value = true;
  await nextTick();
  positionAvatarPicker();
  avatarPopover.value?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus({ preventScroll: true });
}

function positionAvatarPicker() {
  const popup = avatarPopover.value;
  const trigger = avatarTrigger.value;
  if (!popup || !trigger) return;
  popup.showPopover?.();
  const bounds = trigger.getBoundingClientRect();
  popup.style.maxWidth = `${bounds.width}px`;
  const top = bounds.bottom + 6;
  avatarPosition.value = {
    left: `${Math.max(8, Math.min(bounds.right - popup.offsetWidth, window.innerWidth - popup.offsetWidth - 8))}px`,
    top: `${Math.max(8, Math.min(top + popup.offsetHeight <= window.innerHeight - 8 ? top : bounds.top - popup.offsetHeight - 6, window.innerHeight - popup.offsetHeight - 8))}px`,
  };
}

watch(avatarStyle, async () => {
  await nextTick();
  if (avatarOpen.value) positionAvatarPicker();
});

function selectAvatar(icon?: string) {
  if (draft.value) draft.value.icon = icon;
  closeAvatarPicker(true);
}

function randomAvatar() {
  const options = visibleAvatarOptions.value.filter(option => option.id !== draft.value?.icon);
  selectAvatar(options[Math.floor(Math.random() * options.length)]!.id);
}

function avatarToggled(event: Event) {
  if ((event as ToggleEvent).newState === 'closed') avatarOpen.value = false;
}

function dismissAvatarPicker(event: Event) {
  if (!avatarOpen.value || event.composedPath().includes(avatarPopover.value!) || event.composedPath().includes(avatarTrigger.value!)) return;
  closeAvatarPicker();
}
const deletionDialog = ref<HTMLDialogElement>();
const cancelDeletionButton = ref<HTMLButtonElement>();
const pendingDeletion = ref<Pick<AssistantConnection, 'id' | 'name'> | null>(null);
const removing = ref(false);
const nameInput = ref<HTMLInputElement>();
const addButton = ref<HTMLButtonElement>();
const menuConnectionId = ref('');
const quotaRequests = ref<Record<string, number>>({});
const quotaLoading = ref<Record<string, boolean>>({});
function canQueryQuota(connection: AssistantConnection) {
  return !connection.managed && connection.quota?.mode !== 'disabled' &&
    (connection.kind === 'codex-cli' || connection.kind === 'claude-cli' || !!connection.quota);
}
function queryConnectionQuota(connection: AssistantConnection) {
  closeMenu(true);
  quotaRequests.value[connection.id] = (quotaRequests.value[connection.id] ?? 0) + 1;
}
const quotaEditorId = ref('');
const quotaDialog = ref<HTMLDialogElement>();
const quotaSaving = ref(false);
const quotaConnection = computed(() => assistant.connections.find(item => item.id === quotaEditorId.value));
async function configureQuota(connection: AssistantConnection) {
  closeMenu();
  quotaSaving.value = false;
  quotaEditorId.value = connection.id;
  await nextTick();
  quotaDialog.value?.showModal();
  quotaDialog.value?.querySelector<HTMLButtonElement>('[role="switch"]')?.focus({ preventScroll: true });
}
function closeQuotaEditor() {
  if (quotaSaving.value) return;
  const id = quotaEditorId.value;
  closeSurfaceDialog(quotaDialog.value);
  quotaEditorId.value = '';
  void nextTick(() => { document.querySelector<HTMLButtonElement>(`[data-quota-owner="${id}"]`)?.focus(); });
}
const menu = ref<HTMLElement>();
const menuPosition = ref({ left: '0px', top: '0px' });
const checkControllers = shallowReactive(new Map<string, AbortController>());
const connectionChecks = ref<Record<string, AssistantConnectionCheck>>({ ...assistant.connectionCheckResults });
watch(() => assistant.connections.map(connection => JSON.stringify(connection)), fingerprints => {
  for (const [id, result] of Object.entries(connectionChecks.value)) {
    if (!fingerprints.includes(result.fingerprint)) {
      checkControllers.get(id)?.abort();
      checkControllers.delete(id);
      delete connectionChecks.value[id];
    }
  }
});
function checkSummary(connection: AssistantConnection) {
  if (checkControllers.has(connection.id)) return t('正在检测…');
  const result = connectionChecks.value[connection.id];
  if (!result) return '';
  const duration = `${result.elapsedMs} ms`;
  if (result.failed) return `${t('检测失败')} · ${duration}`;
  return duration;
}
let menuTrigger: HTMLButtonElement | undefined;
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
const hasSavedSecret = computed(() => assistant.connections.some(connection => connection.id === (copySourceId.value || draft.value?.id) && connection.hasKey));
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
  if (checkControllers.has(connection.id) || saving.value) return;
  closeMenu(true);
  const controller = new AbortController();
  checkControllers.set(connection.id, controller);
  const startedAt = performance.now();
  const fingerprint = JSON.stringify(connection);
  connectionChecks.value[connection.id] = { fingerprint, message: t('正在检测「{0}」…', [connection.name]), failed: false };
  try {
    const count = await assistant.checkConnection(connection.id, controller.signal);
    if (controller.signal.aborted || connectionChecks.value[connection.id]?.fingerprint !== fingerprint) return;
    const message = connection.managed ? t('平台已开放 {0} 个模型，可在助手中选择使用。', [count]) : connection.kind && connection.kind !== 'api'
      ? t('「{0}」的 CLI 可执行文件可用；登录状态与模型连通需在会话中确认。', [connection.name])
      : t('「{0}」连接成功，已读取 {1} 个模型。检测范围为模型列表接口，模型调用权限需在会话中确认。', [connection.name, count]);
    connectionChecks.value[connection.id] = { fingerprint, message, failed: false, elapsedMs: Math.round(performance.now() - startedAt), checkedAt: Date.now() };
  } catch (cause) {
    if (controller.signal.aborted || connectionChecks.value[connection.id]?.fingerprint !== fingerprint) return;
    connectionChecks.value[connection.id] = {
      fingerprint, failed: true, elapsedMs: Math.round(performance.now() - startedAt), checkedAt: Date.now(),
      message: t('「{0}」检测失败：{1}', [connection.name, cause instanceof Error ? cause.message : String(cause)]),
    };
  } finally {
    const result = connectionChecks.value[connection.id];
    if (!controller.signal.aborted && result?.checkedAt != null) assistant.connectionCheckResults[connection.id] = result;
    if (checkControllers.get(connection.id) === controller) checkControllers.delete(connection.id);
  }
}

function resetSecret() {
  copySourceId.value = '';
  secretRequest++;
  secretLoading.value = false;
  revealedSecret.value = '';
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
  if (connection.managed) return;
  closeMenu(true);
  draft.value = {
    id: connection.id,
    name: connection.name,
    icon: connection.icon,
    quota: connection.quota ? { ...connection.quota } : undefined,
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

function copyConnection(connection: AssistantConnection) {
  if (connection.managed || saving.value || assistant.busy || assistant.loading) return;
  editConnection(connection);
  draft.value!.id = crypto.randomUUID();
  const suffixLength = t('{0}（副本）', ['']).length;
  draft.value!.name = t('{0}（副本）', [connection.name.slice(0, 120 - suffixLength)]);
  copySourceId.value = connection.id;
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
  closeAvatarPicker();
  closeSurfaceDialog(editor.value);
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
    const key = !cli && !secret.value && copySourceId.value && hasSavedSecret.value
      ? await assistant.readConnectionKey(copySourceId.value)
      : secret.value;
    await assistant.saveConnection(
      { ...draft.value, endpoint: cli ? '' : draft.value.endpoint,
        reasoningEffort: draft.value.kind === 'codex-cli' ? draft.value.reasoningEffort : undefined },
      cli ? undefined : key,
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
  if (connection.managed || saving.value || removing.value || assistant.busy || assistant.loading) return;
  closeMenu();
  error.value = '';
  notice.value = '';
  deletionTrigger = event.currentTarget as HTMLButtonElement;
  pendingDeletion.value = { id: connection.id, name: connection.name };
}

function closeDeletion() {
  if (removing.value) return;
  closeSurfaceDialog(deletionDialog.value);
  pendingDeletion.value = null;
  error.value = '';
  const target = deletionTrigger;
  deletionTrigger = undefined;
  void nextTick(() => (target?.isConnected ? target : addButton.value)?.focus());
}

async function removeConnection() {
  const connection = pendingDeletion.value;
  if (!connection || saving.value || removing.value || assistant.busy || assistant.loading) return;
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
  document.addEventListener('pointerdown', dismissAvatarPicker, true);
  window.addEventListener('scroll', dismissAvatarPicker, true);
  window.addEventListener('resize', dismissAvatarPicker);
  document.addEventListener('pointerdown', dismissMenu, true);
  document.addEventListener('focusin', dismissMenu);
  window.addEventListener('scroll', dismissMenu, true);
  window.addEventListener('resize', dismissMenu);
  void assistant.reloadConnections().catch(cause => {
    error.value = String(cause);
  });
});
onBeforeUnmount(() => {
  resetSecret();
  document.removeEventListener('pointerdown', dismissAvatarPicker, true);
  window.removeEventListener('scroll', dismissAvatarPicker, true);
  window.removeEventListener('resize', dismissAvatarPicker);
  closeSurfaceDialog(editor.value);
  closeSurfaceDialog(deletionDialog.value);
  for (const controller of checkControllers.values()) controller.abort();
  checkControllers.clear();
  document.removeEventListener('pointerdown', dismissMenu, true);
  document.removeEventListener('focusin', dismissMenu);
  window.removeEventListener('scroll', dismissMenu, true);
  window.removeEventListener('resize', dismissMenu);
});
</script>

<template>
  <div class="settings-content assistant-settings-page">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('助手') }}</h2>
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
        <div class="settings-section-heading assistant-connections-heading">
          <h3 id="assistant-connections-title">{{ t('模型连接') }}</h3>
          <div class="assistant-connection-add-actions"><AssistantCcSwitchImport @changed="emit('changed')" />
          <button v-if="assistant.canConfigure !== false" ref="addButton" type="button" class="assistant-add-connection" aria-haspopup="dialog" @click="addConnection"><Plus :size="15" />{{ t('添加连接') }}</button></div>
        </div>
        <div class="settings-card assistant-settings-card">
          <div class="assistant-connection-list">
            <div v-for="connection in assistant.connections" :key="connection.id">
              <button type="button" aria-haspopup="dialog" :disabled="connection.managed" @click="editConnection(connection)">
                <AssistantConnectionAvatar :connection="connection" />
                <span class="connection-label">
                <strong>{{ connection.name }}</strong>
                <small>{{ connection.managed ? t('平台提供，登录后即可使用') : connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : connection.endpoint }}</small>
                </span>
              </button>
              <div class="connection-statuses">
              <AssistantConnectionStatus v-if="connectionChecks[connection.id]" :key="connectionChecks[connection.id].fingerprint" class="connection-check"
                :label="t('连通性详情')" :summary="checkSummary(connection)" :checked-at="connectionChecks[connection.id].checkedAt" :refreshing="checkControllers.has(connection.id)" :failed="connectionChecks[connection.id].failed">
                <template #icon>
                  <LoaderCircle v-if="checkControllers.has(connection.id)" :size="14" class="spinning" aria-hidden="true" />
                  <TriangleAlert v-else-if="connectionChecks[connection.id].failed" :size="14" aria-hidden="true" />
                  <Wifi v-else :size="14" aria-hidden="true" />
                </template>
                <p :role="connectionChecks[connection.id].failed ? 'alert' : 'status'">{{ connectionChecks[connection.id].message }}</p>
                <dl v-if="connectionChecks[connection.id].elapsedMs != null" class="connection-check-values">
                  <div><dt>{{ t('检测耗时') }}</dt><dd>{{ connectionChecks[connection.id].elapsedMs }} ms</dd></div>
                  <div><dt>{{ t('检测时间') }}</dt><dd>{{ new Date(connectionChecks[connection.id].checkedAt!).toLocaleString(uiLocale) }}</dd></div>
                </dl>
              </AssistantConnectionStatus>
              <AssistantQuota :connection="connection" :request="quotaRequests[connection.id]" @loading="quotaLoading[connection.id] = $event" />
              </div>
              <button
                type="button"
                class="icon-button"
                :disabled="saving || assistant.busy || assistant.loading"
                v-if="!connection.managed"
                :aria-label="t('删除连接 {0}', [connection.name])"
                :data-tooltip="t('删除模型连接')"
                aria-haspopup="dialog"
                @click="confirmRemoval(connection, $event)"
              ><Trash2 :size="15" /></button>
              <button
                type="button"
                class="icon-button assistant-connection-more"
                :data-quota-owner="connection.id" :aria-label="t('更多操作 {0}', [connection.name])"
                :data-tooltip="t('更多操作')"
                aria-haspopup="menu"
                :aria-expanded="menuConnectionId === connection.id"
                :aria-controls="menuConnectionId === connection.id ? 'assistant-connection-actions' : undefined"
                @click="toggleMenu(connection, $event)"
                @keydown.down.prevent="toggleMenu(connection, $event)"
              ><MoreHorizontal :size="17" /></button>
            </div>
            <p v-if="!assistant.connections.length" class="assistant-settings-empty">{{ assistant.canConfigure !== false ? t('还没有模型连接，请先添加一个连接。') : t('平台暂未开放模型，请稍后刷新。') }}</p>
          </div>
        </div>
        <p v-if="!editing && !pendingDeletion && error" class="form-error" role="alert">{{ error }}</p>
        <p v-if="!editing && notice" class="settings-notice" role="status">{{ notice }}</p>
      </section>
    </template>
    <AssistantUsage v-if="assistant.available" :sessions="assistant.sessions ?? []" :connections="assistant.connections" :active-session="assistant.session" :loading="assistant.loading" :demo="assistant.demo" />
  </div>

  <Teleport to="body">
    <dialog v-surface-motion="'AssistantSettings:0'" v-if="quotaConnection" ref="quotaDialog" class="assistant-connection-dialog assistant-config-dialog assistant-quota-dialog" :aria-label="t('额度查询配置')" @cancel.prevent="closeQuotaEditor" @keydown.stop>
      <AssistantQuotaConfig :key="quotaConnection.id" :connection="quotaConnection" @close="closeQuotaEditor" @busy="quotaSaving = $event" @saved="emit('changed')" />
    </dialog>
    <dialog v-surface-motion="'AssistantSettings:1'" v-if="pendingDeletion" ref="deletionDialog" class="assistant-connection-dialog assistant-delete-dialog" role="alertdialog" aria-modal="true" aria-labelledby="assistant-delete-title" aria-describedby="assistant-delete-description" @cancel.prevent="closeDeletion" @keydown.stop>
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
    <div v-surface-motion="'AssistantSettings:2'" v-if="menuConnection" id="assistant-connection-actions" ref="menu" class="dropdown compact-action-menu assistant-connection-menu" role="menu" tabindex="-1" :aria-label="t('{0} 操作', [menuConnection.name])" :style="menuPosition" @keydown.stop="menuKey">
      <button type="button" role="menuitem" :disabled="checkControllers.has(menuConnection.id) || saving" @click="checkConnection(menuConnection)"><Wifi :size="15" />{{ checkControllers.has(menuConnection.id) ? t('正在检测…') : menuConnection.managed ? t('刷新模型名单') : t('检测连通') }}</button>
      <button v-if="canQueryQuota(menuConnection)" type="button" role="menuitem" :disabled="saving || quotaLoading[menuConnection.id]" @click="queryConnectionQuota(menuConnection)"><Gauge :size="15" />{{ quotaLoading[menuConnection.id] ? t('正在查询额度…') : t('查询额度') }}</button>
      <div v-if="!menuConnection.managed" class="menu-divider" role="separator" />
      <button v-if="!menuConnection.managed" type="button" role="menuitem" :disabled="saving || assistant.busy || assistant.loading" @click="editConnection(menuConnection)"><Pencil :size="15" />{{ t('编辑连接') }}</button>
      <button v-if="!menuConnection.managed" type="button" role="menuitem" :disabled="saving || assistant.busy || assistant.loading" @click="copyConnection(menuConnection)"><Copy :size="15" />{{ t('复制连接') }}</button>
      <div v-if="!menuConnection.managed" class="menu-divider" role="separator" />
      <button v-if="!menuConnection.managed" type="button" role="menuitem" :disabled="saving || assistant.busy || assistant.loading" @click="configureQuota(menuConnection)"><Settings2 :size="15" />{{ t('配置额度查询') }}</button>
    </div>
    <dialog v-surface-motion="'AssistantSettings:3'" v-if="draft" ref="editor" class="assistant-connection-dialog assistant-config-dialog" aria-labelledby="assistant-connection-editor-title" @cancel.prevent="closeEditor" @keydown.stop>
      <form class="assistant-connection-form" :aria-busy="saving" @submit.prevent="saveConnection">
        <header class="assistant-form-heading">
          <h2 id="assistant-connection-editor-title">{{ assistant.connections.some(connection => connection.id === draft?.id) ? t('编辑连接') : t('新建连接') }}</h2>
        </header>
        <div class="assistant-form-scroll">
          <fieldset :disabled="saving" class="assistant-form-fields">
            <section class="config-section"><h3>{{ t('基本信息') }}</h3><div class="config-field-grid">
            <label>{{ t('连接名称') }}<input ref="nameInput" v-model="draft.name" required maxlength="120" autocomplete="off" /></label>
            <label>{{ t('连接方式') }}<select v-model="draft.kind" @change="resetSecret(); draft.quota = undefined"><option value="api">API</option><option value="codex-cli">Codex CLI</option><option value="claude-cli">Claude CLI</option></select></label>
            </div>
            <div class="connection-avatar-field">
              <button ref="avatarTrigger" type="button" class="connection-avatar-trigger" aria-haspopup="dialog" :aria-expanded="avatarOpen" :aria-controls="avatarOpen ? 'connection-avatar-popover' : undefined" @click="toggleAvatarPicker"><span class="config-avatar-summary"><AssistantConnectionAvatar :connection="draft" :size="28" /><span>{{ t('连接头像') }}</span></span><span class="config-summary-hint">{{ t('选择图标') }} <ChevronDown :size="14" /></span></button>
              <div v-surface-motion="'AssistantSettings:4'" v-if="avatarOpen" id="connection-avatar-popover" ref="avatarPopover" popover="auto" role="dialog" :aria-label="t('选择连接头像')" class="connection-icon-picker connection-avatar-popover" :style="avatarPosition" @toggle="avatarToggled" @keydown.esc.stop.prevent="closeAvatarPicker(true)">
              <div class="connection-icon-preview"><AssistantConnectionAvatar :connection="draft" />
                <button type="button" :aria-pressed="!draft.icon || draft.icon === 'auto'" @click="selectAvatar()">{{ t('自动识别') }}</button>
                <button type="button" :aria-pressed="draft.icon === 'initials'" @click="selectAvatar('initials')">{{ t('名称缩写') }}</button>
                <button type="button" @click="randomAvatar">{{ t('随机选择') }}</button>
              </div>
              <div class="connection-icon-styles" role="group" :aria-label="t('图标风格')">
                <button v-for="style in avatarStyles" :key="style" type="button" :aria-pressed="avatarStyle === style" @click="avatarStyle = style">{{ t(style) }}</button>
              </div>
              <div class="connection-icon-options">
                <button v-for="option in visibleAvatarOptions" :key="option.id" type="button" :title="t(option.label)" :aria-label="t(option.label)" :aria-pressed="draft.icon === option.id" @click="selectAvatar(option.id)">
                  <AssistantConnectionAvatar :connection="{ ...draft, icon: option.id }" />
                </button>
              </div>
              </div>
            </div>
            </section>
            <section class="config-section"><h3>{{ draft.kind === 'api' ? t('服务凭据') : t('本机命令行') }}</h3>
              <template v-if="draft.kind === 'api'">
                <label>{{ t('API 服务地址') }}<input v-model="draft.endpoint" required type="url" maxlength="2000" autocomplete="off" placeholder="https://api.example.com/v1" /></label>

              <div class="assistant-secret-field">
                <label for="assistant-api-key">{{ t('API 密钥') }}</label>
                <div class="assistant-secret-input">
                  <input id="assistant-api-key" :value="secret || revealedSecret" @input="editSecret" :type="secretVisible ? 'text' : 'password'" maxlength="2000" autocomplete="new-password" autocapitalize="off" :spellcheck="false" :placeholder="hasSavedSecret && !secretEditing ? '••••••••••••••••••••••••••••••••' : ''" :title="hasSavedSecret && !secret ? t('已保存；留空保留当前密钥') : undefined" @focus="secretEditing = true" @blur="secretEditing = false" />
                  <button type="button" class="assistant-secret-toggle" :aria-label="secretToggleLabel" :aria-pressed="secretVisible" aria-controls="assistant-api-key" :disabled="secretLoading || (!secret && !hasSavedSecret)" :aria-busy="secretLoading" :data-tooltip="!secret && !hasSavedSecret ? t('输入密钥后可查看') : secretToggleLabel" @click="toggleSecret">
                    <EyeOff v-if="secretVisible" :size="16" /><Eye v-else :size="16" />
                  </button>
                </div>
              </div>
                <p class="config-field-hint">{{ t('密钥安全保存在本机，留空保留已保存的密钥。') }}</p>
              </template>
              <template v-else><label>{{ t('CLI 可执行文件路径') }}<input v-model="draft.cliPath" maxlength="2000" autocomplete="off" :placeholder="t('留空自动查找')" /></label><p class="config-field-hint">{{ t('使用本机已登录的账号，通常无需填写路径。') }}</p></template>
            </section>
            <details class="config-disclosure config-advanced">
              <summary><span>{{ t('高级设置') }}</span><span class="config-summary-hint">{{ t('协议与工具') }} <ChevronDown :size="14" /></span></summary>
              <div class="config-advanced-body">
                <div v-if="draft.kind === 'api'" class="config-field-grid">
                  <label>{{ t('首选接口协议') }}<select v-model="draft.protocol"><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label>
                  <label>{{ t('最大输出 token') }}<input v-model.number="draft.maxOutputTokens" type="number" min="256" max="32768" required /></label>
                </div>
                <label v-if="draft.kind === 'api'" class="assistant-settings-checkbox"><input v-model="draft.autoAdapt" type="checkbox" />{{ t('自动适配接口与参数') }}</label>
                <label class="assistant-settings-checkbox"><input v-model="draft.tools" type="checkbox" />{{ t('工具调用与文件操作') }}</label>
              </div>
            </details>
          </fieldset>
          <p v-if="error" class="form-error" role="alert">{{ error }}</p>
        </div>
        <footer class="assistant-form-actions">
          <button type="button" class="secondary-button" :disabled="saving" @click="closeEditor">{{ t('取消') }}</button>
          <button type="submit" class="secondary-button" :disabled="saving || assistant.busy || assistant.loading"><LoaderCircle v-if="saving" :size="15" class="spinning" /><Save v-else :size="15" />{{ saving ? t('正在保存…') : t('保存') }}</button>
        </footer>
      </form>
    </dialog>
  </Teleport>
</template>

<style scoped>
.assistant-settings-page :deep([data-settings-key='assistant-connections'] + .assistant-usage) {
  margin-top: 64px;
}
.assistant-connection-add-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.connection-statuses { display: flex; align-items: center; gap: 4px; min-width: 0; }
.connection-statuses:empty { display: none; }
@media (max-width: 600px) {
  .connection-statuses { order: 1; flex-basis: 100%; flex-wrap: wrap; padding: 0 0 12px 42px; }
}
.connection-check p { margin: 0 0 12px; line-height: 1.6; }
.connection-check-values { display: grid; gap: 8px; margin: 0; }
.connection-check-values div { display: flex; justify-content: space-between; gap: 12px; }
.connection-check-values dt { color: var(--muted); }
.connection-check-values dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.connection-label { display: grid; gap: 4px; min-width: 0; }
.connection-icon-picker { border: 0; padding: 0; margin: 0; min-width: 0; }
.connection-icon-preview { display: flex; align-items: center; gap: 8px; margin: 8px 0; }
.connection-icon-options { display: grid; grid-template-columns: repeat(auto-fill, 40px); gap: 5px; }
.connection-icon-picker button { padding: 4px; border: 1px solid transparent; border-radius: 7px; }
.connection-icon-picker button:hover { background: var(--hover); }
.connection-icon-picker button[aria-pressed='true'] {
  background: color-mix(in srgb, var(--text) 9%, var(--paper));
  color: var(--text);
  font-weight: 600;
}
.connection-icon-picker button:focus-visible {
  outline: 2px solid var(--text-secondary);
  outline-offset: 2px;
}
.assistant-connections-heading {
  justify-content: space-between;
  border-bottom: 0;
  padding-bottom: 0;
  margin-bottom: 16px;
}
.assistant-settings-card {
  display: block;
  padding: 0;
}
.assistant-connection-list {
  display: grid;
  gap: 8px;
  min-width: 0;
}
.assistant-connection-list > div {
  flex-wrap: wrap;
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 76px;
  padding: 0 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--hover) 35%, var(--paper));
}
.assistant-connection-list > div > button:first-child {
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 10px;
  padding: 16px 0;
  color: var(--text);
  line-height: 1.5;
  text-align: left;
  overflow-wrap: anywhere;
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
  width: max-content;
  min-width: 132px;
  max-width: calc(100vw - 16px);
  max-height: calc(100dvh - 16px);
  overflow-y: auto;
}
.assistant-add-connection {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid var(--line);
  border-radius: 6px;
  background: var(--paper);
  color: var(--text);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background .15s, border-color .15s;
}
.assistant-add-connection:hover {
  background: var(--hover);
  border-color: var(--control-border);
}
.assistant-add-connection:focus-visible,
.assistant-connection-list > div > button:focus-visible {
  outline: 2px solid var(--green);
  outline-offset: 2px;
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
  box-shadow: 0 25px 90px #0f0f0f28;
}
.assistant-connection-dialog::backdrop {
  background: #0f0f0f35;
  backdrop-filter: blur(2px);
}
.assistant-quota-dialog { width: min(720px, calc(100vw - 32px)); }
.assistant-quota-dialog :deep(.quota-panel) { display: flex; flex-direction: column; max-height: calc(100dvh - 34px); padding: 0; gap: 0; }
.assistant-quota-dialog :deep(.quota-panel > header) { flex: none; padding: 18px 24px; border-bottom: 1px solid var(--line); }
.assistant-quota-dialog :deep(.quota-panel > .quota-scroll) { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; overscroll-behavior: contain; padding: 20px 24px; }
.assistant-quota-dialog :deep(.quota-panel > footer) { flex: none; padding: 16px 24px; border-top: 1px solid var(--line); }
.assistant-quota-dialog :deep(.quota-panel > p) { flex: none; padding: 0 24px 12px; }
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
