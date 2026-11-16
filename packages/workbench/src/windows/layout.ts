import type { WorkspaceLayout } from '@tano/protocol';
import { dockLayout, layoutPanes, mapLayout, newPane, type PaneDrop } from '../pane-layout';

export interface WindowLayout {
  layout: WorkspaceLayout;
  activePaneId: string;
}
export type WindowLayouts = Record<string, WindowLayout>;

export function newWindowLayout(tabs: string[] = []): WindowLayout {
  const layout = newPane(tabs);
  return { layout, activePaneId: layout.id };
}

function withLayout(previous: WindowLayout, layout: WorkspaceLayout, activeTab?: string): WindowLayout {
  const panes = layoutPanes(layout);
  const active = activeTab ? panes.find(pane => pane.tabs.includes(activeTab)) : undefined;
  return {
    layout,
    activePaneId: active?.id ?? panes.find(pane => pane.id === previous.activePaneId)?.id ?? panes[0].id,
  };
}

/** Removes layout ownership only. The caller saves and closes document state separately. */
export function removeWindowTab(windows: WindowLayouts, tabId: string): WindowLayouts {
  const source = Object.entries(windows).find(([, state]) => layoutPanes(state.layout).some(pane => pane.tabs.includes(tabId)));
  if (!source) return windows;
  const [id, state] = source;
  const layout = mapLayout(state.layout, pane => {
    const tabs = pane.tabs.filter(tab => tab !== tabId);
    return tabs.length ? { ...pane, tabs, activeId: tabs.includes(pane.activeId) ? pane.activeId : tabs.at(-1)! } : null;
  });
  const next = { ...windows };
  if (layout) next[id] = withLayout(state, layout);
  else if (id === 'main') next[id] = newWindowLayout();
  else delete next[id];
  return next;
}

export function moveWindowTab(windows: WindowLayouts, tabId: string, targetId: string, drop: PaneDrop): WindowLayouts {
  const source = Object.entries(windows).find(([, state]) => layoutPanes(state.layout).some(pane => pane.tabs.includes(tabId)));
  const target = windows[targetId];
  if (!source || !target || !layoutPanes(target.layout).some(pane => pane.id === drop.paneId)) return windows;
  if (source[0] === targetId) {
    const layout = dockLayout(target.layout, tabId, drop);
    return { ...windows, [targetId]: withLayout(target, layout, tabId) };
  }
  const next = removeWindowTab(windows, tabId);
  // Seed the receiving pane so the existing docking algorithm handles splitting,
  // ordering and active-tab selection with the same rules as a local drag.
  const seeded = mapLayout(target.layout, pane => pane.id === drop.paneId
    ? { ...pane, tabs: [...pane.tabs, tabId], activeId: tabId } : pane)!;
  const layout = dockLayout(seeded, tabId, drop);
  return { ...next, [targetId]: withLayout(target, layout, tabId) };
}

export function moveTabToNewWindow(windows: WindowLayouts, tabId: string, id: string): WindowLayouts {
  if (windows[id] || !Object.values(windows).some(state => layoutPanes(state.layout).some(pane => pane.tabs.includes(tabId)))) return windows;
  return { ...removeWindowTab(windows, tabId), [id]: newWindowLayout([tabId]) };
}

export function closeWindowLayout(windows: WindowLayouts, id: string): WindowLayouts {
  if (!windows[id]) return windows;
  if (id === 'main') return { ...windows, main: newWindowLayout() };
  const next = { ...windows };
  delete next[id];
  return next;
}
