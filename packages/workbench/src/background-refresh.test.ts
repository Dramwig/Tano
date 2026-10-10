// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { DemoAdapter } from './adapter';
import { refreshWorkspace, subscribeBackgroundRefresh } from './background-refresh';

const stops: (() => void)[] = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); vi.useRealTimers(); });

it('shares in-flight reads but retries failures and refreshes again after completion', async () => {
  const adapter = new DemoAdapter();
  const snapshot = await adapter.refresh();
  let resolve!: (value: typeof snapshot) => void;
  const refresh = vi.spyOn(adapter, 'refresh').mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  const first = refreshWorkspace(adapter), second = refreshWorkspace(adapter);
  expect(first).toBe(second);
  expect(refresh).toHaveBeenCalledOnce();
  resolve(snapshot); await first;
  refresh.mockRejectedValueOnce(new Error('offline'));
  await expect(refreshWorkspace(adapter)).rejects.toThrow('offline');
  await expect(refreshWorkspace(adapter)).resolves.toMatchObject({ id: snapshot.id });
  expect(refresh).toHaveBeenCalledTimes(3);
});

it('runs review readers on one clock, pauses when hidden and refreshes on return without overlap', async () => {
  vi.useFakeTimers();
  let visible = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visible as DocumentVisibilityState);
  let finish!: () => void;
  const first = vi.fn().mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve; }));
  const second = vi.fn();
  stops.push(subscribeBackgroundRefresh(first), subscribeBackgroundRefresh(second));
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(5000);
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('focus')); await Promise.resolve();
  expect(first).toHaveBeenCalledOnce(); expect(second).toHaveBeenCalledTimes(2);
  visible = 'hidden'; document.dispatchEvent(new Event('visibilitychange'));
  finish(); await vi.advanceTimersByTimeAsync(15000);
  expect(second).toHaveBeenCalledTimes(2);
  expect(vi.getTimerCount()).toBe(0);
  visible = 'visible'; document.dispatchEvent(new Event('visibilitychange'));
  await vi.advanceTimersByTimeAsync(0);
  expect(first).toHaveBeenCalledTimes(2); expect(second).toHaveBeenCalledTimes(3);
  stops.splice(0).forEach(stop => stop());
  expect(vi.getTimerCount()).toBe(0);
  window.dispatchEvent(new Event('focus')); await vi.advanceTimersByTimeAsync(10000);
  expect(second).toHaveBeenCalledTimes(3);
});
