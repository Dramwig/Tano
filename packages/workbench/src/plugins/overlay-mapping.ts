import type { PluginWorkbenchView } from './workbench';

const WORKSPACE_VIEW_OVERLAY_MAP: Record<string, readonly string[]> = {
  repository: ['files'],
  events: ['tasks', 'calendar'],
  'plugin-views': ['plugins'],
};

const SIDEBAR_NAV_OVERLAY_MAP: Record<string, readonly string[]> = {
  plan: ['calendar', 'tasks'],
  mail: ['mail'],
  'view:mail': ['mail'],
  search: ['search'],
  graph: ['graph'],
  files: ['files'],
  objects: ['objects'],
  relations: ['relations'],
  plugins: ['plugins'],
};

function mappedOverlayIds(
  itemId: string,
  table: Record<string, readonly string[]>,
): readonly string[] {
  if (itemId in table) return table[itemId];
  const stripped = itemId.startsWith('view:') ? itemId.slice(5) : itemId;
  if (stripped in table) return table[stripped];
  return [];
}

/**
 * Checks whether a home sidebar navigation item or sidebar header button is hidden
 * by an optional host-provided WorkbenchOverlayExtension.
 */
export function isOverlaySidebarNavHidden(
  itemId: string,
  hidden?: readonly string[],
): boolean {
  if (!hidden?.length) return false;
  const mapped = mappedOverlayIds(itemId, SIDEBAR_NAV_OVERLAY_MAP);
  if (!mapped.length) return false;
  if (itemId === 'plan') {
    return hidden.includes('calendar') || hidden.includes('tasks');
  }
  return mapped.some((id) => hidden.includes(id));
}

/**
 * Computes CSS flex `order` style for a home sidebar navigation button when
 * sidebar ordering is provided by an optional host WorkbenchOverlayExtension.
 */
export function overlaySidebarNavOrderStyle(
  itemId: string,
  order?: readonly string[],
): { order: number } | undefined {
  if (!order?.length) return undefined;
  const mapped = mappedOverlayIds(itemId, SIDEBAR_NAV_OVERLAY_MAP);
  if (!mapped.length) return undefined;
  let best = Number.POSITIVE_INFINITY;
  for (const key of mapped) {
    const idx = order.indexOf(key);
    if (idx >= 0 && idx < best) best = idx;
  }
  return Number.isFinite(best) ? { order: best } : undefined;
}

/**
 * Applies optional overlay `hiddenSidebarItems` and `sidebarOrder` to the workspace sidebar
 * view tabs (`repository`, `events`, `assistant`, `plugin-views`, `plugin-sidebar:*`).
 * Always keeps at least one tab visible so the workspace sidebar can never become empty.
 */
export function applyOverlayToWorkspaceViews<T extends { id: string }>(
  views: readonly T[],
  hidden?: readonly string[],
  order?: readonly string[],
): T[] {
  const hiddenSet = new Set(hidden ?? []);
  let filtered = views.filter((view) => {
    const mapped = WORKSPACE_VIEW_OVERLAY_MAP[view.id];
    if (!mapped?.length) return true;
    return !mapped.some((key) => hiddenSet.has(key));
  });
  if (!filtered.length && views.length) {
    filtered = [views[0]];
  }
  if (!order?.length || filtered.length <= 1) return filtered;

  const rankOf = (viewId: string): number => {
    const mapped = WORKSPACE_VIEW_OVERLAY_MAP[viewId];
    if (!mapped?.length) return Number.POSITIVE_INFINITY;
    let best = Number.POSITIVE_INFINITY;
    for (const key of mapped) {
      const idx = order.indexOf(key);
      if (idx >= 0 && idx < best) best = idx;
    }
    return best;
  };

  return filtered
    .map((view, index) => ({ view, index, rank: rankOf(view.id) }))
    .sort((a, b) => (a.rank !== b.rank ? a.rank - b.rank : a.index - b.index))
    .map((entry) => entry.view);
}

/**
 * Resolves which Tier 2 custom plugin view (if any) replaces `<EmptyEditor>` inside
 * `.workspace-no-tabs` for the current pane.
 * - Blank new tab (`blank:*`) -> `newTabView`
 * - Empty workspace (no active tab) -> `homeTabView`
 * - Safe Mode always disables custom tab replacement and returns `null`.
 */
export function resolveOverlayTabView(
  activeTabId: string,
  options: {
    safeMode?: boolean;
    homeTabView?: PluginWorkbenchView | null;
    newTabView?: PluginWorkbenchView | null;
  },
): PluginWorkbenchView | null {
  if (options.safeMode) return null;
  if (activeTabId.startsWith('blank:')) {
    return options.newTabView ?? null;
  }
  return options.homeTabView ?? null;
}
