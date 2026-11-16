import { shallowRef } from 'vue';

export const finishedTabDrag = shallowRef<{ sourceLabel: string; tabId: string }>();

export const TAB_DRAG_META_PREFIX = 'application/x-tano-tab-meta-';

export type TabDragMeta = {
  sourceLabel: string;
  workspaceId: string;
  tabId: string;
  width: number;
  centerOffset: number;
  height?: number;
  grabY?: number;
};

export function tabDragMetaType(meta: TabDragMeta) {
  const bytes = new TextEncoder().encode(JSON.stringify(meta));
  return TAB_DRAG_META_PREFIX + Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function parseTabDragMeta(types: readonly string[]): TabDragMeta | null {
  const type = types.find((value) => value.startsWith(TAB_DRAG_META_PREFIX));
  if (!type) return null;
  try {
    const hex = type.slice(TAB_DRAG_META_PREFIX.length);
    if (!hex || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) return null;
    const bytes = Uint8Array.from(hex.match(/../g)!, (pair) => Number.parseInt(pair, 16));
    const value = JSON.parse(new TextDecoder().decode(bytes)) as Partial<TabDragMeta>;
    return typeof value.sourceLabel === 'string' && typeof value.workspaceId === 'string' &&
      typeof value.tabId === 'string' && Number.isFinite(value.width) &&
      Number.isFinite(value.centerOffset) &&
      (value.height === undefined || Number.isFinite(value.height)) &&
      (value.grabY === undefined || Number.isFinite(value.grabY)) ? value as TabDragMeta : null;
  } catch {
    return null;
  }
}

export function tabDockIndex(center: number, centers: readonly number[]) {
  const index = centers.findIndex((value) => center < value);
  return index < 0 ? centers.length : index;
}
