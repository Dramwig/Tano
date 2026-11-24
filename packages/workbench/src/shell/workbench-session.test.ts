import { expect, it, vi } from 'vitest';
import { retainWorkbenchSession } from './workbench-session';

it('keeps the initialized session alive across immediate view remounts', async () => {
  const owner = {};
  const dispose = vi.fn();
  const start = vi.fn(async () => {});
  const first = retainWorkbenchSession(owner, dispose);
  await first.initialize(start);
  first.release();
  const replacement = retainWorkbenchSession(owner, dispose);
  await replacement.initialize(start);
  expect(dispose).not.toHaveBeenCalled();
  expect(start).toHaveBeenCalledOnce();

  replacement.release();
  replacement.release();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledOnce();
});

it('shares in-flight initialization instead of opening the workspace twice', async () => {
  const owner = {};
  const dispose = vi.fn();
  let finish!: () => void;
  const start = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const first = retainWorkbenchSession(owner, dispose);
  const startup = first.initialize(start);
  await Promise.resolve();
  first.release();
  const replacement = retainWorkbenchSession(owner, dispose);
  expect(replacement.initialize(start)).toBe(startup);
  await Promise.resolve();
  expect(dispose).not.toHaveBeenCalled();
  finish();
  await startup;
  expect(start).toHaveBeenCalledOnce();
  replacement.release();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledOnce();
});

it('releases independent workbench sessions only after their last view unmounts', async () => {
  const owner = {}, otherOwner = {};
  const dispose = vi.fn(), otherDispose = vi.fn();
  const first = retainWorkbenchSession(owner, dispose);
  const second = retainWorkbenchSession(owner, dispose);
  const other = retainWorkbenchSession(otherOwner, otherDispose);
  first.release();
  other.release();
  await Promise.resolve();
  expect(dispose).not.toHaveBeenCalled();
  expect(otherDispose).toHaveBeenCalledOnce();
  second.release();
  await Promise.resolve();
  expect(dispose).toHaveBeenCalledOnce();
});
