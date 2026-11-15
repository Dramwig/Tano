import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, monitorFromPoint } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
import { DETACHED_SPARE_TAB } from './detached-spare-tab';

export { DETACHED_SPARE_TAB };

type DetachedResult = { label: string; error?: string };
export type DetachedDropPoint = {
  x: number; y: number; grabX: number; grabY: number;
  width?: number; insideSourceWindow?: boolean;
};
export function detachedWindowPosition(
  drop: DetachedDropPoint,
  scale: number,
  width: number,
  height: number,
  area?: { position: { x: number; y: number }; size: { width: number; height: number } },
) {
  const desiredX = drop.x / scale - drop.grabX;
  const desiredY = drop.y / scale - drop.grabY;
  if (!area) return { x: Math.round(desiredX), y: Math.round(desiredY) };
  const left = area.position.x / scale;
  const top = area.position.y / scale;
  // Keep a draggable part of the title bar visible while anchoring the window at the drop point.
  return {
    x: Math.round(Math.max(left, Math.min(desiredX, left + area.size.width / scale - Math.min(width, 520)))),
    y: Math.round(Math.max(top, Math.min(desiredY, top + area.size.height / scale - Math.min(height, 100)))),
  };
}

export function detachedTabRequest() {
  const query = new URLSearchParams(window.location.search);
  const tabId = query.get('detachedTab');
  const workspacePath = query.get('workspacePath');
  const opener = query.get('opener');
  return tabId && workspacePath && opener && getCurrentWindow().label.startsWith('detached-')
    ? { tabId, workspacePath, opener, settingsPage: query.get('settingsPage') ?? undefined }
    : null;
}

export async function reportDetachedReady(error?: string) {
  const request = detachedTabRequest();
  if (!request) return;
  await emitTo(request.opener, 'tano-detached-ready', {
    label: getCurrentWindow().label,
    ...(error ? { error } : {}),
  } satisfies DetachedResult);
}

const DETACHED_WIDTH = 1100;
const DETACHED_HEIGHT = 760;
const DETACHED_TITLE_SUFFIX = ' — Tano / 同页';

/** Logical position that anchors a detached window under the release point. */
async function dropPosition(drop: DetachedDropPoint) {
  const monitor = await monitorFromPoint(drop.x, drop.y);
  const scale = monitor?.scaleFactor ?? await getCurrentWindow().scaleFactor();
  return { scale, ...detachedWindowPosition(drop, scale, DETACHED_WIDTH, DETACHED_HEIGHT, monitor?.workArea) };
}

/** Creates a hidden detached window and resolves once its workbench reported ready. */
async function spawnDetachedWindow(
  label: string,
  query: URLSearchParams,
  title: string,
  position?: { x: number; y: number },
) {
  let finish: ((error?: string) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    finish = (error) => error ? reject(new Error(error)) : resolve();
  });
  const unlisten = await listen<DetachedResult>('tano-detached-ready', (event) => {
    if (event.payload.label === label) finish?.(event.payload.error);
  });
  const window = new WebviewWindow(label, {
    url: `index.html?${query.toString()}`,
    visible: false,
    title,
    width: DETACHED_WIDTH,
    height: DETACHED_HEIGHT,
    ...position,
    minWidth: 800,
    minHeight: 580,
    decorations: false,
    dragDropEnabled: false,
    backgroundColor: '#f7f7f2',
  });
  const created = new Promise<void>((resolve, reject) => {
    void window.once('tauri://created', () => resolve());
    void window.once<string>('tauri://error', (event) => reject(new Error(String(event.payload))));
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      Promise.all([created, ready]),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('独立窗口启动超时')), 15_000);
      }),
    ]);
    return window;
  } catch (error) {
    await window.destroy().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timeout);
    unlisten();
  }
}

