<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { Bot, Check, LoaderCircle, Plus, Trash2 } from 'lucide-vue-next';
import type { AssistantConnection } from '@tano/protocol';
import { useAssistantStore } from '../assistant/store';

const assistant = useAssistantStore();
const emit = defineEmits<{ changed: [] }>();
const saving = ref(false);
const error = ref('');
const notice = ref('');
const secret = ref('');
type ConnectionDraft = Omit<AssistantConnection, 'hasKey'>;

function blankConnection(): ConnectionDraft {
  return {
    id: crypto.randomUUID(),
    name: '',
    kind: 'api',
    cliPath: '',
    endpoint: 'https://api.openai.com/v1',
    protocol: 'responses',
    tools: true,
    maxOutputTokens: 4096,
  };
}

const draft = ref<ConnectionDraft>(blankConnection());

function editConnection(connection?: AssistantConnection) {
  draft.value = connection
    ? {
        id: connection.id,
        name: connection.name,
        endpoint: connection.endpoint,
        kind: connection.kind ?? 'api',
        cliPath: connection.cliPath ?? '',
        protocol: connection.protocol ?? 'chat-completions',
        tools: connection.tools,
        maxOutputTokens: connection.maxOutputTokens,
      }
    : blankConnection();
  secret.value = '';
  error.value = '';
  notice.value = '';
}

async function saveConnection() {
  saving.value = true;
  error.value = '';
  notice.value = '';
  try {
    const cli = draft.value.kind !== 'api';
    await assistant.saveConnection(
      { ...draft.value, endpoint: cli ? '' : draft.value.endpoint },
      cli ? undefined : secret.value,
    );
    secret.value = '';
    notice.value = '模型连接已保存';
    emit('changed');
  } catch (cause) {
    error.value = String(cause);
  } finally {
    saving.value = false;
  }
}

async function removeConnection(id: string) {
  error.value = '';
  notice.value = '';
  try {
    await assistant.removeConnection(id);
    editConnection();
    notice.value = '模型连接已删除';
    emit('changed');
  } catch (cause) {
    error.value = String(cause);
  }
}

onMounted(() => {
  void assistant.reloadConnections().catch(cause => {
    error.value = String(cause);
  });
});
</script>

<template>
  <div class="settings-content assistant-settings-page">
    <div class="settings-title-line">
      <h2 id="settings-title">助手设置</h2>
      <div class="settings-page-scope" role="note" tabindex="0" aria-label="个人偏好 · 当前设备">
        <Bot :size="13" /><span>个人偏好 · 当前设备</span>
      </div>
    </div>
    <p class="settings-lead">配置助手使用的模型连接与生成选项。当前设置仅对你生效，未来可按工作区分别配置。</p>

    <template v-if="!assistant.available">
      <p class="settings-notice" role="status">当前运行环境未提供助手连接配置。</p>
    </template>
    <template v-else-if="assistant.demo">
      <p class="settings-notice" role="status">浏览器演示使用模拟连接，暂不支持修改模型连接。</p>
    </template>
    <template v-else>
      <section class="settings-section" aria-labelledby="assistant-connections-title">
        <h3 id="assistant-connections-title">模型连接</h3>
        <div class="settings-card assistant-settings-card">
          <div class="assistant-connection-list">
            <div v-for="connection in assistant.connections" :key="connection.id">
              <button type="button" @click="editConnection(connection)">
                <strong>{{ connection.name }}</strong>
                <small>{{ connection.kind === 'codex-cli' ? 'Codex CLI' : connection.kind === 'claude-cli' ? 'Claude CLI' : connection.endpoint }}</small>
              </button>
              <button
                type="button"
                class="icon-button"
                :disabled="saving || assistant.busy"
                :aria-label="`删除连接 ${connection.name}`"
                title="删除模型连接"
                @click="removeConnection(connection.id)"
              ><Trash2 :size="15" /></button>
            </div>
            <button type="button" class="assistant-add-connection" @click="editConnection()"><Plus :size="15" />添加连接</button>
            <p v-if="!assistant.connections.length" class="assistant-settings-empty">还没有模型连接，请先添加一个连接。</p>
          </div>

          <form class="assistant-connection-form" @submit.prevent="saveConnection">
            <label>连接名称<input v-model="draft.name" required maxlength="120" autocomplete="off" /></label>
            <label>连接方式<select v-model="draft.kind" @change="secret = ''"><option value="api">API</option><option value="codex-cli">Codex CLI</option><option value="claude-cli">Claude CLI</option></select></label>
            <template v-if="draft.kind === 'api'">
              <label>API 服务地址<input v-model="draft.endpoint" required type="url" maxlength="2000" autocomplete="off" /></label>
              <label>接口协议<select v-model="draft.protocol"><option value="responses">Responses</option><option value="chat-completions">Chat Completions</option></select></label>
              <label>API 密钥<input v-model="secret" type="password" maxlength="2000" autocomplete="new-password" :placeholder="assistant.connections.some(connection => connection.id === draft.id && connection.hasKey) ? '已保存；留空保留当前密钥' : ''" /></label>
            </template>
            <label v-else>CLI 可执行文件路径<input v-model="draft.cliPath" maxlength="2000" autocomplete="off" placeholder="留空自动查找" /></label>
            <label class="assistant-settings-checkbox"><input v-model="draft.tools" type="checkbox" />工具调用与修改建议</label>
            <label v-if="draft.kind === 'api'">最大输出 token<input v-model.number="draft.maxOutputTokens" type="number" min="256" max="32768" required /></label>
            <p v-if="error" class="form-error" role="alert">{{ error }}</p>
            <p v-if="notice" class="settings-notice" role="status">{{ notice }}</p>
            <button class="primary-button" :disabled="saving || assistant.busy || assistant.loading"><LoaderCircle v-if="saving" :size="15" class="spinning" /><Check v-else :size="15" />保存连接</button>
          </form>
        </div>
        <p class="settings-local-note">模型连接和 API 密钥仅保存在当前设备的个人配置中，不会写入工作区 Markdown 文件。</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.assistant-settings-card {
  display: grid;
  grid-template-columns: minmax(220px, 0.85fr) minmax(300px, 1.15fr);
  gap: 28px;
  padding: 20px;
}
.assistant-connection-list {
  min-width: 0;
}
.assistant-connection-list > div {
  display: flex;
  align-items: center;
  gap: 6px;
  border-bottom: 1px solid var(--line);
}
.assistant-connection-list > div > button:first-child {
  display: grid;
  flex: 1;
  min-width: 0;
  gap: 4px;
  padding: 11px 0;
  color: var(--text);
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
.assistant-add-connection {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  margin-top: 12px;
  padding: 5px 0;
  color: var(--green);
  font-size: 12px;
}
.assistant-settings-empty {
  margin: 16px 0 0;
  color: var(--muted);
  font-size: 12px;
  line-height: 1.7;
}
.assistant-connection-form {
  display: grid;
  gap: 13px;
  min-width: 0;
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
.assistant-settings-checkbox input {
  margin: 0;
}
.assistant-connection-form .settings-notice {
  margin: 0;
}
@media (max-width: 760px) {
  .assistant-settings-card {
    grid-template-columns: 1fr;
    gap: 24px;
  }
}
</style>
