import type { WorkspaceLayout, WorkspacePane } from '@tano/protocol';

export type DockSide = 'center' | 'left' | 'right' | 'top' | 'bottom';
export interface PaneDrop { paneId: string; side: DockSide; index?: number }
export const newPane = (tabs: string[] = []): WorkspacePane => ({
  kind: 'pane', id: crypto.randomUUID(), tabs, activeId: tabs[0] ?? '',
});
export function layoutPanes(node: WorkspaceLayout): WorkspacePane[] {
  return node.kind === 'pane' ? [node] : [...layoutPanes(node.first), ...layoutPanes(node.second)];
}
export function mapLayout(node: WorkspaceLayout, visit: (pane: WorkspacePane) => WorkspaceLayout | null): WorkspaceLayout | null {
  if (node.kind === 'pane') return visit(node);
  const first = mapLayout(node.first, visit), second = mapLayout(node.second, visit);
  return first && second ? { ...node, first, second } : first ?? second;
}
// Session layout is application state, never a source of document content. Discard
// stale/duplicate IDs and malformed branches without discarding recovered drafts.
export function restoreLayout(value: unknown, tabs: string[], remapped = new Map<string, string>()): WorkspaceLayout {
  const seen = new Set<string>(), nodes = new Set<string>();
  function parse(value: unknown, depth: number): WorkspaceLayout | null {
    if (!value || typeof value !== 'object' || depth > 32) return null;
    const row = value as Record<string, unknown>;
    if (typeof row.id !== 'string' || nodes.has(row.id)) return null;
    nodes.add(row.id);
    if (row.kind === 'pane' && Array.isArray(row.tabs)) {
      const ids = row.tabs.filter((id): id is string => typeof id === 'string')
        .map(id => remapped.get(id) ?? id).filter(id => {
          if (!tabs.includes(id) || seen.has(id)) return false;
          seen.add(id); return true;
        });
      const active = typeof row.activeId === 'string' ? remapped.get(row.activeId) ?? row.activeId : '';
      return ids.length ? { kind: 'pane', id: row.id, tabs: ids, activeId: ids.includes(active) ? active : ids[0] } : null;
    }
    if (row.kind !== 'split' || !['horizontal', 'vertical'].includes(String(row.axis))) return null;
    const first = parse(row.first, depth + 1), second = parse(row.second, depth + 1);
    return first && second ? { kind: 'split', id: row.id, axis: row.axis as 'horizontal' | 'vertical',
      ratio: typeof row.ratio === 'number' && Number.isFinite(row.ratio) ? Math.max(.1, Math.min(.9, row.ratio)) : .5,
      first, second } : first ?? second;
  }
  const root = parse(value, 0) ?? newPane();
  const first = layoutPanes(root)[0];
  first.tabs.push(...tabs.filter(id => !seen.has(id)));
  if (!first.activeId) first.activeId = first.tabs[0] ?? '';
  return root;
}

export function reconcileLayout(root: WorkspaceLayout, tabs: string[], previous: string[], activePaneId: string): WorkspaceLayout {
  const owned = new Set(layoutPanes(root).flatMap(pane => pane.tabs));
  const additions = tabs.filter(id => !owned.has(id));
  const replacements = new Map<string, string>();
  // Replacing the current document should retain its pane and tab position.
  if (tabs.length === previous.length) previous.forEach((id, index) => {
    if (!tabs.includes(id) && additions.includes(tabs[index])) {
      replacements.set(id, tabs[index]);
      additions.splice(additions.indexOf(tabs[index]), 1);
    }
  });
  const target = layoutPanes(root).find(pane => pane.id === activePaneId) ?? layoutPanes(root)[0];
  return mapLayout(root, pane => {
    const ids = pane.tabs.map(id => replacements.get(id) ?? id).filter(id => tabs.includes(id));
    if (pane.id === target.id) ids.push(...additions);
    ids.sort((a, b) => tabs.indexOf(a) - tabs.indexOf(b));
    const active = replacements.get(pane.activeId) ?? pane.activeId;
    return ids.length ? { ...pane, tabs: ids, activeId: ids.includes(active) ? active : ids.at(-1)! } : null;
  }) ?? { ...target, tabs: [], activeId: '' };
}

