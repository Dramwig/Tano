// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

const start = vi.fn<(signal?: AbortSignal) => Promise<void>>();
const nativeStartup = vi.hoisted(() => ({ native: false, reveal: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => nativeStartup.native,
  invoke: nativeStartup.reveal,
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  start.mockReset();
  nativeStartup.native = false;
  nativeStartup.reveal.mockReset().mockResolvedValue(undefined);
  vi.doMock('./start', () => ({ start }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

afterEach(() => {
  vi.doUnmock('./start');
  vi.doUnmock('@tauri-apps/api/window');
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
  localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.removeProperty('color-scheme');
});

it('keeps the native window hidden until the workbench mounts, even with suspended frames', async () => {
  nativeStartup.native = true;
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(123);
  let mounted!: () => void;
  start.mockImplementation(() => new Promise<void>(resolve => {
    mounted = () => {
      document.getElementById('app')!.textContent = 'mounted workbench';
      resolve();
    };
  }));
  nativeStartup.reveal.mockImplementation(async () => {
    expect(document.getElementById('app')?.textContent).toBe('mounted workbench');
  });
  await import('./main');
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(5000);
  expect(nativeStartup.reveal).not.toHaveBeenCalled();
  mounted();
  await vi.waitFor(() => expect(nativeStartup.reveal).toHaveBeenCalledExactlyOnceWith('startup_ready'));
  expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('shows recovery after native initialization fails, with the recovery DOM already in place', async () => {
  nativeStartup.native = true;
  start.mockRejectedValue(new Error('Native initialization failed'));
  nativeStartup.reveal.mockImplementation(async () => {
    expect(document.getElementById('tano-startup-status')?.textContent).toBe('无法打开同页');
    expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
  });
  await import('./main');
  await vi.waitFor(() => expect(nativeStartup.reveal).toHaveBeenCalledExactlyOnceWith('startup_ready'));
});

it('aborts a stalled native startup and reveals recovery instead of staying hidden forever', async () => {
  nativeStartup.native = true;
  start.mockImplementation(() => new Promise(() => {}));
  await import('./main');
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  const signal = start.mock.calls[0][0]!;
  await vi.advanceTimersByTimeAsync(29_000);
  expect(nativeStartup.reveal).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1000);
  expect(signal.aborted).toBe(true);
  expect(document.getElementById('tano-startup-detail')?.textContent).toContain('打开同页超时');
  expect(nativeStartup.reveal).toHaveBeenCalledExactlyOnceWith('startup_ready');
  expect(vi.getTimerCount()).toBe(0);
});

it('does not mount a late workbench import over native timeout recovery', async () => {
  nativeStartup.native = true;
  let loaded!: () => void;
  vi.doMock('./start', async () => {
    await new Promise<void>(resolve => { loaded = resolve; });
    return { start };
  });
  await import('./main');
  await vi.advanceTimersByTimeAsync(30_000);
  expect(document.getElementById('tano-startup-detail')?.textContent).toContain('打开同页超时');
  loaded();
  await vi.advanceTimersByTimeAsync(1);
  expect(start).not.toHaveBeenCalled();
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
});

it('uses the saved English preference for startup, slow loading and timeout recovery', async () => {
  nativeStartup.native = true;
  localStorage.setItem('tano.preference.locale', 'en-US');
  start.mockImplementation(() => new Promise(() => {}));
  await import('./main');
  expect(document.documentElement.lang).toBe('en-US');
  expect(document.getElementById('tano-startup-status')?.textContent).toBe('Opening Tano...');
  expect(document.getElementById('tano-startup-retry')?.textContent).toBe('Reload');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(document.getElementById('tano-startup-status')?.textContent).toContain('Loading the workbench');
  await vi.advanceTimersByTimeAsync(15_000);
  expect(document.getElementById('tano-startup-status')?.textContent).toBe('Unable to open Tano');
  expect(document.getElementById('tano-startup-detail')?.textContent).toContain('timed out after 30 seconds');
  expect(nativeStartup.reveal).toHaveBeenCalledExactlyOnceWith('startup_ready');
});

it.each(['main', 'settings-main'])('reveals recovery only for the main window when startup fails in %s', async label => {
  nativeStartup.native = true;
  nativeStartup.reveal.mockRejectedValue(new Error('Startup reveal failed'));
  const show = vi.fn().mockResolvedValue(undefined);
  vi.doMock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label, show }) }));
  await import('./main');
  await vi.waitFor(() => expect(document.getElementById('tano-startup-status')?.textContent).toBe('无法打开同页'));
  expect(start).toHaveBeenCalledOnce();
  if (label === 'main') await vi.waitFor(() => expect(show).toHaveBeenCalledOnce());
  else expect(show).not.toHaveBeenCalled();
});

it('keeps a visible startup state while the workbench loads and offers a retry if it stalls', async () => {
  start.mockImplementation(() => new Promise(() => {}));
  await import('./main');
  expect(document.getElementById('tano-startup-status')?.textContent).toBe('正在打开同页...');
  expect(document.getElementById('tano-startup-status')?.classList.contains('tano-skeleton-status')).toBe(true);
  expect(document.querySelector('.tano-skeleton-shell')).not.toBeNull();
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(document.getElementById('tano-startup-status')?.textContent).toContain('正在加载工作台');
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
});

it.each(['light', 'dark'])('applies the saved %s theme while workbench loading is still pending', async theme => {
  localStorage.setItem('tano.preference.theme', theme);
  start.mockImplementation(() => new Promise(() => {}));
  await import('./main');
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.documentElement.style.colorScheme).toBe(theme);
  expect(document.getElementById('tano-startup')?.getAttribute('aria-busy')).toBe('true');
});

it('preserves the mounted workbench and clears the slow-start timer after success', async () => {
  start.mockImplementation(async () => { document.getElementById('app')!.textContent = 'ready'; });
  await import('./main');
  await vi.waitFor(() => expect(start).toHaveBeenCalledOnce());
  await vi.advanceTimersByTimeAsync(20_000);
  expect(document.getElementById('app')?.textContent).toBe('ready');
  expect(vi.getTimerCount()).toBe(0);
});

it('restores the startup UI when initialization fails after replacing its contents', async () => {
  start.mockImplementation(async () => {
    document.getElementById('app')!.replaceChildren();
    throw new Error('Platform initialization failed');
  });
  await import('./main');
  await vi.waitFor(() => expect(document.getElementById('tano-startup-status')?.textContent).toBe('无法打开同页'));
  expect(document.getElementById('tano-startup-detail')?.textContent).toBe('Platform initialization failed');
  expect(document.getElementById('tano-startup-detail')?.hidden).toBe(false);
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
  expect(document.getElementById('tano-startup')?.getAttribute('aria-busy')).toBe('false');
  await vi.advanceTimersByTimeAsync(20_000);
  expect(document.getElementById('tano-startup-status')?.textContent).toBe('无法打开同页');
});

it('shows a recovery UI even when a startup dependency cannot be imported', async () => {
  vi.doMock('./start', () => { throw new Error('Dependency unavailable'); });
  await import('./main');
  await vi.waitFor(() => expect(document.getElementById('tano-startup-status')?.textContent).toBe('无法打开同页'));
  expect(document.getElementById('tano-startup-detail')?.textContent).toBeTruthy();
  expect(document.getElementById('tano-startup-detail')?.hidden).toBe(false);
  expect(start).not.toHaveBeenCalled();
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
});