/** Cold path: boots a brand-new window for the tab. Used when no spare is available. */
export async function createDetachedTabWindow(
  workspacePath: string,
  tabId: string,
  title: string,
  drop?: DetachedDropPoint,
  settingsPage?: string,
) {
  const label = `detached-${crypto.randomUUID()}`;
  const query = new URLSearchParams({
    detachedTab: tabId,
    workspacePath,
    opener: getCurrentWindow().label,
  });
  if (tabId === 'view:settings' && settingsPage) query.set('settingsPage', settingsPage);
  let position: { x: number; y: number } | undefined;
  if (drop) {
    const { x, y } = await dropPosition(drop);
    position = { x, y };
  }
  const window = await spawnDetachedWindow(label, query, `${title}${DETACHED_TITLE_SUFFIX}`, position);
  try {
    await window.show();
    await window.setFocus();
    return window;
  } catch (error) {
    await window.destroy().catch(() => {});
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Spare window
//
// Booting a WebView, the workbench bundle and the workspace takes far longer
// than a drag release should. Like a browser's spare renderer, a main window
// keeps one hidden detached window that already finished loading its
// workspace. Releasing a tab outside every window claims it, moves it under
// the pointer, shows it, and transfers the tab through the regular cross-window
// path. The owner warms a new spare afterwards.
// ---------------------------------------------------------------------------

export const DETACHED_SPARE_CLAIM = 'tano-detached-spare-claim';
export const DETACHED_SPARE_CLAIMED = 'tano-detached-spare-claimed';
export const DETACHED_SPARE_CONSUMED = 'tano-detached-spare-consumed';
export type DetachedSpareClaim = { requestId: string; sourceLabel: string; workspacePath: string };
export type DetachedSpareClaimed = { requestId: string; label: string };
export type DetachedSpareConsumed = { label: string };
/** Upper bound for a ready spare to answer; it normally replies within a few milliseconds. */
const SPARE_CLAIM_TIMEOUT = 150;

type SpareEntry = { label: string; workspacePath: string; warming: Promise<WebviewWindow | null> };
let spare: SpareEntry | null = null;

export function isDetachedSpareWindow() {
  return detachedTabRequest()?.tabId === DETACHED_SPARE_TAB;
}

/** Owner side: keeps exactly one hidden, pre-booted window for this workspace. */
export function warmDetachedSpare(workspacePath: string) {
  if (spare?.workspacePath === workspacePath) return spare.warming.then(() => {});
  void discardDetachedSpare();
  const label = `detached-${crypto.randomUUID()}`;
  const query = new URLSearchParams({
    detachedTab: DETACHED_SPARE_TAB,
    workspacePath,
    opener: getCurrentWindow().label,
  });
  const entry: SpareEntry = { label, workspacePath, warming: Promise.resolve(null) };
  entry.warming = spawnDetachedWindow(label, query, `Tano / 同页`)
    .then((window) => {
      void window.once('tauri://destroyed', () => { if (spare === entry) spare = null; });
      return window;
    })
    .catch(() => {
      // Warming is speculative; a failed spare only means the next drag uses the cold path.
      if (spare === entry) spare = null;
      return null;
    });
  spare = entry;
  return entry.warming.then(() => {});
}

/** Owner side: forgets a spare another window adopted. Returns true when it was ours. */
export function releaseDetachedSpare(label: string) {
  if (spare?.label !== label) return false;
  spare = null;
  return true;
}

/** Owner side: destroys the unused spare (workspace switch, window close). */
export async function discardDetachedSpare() {
  const entry = spare;
  spare = null;
  if (!entry) return;
  const window = await entry.warming;
  await window?.destroy().catch(() => {});
}

/**
 * Source side: reserves a ready spare for this workspace. Resolves to its label,
 * or null when none exists so the caller boots a window the slow way.
 */
export async function claimDetachedSpare(workspacePath: string): Promise<string | null> {
  try {
    // Hidden detached windows are spares (or cold windows still booting).
    // Without any, skip the broadcast instead of waiting for its timeout.
    const { getAllWebviewWindows } = await import('@tauri-apps/api/webviewWindow');
    const windows = (await getAllWebviewWindows()).filter((window) => window.label.startsWith('detached-'));
    const hidden = await Promise.all(windows.map(async (window) => !(await window.isVisible())));
    if (!hidden.some(Boolean)) return null;
  } catch {
    // Geometry/visibility lookups are an optimization; fall through to the claim.
  }
  const requestId = crypto.randomUUID();
  let resolveClaim!: (label: string | null) => void;
  const claimed = new Promise<string | null>((resolve) => { resolveClaim = resolve; });
  const unlisten = await listen<DetachedSpareClaimed>(DETACHED_SPARE_CLAIMED, ({ payload }) => {
    if (payload.requestId === requestId) resolveClaim(payload.label);
  });
  const timer = setTimeout(() => resolveClaim(null), SPARE_CLAIM_TIMEOUT);
  try {
    const { emit } = await import('@tauri-apps/api/event');
    await emit<DetachedSpareClaim>(DETACHED_SPARE_CLAIM, {
      requestId, sourceLabel: getCurrentWindow().label, workspacePath,
    });
    return await claimed;
  } finally {
    clearTimeout(timer);
    unlisten();
  }
}

/**
 * Source side: moves a claimed (still hidden) spare under the release point.
 * The caller transfers the tab first and shows the window afterwards, so an
 * empty workbench never flashes on screen.
 */
export async function placeDetachedSpare(label: string, title: string, drop?: DetachedDropPoint) {
  const window = await WebviewWindow.getByLabel(label);
  if (!window) throw new Error('独立窗口已关闭');
  const { PhysicalPosition } = await import('@tauri-apps/api/dpi');
  if (drop) {
    const { scale, x, y } = await dropPosition(drop);
    // Physical pixels keep the target monitor's scale; a logical position would
    // be converted with the spare's current (possibly different) monitor.
    await window.setPosition(new PhysicalPosition(Math.round(x * scale), Math.round(y * scale)));
  } else {
    await window.center();
  }
  await window.setTitle(`${title}${DETACHED_TITLE_SUFFIX}`);
  return window;
}

/**
 * Spare side: answers the first claim for its workspace, then stops being a
 * spare. Destroys itself if its owner goes away before anyone claimed it.
 */
export async function serveDetachedSpareClaims(canAdopt: (workspacePath: string) => boolean) {
  const request = detachedTabRequest();
  if (!request || request.tabId !== DETACHED_SPARE_TAB) return () => {};
  const self = getCurrentWindow();
  let claimed = false;
  const stopClaims = await listen<DetachedSpareClaim>(DETACHED_SPARE_CLAIM, ({ payload }) => {
    if (claimed || payload.sourceLabel === self.label || payload.workspacePath !== request.workspacePath ||
      !canAdopt(payload.workspacePath)) return;
    claimed = true;
    stopClaims();
    void emitTo(payload.sourceLabel, DETACHED_SPARE_CLAIMED, {
      requestId: payload.requestId, label: self.label,
    } satisfies DetachedSpareClaimed).catch(() => {});
    void emitTo(request.opener, DETACHED_SPARE_CONSUMED, { label: self.label } satisfies DetachedSpareConsumed)
      .catch(() => {});
  });
  let stopOwnerWatch = () => {};
  const owner = await WebviewWindow.getByLabel(request.opener).catch(() => null);
  if (!owner) {
    stopClaims();
    await self.destroy().catch(() => {});
    return () => {};
  }
  stopOwnerWatch = await owner.once('tauri://destroyed', () => {
    if (!claimed) void self.destroy().catch(() => {});
  });
  return () => {
    stopClaims();
    stopOwnerWatch();
  };
}
