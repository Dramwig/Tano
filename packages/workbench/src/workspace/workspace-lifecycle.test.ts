// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { WorkspaceLifecycle } from './workspace-lifecycle';

afterEach(() => vi.useRealTimers());
it('releases a watcher that finishes registering after its workspace was closed', async () => {
  let register!: (stop: () => void) => void;
  const release = vi.fn();
  const lifecycle = new WorkspaceLifecycle({
    watch: () => new Promise(resolve => { register = resolve; }),
    available: () => true, refresh: vi.fn(), report: vi.fn(),
  }, false);
  const starting = lifecycle.start();
  lifecycle.stop();
  register(release);
  await starting;
  expect(release).toHaveBeenCalledTimes(1);
});

it('coalesces a burst and stops a pending refresh when the workspace is closed', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined), stop = vi.fn();
  const lifecycle = new WorkspaceLifecycle({
    watch: async () => stop, available: () => true, refresh, report: vi.fn(),
  }, false);
  await lifecycle.start();
  for (let i = 0; i < 100; i++) lifecycle.schedule();
  await vi.advanceTimersByTimeAsync(150);
  expect(refresh).toHaveBeenCalledTimes(1);
  lifecycle.schedule();
  lifecycle.stop();
  await vi.advanceTimersByTimeAsync(150);
  expect(refresh).toHaveBeenCalledTimes(1);
  expect(stop).toHaveBeenCalledTimes(1);
});

it('uses native events and focus without polling a healthy watcher', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  let changed!: () => void;
  const lifecycle = new WorkspaceLifecycle({
    watch: async callback => { changed = callback; return () => {}; },
    available: () => true, refresh, report: vi.fn(),
  }, true);
  try {
    await lifecycle.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).not.toHaveBeenCalled();
    changed();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(2);
    lifecycle.enablePolling();
    lifecycle.enablePolling();
    await vi.advanceTimersByTimeAsync(5_150);
    expect(refresh).toHaveBeenCalledTimes(3);
  } finally { lifecycle.stop(); }
});

it('polls after watcher failure and stops polling once registration recovers', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined), report = vi.fn();
  const lifecycle = new WorkspaceLifecycle({
    watch: vi.fn().mockRejectedValueOnce(new Error('watch unavailable')).mockResolvedValue(() => {}),
    available: () => true, refresh, report,
  }, true);
  try {
    await lifecycle.start();
    expect(report).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(5_150);
    expect(refresh).toHaveBeenCalledTimes(1);
    await lifecycle.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(refresh).toHaveBeenCalledTimes(1);
  } finally { lifecycle.stop(); }
});

it('defers queued changes during switching and replays them if switching is cancelled', async () => {
  vi.useFakeTimers();
  const refresh = vi.fn().mockResolvedValue(undefined);
  let changed!: () => void;
  const lifecycle = new WorkspaceLifecycle({
    watch: async callback => { changed = callback; return () => {}; },
    available: () => true, refresh, report: vi.fn(),
  }, true);
  try {
    await lifecycle.start();
    changed();
    lifecycle.pause();
    changed();
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).not.toHaveBeenCalled();
    lifecycle.resume();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(1);
    changed();
    lifecycle.pause();
    await lifecycle.start();
    lifecycle.resume();
    await vi.advanceTimersByTimeAsync(500);
    expect(refresh).toHaveBeenCalledTimes(1);
    changed();
    await vi.advanceTimersByTimeAsync(150);
    expect(refresh).toHaveBeenCalledTimes(2);
  } finally { lifecycle.stop(); }
});
