import type { ComputedRef, InjectionKey } from 'vue';
import type { EditorPreferences, WorkspaceCapabilities } from '@tano/editor/runtime';
import type { AppearanceSelection, AppearanceSnapshot } from '../../appearance';
import type { SplitFontSettings, VisualFontChoice } from '../../editor-font';
import type { PluginInteraction, PluginSettingsPage } from '../../plugins/workbench';
import type { SettingsPage, SettingsPageContext } from '../../runtime';
import type { ShortcutBindings } from '../../shortcuts';
import type { ThemePreference } from '../../theme';
import type { ToolbarMode } from '../../toolbar-preference';
import type { CapabilityPatch } from '../../workspace-capabilities';
import type { WorkspaceSettings, WorkspaceSettingsPatch } from '../../workspace-settings';

export type SettingsAction =
  | 'open-folder'
  | 'switch-mode'
  | 'reveal'
  | 'agent'
  | 'history'
  | 'recycle'
  | 'sign-out';

export interface SettingsPanelProps {
  workspace: SettingsPageContext['workspace'];
  workspaceSettings?: WorkspaceSettings;
  workspacePages?: { id: string; path: string }[];
  workspaceSettingsError?: string;
  workspaceSettingsSaving?: boolean;
  workspaceExporting?: boolean;
  workspaceExportError?: string;
  workspaceDeletionSupported?: boolean;
  workspaceDeleting?: boolean;
  workspaceDeletionError?: string;
  activeFile?: SettingsPageContext['activeFile'];
  windowed?: boolean;
  tabbed?: boolean;
  canOpenTab?: boolean;
  canOpenWindow?: boolean;
  openingWindow?: boolean;
  extraPages?: SettingsPage[];
  pluginPages?: PluginSettingsPage[];
  executePlugin?: (interaction: PluginInteraction) => Promise<void>;
  mode: 'demo' | 'web' | 'local';
  native: boolean;
  mobile: boolean;
  developerMode?: boolean;
  defaultSource: boolean;
  theme: ThemePreference;
  appearance?: AppearanceSnapshot;
  visualFontChoice: VisualFontChoice;
  customFontName: string;
  splitFontSettings?: SplitFontSettings;
  revealMarkdown: boolean;
  toolbarMode?: ToolbarMode;
  shortcuts?: ShortcutBindings;
  showPageTitle: boolean;
  showDocumentProperties: boolean;
  showDocumentDiscussion: boolean;
  showOutline: boolean;
  outlineOnLeft?: boolean;
  visualFontSize: number;
  sourceFontSize: number;
  historyEnabled: boolean;
  version: string;
  documentationBaseUrl?: string;
  initialPage?: string;
  rememberPage?: boolean;
  capabilities?: WorkspaceCapabilities;
  editorPreferences?: EditorPreferences;
  capabilityError?: string;
  capabilitySaving?: boolean;
}

export interface SettingsPanelContext {
  props: SettingsPanelProps;
  scopeLabel: ComputedRef<string>;
  display: ComputedRef<EditorPreferences>;
  rules: ComputedRef<WorkspaceCapabilities>;
  rulesDisabled: ComputedRef<boolean>;
  fixedDisplayMode: ComputedRef<'light' | 'dark' | undefined>;
  frostActive: ComputedRef<boolean>;
  displayMode: ComputedRef<ThemePreference>;
  displayModeDescription: ComputedRef<string>;
  showDeveloperMode: ComputedRef<boolean>;
  developerModeDescription: string;
  splitFonts: ComputedRef<SplitFontSettings>;
  emitUpdateDeveloperMode: (value: boolean) => void;
  emitUpdateDefaultSource: (value: boolean) => void;
  emitUpdateTheme: (value: ThemePreference) => void;
  emitAppearance: (selection: AppearanceSelection) => void;
  emitUpdateVisualFontChoice: (value: VisualFontChoice) => void;
  emitUpdateCustomFontName: (value: string) => void;
  emitUpdateSplitFontSettings: (value: SplitFontSettings) => void;
  emitUpdateRevealMarkdown: (value: boolean) => void;
  emitUpdateToolbarMode: (value: ToolbarMode) => void;
  emitUpdateShortcuts: (value: ShortcutBindings) => void;
  emitUpdateShowPageTitle: (value: boolean) => void;
  emitUpdateShowDocumentProperties: (value: boolean) => void;
  emitUpdateShowDocumentDiscussion: (value: boolean) => void;
  emitUpdateShowOutline: (value: boolean) => void;
  emitUpdateOutlineOnLeft: (value: boolean) => void;
  emitUpdateVisualFontSize: (value: number) => void;
  emitUpdateSourceFontSize: (value: number) => void;
  emitAction: (value: SettingsAction) => void;
  emitCapability: (value: CapabilityPatch) => void;
  emitUpdateEditorPreferences: (value: EditorPreferences) => void;
  emitWorkspaceSetting: (workspaceId: string, patch: WorkspaceSettingsPatch) => void;
  emitWorkspaceSettingsReload: () => void;
  emitWorkspaceExport: (workspaceId: string) => void;
  emitWorkspaceDelete: (workspaceId: string) => void;
}

export const settingsPanelContextKey: InjectionKey<SettingsPanelContext> =
  Symbol('tano-settings-panel');
