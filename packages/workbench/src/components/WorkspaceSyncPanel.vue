<script setup lang="ts">
import { uiLocale, t } from '../i18n';
import { vSurfaceMotion } from '@tano/editor/surface-motion';
import GitInspectionPanel from './GitInspectionPanel.vue';
import { ref } from 'vue';
import { X, RefreshCw, GitBranch } from 'lucide-vue-next';
import type { WorkspaceSyncController } from '../workspace-sync';
import type { WorkbenchExtensions } from '../runtime';
const props = defineProps<{ workspaceId: string; controller: WorkspaceSyncController; cloud?: WorkbenchExtensions['sync'] }>();
const emit = defineEmits<{ close: [] }>();
const remote = ref('');
const tab = ref<'git' | 'sync'>('git');
const { state, busy, error } = props.controller;
async function enable() { await props.controller.action('configure', remote.value.trim()); if (state.value.backend === 'git') await props.controller.action('run'); }
</script>
<template>
  <div v-surface-motion="'WorkspaceSyncPanel:0'" class="modal-backdrop" @mousedown.self="emit('close')" @keydown.esc="emit('close')">
    <section class="modal workspace-sync-panel" role="dialog" aria-modal="true" :aria-label="t('Git 与同步')">
      <header><h2><GitBranch :size="20" />{{ t('Git 与同步') }}</h2><button class="icon-button" :aria-label="t('关闭同步')" @click="emit('close')"><X :size="18" /></button></header>
      <nav :aria-label="t('Git 功能')"><button class="secondary-button" :aria-pressed="tab === 'git'" @click="tab = 'git'">{{ t('变更与历史') }}</button><button class="secondary-button" :aria-pressed="tab === 'sync'" @click="tab = 'sync'">{{ t('同步设置') }}</button></nav>
      <GitInspectionPanel v-if="tab === 'git'" :key="workspaceId" :workspace-id="workspaceId" />
      <template v-else>
      <p>{{ t('当前后端：') }}{{ state.backend === 'git' ? 'Git' : state.backend === 'cloud' ? t('Tano 云端') : t('未启用') }}</p>
      <template v-if="state.backend !== 'cloud'">
        <p>{{ t('Git 同步源文件及 .tano 元数据，按仓库忽略规则提交已保存的修改。每 30 秒尝试同步；断网时保留本地提交。') }}</p>
        <template v-if="state.backend !== 'git'">
          <label>{{ t('Git 远端地址') }}<input v-model="remote" :placeholder="t('https://…/workspace.git 或 git@…')" :disabled="busy" /></label>
          <p>{{ t('新目录会初始化 main 分支；已有仓库使用 origin 和当前分支。第二台设备请克隆同一仓库，再在 Tano 中打开。SSH 使用系统认证，操作不会弹出终端。') }}</p>
          <button class="primary-button" :disabled="busy || !remote.trim()" @click="enable">{{ t('启用 Git 并同步') }}</button>
        </template>
        <button v-else class="primary-button" :disabled="busy" @click="controller.action('run')"><RefreshCw :size="16" />{{ busy ? t('正在同步…') : t('立即同步') }}</button>
      </template>
      <p v-if="state.lastSynced">{{ t('最近完成：') }}{{ new Date(state.lastSynced).toLocaleString(uiLocale) }}</p>
      <p role="status">{{ state.message }}</p>
      <p v-if="error" role="alert">{{ error }}</p>
      <ul v-if="state.conflicts.length"><li v-for="path in state.conflicts" :key="path">{{ path }}</li></ul>
      <p v-if="state.conflicts.length">{{ t('本地文件未被冲突标记覆盖。请在外部 Git 中合并 origin 对应分支、解决冲突并提交，然后重试。') }}</p>
      <footer><button v-if="state.backend" class="secondary-button" :disabled="busy" @click="controller.action('disable')">{{ t('停用同步') }}</button>
      <button v-if="cloud" class="secondary-button" :disabled="busy || state.backend === 'git'" @click="emit('close'); cloud.open()">{{ t('配置 Tano 云端同步') }}</button>
      <button class="secondary-button" :disabled="busy" @click="controller.action('status')">{{ t('刷新状态') }}</button></footer>
      </template>
    </section>
  </div>
</template>
<style scoped>
.workspace-sync-panel { width: min(900px, calc(100vw - 32px)); max-height: 85vh; overflow: auto; padding: 24px; }
header, h2, footer, nav { display: flex; align-items: center; gap: 12px; } header { justify-content: space-between; } h2 { margin: 0; font-size: 18px; }
nav { margin: 20px 0; } nav [aria-pressed=true] { outline: 2px solid var(--accent, #24845b); }
p { line-height: 1.7; } label { display: grid; gap: 8px; } input { width: 100%; box-sizing: border-box; padding: 8px; } footer { margin-top: 20px; flex-wrap: wrap; } [role=alert] { color: var(--danger, #c33); } li { overflow-wrap: anywhere; }
</style>
