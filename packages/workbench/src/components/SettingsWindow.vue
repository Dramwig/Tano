<script setup lang="ts">
import LoadingSkeleton from './LoadingSkeleton.vue';
import AppTooltip from './AppTooltip.vue';
import { t } from '../i18n';
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import SettingsPanel from './SettingsPanel.vue';
import UpdatePanel from './UpdatePanel.vue';
import { useWorkbenchRuntime } from '../runtime';
import {
  SETTINGS_COMMAND, SETTINGS_NAVIGATE, SETTINGS_RENDERED, SETTINGS_STATE, SETTINGS_PLUGIN_RESULT, settingsWindowRequest,
} from '../settings-window';
import type {
  SettingsAction, SettingsCommand, SettingsPageId, SettingsSnapshot, SettingsValues,
} from '../settings-window';
import type { CapabilityPatch } from '../workspace-capabilities';
import { applyTheme } from '../theme';
import type { PluginInteraction } from '../plugins/workbench';

const request = settingsWindowRequest()!;
const extensions = useWorkbenchRuntime().extensions?.();
const snapshot = ref<SettingsSnapshot | null>(null);
const page = ref<SettingsPageId>(request.page);
const error = ref('');
const unlisten: Array<() => void> = [];
let mounted = false;
let rendered = false;
const pluginCalls = new Map<string, { resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }>();
function executePlugin(interaction: PluginInteraction) {
  const requestId = crypto.randomUUID();
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { pluginCalls.delete(requestId); reject(new Error(t('插件操作未返回，请检查工作台状态'))); }, 35000);
    pluginCalls.set(requestId, { resolve, reject, timer });
    void emitTo(request.opener, SETTINGS_COMMAND, { type: 'plugin-invoke', requestId, interaction } satisfies SettingsCommand)
      .catch(error => { clearTimeout(timer); pluginCalls.delete(requestId); reject(error); });
  });
}

async function send(command: SettingsCommand) {
  try {
    await emitTo(request.opener, SETTINGS_COMMAND, command);
  } catch (cause) {
    error.value = t('无法与工作台通信：{0}', [String(cause)]);
  }
}

function change(key: keyof SettingsValues, value: SettingsValues[keyof SettingsValues]) {
  if (snapshot.value) snapshot.value = { ...snapshot.value, [key]: value };
  if (key === 'theme') applyTheme(value as SettingsValues['theme']);
  void send({ type: 'change', key, value });
}

async function action(value: SettingsAction) {
  await send({ type: 'action', value });
  if (!error.value) await getCurrentWindow().close();
}

function dragWindow(event: MouseEvent) {
  if (event.button === 0 && event.detail === 1) void getCurrentWindow().startDragging();
}

onMounted(async () => {
  mounted = true;
  const appWindow = getCurrentWindow();
  const closeListener = await appWindow.onCloseRequested(event => {
    event.preventDefault();
    void appWindow.hide();
  });
  if (!mounted) { closeListener(); return; }
  unlisten.push(closeListener);
  const stateListener = await listen<SettingsSnapshot>(SETTINGS_STATE, async event => {
    snapshot.value = event.payload;
    applyTheme(event.payload.theme);
    if (!rendered) {
      await nextTick();
      rendered = true;
      void emitTo(request.opener, SETTINGS_RENDERED, { label: appWindow.label }).catch(() => {});
    }
  });
  if (!mounted) { stateListener(); return; }
  unlisten.push(stateListener);
  const navigationListener = await listen<SettingsPageId>(SETTINGS_NAVIGATE, event => {
    page.value = event.payload;
  });
  if (!mounted) { navigationListener(); return; }
  unlisten.push(navigationListener);
  const resultListener = await listen<{ requestId: string; error?: string }>(SETTINGS_PLUGIN_RESULT, event => {
    const pending = pluginCalls.get(event.payload.requestId);
    if (!pending) return;
    clearTimeout(pending.timer); pluginCalls.delete(event.payload.requestId);
    if (event.payload.error) pending.reject(new Error(event.payload.error)); else pending.resolve();
  });
  if (!mounted) { resultListener(); return; }
  unlisten.push(resultListener);
  await send({ type: 'ready' });
});

onBeforeUnmount(() => {
  for (const pending of pluginCalls.values()) { clearTimeout(pending.timer); pending.reject(new Error(t('设置窗口已关闭'))); }
  pluginCalls.clear();
  mounted = false;
  for (const stop of unlisten) stop();
  void extensions?.disconnect().catch(() => {});
});
</script>

