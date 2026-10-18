<script setup lang="ts">
import { t, uiLocale } from '../i18n';
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { invoke } from '@tauri-apps/api/core';
import { Bot, X, Terminal, RefreshCw, FileText, Copy } from 'lucide-vue-next';
import { workspaceAgentGuide, assistantRulesPath } from '@tano/protocol';
import type { AgentChange, AgentChangeDetail, AgentSetup } from '@tano/protocol';
import { useWorkspaceStore } from '../stores/workspace';
import { native } from '../adapter';
import { mobile } from '../platform';
import ChangeDiff from './ChangeDiff.vue';
const props = defineProps<{ workspaceId: string }>();
const emit = defineEmits<{ close: [] }>();
const workspace = useWorkspaceStore();
const localMcp = native && !mobile && !workspace.isWeb;
const tab = ref<'guide' | 'changes' | 'mcp'>('guide');
const purpose = ref('');
const language = ref<'zh' | 'en'>('zh');
const draft = computed(() =>
  workspaceAgentGuide(workspace.workspace?.name ?? '', purpose.value, language.value),
);
const existing = computed(() =>
  workspace.workspace?.files.find((file) => file.path === assistantRulesPath) ??
    workspace.workspace?.files.find((file) => /^agents\.md$/i.test(file.path)),
);
const error = ref(''),
  notice = ref('');
const busy = ref(false),
  loading = ref(false);
const setup = ref<AgentSetup>();
const changes = ref<AgentChange[]>([]);
const selected = ref<AgentChangeDetail>();
const closeButton = ref<HTMLButtonElement>();
const originalFocus = document.activeElement as HTMLElement | null;
let disposed = false,
  request = 0;
