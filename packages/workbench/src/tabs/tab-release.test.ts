import { expect, it } from 'vitest';
import { resolveTabRelease } from './tab-release';

const source = { id: 'b', paneId: 'pane', tabs: ['a', 'b', 'c'] };
const input = { source, reference: false, outside: false, detachable: true };

it('returns for neutral and unchanged insertion positions', () => {
  expect(resolveTabRelease(input)).toEqual({ kind: 'return' });
  for (const index of [1, 2]) expect(resolveTabRelease({ ...input,
    paneDrop: { paneId: 'pane', side: 'center', index },
  })).toEqual({ kind: 'return' });
  expect(resolveTabRelease({ ...input, target: { id: 'a', side: 'after' } })).toEqual({ kind: 'return' });
  expect(resolveTabRelease({ ...input, target: { id: 'c', side: 'before' } })).toEqual({ kind: 'return' });
});

it('keeps reference acceptance ahead of stale outside or docking hints', () => {
  expect(resolveTabRelease({ ...input, reference: true, outside: true,
    paneDrop: { paneId: 'pane', side: 'right' },
  })).toEqual({ kind: 'reference' });
});

it('distinguishes detach, split, move and reorder', () => {
  expect(resolveTabRelease({ ...input, outside: true })).toEqual({ kind: 'detach' });
  expect(resolveTabRelease({ ...input, outside: true, detachable: false })).toEqual({ kind: 'return' });
  for (const drop of [{ paneId: 'pane', side: 'right' as const },
    { paneId: 'other', side: 'center' as const, index: 1 }]) {
    expect(resolveTabRelease({ ...input, paneDrop: drop })).toEqual({ kind: 'dock', drop });
  }
  const target = { id: 'c', side: 'after' as const };
  expect(resolveTabRelease({ ...input, target })).toEqual({ kind: 'reorder', target });
});
