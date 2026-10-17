// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { startupPaint } from './startup-paint';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('gives a visible browser page a frame without treating elapsed time as a paint', async () => {
  vi.useFakeTimers();
  const painted = vi.fn();
  const ready = startupPaint().then(painted);
  vi.advanceTimersToNextFrame();
  await Promise.resolve();
  expect(painted).not.toHaveBeenCalled();
  vi.advanceTimersToNextFrame();
  await ready;
  expect(painted).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it('does not wait for animation frames in a hidden page', async () => {
  vi.useFakeTimers();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(123);
  await startupPaint();
  expect(window.requestAnimationFrame).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it('continues when a visible page becomes hidden before its frame arrives', async () => {
  vi.useFakeTimers();
  const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(123);
  const cancel = vi.spyOn(window, 'cancelAnimationFrame');
  const ready = startupPaint();
  visibility.mockReturnValue('hidden');
  document.dispatchEvent(new Event('visibilitychange'));
  await ready;
  expect(cancel).toHaveBeenCalledWith(123);
  expect(vi.getTimerCount()).toBe(0);
});
