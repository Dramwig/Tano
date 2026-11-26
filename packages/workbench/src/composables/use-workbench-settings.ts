import { computed, ref, type Ref } from 'vue';
import { isMarkdown, isWorkspaceInternalPath, type WorkspaceAdapter } from '@tano/protocol';
import { version as appVersion } from '../../package.json';
import { t } from '../i18n/i18n';
import { mobile } from '../platform/platform';
import type { WorkbenchExtensions } from '../runtime';
import { readSettingsPage } from '../settings/settings-preference';
import { SETTINGS_TAB_ID } from '../settings/settings-tab';
import type { SettingsPageId } from '../settings/settings-window';
import type { useUpdatesStore } from '../stores/updates';
import type { useWorkspaceStore } from '../stores/workspace';
import type { WindowContext } from '../windows/context';
import type { useAuxiliaryWindows } from '../windows/manager';
import { native } from '../workspace/adapter';
import type { useWorkbenchModals } from './use-workbench-modals';
import type { useWorkbenchOutline } from './use-workbench-outline';
import type { useWorkbenchPreferences } from './use-workbench-preferences';

export interface WorkbenchSettingsDeps {
  store: ReturnType<typeof useWorkspaceStore>;
  updates: ReturnType<typeof useUpdatesStore>;
  workspaceAdapter: WorkspaceAdapter;
  extensions: WorkbenchExtensions;
  auxiliaryWindows: ReturnType<typeof useAuxiliaryWindows>;
  activeWindow: Ref<WindowContext>;
  navigationContext: Ref<'home' | 'workspace'>;
  compactPanes: Ref<boolean>;
  sidebar: Ref<boolean>;
  tabsEnabled: boolean;
  menu: Ref<boolean>;
  workspaceMenu: Ref<boolean>;
  settingsPanel: Ref<boolean>;
  agentPanel: Ref<boolean>;
  recyclePanel: Ref<boolean>;
  prefs: ReturnType<typeof useWorkbenchPreferences>;
  outlineCtrl: ReturnType<typeof useWorkbenchOutline>;
  modals: ReturnType<typeof useWorkbenchModals>;
}

export function useWorkbenchSettings(deps: WorkbenchSettingsDeps) {
  const {
    store,
    updates,
    workspaceAdapter,
    extensions,
    auxiliaryWindows,
    activeWindow,
    navigationContext,
    compactPanes,
    sidebar,
    tabsEnabled,
    menu,
    workspaceMenu,
    settingsPanel,
    agentPanel,
    recyclePanel,
    prefs,
    outlineCtrl,
    modals,
  } = deps;

  const settingsPage = ref<SettingsPageId>(readSettingsPage());
  const settingsWorkspace = computed(() =>
    navigationContext.value === 'workspace' ? store.workspace : null,
  );

  function openSettingsTab(page: SettingsPageId) {
    settingsPage.value = page;
    store.openViewTab(SETTINGS_TAB_ID);
    settingsPanel.value = false;
    if (compactPanes.value) sidebar.value = false;
  }

  const openingSettingsWindow = ref(false);
  async function openSettingsInNewWindow(page: SettingsPageId) {
    if (!native || mobile || !tabsEnabled) return;
    settingsPage.value = page;
    if (openingSettingsWindow.value) return;
    openingSettingsWindow.value = true;
    settingsPanel.value = false;
    try {
      activeWindow.value = (
        await auxiliaryWindows.open('settings', 'settings', t('设置') + ' — Tano / 同页')
      ).context;
    } catch (error) {
      settingsPanel.value = true;
      store.report(error);
    } finally {
      openingSettingsWindow.value = false;
    }
  }

  function openSettings(page: SettingsPageId = readSettingsPage(settingsPage.value)) {
    menu.value = false;
    workspaceMenu.value = false;
    settingsPage.value = page === 'preferences' ? 'appearance' : page;
    const pane = store.panes.find((pane) => pane.tabs.includes(SETTINGS_TAB_ID));
    if (pane) {
      store.focusPane(pane.id);
      openSettingsTab(settingsPage.value);
      return;
    }
    settingsPanel.value = true;
  }

  function settingsAction(
    action: 'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' | 'sign-out',
  ) {
    if (!settingsWorkspace.value && ['reveal', 'agent', 'history', 'recycle'].includes(action))
      return;
    settingsPanel.value = false;
    if (action === 'open-folder') void store.openWorkspace();
    else if (action === 'reveal') void store.reveal();
    else if (action === 'agent') agentPanel.value = true;
    else if (action === 'history') extensions.showHistory?.();
    else if (action === 'recycle') recyclePanel.value = true;
  }

  const settingsContext = computed(() => ({
    pluginPages: settingsWorkspace.value ? store.pluginSettingsPages : [],
    workspace: settingsWorkspace.value
      ? {
          id: settingsWorkspace.value.id,
          name: settingsWorkspace.value.name,
          path: settingsWorkspace.value.path,
          readOnly: settingsWorkspace.value.readOnly,
          canDelete: settingsWorkspace.value.canDelete,
          canManageSettings: settingsWorkspace.value.canManageSettings,
        }
      : null,
    activeFile:
      settingsWorkspace.value && store.active
        ? { id: store.active.id, path: store.active.path }
        : null,
    workspaceSettings: store.workspaceSettings,
    workspacePages:
      settingsWorkspace.value?.files
        .filter(
          (file) =>
            file.kind === 'file' && isMarkdown(file.path) && !isWorkspaceInternalPath(file.path),
        )
        .map((file) => ({ id: file.id, path: file.path })) ?? [],
    workspaceSettingsError: store.workspaceSettingsError,
    workspaceSettingsSaving: store.workspaceSettingsSaving,
    workspaceExporting: modals.workspaceExporting.value,
    workspaceExportError: modals.workspaceExportError.value,
    workspaceDeletionSupported: !!workspaceAdapter.deleteWorkspace,
    workspaceDeleting: modals.workspaceDeleting.value || store.busy,
    workspaceDeletionError: modals.workspaceDeletionError.value,
    mode: store.isDemo ? 'demo' : store.isWeb ? 'web' : 'local',
    defaultSource: prefs.defaultSource.value,
    theme: prefs.theme.value,
    appearance: prefs.appearance.value,
    visualFontChoice: prefs.visualFontChoice.value,
    customFontName: prefs.customFontName.value,
    splitFontSettings: prefs.splitFontSettings.value,
    revealMarkdown: prefs.revealMarkdown.value,
    toolbarMode: prefs.toolbarMode.value,
    shortcuts: prefs.shortcuts.value,
    showPageTitle: prefs.showPageTitle.value,
    showDocumentProperties: prefs.showDocumentProperties.value,
    showDocumentDiscussion: prefs.showDocumentDiscussion.value,
    showOutline: outlineCtrl.showOutline.value,
    outlineOnLeft: outlineCtrl.outlineOnLeft.value,
    visualFontSize: prefs.visualFontSize.value,
    sourceFontSize: prefs.sourceFontSize.value,
    editorPreferences: prefs.editorPreferences.value,
    historyEnabled: !!extensions.historyEnabled,
    capabilities: store.capabilities,
    capabilityError: store.capabilityError,
    capabilitySaving: store.capabilitySaving,
    version: updates.state.status?.currentVersion ?? appVersion,
    updates: updates.state,
  }));

  return {
    settingsPage,
    openingSettingsWindow,
    openSettingsTab,
    openSettingsInNewWindow,
    openSettings,
    settingsAction,
    settingsContext,
  };
}
