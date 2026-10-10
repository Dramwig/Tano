// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createButterflyIdleTrigger, type ButterflyIdleSelection } from './butterfly-idle';

let selection: ButterflyIdleSelection | null;
let enabled: boolean;
let focused: boolean;
let hidden: boolean;
let idle: ReturnType<typeof createButterflyIdleTrigger>;
const fire = vi.fn();
const readSelection = vi.fn(() => selection);
beforeEach(() => {
  vi.useFakeTimers(); fire.mockReset(); readSelection.mockClear();
  selection = { scope: 'workspace:pane:doc', from: 1, to: 6, document: {} };
  enabled = focused = true; hidden = false;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => focused);
  vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
  idle = createButterflyIdleTrigger({ selection: readSelection, enabled: () => enabled, onIdle: fire });
});
afterEach(() => { idle.dispose(); vi.restoreAllMocks(); vi.useRealTimers(); });

it('does not read the editor or churn timers during mouse movement, even at the old deadline', () => {
  readSelection.mockClear();
  const timeout = vi.spyOn(globalThis, 'setTimeout');
  vi.advanceTimersByTime(25_000);
  for (let index = 0; index < 2000; index++) window.dispatchEvent(new Event('pointermove'));
  expect(readSelection).not.toHaveBeenCalled(); expect(timeout).not.toHaveBeenCalled();
  vi.advanceTimersByTime(5000); expect(readSelection).not.toHaveBeenCalled(); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(25_000); expect(readSelection).toHaveBeenCalledOnce(); expect(fire).toHaveBeenCalledOnce();
});

it('schedules no butterfly checks without a selection', () => {
  selection = null; idle.refresh(); readSelection.mockClear();
  window.dispatchEvent(new Event('pointermove')); vi.advanceTimersByTime(90_000);
  expect(vi.getTimerCount()).toBe(0); expect(readSelection).not.toHaveBeenCalled(); expect(fire).not.toHaveBeenCalled();
});

it('waits the full 30 seconds and fires only once for the unchanged selection', () => {
  vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledExactlyOnceWith(selection);
  window.dispatchEvent(new Event('pointermove')); idle.refresh();
  vi.advanceTimersByTime(90_000); expect(fire).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

it.each(['pointermove', 'wheel', 'scroll', 'input', 'selectionchange', 'resize'])('restarts the deadline after %s', name => {
  vi.advanceTimersByTime(25_000);
  document.dispatchEvent(new Event(name));
  vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledOnce();
});

it('does not fire while a drag, key or IME composition is held', () => {
  for (const [start, end] of [
    [new MouseEvent('pointerdown'), new MouseEvent('pointerup')],
    [new KeyboardEvent('keydown', { code: 'ShiftLeft' }), new KeyboardEvent('keyup', { code: 'ShiftLeft' })],
    [new Event('compositionstart'), new Event('compositionend')],
  ]) {
    window.dispatchEvent(start);
    vi.advanceTimersByTime(40_000); expect(fire).not.toHaveBeenCalled();
    window.dispatchEvent(end);
    vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  }
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledOnce();
});

it('cancels a collapsed selection and starts a new selection with a fresh deadline', () => {
  vi.advanceTimersByTime(25_000); const previous = selection;
  selection = null; document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(60_000); expect(fire).not.toHaveBeenCalled();
  selection = previous; document.dispatchEvent(new Event('selectionchange'));
  vi.advanceTimersByTime(30_000); expect(fire).toHaveBeenCalledOnce();
});

it.each(['scope', 'range', 'document'])('re-arms once after the %s changes', kind => {
  vi.advanceTimersByTime(30_000);
  selection = { ...selection!, ...(kind === 'scope' ? { scope: 'other:pane:doc' } : kind === 'range' ? { to: 8 } : { document: {} }) };
  idle.refresh(); vi.advanceTimersByTime(29_999); expect(fire).toHaveBeenCalledOnce();
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledTimes(2);
});

it('suspends while unavailable and does not re-trigger after an existing flight returns', () => {
  vi.advanceTimersByTime(25_000); enabled = false; idle.refresh();
  vi.advanceTimersByTime(60_000); expect(fire).not.toHaveBeenCalled();
  enabled = true; idle.refresh();
  vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledOnce();
  enabled = false; idle.refresh(); enabled = true; idle.refresh();
  vi.advanceTimersByTime(30_000); expect(fire).toHaveBeenCalledOnce();
});

it.each(['blur', 'hidden'])('waits a fresh 30 seconds after returning from %s', reason => {
  vi.advanceTimersByTime(25_000);
  if (reason === 'blur') { focused = false; window.dispatchEvent(new Event('blur')); }
  else { hidden = true; document.dispatchEvent(new Event('visibilitychange')); }
  vi.advanceTimersByTime(60_000); expect(fire).not.toHaveBeenCalled();
  focused = true; hidden = false;
  if (reason === 'blur') window.dispatchEvent(new Event('focus'));
  else document.dispatchEvent(new Event('visibilitychange'));
  vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(fire).toHaveBeenCalledOnce();
});

it('rechecks eligibility and the selection at the deadline without a prior event', () => {
  vi.advanceTimersByTime(29_000); selection = { ...selection!, to: 9 };
  vi.advanceTimersByTime(1_000); expect(fire).not.toHaveBeenCalled();
  vi.advanceTimersByTime(29_999); expect(fire).not.toHaveBeenCalled();
  enabled = false; vi.advanceTimersByTime(1); expect(fire).not.toHaveBeenCalled();
});

it('removes all listeners and timers on disposal', () => {
  idle.dispose();
  window.dispatchEvent(new Event('pointermove')); window.dispatchEvent(new Event('focus'));
  document.dispatchEvent(new Event('selectionchange')); idle.refresh();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(60_000); expect(fire).not.toHaveBeenCalled();
});
