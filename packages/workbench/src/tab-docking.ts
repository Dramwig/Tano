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

export async function findTabDockTarget(
  workspaceId: string,
  tabId: string,
  point: { x: number; y: number; centerOffset: number },
): Promise<{ targetLabel: string; index: number; drop?: PaneDrop } | 'inside-window' | null> {
  const requestId = crypto.randomUUID();
  const replies: TabDockReply[] = [];
  const unlisten = await listen<TabDockReply>(TAB_DOCK_REPLY, ({ payload }) => {
    if (payload.requestId === requestId) replies.push(payload);
  });
  try {
    await emit<TabDockProbe>(TAB_DOCK_PROBE, {
      requestId, sourceLabel: getCurrentWindow().label, workspaceId, tabId,
      x: point.x, y: point.y, centerOffset: point.centerOffset,
    });
    await new Promise((resolve) => setTimeout(resolve, 250));
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
