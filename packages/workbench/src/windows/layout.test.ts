import { expect, it } from 'vitest';
import { layoutPanes } from '../pane-layout';
import { closeWindowLayout, moveTabToNewWindow, moveWindowTab, newWindowLayout, removeWindowTab } from './layout';

it('moves a tab to a new window without losing either active pane', () => {
  const original = { main: newWindowLayout(['a', 'b']) };
  const next = moveTabToNewWindow(original, 'a', 'one');
  expect(layoutPanes(next.main.layout)[0].activeId).toBe('b');
  expect(layoutPanes(next.one.layout)[0].activeId).toBe('a');
  expect(next.one.activePaneId).toBe(next.one.layout.id);
  expect(layoutPanes(original.main.layout)[0].tabs).toEqual(['a', 'b']);
});

it('moves between windows, splits the target and removes an empty source', () => {
  const windows = { main: newWindowLayout(['a']), one: newWindowLayout(['b']), two: newWindowLayout(['c']) };
  const next = moveWindowTab(windows, 'b', 'two', { paneId: windows.two.layout.id, side: 'right' });
  expect(next.one).toBeUndefined();
  const panes = layoutPanes(next.two.layout);
  expect(panes.map(pane => pane.tabs)).toEqual([['c'], ['b']]);
  expect(next.two.activePaneId).toBe(panes[1].id);
  const returned = moveWindowTab(next, 'b', 'main', { paneId: next.main.layout.id, side: 'center', index: 0 });
  expect(layoutPanes(returned.main.layout)[0].tabs).toEqual(['b', 'a']);
  expect(layoutPanes(returned.main.layout)[0].activeId).toBe('b');
  expect(layoutPanes(returned.two.layout)[0].activeId).toBe('c');
  expect(returned.two.activePaneId).toBe(returned.two.layout.id);
});

it('keeps the main window and removes auxiliary windows after their final tab closes', () => {
  const windows = { main: newWindowLayout(['a']), one: newWindowLayout(['b', 'c']) };
  const next = removeWindowTab(removeWindowTab(windows, 'b'), 'c');
  expect(next.one).toBeUndefined();
  expect(layoutPanes(removeWindowTab(next, 'a').main.layout)[0].tabs).toEqual([]);
  expect(closeWindowLayout(windows, 'one')).toEqual({ main: windows.main });
  expect(moveTabToNewWindow(windows, 'missing', 'two')).toBe(windows);
  expect(moveWindowTab(windows, 'a', 'one', { paneId: 'missing', side: 'center' })).toBe(windows);
});
