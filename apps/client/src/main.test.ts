// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import html from '../index.html?raw';

const start = vi.fn<() => Promise<void>>();

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  start.mockReset();
  vi.doMock('./start', () => ({ start }));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  document.body.innerHTML = new DOMParser().parseFromString(html, 'text/html').body.innerHTML;
});

afterEach(() => {
  vi.doUnmock('./start');
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

it('keeps a visible startup state while the workbench loads and offers a retry if it stalls', async () => {
  start.mockImplementation(() => new Promise(() => {}));
  await import('./main');
  expect(document.getElementById('tano-startup-status')?.textContent).toBe('正在打开同页...');
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(15_000);
  expect(document.getElementById('tano-startup-status')?.textContent).toContain('正在加载工作台');
  expect(document.getElementById('tano-startup-retry')?.hidden).toBe(false);
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
