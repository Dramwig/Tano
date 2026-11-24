import type { WorkspaceSettings } from '../workspace/workspace-settings';
import type { AppearanceSnapshot } from '../appearance/appearance';
import type { PluginSettingsPage } from '../plugins/workbench';
import type { SettingsPageContext } from '../runtime';
import type { EditorPreferences, WorkspaceCapabilities } from '@tano/editor/runtime';
import type { ThemePreference } from '../appearance/theme';
import type { SplitFontSettings, VisualFontChoice } from '../appearance/editor-font';
import type { ToolbarMode } from '../shell/toolbar-preference';
import type { ShortcutBindings } from '../shell/shortcuts';
import type { UpdateCandidate, UpdatePhase, UpdateProgress, UpdateStatus } from '../updates/controller';

/** Built-in pages and IDs registered by a product's settings extension. */
export type SettingsPageId = 'preferences' | 'appearance' | 'editing' | 'shortcuts' | 'assistant' | 'workspace' | 'about' | (string & {});
export type SettingsAction =
  'open-folder' | 'switch-mode' | 'reveal' | 'agent' | 'history' | 'recycle' |
  'sign-out';

export interface SettingsValues {
  defaultSource: boolean;
  theme: ThemePreference;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  splitFontSettings?: SplitFontSettings;
  revealMarkdown: boolean;
  toolbarMode: ToolbarMode;
  shortcuts: ShortcutBindings;
  showPageTitle: boolean;
  showDocumentProperties: boolean;
  showDocumentDiscussion: boolean;
  showOutline: boolean;
  outlineOnLeft: boolean;
  visualFontSize: number;
  sourceFontSize: number;
  editorPreferences: EditorPreferences;
}

export interface SettingsSnapshot extends SettingsValues, SettingsPageContext {
  appearance?: AppearanceSnapshot;
  pluginPages?: PluginSettingsPage[];
  workspaceSettings: WorkspaceSettings;
  workspacePages: { id: string; path: string }[];
  workspaceSettingsError: string;
  workspaceSettingsSaving: boolean;
  workspaceExporting: boolean;
  workspaceExportError: string;
  workspaceDeletionSupported?: boolean;
  workspaceDeleting?: boolean;
  workspaceDeletionError?: string;
  historyEnabled: boolean;
  capabilities: WorkspaceCapabilities;
  capabilityError: string;
  capabilitySaving: boolean;
  version: string;
  updates: {
    phase: UpdatePhase;
    status?: UpdateStatus;
    candidate?: UpdateCandidate;
    progress: UpdateProgress;
    error: string;
    busy: boolean;
  };
}
