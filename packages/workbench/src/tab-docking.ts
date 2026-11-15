import { emit, emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import type { PaneDrop } from './pane-layout';

export const TAB_DRAG_META_PREFIX = 'application/x-tano-tab-meta-';
export const TAB_DOCK_PROBE = 'tano-tab-dock-probe';
export const TAB_DOCK_REPLY = 'tano-tab-dock-reply';
export const TAB_TRANSFER_REQUEST = 'tano-tab-transfer-request';
export const TAB_TRANSFER_RESULT = 'tano-tab-transfer-result';
export const TAB_TRANSFER_ROLLBACK = 'tano-tab-transfer-rollback';
export const TAB_DRAG_FINISHED = 'tano-tab-drag-finished';
export type TabDragFinished = { sourceLabel: string; tabId: string };
export type TabTransferRollback = { requestId: string };

export type TabDragMeta = {
  sourceLabel: string;
  workspaceId: string;
  tabId: string;
  width: number;
  centerOffset: number;
};
export type TabDockProbe = {
  requestId: string;
  sourceLabel: string;
  workspaceId: string;
  tabId: string;
  x: number;
  y: number;
  centerOffset: number;
};
export type TabDockReply = {
  requestId: string;
  targetLabel: string;
  insideWindow: boolean;
  index?: number;
  drop?: PaneDrop;
  hovered?: boolean;
};
export type TabTransferRequest = {
  settingsPage?: string;
  requestId: string;
  sourceLabel: string;
  workspaceId: string;
  tabId: string;
  index: number;
  drop?: PaneDrop;
};
export type TabTransferResult = {
  requestId: string;
  targetLabel: string;
  tabId?: string;
  created?: boolean;
  error?: string;
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
      Number.isFinite(value.centerOffset) ? value as TabDragMeta : null;
  } catch {
    return null;
  }
}

export function tabDockIndex(center: number, centers: readonly number[]) {
  const index = centers.findIndex((value) => center < value);
  return index < 0 ? centers.length : index;
}

/** Longest wait for other windows to answer a dock probe. */
export const TAB_DOCK_PROBE_TIMEOUT = 250;
/** Extra wait after every candidate answered, so sibling panes of one window can still reply. */
export const TAB_DOCK_PROBE_GRACE = 24;
/** Physical pixels around a window that may still snap into its strip. */
const DOCK_CANDIDATE_MARGIN = 96;

/**
 * Labels of other visible windows near the screen point, or null when the
 * native geometry is unavailable and every window has to be probed.
 */
export async function dockCandidateLabels(point: { x: number; y: number }): Promise<Set<string> | null> {
  try {
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
    const self = getCurrentWindow().label;
    const windows = (await getAllWebviewWindows()).filter((window) => window.label !== self);
    const near = await Promise.all(windows.map(async (window) => {
      const [visible, minimized, position, size] = await Promise.all([
        window.isVisible(), window.isMinimized(), window.outerPosition(), window.outerSize(),
      ]);
      return visible && !minimized &&
        point.x >= position.x - DOCK_CANDIDATE_MARGIN && point.x < position.x + size.width + DOCK_CANDIDATE_MARGIN &&
        point.y >= position.y - DOCK_CANDIDATE_MARGIN && point.y < position.y + size.height + DOCK_CANDIDATE_MARGIN
        ? window.label : null;
    }));
    return new Set(near.filter((label): label is string => !!label));
  } catch {
    return null;
  }
}

export async function findTabDockTarget(
  workspaceId: string,
  tabId: string,
  point: { x: number; y: number; centerOffset: number },
): Promise<{ targetLabel: string; index: number; drop?: PaneDrop } | 'inside-window' | null> {
  // Dropping on empty desktop is the common case: no window can answer, so
  // skip the probe round-trip entirely instead of sleeping for the timeout.
  const candidates = await dockCandidateLabels(point);
  if (candidates && !candidates.size) return null;
  const requestId = crypto.randomUUID();
  const replies: TabDockReply[] = [];
  let answered: (() => void) | undefined;
  const unlisten = await listen<TabDockReply>(TAB_DOCK_REPLY, ({ payload }) => {
    if (payload.requestId !== requestId || (candidates && !candidates.has(payload.targetLabel))) return;
    replies.push(payload);
    if (candidates && [...candidates].every((label) => replies.some((reply) => reply.targetLabel === label))) answered?.();
  });
  try {
    await emit<TabDockProbe>(TAB_DOCK_PROBE, {
      requestId, sourceLabel: getCurrentWindow().label, workspaceId, tabId,
      x: point.x, y: point.y, centerOffset: point.centerOffset,
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await new Promise<void>((resolve) => {
      timer = setTimeout(resolve, TAB_DOCK_PROBE_TIMEOUT);
      answered = () => {
        answered = undefined;
        clearTimeout(timer);
        timer = setTimeout(resolve, TAB_DOCK_PROBE_GRACE);
      };
      if (candidates && [...candidates].every((label) => replies.some((reply) => reply.targetLabel === label))) answered();
    });
    clearTimeout(timer);
    // A window actually under the native drag takes precedence over windows
    // behind it, even when the pointer is in its non-docking interior.
    const hovered = replies.filter(reply => reply.hovered);
    const target = (hovered.length ? hovered : replies).find(reply => reply.index !== undefined);
    if (target?.index !== undefined) return {
      targetLabel: target.targetLabel, index: target.index, ...(target.drop ? { drop: target.drop } : {}),
    };
    return replies.some((reply) => reply.insideWindow) ? 'inside-window' : null;
  } finally {
    unlisten();
  }
}

export async function requestTabTransfer(targetLabel: string, request: Omit<TabTransferRequest, 'requestId' | 'sourceLabel'>) {
  const requestId = crypto.randomUUID();
  const sourceLabel = getCurrentWindow().label;
  let finish!: (result: TabTransferResult) => void;
  const result = new Promise<TabTransferResult>((resolve) => { finish = resolve; });
  const unlisten = await listen<TabTransferResult>(TAB_TRANSFER_RESULT, ({ payload }) => {
    if (payload.requestId === requestId && payload.targetLabel === targetLabel) finish(payload);
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await emitTo(targetLabel, TAB_TRANSFER_REQUEST, { ...request, requestId, sourceLabel } satisfies TabTransferRequest);
    const reply = await Promise.race([
      result,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('目标窗口没有响应标签迁移')), 10_000);
      }),
    ]);
    if (reply.error || !reply.tabId) throw new Error(reply.error || '目标窗口未能打开标签页');
    return { ...reply, requestId };
  } finally {
    clearTimeout(timeout);
    unlisten();
  }
}
