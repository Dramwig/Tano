import type { FileEntry, PluginManifest } from '@tano/protocol';
import type { OpenDocument } from '../documents/document-session';
import type { PluginWorkbenchView } from '../plugins/workbench';
import type { WorkbenchViewTab } from '../runtime';

export type { OpenDocument } from '../documents/document-session';

export interface DocumentTab {
  id: string;
  path: string;
  blank: boolean;
  graph: boolean;
  plugins: boolean;
  calendar: boolean;
  view?: WorkbenchViewTab;
  directory?: { path: string; name: string; missing: boolean };
  pluginView?: PluginWorkbenchView;
  pluginDetail?: PluginManifest;
  document?: OpenDocument;
  attachmentPreview: boolean;
  attachment?: FileEntry;
  dataTable?: { name: string; dirty: boolean; icon?: string };
}

export interface Activity {
  id: string;
  label: string;
  detail: string;
  time: number;
  kind: 'external' | 'save' | 'conflict' | 'file';
  change?: { before: string; after: string };
}

export interface WorkspaceLoadingState {
  files: boolean;
  session: boolean;
  settings: boolean;
  tables: boolean;
  plugins: boolean;
  objects: boolean;
  relations: boolean;
  capabilities: boolean;
}

export interface WorkspaceLifecycleHooks {
  beforeSwitch?: () => Promise<void>;
  beforeWorkspaceChange?: () => Promise<void>;
  afterSwitch?: () => Promise<void>;
  beforeCloseDocument?: (id: string) => Promise<void>;
}
