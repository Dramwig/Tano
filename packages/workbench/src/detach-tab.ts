import { emitTo, listen } from '@tauri-apps/api/event';
import { getCurrentWindow, monitorFromPoint } from '@tauri-apps/api/window';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

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
  const url = `index.html?${query.toString()}`;
  const width = 1100;
  const height = 760;
  let position: { x: number; y: number } | undefined;
  if (drop) {
    const monitor = await monitorFromPoint(drop.x, drop.y);
    const scale = monitor?.scaleFactor ?? await getCurrentWindow().scaleFactor();
    position = detachedWindowPosition(drop, scale, width, height, monitor?.workArea);
  }
  let finish: ((error?: string) => void) | undefined;
  const ready = new Promise<void>((resolve, reject) => {
    finish = (error) => error ? reject(new Error(error)) : resolve();
  });
  const unlisten = await listen<DetachedResult>('tano-detached-ready', (event) => {
    if (event.payload.label === label) finish?.(event.payload.error);
  });
  const window = new WebviewWindow(label, {
    url,
    title: `${title} — Tano / 同页`,
    width,
    height,
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
  try {
    await Promise.race([created, ready]);
    await Promise.race([
      ready,
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('独立窗口启动超时')), 15_000)),
    ]);
    return window;
  } catch (error) {
    await window.destroy().catch(() => {});
    throw error;
  } finally {
    unlisten();
  }
}
