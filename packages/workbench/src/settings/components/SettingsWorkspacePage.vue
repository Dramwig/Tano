<script setup lang="ts">
import { inject } from 'vue';
import { BookOpen, Bot, ExternalLink, FolderOpen, History, Trash2 } from 'lucide-vue-next';
import { t } from '../../i18n/i18n';
import WorkspaceDeletionSettings from '../../workspace/components/WorkspaceDeletionSettings.vue';
import WorkspaceGeneralSettings from '../../workspace/components/WorkspaceGeneralSettings.vue';
import { settingsPanelContextKey } from './settings-context';

const ctx = inject(settingsPanelContextKey);
if (!ctx) throw new Error('Settings panel context is required');
const { props, scopeLabel } = ctx;
</script>

<template>
  <div class="settings-content">
    <div class="settings-title-line">
      <h2 id="settings-title">{{ t('基本设置') }}</h2>
      <div class="settings-page-scope" role="note" tabindex="0" :aria-label="scopeLabel">
        <BookOpen :size="13" /><span>{{ scopeLabel }}</span>
      </div>
    </div>
    <p class="settings-lead">{{ t('管理工作区名称、图标、默认页面、页面标题来源、侧栏与内容导出。') }}</p>
    <WorkspaceGeneralSettings
      :key="props.workspace?.id"
      :workspace="props.workspace"
      :settings="props.workspaceSettings"
      :pages="props.workspacePages"
      :mode="props.mode"
      :saving="props.workspaceSettingsSaving || props.workspaceDeleting"
      :error="props.workspaceSettingsError"
      :exporting="props.workspaceExporting || props.workspaceDeleting"
      :export-error="props.workspaceExportError"
      @change="(id, patch) => ctx.emitWorkspaceSetting(id, patch)"
      @reload="ctx.emitWorkspaceSettingsReload()"
      @export="ctx.emitWorkspaceExport($event)"
    >
      <template #current-space>
        <div class="settings-card settings-workspace-card" data-surface-role="section">
          <div class="settings-info">
            <strong>{{ props.workspace?.name ?? t('尚未打开工作区') }}</strong>
            <span>{{
              props.mode === 'demo'
                ? t('浏览器演示 · 保存在当前浏览器')
                : props.mode === 'web'
                  ? t('在线工作区 · Markdown 保存在服务器')
                  : t('本地工作区 · Markdown 保存在文件夹')
            }}</span>
            <small v-if="props.workspace && props.mode === 'local'">{{ props.workspace.path }}</small>
          </div>
          <div class="settings-actions">
            <button v-if="props.mode === 'local' && props.native && !props.mobile" @click="ctx.emitAction('open-folder')">
              <FolderOpen :size="17" />{{ t('打开工作文件夹') }}
            </button>
            <button v-if="props.mode === 'local' && props.native && !props.mobile && props.workspace" @click="ctx.emitAction('reveal')">
              <ExternalLink :size="17" />{{ t('在资源管理器中显示') }}
            </button>
            <button v-if="props.mode === 'local' && props.native && props.workspace" @click="ctx.emitAction('agent')">
              <Bot :size="17" />{{ t('与 Agent 一起工作') }}
            </button>
            <button v-if="props.mode === 'local' && props.native && props.workspace && props.historyEnabled" @click="ctx.emitAction('history')">
              <History :size="17" />{{ t('空间版本历史') }}
            </button>
            <button v-if="props.mobile && props.workspace" @click="ctx.emitAction('recycle')">
              <Trash2 :size="17" />{{ t('手机回收站') }}
            </button>
          </div>
        </div>
      </template>
      <template #members-export><slot name="workspace-members-export" /></template>
    </WorkspaceGeneralSettings>
    <WorkspaceDeletionSettings
      v-if="props.mode !== 'demo' && props.workspaceDeletionSupported"
      :key="props.workspace?.id"
      :workspace="props.workspace"
      :mode="props.mode"
      :busy="props.workspaceDeleting || props.workspaceSettingsSaving || props.workspaceExporting"
      :error="props.workspaceDeletionError"
      @delete="ctx.emitWorkspaceDelete($event)"
    />
  </div>
</template>
