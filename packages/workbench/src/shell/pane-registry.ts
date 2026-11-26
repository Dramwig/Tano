import { ASSISTANT_TAB_ID } from '../assistant/navigation';
import { isTableTab } from '../data-tables/data-tables';
import { GRAPH_TAB_ID } from '../documents/document-graph';
import { MAIL_TAB_ID } from '../mail/types';
import { CALENDAR_TAB_ID } from '../plans/calendar';
import { PLUGINS_TAB_ID } from '../plugins/workspace-plugins';
import { SETTINGS_TAB_ID } from '../settings/settings-tab';
import type { DocumentTab, OpenDocument } from '../stores/workspace-types';

export type PaneViewKind =
  | 'graph'
  | 'table'
  | 'directory'
  | 'calendar'
  | 'assistant'
  | 'extension'
  | 'settings'
  | 'mail'
  | 'plugin-detail'
  | 'plugin-view'
  | 'plugins'
  | 'document'
  | 'attachment'
  | 'empty';

export interface PaneViewMatchContext {
  activeId: string;
  hasWorkspace: boolean;
  mailEnabled: boolean;
  extensionViewIds: readonly string[];
  tab?: DocumentTab;
  document?: OpenDocument;
}

/**
 * Declaratively resolves the active view kind for a workbench pane, replacing
 * ad-hoc negative `v-else-if` chains across pane shells.
 */
export function resolvePaneViewKind(ctx: PaneViewMatchContext): PaneViewKind {
  const { activeId, hasWorkspace, mailEnabled, extensionViewIds, tab, document } = ctx;
  if (hasWorkspace && activeId === GRAPH_TAB_ID) return 'graph';
  if (hasWorkspace && isTableTab(activeId)) return 'table';
  if (hasWorkspace && tab?.directory) return 'directory';
  if (hasWorkspace && activeId === CALENDAR_TAB_ID) return 'calendar';
  if (activeId === ASSISTANT_TAB_ID) return 'assistant';
  if (extensionViewIds.includes(activeId)) return 'extension';
  if (activeId === SETTINGS_TAB_ID) return 'settings';
  if (mailEnabled && activeId === MAIL_TAB_ID) return 'mail';
  if (tab?.pluginDetail) return 'plugin-detail';
  if (activeId.startsWith('plugin:')) return 'plugin-view';
  if (hasWorkspace && activeId === PLUGINS_TAB_ID) return 'plugins';
  if (document) return 'document';
  if (hasWorkspace && activeId.startsWith('attachment:')) return 'attachment';
  return 'empty';
}

export function isEmptyPaneFallback(ctx: PaneViewMatchContext & { startupPending: boolean }): boolean {
  if (!ctx.hasWorkspace && !ctx.startupPending) return false;
  if (ctx.activeId === GRAPH_TAB_ID) return false;
  if (ctx.activeId === PLUGINS_TAB_ID) return false;
  if (ctx.activeId === CALENDAR_TAB_ID) return false;
  if (ctx.activeId === SETTINGS_TAB_ID) return false;
  if (ctx.mailEnabled && ctx.activeId === MAIL_TAB_ID) return false;
  if (isTableTab(ctx.activeId)) return false;
  if (ctx.activeId.startsWith('plugin:')) return false;
  if (ctx.tab?.directory || ctx.tab?.pluginView) return false;
  if (ctx.extensionViewIds.includes(ctx.activeId)) return false;
  return true;
}
