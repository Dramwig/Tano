import { dockSideAt } from './pane-layout';
import type { PaneDrop } from './pane-layout';

// Both captured pointer drags and Windows native drags use the same hit test.
export function paneDropAt(x: number, y: number): PaneDrop | undefined {
  const hit = document.elementFromPoint(x, y);
  const strip = hit?.closest<HTMLElement>('[data-tab-pane-id]');
  const host = hit?.closest<HTMLElement>('.workspace-panes');
  // Previewing resizes visible panes. Hit-test their original rectangles to
  // retain the narrow edge band and release the preview when leaving that band.
  const region = [...(host?.querySelectorAll<HTMLElement>('[data-dock-pane-id]') ?? [])].find(item => {
    const box = item.getBoundingClientRect();
    return x >= box.left && x <= box.right && y >= box.top && y <= box.bottom;
  });
  const pane = region
    ? [...host!.querySelectorAll<HTMLElement>('.workspace-pane')].find(item => item.dataset.paneId === region.dataset.dockPaneId)
    : hit?.closest<HTMLElement>('.workspace-pane');
  const paneId = strip?.dataset.tabPaneId ?? pane?.dataset.paneId;
  if (!paneId) return;
  if (strip) {
    const tabs = [...strip.querySelectorAll<HTMLElement>('.desktop-tab')];
    const index = tabs.findIndex(tab => { const box = tab.getBoundingClientRect(); return x < box.left + box.width / 2; });
    return { paneId, side: 'center', index: index < 0 ? tabs.length : index };
  }
  if (!pane) return;
  const rect = (region ?? pane).getBoundingClientRect();
  // The tab strip remains a merge/reorder target. Top splitting starts just
  // below it, at the content edge, so the narrow top band stays reachable.
  const tabbar = pane.querySelector<HTMLElement>(':scope > .workspace-tabbar');
  const top = region ? rect.top + (tabbar?.getBoundingClientRect().height ?? 0)
    : tabbar?.getBoundingClientRect().bottom ?? rect.top;
  const side = dockSideAt(x - rect.left, y - top, rect.width, rect.bottom - top);
  return side ? { paneId, side } : undefined;
}