let timer: ReturnType<typeof setInterval> | undefined;
const config = computed(() => (setup.value ? JSON.stringify(setup.value.config, null, 2) : ''));
const status = { get prepared() { return t('结果待核对'); }, get applied() { return t('已写入'); }, get failed() { return t('未写入'); } };
async function run(task: () => Promise<void>) {
  if (busy.value || workspace.workspace?.id !== props.workspaceId) return;
  busy.value = true;
  error.value = '';
  notice.value = '';
  try {
    await task();
  } catch (reason) {
    error.value = String(reason);
  } finally {
    busy.value = false;
  }
}
async function createGuide() {
  await run(async () => {
    await workspace.refresh();
    if (workspace.workspace?.id !== props.workspaceId) throw new Error(t('工作区已切换'));
    if (existing.value) await workspace.openFile(existing.value);
    else await workspace.create(assistantRulesPath, false, draft.value, props.workspaceId);
    emit('close');
  });
}
async function terminal() {
  if (!localMcp) return;
  await run(async () => {
    if (!(await workspace.flush())) throw new Error(t('请先完成文档保存'));
    await invoke('open_workspace_terminal', { workspaceId: props.workspaceId });
    notice.value = t('已在当前工作文件夹打开系统终端。');
  });
}
async function load() {
  if (!localMcp || loading.value) return;
  loading.value = true;
  try {
    const result = await invoke<AgentChange[]>('agent_changes', {
      workspaceId: props.workspaceId,
      selected: null,
    });
    if (!disposed) changes.value = result;
  } catch (reason) {
    if (!disposed) error.value = String(reason);
  } finally {
    loading.value = false;
  }
}
async function preview(item: AgentChange) {
  if (!localMcp) return;
  const current = ++request;
  selected.value = undefined;
  error.value = '';
  try {
    const result = await invoke<AgentChangeDetail[]>('agent_changes', {
      workspaceId: props.workspaceId,
      selected: item.id,
    });
    if (!disposed && current === request) selected.value = result[0];
  } catch (reason) {
    if (!disposed && current === request) error.value = String(reason);
  }
}
async function copyConfig() {
  await run(async () => {
    await navigator.clipboard.writeText(config.value);
    notice.value = t('MCP 配置已复制。');
  });
}
function trap(event: KeyboardEvent) {
  if (event.key === 'Escape') {
    event.stopPropagation();
    if (!busy.value) emit('close');
    return;
  }
  if (event.key !== 'Tab') return;
  const controls = [
    ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
      'button:not(:disabled), input, textarea, select, [tabindex="0"]',
    ),
  ];
  const first = controls[0],
    last = controls.at(-1);
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last?.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first?.focus();
  }
}
onMounted(async () => {
  closeButton.value?.focus();
  if (localMcp) {
    try {
      const result = await invoke<AgentSetup>('agent_setup', { workspaceId: props.workspaceId });
      if (!disposed) setup.value = result;
    } catch (reason) {
      if (!disposed) error.value = String(reason);
    }
    await load();
    if (!disposed)
      timer = setInterval(() => {
        void load();
      }, 3000);
  }
});
onBeforeUnmount(() => {
  disposed = true;
  request++;
  clearInterval(timer);
  originalFocus?.focus();
});
</script>
<template>
  <div class="modal-backdrop" @mousedown.self="!busy && emit('close')">
    <section
      class="modal agent-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="t('与 Agent 一起工作')"
      @keydown="trap"
    >
      <div class="modal-heading">
        <h2><Bot :size="21" />{{ t('与 Agent 一起工作') }}</h2>
        <button
          ref="closeButton"
          class="icon-button"
          :aria-label="t('关闭 Agent 工作台')"
          :disabled="busy"
          @click="emit('close')"
        >
          <X :size="19" />
        </button>
      </div>
      <p class="panel-hint">{{ workspace.workspace?.name }} {{ t('· 普通 Markdown，是共同的工作界面。') }}</p>
      <div class="agent-tabs">
        <button :class="{ active: tab === 'guide' }" @click="tab = 'guide'">{{ t('工作区指引') }}</button
        ><button
          v-if="!mobile"
          :disabled="!localMcp"
          :class="{ active: tab === 'changes' }"
          @click="tab = 'changes'"
        >
          {{ t('Agent 活动') }} <small>{{ changes.length }}</small></button
        ><button
          v-if="!mobile"
          :disabled="!localMcp"
          :class="{ active: tab === 'mcp' }"
          @click="tab = 'mcp'"
        >
          {{ t('连接 MCP') }}</button
        ><button
          v-if="!mobile"
          class="agent-terminal"
          :disabled="!localMcp || busy"
          @click="terminal"
        >
          <Terminal :size="15" />{{ t('在此打开终端') }}
        </button>
      </div>
      <p v-if="mobile" class="panel-hint">
        {{ t('手机与电脑连接同一同步空间后，电脑上的 Agent 修改会同步到这里。本机 MCP 与终端在电脑端使用。') }}
      </p>
      <p v-else-if="!localMcp" class="panel-hint">
        {{
          workspace.isDemo ? t('浏览器演示可查看和编辑工作区指引。') : t('这里可查看和编辑工作区指引。')
        }}{{ t('本机 MCP 与终端请在桌面版的本地工作区使用。') }}
      </p>
      <p v-if="error" class="form-error" role="alert">{{ error }}</p>
      <p v-if="notice" class="panel-hint" role="status">{{ notice }}</p>
      <div v-if="tab === 'guide'" class="agent-guide">
        <template v-if="existing"
          ><div class="agent-existing">
            <FileText :size="28" />
            <h3>{{ t('这个空间已有') }} {{ existing.path }}</h3>
            <p>{{ t('直接查看和编辑现有约定。') }}</p>
            <button class="primary-button" :disabled="busy" @click="createGuide">
              {{ t('打开已有指引') }}
            </button>
          </div></template
        >
        <template v-else
          ><p class="panel-hint">
            {{ t('工作区助手约定') }}
          </p>
          <label
            >{{ t('工作背景') }}<textarea
              v-model="purpose"
              maxlength="4000"
              rows="2"
              :placeholder="t('例如：这里保存论文研究笔记，请保留引用与实验数据。')"
            /></label
          ><label
            >{{ t('默认语言') }}<select v-model="language">
              <option value="zh">{{ t('简体中文') }}</option>
              <option value="en">English</option>
            </select></label
          ><label
            >{{ t('生成预览') }}<textarea
              class="agent-preview"
              readonly
              :value="draft"
              :aria-label="t('助手约定生成预览')"
            /></label
          ><button
            class="primary-button"
            :disabled="busy || workspace.workspace?.readOnly"
            @click="createGuide"
          >
            {{ t('创建助手约定') }}
          </button></template
        >
      </div>
      <div v-else-if="tab === 'changes'" class="agent-activity">
        <p class="panel-hint">
          {{ t('本机 MCP 工具调用记录，保留最近 200 条。客户端名称由对方声明，不能证明人员或模型身份。普通外部改动可在工作动态查看。') }}
        </p>
        <button class="secondary-button" :disabled="loading || !localMcp" @click="load">
          <RefreshCw :size="14" />{{ t('刷新记录') }}
        </button>
        <p v-if="!changes.length" class="panel-hint">
          {{ t('还没有 MCP 写入记录。连接后，通过 Tano 工具修改文档就会出现在这里。') }}
        </p>
        <div v-else class="agent-history">
          <div class="agent-change-list">
            <button
              v-for="item in changes"
              :key="item.id"
              :class="{ active: selected?.id === item.id }"
              @click="preview(item)"
            >
              <strong>{{ item.path }}</strong
              ><span
                >{{ status[item.status] }} · {{ item.client }} ·
                {{ item.instanceId ? item.instanceId.slice(0, 8) : t('旧记录') }}</span
              ><time>{{ new Date(item.createdAt).toLocaleString(uiLocale) }}</time>
            </button>
          </div>
          <div class="agent-change-preview">
            <template v-if="selected"
              ><h3>{{ selected.path }}</h3>
              <p class="panel-hint">
                {{ status[selected.status] }} · MCP / {{ selected.client }} {{ t('· 实例') }}
                {{ selected.instanceId ? selected.instanceId.slice(0, 8) : t('旧记录') }}
              </p>
              <p v-if="selected.status === 'prepared'" class="form-error">
                {{ t('工具在完成确认前中断。下面是拟写入的变化，请打开当前文档核对实际结果。') }}
              </p>
              <p v-if="selected.error" class="form-error">{{ selected.error }}</p>
              <ChangeDiff
                v-if="
                  selected.afterContent != null &&
                  (selected.beforeContent != null || selected.operation === 'create')
                "
                :before="selected.beforeContent ?? ''"
                :after="selected.afterContent"
              />
              <p v-else class="panel-hint">
                {{ t('此记录仅保留内容校验值；超过 512 KiB 的版本不保存差异正文。') }}
              </p>
              <details>
                <summary>{{ t('内容校验值') }}</summary>
                <code>{{ selected.beforeHash ?? t('新建文档') }}<br />→ {{ selected.afterHash }}</code>
              </details></template
            >
            <p v-else class="panel-hint">{{ t('选择一条记录，查看修改前后。') }}</p>
          </div>
        </div>
      </div>
      <div v-else class="agent-mcp">
        <p>
          {{ t('把配置加入支持 MCP 的 Agent 客户端，即可列出、读取、新建和条件修改本工作区中的 Markdown。') }}
        </p>
        <p class="panel-hint">
          {{ t('需要 Node.js 24.12 或更新版本。此连接通过本机标准输入输出运行，授予所选工作区的读写能力；无需启动同步服务器。安装器已包含 MCP 程序。') }}
        </p>
        <textarea
          readonly
          :value="config || t('请在桌面版工作区中获取配置。')"
          class="agent-preview"
          :aria-label="t('MCP 客户端配置')"
        /><button class="secondary-button" :disabled="!setup?.bundled || busy" @click="copyConfig">
          <Copy :size="15" />{{ t('复制配置') }}
        </button>
        <p v-if="setup && !setup.bundled" class="form-error">
          {{ t('缺少 MCP 程序，请重新构建或安装 Tano。') }}
        </p>
        <p class="panel-hint">
          {{ t('写入需要先读取文件并携带 SHA-256。检测到新内容时会拒绝覆盖，Agent 需要重新读取并合并。') }}
        </p>
      </div>
    </section>
  </div>
</template>
