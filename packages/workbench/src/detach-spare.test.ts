import { afterEach, expect, it, vi } from 'vitest';
import {
  DETACHED_SPARE_CONSUMED,
  claimDetachedSpare,
  discardDetachedSpare,
  placeDetachedSpare,
  releaseDetachedSpare,
  serveDetachedSpareClaims,
  warmDetachedSpare,
} from './detach-tab';

// Node environment: only the query string of the current page matters here.
const page = { location: new URL('http://tano.localhost/') };
(globalThis as any).window = page;
function navigate(path: string) { page.location = new URL(path, 'http://tano.localhost/'); }

type Handler = (event: { payload: any }) => void;
const native = vi.hoisted(() => ({
  label: 'main',
  handlers: new Map<string, Set<Handler>>(),
  emitted: [] as Array<{ target?: string; name: string; payload: any }>,
  windows: new Map<string, any>(),
}));
function dispatch(name: string, payload: unknown) {
  for (const handler of [...(native.handlers.get(name) ?? [])]) handler({ payload });
}
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label: native.label, destroy: vi.fn(async () => {}), scaleFactor: async () => 1 }),
  monitorFromPoint: async () => ({ scaleFactor: 2, workArea: { position: { x: 0, y: 0 }, size: { width: 4000, height: 2000 } } }),
}));
vi.mock('@tauri-apps/api/dpi', () => ({ PhysicalPosition: class { constructor(public x: number, public y: number) {} } }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: Handler) => {
    const set = native.handlers.get(name) ?? new Set();
    set.add(handler);
    native.handlers.set(name, set);
    return () => set.delete(handler);
  }),
  emit: vi.fn(async (name: string, payload: unknown) => {
    native.emitted.push({ name, payload });
    dispatch(name, payload);
  }),
  emitTo: vi.fn(async (target: string, name: string, payload: unknown) => {
    native.emitted.push({ target, name, payload });
    dispatch(name, payload);
  }),
}));
vi.mock('@tauri-apps/api/webviewWindow', () => {
  class WebviewWindow {
    visible = false;
    position: unknown;
    title = '';
    destroyed = false;
    constructor(public label: string, public options: Record<string, any> = {}) {
      native.windows.set(label, this);
      // The spare's workbench boots and reports ready.
      queueMicrotask(() => dispatch('tano-detached-ready', { label }));
    }
    static async getByLabel(label: string) { return native.windows.get(label) ?? null; }
    async once(event: string, handler: () => void) {
      if (event === 'tauri://created') queueMicrotask(handler);
      return () => {};
    }
    async isVisible() { return this.visible; }
    async setPosition(position: unknown) { this.position = position; }
    async setTitle(title: string) { this.title = title; }
    async center() {}
    async show() { this.visible = true; }
    async destroy() { this.destroyed = true; native.windows.delete(this.label); }
  }
  return { WebviewWindow, getAllWebviewWindows: async () => [...native.windows.values()] };
});

afterEach(async () => {
  await discardDetachedSpare();
  native.label = 'main';
  native.handlers.clear();
  native.emitted.length = 0;
  native.windows.clear();
  navigate('/');
});

/** Boots the spare page in the same test process as the hidden window would. */
async function bootSpare(label: string, canAdopt = () => true) {
  navigate(native.windows.get(label).options.url);
  native.windows.set('main', { label: 'main', once: async () => () => {}, isVisible: async () => true });
  native.label = label;
  const stop = await serveDetachedSpareClaims(canAdopt);
  native.label = 'main';
  navigate('/');
  return stop;
}

it('skips the claim broadcast when no hidden window exists', async () => {
  expect(await claimDetachedSpare('C:/工作区')).toBeNull();
  expect(native.emitted.some((event) => event.name === 'tano-detached-spare-claim')).toBe(false);
});

it('pre-boots one hidden spare that a drag release adopts without starting a WebView', async () => {
  await warmDetachedSpare('C:/工作区');
  await warmDetachedSpare('C:/工作区');
  const [label] = [...native.windows.keys()];
  expect(native.windows.size).toBe(1);
  const spare = native.windows.get(label);
  expect(spare.options.visible).toBe(false);
  expect(new URL(spare.options.url, 'http://x').searchParams.get('detachedTab')).toBe('spare:');
  await bootSpare(label);

  expect(await claimDetachedSpare('C:/其他')).toBeNull();
  expect(await claimDetachedSpare('C:/工作区')).toBe(label);
  // A spare is single-use: the second release falls back to the cold path.
  expect(await claimDetachedSpare('C:/工作区')).toBeNull();
  expect(native.emitted).toContainEqual({
    target: 'main', name: DETACHED_SPARE_CONSUMED, payload: { label },
  });
  expect(releaseDetachedSpare(label)).toBe(true);

  const placed: any = await placeDetachedSpare(label, '笔记', { x: 1000, y: 400, grabX: 40, grabY: 12 });
  // Logical drop (500,200) minus the grab offset, in the target monitor's physical pixels.
  expect(placed.position).toEqual({ x: 920, y: 376 });
  expect(placed.title).toBe('笔记 — Tano / 同页');
  // The caller reveals it only after the tab has moved in.
  expect(placed.visible).toBe(false);
});

it('destroys an unclaimed spare when the workspace changes', async () => {
  await warmDetachedSpare('C:/工作区');
  const [first] = [...native.windows.values()];
  await warmDetachedSpare('C:/另一个');
  await vi.waitFor(() => expect(first.destroyed).toBe(true));
  expect(native.windows.size).toBe(1);
});
