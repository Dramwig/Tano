// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
  mount: vi.fn(),
  tick: vi.fn<() => Promise<void>>(),
  platform: vi.fn<() => Promise<void>>(),
  create: vi.fn(),
  windowLabel: 'main',
}));
vi.mock('vue', async importOriginal => ({
  ...await importOriginal<typeof import('vue')>(),
  createApp: (...args: unknown[]) => { app.create(...args); return { use: () => ({ mount: app.mount }) }; },
  nextTick: app.tick,
}));
vi.mock('pinia', () => ({ createPinia: () => ({}) }));
vi.mock('@tano/workbench/runtime', () => ({
  configureWorkbench: () => ({}), createLocalExtensions: () => ({}),
}));
vi.mock('@tano/workbench/adapter', () => ({ native: true, NativeAdapter: class {} }));
vi.mock('@tano/workbench/platform', () => ({ mobile: false, initializePlatform: app.platform }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: app.windowLabel }) }));
vi.mock('@tano/workbench/styles.css', () => ({}));
vi.mock('@tano/workbench/settings-window', () => ({ settingsWindowRequest: () => undefined }));
vi.mock('@tano/workbench/plugins/catalog', () => ({ HttpPluginCatalog: class {} }));
vi.mock('@tano/workbench/plugins/native', () => ({
  createNativePluginServices: () => ({}), createNativePluginConnections: () => ({}),
}));
vi.mock('@tano/workbench', () => ({ default: { name: 'Workbench' } }));
vi.mock('./WorkspaceShell.vue', () => ({ default: { name: 'WorkspaceShell' } }));
vi.mock('./StandaloneFile.vue', () => ({ default: { name: 'StandaloneFile' } }));
vi.mock('@tano/workbench/components/DesktopWindow.vue', () => ({ default: {} }));

beforeEach(() => {
  app.mount.mockReset();
  app.tick.mockReset().mockResolvedValue(undefined);
  app.platform.mockReset().mockResolvedValue(undefined);
  app.create.mockReset();
  app.windowLabel = 'main';
});

it.each([
  ['main', 'WorkspaceShell'],
  ['file-test', 'StandaloneFile'],
  ['detached-test', 'Workbench'],
])('routes %s to %s without consuming another window’s shell queue', async (label, view) => {
  app.windowLabel = label;
  const { start } = await import('./start');
  await start();
  expect(app.create).toHaveBeenCalledWith(expect.anything(), { view: { name: view } });
});

it('signals native readiness only after the mounted workbench has flushed DOM updates', async () => {
  let flushed!: () => void;
  app.tick.mockImplementation(() => new Promise<void>(resolve => { flushed = resolve; }));
  const { start } = await import('./start');
  const ready = vi.fn();
  const starting = start().then(ready);
  await vi.waitFor(() => expect(app.mount).toHaveBeenCalledExactlyOnceWith('#app'));
  expect(ready).not.toHaveBeenCalled();
  flushed();
  await starting;
  expect(ready).toHaveBeenCalledOnce();
});

it('preserves timeout recovery when platform initialization finishes after cancellation', async () => {
  let platformReady!: () => void;
  app.platform.mockImplementation(() => new Promise<void>(resolve => { platformReady = resolve; }));
  const { start } = await import('./start');
  const controller = new AbortController();
  const starting = start(controller.signal);
  await vi.waitFor(() => expect(app.platform).toHaveBeenCalledOnce());
  controller.abort(new Error('Startup timed out'));
  platformReady();
  await expect(starting).rejects.toThrow('Startup timed out');
  expect(app.mount).not.toHaveBeenCalled();
});
