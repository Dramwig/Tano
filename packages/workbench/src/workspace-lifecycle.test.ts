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
