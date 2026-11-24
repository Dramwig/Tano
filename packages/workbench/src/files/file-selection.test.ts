import { expect, it } from 'vitest';
import { selectTreeEntry, topLevelEntries } from './file-selection';

const visible = ['folder', 'nested', 'second', 'third'];

it('selects visible ranges in either direction and keeps the original anchor', () => {
  const first = selectTreeEntry({ ids: new Set(), anchor: null }, 'nested', visible, {});
  const range = selectTreeEntry(first, 'third', visible, { shiftKey: true });
  expect([...range.ids]).toEqual(['nested', 'second', 'third']);
  expect(range.anchor).toBe('nested');
  expect([...selectTreeEntry(range, 'folder', visible, { shiftKey: true }).ids]).toEqual([
    'folder',
    'nested',
  ]);
});

it('toggles entries with Ctrl and adds a shifted range with Ctrl+Shift', () => {
  const first = selectTreeEntry({ ids: new Set(['folder']), anchor: 'folder' }, 'third', visible, {
    ctrlKey: true,
  });
  const range = selectTreeEntry(first, 'nested', visible, { ctrlKey: true, shiftKey: true });
  expect([...range.ids]).toEqual(['folder', 'third', 'nested', 'second']);
  expect(selectTreeEntry(range, 'folder', visible, { ctrlKey: true }).ids.has('folder')).toBe(
    false,
  );
});

it('keeps only top-level selected entries for a batch operation', () => {
  expect(
    topLevelEntries([{ path: 'folder' }, { path: 'folder/nested.md' }, { path: 'other.md' }]).map(
      (entry) => entry.path,
    ),
  ).toEqual(['folder', 'other.md']);
});
