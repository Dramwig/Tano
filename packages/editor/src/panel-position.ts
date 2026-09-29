export type PanelSide = 'above' | 'below';

interface PanelPosition {
  x: number;
  y: number;
  side: PanelSide;
}

function visibleBounds(anchor: Element, includeClippingParents: boolean) {
  const margin = 8;
  const bounds = { left: margin, top: margin, right: window.innerWidth - margin, bottom: window.innerHeight - margin };
  if (!includeClippingParents) return bounds;
  for (let parent = anchor.parentElement; parent; parent = parent.parentElement) {
    const style = window.getComputedStyle(parent);
    const rect = parent.getBoundingClientRect();
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowX} ${style.overflow}`)) {
      bounds.left = Math.max(bounds.left, rect.left + margin);
      bounds.right = Math.min(bounds.right, rect.right - margin);
    }
    if (/(auto|scroll|hidden|clip)/.test(`${style.overflowY} ${style.overflow}`)) {
      bounds.top = Math.max(bounds.top, rect.top + margin);
      bounds.bottom = Math.min(bounds.bottom, rect.bottom - margin);
    }
  }
  return bounds;
}

export function floatingPanelPosition(
  anchor: Element,
  panel: HTMLElement,
  preferredLeft = 0,
  includeClippingParents = true,
  side?: PanelSide,
): PanelPosition {
  const visible = visibleBounds(anchor, includeClippingParents);
  panel.style.setProperty('--tano-panel-available-width', `${Math.max(1, visible.right - visible.left)}px`);
  panel.style.setProperty('--tano-panel-available-height', `${Math.max(1, visible.bottom - visible.top)}px`);
  const anchorRect = anchor.getBoundingClientRect();
  const panelRect = panel.getBoundingClientRect();
  const x = Math.max(visible.left, Math.min(anchorRect.left + preferredLeft, visible.right - panelRect.width));
  const below = anchorRect.bottom + 6;
  const above = anchorRect.top - panelRect.height - 6;
  const chosenSide = side ?? (below + panelRect.height <= visible.bottom || above < visible.top ? 'below' : 'above');
  const preferredY = chosenSide === 'above' ? above : below;
  const y = Math.max(visible.top, Math.min(preferredY, visible.bottom - panelRect.height));
  return { x, y, side: chosenSide };
}

export function positionAnchoredPanel(anchor: HTMLElement, panel: HTMLElement, preferredLeft = 0, side?: PanelSide) {
  const position = floatingPanelPosition(anchor, panel, preferredLeft, true, side);
  const rect = anchor.getBoundingClientRect();
  panel.style.left = `${position.x - rect.left}px`;
  panel.style.top = `${position.y - rect.top}px`;
  return position.side;
}

export function observePanelPosition(reposition: () => void) {
  window.addEventListener('resize', reposition);
  window.addEventListener('scroll', reposition, true);
  return () => {
    window.removeEventListener('resize', reposition);
    window.removeEventListener('scroll', reposition, true);
  };
}