<template>
  <AppTooltip />
  <LoadingSkeleton v-if="!snapshot" variant="shell" />
  <SettingsPanel
    v-else
    :key="page"
    windowed
    :workspace="snapshot.workspace"
    :workspace-settings="snapshot.workspaceSettings"
    :workspace-pages="snapshot.workspacePages"
    :workspace-settings-error="snapshot.workspaceSettingsError"
    :workspace-settings-saving="snapshot.workspaceSettingsSaving"
    :workspace-exporting="snapshot.workspaceExporting"
    :workspace-export-error="snapshot.workspaceExportError"
    :workspace-deletion-supported="snapshot.workspaceDeletionSupported"
    :workspace-deleting="snapshot.workspaceDeleting"
    :workspace-deletion-error="snapshot.workspaceDeletionError"
    :active-file="snapshot.activeFile"
    :extra-pages="extensions?.settingsPages"
    :plugin-pages="snapshot.pluginPages"
    :execute-plugin="executePlugin"
    :mode="snapshot.mode"
    :native="true"
    :mobile="false"
    :default-source="snapshot.defaultSource"
    :theme="snapshot.theme"
    :visual-font-choice="snapshot.visualFontChoice"
    :custom-font-name="snapshot.customFontName"
    :reveal-markdown="snapshot.revealMarkdown"
    :toolbar-mode="snapshot.toolbarMode"
    :shortcuts="snapshot.shortcuts"
    :show-page-title="snapshot.showPageTitle"
    :show-document-properties="snapshot.showDocumentProperties"
    :show-document-discussion="snapshot.showDocumentDiscussion"
    :show-outline="snapshot.showOutline"
    :outline-on-left="snapshot.outlineOnLeft"
    :visual-font-size="snapshot.visualFontSize"
    :source-font-size="snapshot.sourceFontSize"
    :history-enabled="snapshot.historyEnabled"
    :capabilities="snapshot.capabilities"
    :version="snapshot.version"
    :initial-page="page"
    :editor-preferences="snapshot.editorPreferences"
    :capability-error="snapshot.capabilityError"
    :capability-saving="snapshot.capabilitySaving"
    @close="getCurrentWindow().close()"
    @drag-window="dragWindow"
    @update:default-source="change('defaultSource', $event)"
    @update:theme="change('theme', $event)"
    @update:visual-font-choice="change('visualFontChoice', $event)"
    @update:custom-font-name="change('customFontName', $event)"
    @update:reveal-markdown="change('revealMarkdown', $event)"
    @update:toolbar-mode="change('toolbarMode', $event)"
    @update:shortcuts="change('shortcuts', $event)"
    @update:show-page-title="change('showPageTitle', $event)"
    @update:show-document-properties="change('showDocumentProperties', $event)"
    @update:show-document-discussion="change('showDocumentDiscussion', $event)"
    @update:show-outline="change('showOutline', $event)"
    @update:outline-on-left="change('outlineOnLeft', $event)"
    @update:visual-font-size="change('visualFontSize', $event)"
    @update:source-font-size="change('sourceFontSize', $event)"
    @update:editor-preferences="change('editorPreferences', $event)"
    @capability="send({ type: 'capability', value: $event as CapabilityPatch })"
    @workspace-setting="(workspaceId, patch) => send({ type: 'workspace-setting', workspaceId, patch })"
    @workspace-settings-reload="send({ type: 'workspace-settings-reload' })"
    @workspace-export="send({ type: 'workspace-export', workspaceId: $event })"
    @workspace-delete="send({ type: 'workspace-delete', workspaceId: $event })"
    @assistant-changed="send({ type: 'assistant-refresh' })"
    @action="action"
  >
    <template #workspace-members-export>
      <component v-if="extensions?.regions['workspace-members-export']" :is="extensions.regions['workspace-members-export']" :workspace="snapshot.workspace" :mode="snapshot.mode" />
    </template>
    <template #update-panel>
      <UpdatePanel remote :remote-state="snapshot.updates" @activate="send({ type: 'update' })" />
    </template>
  </SettingsPanel>
  <p v-if="error" class="settings-window-error" role="alert">{{ error }}</p>
</template>

<style>
.settings-window-loading {
  display: grid;
  place-items: center;
  min-height: 100dvh;
  color: var(--muted);
  background: var(--paper);
}
.settings-window-error {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 100;
  max-width: 440px;
  padding: 12px;
  border: 1px solid var(--warning);
  border-radius: 8px;
  background: var(--paper);
  color: var(--warning);
}
</style>
