// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';

const app = vi.hoisted(() => ({
  mount: vi.fn(),
  tick: vi.fn<() => Promise<void>>(),
  platform: vi.fn<() => Promise<void>>(),
}));
vi.mock('vue', () => ({
  createApp: () => ({ use: () => ({ mount: app.mount }) }),
  nextTick: app.tick,
}));
vi.mock('pinia', () => ({ createPinia: () => ({}) }));
vi.mock('@tano/workbench/runtime', () => ({
  configureWorkbench: () => ({}), createLocalExtensions: () => ({}),
}));
vi.mock('@tano/workbench/adapter', () => ({ native: true, NativeAdapter: class {} }));
vi.mock('@tano/workbench/platform', () => ({ mobile: false, initializePlatform: app.platform }));
vi.mock('@tano/workbench/styles.css', () => ({}));
vi.mock('@tano/workbench/settings-window', () => ({ settingsWindowRequest: () => undefined }));
vi.mock('@tano/workbench/plugins/catalog', () => ({ HttpPluginCatalog: class {} }));
vi.mock('@tano/workbench/plugins/native', () => ({
  createNativePluginServices: () => ({}), createNativePluginConnections: () => ({}),
}));
vi.mock('@tano/workbench', () => ({ default: {} }));
vi.mock('@tano/workbench/components/DesktopWindow.vue', () => ({ default: {} }));

beforeEach(() => {
  app.mount.mockReset();
  app.tick.mockReset().mockResolvedValue(undefined);
  app.platform.mockReset().mockResolvedValue(undefined);
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
