<script setup lang="ts">
import { inject, toRefs } from 'vue';
import { workbenchContextKey } from '../workbench-context';
import { useWindowContext } from '../windows/context';
defineProps<{ tabbed?: boolean; windowed?: boolean }>();
const context = inject(workbenchContextKey);
if (!context) throw new Error('Workbench context is required');
const windowContext = useWindowContext();
const { native, mobile, workspace, shortcuts, store, tabsEnabled, extensions, updates, editorPreferences, showPageTitle, showDocumentProperties, showOutline, outlineOnLeft, active, settingsWorkspace, openingSettingsWindow, openSettingsTab, openSettingsInNewWindow, settingsPage, workspaceExporting, workspaceExportError, workspaceDeletionError, deleteWorkspace, exportWorkspace, defaultSource, theme, appearance, appearanceController, visualFontChoice, customFontName, splitFontSettings, revealMarkdown, toolbarMode, showDocumentDiscussion, visualFontSize, sourceFontSize, appVersion, documentationBaseUrl, assistant, settingsAction, SettingsPanel, settingsContext } = toRefs(context);
function closeSettings() {
  if (windowContext.id === 'settings') void context!.auxiliaryWindows.close('settings');
  else context!.settingsPanel = false;
}
</script>
<template>
    <SettingsPanel
      @drag-window="event => { if (event.button === 0) void windowContext.native?.startDragging(); }"
      :tabbed="tabbed"
      :windowed="windowed"
      :can-open-tab="tabsEnabled && !!settingsWorkspace"
      :can-open-window="native && !mobile && tabsEnabled"
      :opening-window="openingSettingsWindow"
      @open-tab="openSettingsTab"
      @open-window="openSettingsInNewWindow"
      @page-change="settingsPage = $event"
      :workspace="settingsContext.workspace"
      :extra-pages="extensions.settingsPages"
      :plugin-pages="settingsContext.pluginPages"
      :execute-plugin="store.interactWithPlugin"
      :workspace-settings="store.workspaceSettings"
      :workspace-pages="settingsContext.workspacePages"
      :workspace-settings-error="store.workspaceSettingsError"
      :workspace-settings-saving="store.workspaceSettingsSaving"
      :workspace-exporting="workspaceExporting"
      :workspace-export-error="workspaceExportError"
      :workspace-deletion-supported="settingsContext.workspaceDeletionSupported"
      :workspace-deleting="settingsContext.workspaceDeleting"
      :workspace-deletion-error="workspaceDeletionError"
      @workspace-delete="deleteWorkspace"
      @workspace-setting="store.updateWorkspaceSettings"
      @workspace-settings-reload="store.reloadWorkspaceSettings"
      @workspace-export="exportWorkspace"
      :active-file="settingsContext.activeFile"
      :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'"
      :native="native"
      :mobile="mobile"
      :default-source="defaultSource"
      :theme="theme"
      :appearance="appearance"
      @appearance="appearanceController.select($event)"
      :visual-font-choice="visualFontChoice"
      :custom-font-name="customFontName"
      :split-font-settings="splitFontSettings"
      :reveal-markdown="revealMarkdown"
      :toolbar-mode="toolbarMode"
      :shortcuts="shortcuts"
      :show-page-title="showPageTitle"
      :show-document-properties="showDocumentProperties"
      :show-document-discussion="showDocumentDiscussion"
      :show-outline="showOutline"
      :outline-on-left="outlineOnLeft"
      :visual-font-size="visualFontSize"
      :source-font-size="sourceFontSize"
      :history-enabled="!!extensions.historyEnabled"
      :capabilities="store.capabilities"
      :version="updates.state.status?.currentVersion ?? appVersion"
      :documentation-base-url="documentationBaseUrl"
      :initial-page="settingsPage"
      :editor-preferences="editorPreferences"
      :capability-error="store.capabilityError"
      :capability-saving="store.capabilitySaving"
      @capability="store.updateCapabilities"
      @assistant-changed="assistant.reloadConnections"
      @update:editor-preferences="editorPreferences = $event"
      @close="closeSettings"
      @update:default-source="defaultSource = $event"
      @update:theme="theme = $event"
      @update:visual-font-choice="visualFontChoice = $event"
      @update:custom-font-name="customFontName = $event"
      @update:split-font-settings="splitFontSettings = $event"
      @update:reveal-markdown="revealMarkdown = $event"
      @update:toolbar-mode="toolbarMode = $event"
      @update:shortcuts="shortcuts = $event"
      @update:show-page-title="showPageTitle = $event"
      @update:show-document-properties="showDocumentProperties = $event"
      @update:show-document-discussion="showDocumentDiscussion = $event"
      @update:show-outline="showOutline = $event"
      @update:outline-on-left="outlineOnLeft = $event"
      @update:visual-font-size="visualFontSize = $event"
      @update:source-font-size="sourceFontSize = $event"
      @action="settingsAction"
    >
      <template #workspace-members-export>
        <component v-if="extensions.regions['workspace-members-export']" :is="extensions.regions['workspace-members-export']" :workspace="workspace" :mode="store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local'" />
      </template>
    </SettingsPanel>

</template>