export function dockLayout(root: WorkspaceLayout, tabId: string, drop: PaneDrop): WorkspaceLayout {
  const panes = layoutPanes(root);
  const source = panes.find(pane => pane.tabs.includes(tabId)), target = panes.find(pane => pane.id === drop.paneId);
  if (!source || !target || (source === target && source.tabs.length === 1 && drop.side !== 'center')) return root;
  const moved = newPane([tabId]);
  return mapLayout(root, pane => {
    const ids = pane.tabs.filter(id => id !== tabId);
    const kept = { ...pane, tabs: ids, activeId: ids.includes(pane.activeId) ? pane.activeId : ids.at(-1) ?? '' };
    if (pane.id !== target.id) return ids.length ? kept : null;
    if (drop.side === 'center') {
      const index = drop.index === undefined ? ids.length : Math.max(0, Math.min(ids.length,
        drop.index - (source === target && pane.tabs.indexOf(tabId) < drop.index ? 1 : 0)));
      ids.splice(index, 0, tabId);
      return { ...kept, activeId: tabId };
    }
    const before = drop.side === 'left' || drop.side === 'top';
    return { kind: 'split', id: crypto.randomUUID(), axis: drop.side === 'left' || drop.side === 'right' ? 'horizontal' : 'vertical',
      ratio: .5, first: before ? moved : kept, second: before ? kept : moved };
  }) ?? root;
}

export function dockSideAt(x: number, y: number, width: number, height: number): Exclude<DockSide, 'center'> | undefined {
  if (width <= 0 || height <= 0 || x < 0 || y < 0 || x > width || y > height) return;
  // The preview shows the resulting half-pane, not the hit area. Keep the
  // activation band narrow even in a maximized window and use the nearest edge.
  const edgeSize = Math.min(32, width / 4, height / 4);
  const edges = [{ side: 'left', distance: x }, { side: 'right', distance: width - x },
    { side: 'top', distance: y }, { side: 'bottom', distance: height - y }] as const;
  const edge = [...edges].sort((a, b) => a.distance - b.distance)[0];
  return edge.distance <= edgeSize ? edge.side : undefined;
}

export interface LayoutRect { left: number; top: number; width: number; height: number }
/** Reserve the same half-pane used by dockLayout without changing session state. */
export function panePreviewRects(rect: LayoutRect, side: DockSide) {
  if (side === 'center') return;
  const horizontal = side === 'left' || side === 'right';
  const size = horizontal ? 'width' : 'height', start = horizontal ? 'left' : 'top';
  const first = { ...rect, [size]: rect[size] / 2 };
  const second = { ...rect, [start]: rect[start] + first[size], [size]: rect[size] - first[size] };
  return side === 'left' || side === 'top'
    ? { preview: first, content: second } : { preview: second, content: first };
}
export function layoutGeometry(root: WorkspaceLayout) {
  const panes: { pane: WorkspacePane; rect: LayoutRect }[] = [];
  const dividers: { id: string; axis: 'horizontal' | 'vertical'; ratio: number; rect: LayoutRect; parent: LayoutRect }[] = [];
  function walk(node: WorkspaceLayout, rect: LayoutRect) {
    if (node.kind === 'pane') { panes.push({ pane: node, rect }); return; }
    const horizontal = node.axis === 'horizontal', size = horizontal ? 'width' : 'height', start = horizontal ? 'left' : 'top';
    const first = { ...rect, [size]: rect[size] * node.ratio };
    const second = { ...rect, [start]: rect[start] + first[size], [size]: rect[size] - first[size] };
    dividers.push({ id: node.id, axis: node.axis, ratio: node.ratio, parent: rect,
      rect: { ...rect, [start]: second[start], [size]: 0 } });
    walk(node.first, first); walk(node.second, second);
  }
  walk(root, { left: 0, top: 0, width: 1, height: 1 });
  return { panes, dividers };
}
