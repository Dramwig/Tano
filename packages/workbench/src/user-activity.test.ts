// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { subscribeUserActivity } from './user-activity';

const subscriptions: ReturnType<typeof subscribeUserActivity>[] = [];
let hidden: boolean;
beforeEach(() => {
  vi.useFakeTimers(); hidden = false;
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
});
afterEach(() => { subscriptions.splice(0).forEach(item => item.dispose()); vi.restoreAllMocks(); vi.useRealTimers(); });
function subscribe(options: Parameters<typeof subscribeUserActivity>[0]) {
  const result = subscribeUserActivity(options); subscriptions.push(result); return result;
}

it('shares one listener set and one deadline timer, retaining other subscribers on disposal', () => {
  const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
  const firstCheck = vi.fn(), secondCheck = vi.fn();
  const first = subscribe({ onDeadline: firstCheck }), second = subscribe({ onDeadline: secondCheck });
  expect(add.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(1);
  first.schedule(1000); second.schedule(30_000); expect(vi.getTimerCount()).toBe(1);
  vi.advanceTimersByTime(1000); expect(firstCheck).toHaveBeenCalledOnce(); expect(secondCheck).not.toHaveBeenCalled();
  first.dispose(); expect(remove.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(0);
  vi.advanceTimersByTime(29_000); expect(secondCheck).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  second.dispose(); expect(remove.mock.calls.filter(([name]) => name === 'pointermove')).toHaveLength(1);
});

it('records high-frequency motion without broadcasting callbacks or recreating timers', () => {
  const activity = vi.fn(), check = vi.fn();
  const first = subscribe({ onDeadline: check, onActivity: activity });
  const second = subscribe({ onDeadline: check, onActivity: activity });
  first.schedule(30_000); second.schedule(90_000);
  const timeout = vi.spyOn(globalThis, 'setTimeout'), clear = vi.spyOn(globalThis, 'clearTimeout');
  const query = vi.spyOn(document, 'querySelectorAll'), selection = vi.spyOn(document, 'getSelection');
  vi.advanceTimersByTime(25_000);
  for (let index = 0; index < 2000; index++) window.dispatchEvent(new Event('pointermove'));
  document.dispatchEvent(new Event('scroll')); window.dispatchEvent(new Event('resize'));
  expect(first.lastActivity).toBe(Date.now()); expect(second.lastActivity).toBe(first.lastActivity);
  for (const mock of [activity, check, timeout, clear, query, selection]) expect(mock).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(1);
});

it('stops the clock in the background and restarts both consumers on return', () => {
  const check = vi.fn(), suspend = vi.fn(), resume = vi.fn();
  const item = subscribe({ onDeadline: check, onSuspend: suspend, onResume: resume });
  item.schedule(30_000); hidden = true; document.dispatchEvent(new Event('visibilitychange'));
  expect(item.canRun).toBe(false); expect(suspend).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000); expect(check).not.toHaveBeenCalled();
  hidden = false; document.dispatchEvent(new Event('visibilitychange'));
  expect(item.lastActivity).toBe(Date.now()); expect(resume).toHaveBeenCalledOnce();
  item.schedule(30_000); vi.advanceTimersByTime(30_000); expect(check).toHaveBeenCalledOnce();
  window.dispatchEvent(new Event('blur')); item.schedule(1000); expect(vi.getTimerCount()).toBe(0);
});

it('tracks held input in capture phase even when an editor stops propagation', () => {
  const check = vi.fn(); const item = subscribe({ onDeadline: check });
  const editor = document.createElement('div'); document.body.append(editor);
  editor.addEventListener('pointerup', event => event.stopPropagation());
  try {
    item.schedule(30_000);
    editor.dispatchEvent(new Event('pointerdown', { bubbles: true })); expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(40_000); expect(check).not.toHaveBeenCalled();
    editor.dispatchEvent(new Event('pointerup', { bubbles: true })); expect(item.canRun).toBe(true);
    vi.advanceTimersByTime(0); expect(check).toHaveBeenCalledOnce();
  } finally { editor.remove(); }
});

it('handles equal deadlines and disposal during callbacks without leaving a timer', () => {
  const later = vi.fn(); let second: ReturnType<typeof subscribeUserActivity>;
  const first = subscribe({ onDeadline: () => { second.dispose(); first.dispose(); } });
  second = subscribe({ onDeadline: later });
  first.schedule(1000); second.schedule(1000); vi.advanceTimersByTime(1000);
  expect(later).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  const fresh = subscribe({ onDeadline: later }); fresh.schedule(1000);
  first.dispose(); second.dispose(); vi.advanceTimersByTime(1000);
  expect(later).toHaveBeenCalledOnce();
});
