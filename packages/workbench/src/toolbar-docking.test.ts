import { expect, it } from 'vitest';
import { dockedToolbarMenuPosition, dockedToolbarPosition, toolbarDropTarget } from './toolbar-docking';
import { parseToolbarMode } from './toolbar-preference';

const pane = { left: 308, top: 108, right: 792, bottom: 692 };

it('limits drop targets to the current pane, including its edge inset', () => {
  expect(toolbarDropTarget(302, 104, pane)).toBe('fixed');
  expect(toolbarDropTarget(315, 340, pane)).toBe('left');
  expect(toolbarDropTarget(790, 340, pane)).toBe('right');
  expect(toolbarDropTarget(530, 340, pane)).toBe('selection');
  expect(toolbarDropTarget(530, 680, pane)).toBe('selection');
  expect(toolbarDropTarget(299, 340, pane)).toBeNull();
  expect(toolbarDropTarget(803, 340, pane)).toBeNull();
  expect(toolbarDropTarget(530, 705, pane)).toBeNull();
});

it('leaves a body target between edge zones in a narrow or short pane', () => {
  const small = { left: 0, top: 0, right: 140, bottom: 80 };
  expect(toolbarDropTarget(70, 40, small)).toBe('selection');
  expect(toolbarDropTarget(20, 40, small)).toBe('left');
  expect(toolbarDropTarget(120, 40, small)).toBe('right');
});

it('centers side toolbars of different heights and keeps inward menus inside the pane', () => {
  const position = dockedToolbarPosition(pane, 'right', 46, 244);
  expect(position.x + 46).toBe(pane.right);
  expect(position.y + 244 / 2).toBe((pane.top + pane.bottom) / 2);
  expect(position.y + position.menuTop).toBeGreaterThanOrEqual(pane.top);
  expect(position.menuHeight).toBe(pane.bottom - pane.top);
  expect(position.menuWidth + 46 + 8).toBe(pane.right - pane.left);
  const shorter = dockedToolbarPosition(pane, 'left', 46, 114);
  expect(shorter.x).toBe(pane.left);
  expect(shorter.y + 114 / 2).toBe((pane.top + pane.bottom) / 2);
  const resized = { ...pane, bottom: 430 };
  expect(dockedToolbarPosition(resized, 'left', 46, 114).y + 114 / 2).toBe(
    (resized.top + resized.bottom) / 2,
  );
});

it('anchors a short docked menu to its trigger without reserving space for a taller menu', () => {
  expect(dockedToolbarMenuPosition(pane, 343, 385, 147)).toEqual({ top: 42, maxHeight: 584 });
});

it('moves a docked menu up only enough to keep its bottom inside the pane', () => {
  expect(dockedToolbarMenuPosition(pane, 343, 385, 356)).toEqual({ top: -7, maxHeight: 584 });
});

it('limits an oversized docked menu to the pane height and clamps triggers above the pane', () => {
  expect(dockedToolbarMenuPosition(pane, 343, 385, 700)).toEqual({ top: -235, maxHeight: 584 });
  expect(dockedToolbarMenuPosition(pane, 108, 90, 147)).toEqual({ top: 0, maxHeight: 584 });
});

it('loads toolbar mode preferences', () => {
  expect(parseToolbarMode('fixed')).toBe('fixed');
  expect(parseToolbarMode('left')).toBe('left');
  expect(parseToolbarMode('right')).toBe('right');
  expect(parseToolbarMode('unknown')).toBe('selection');
});
