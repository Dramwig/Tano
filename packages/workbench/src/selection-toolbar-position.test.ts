import { expect, it } from 'vitest';
import { selectionToolbarPosition } from './selection-toolbar-position';

const pane = { left: 308, top: 108, right: 692, bottom: 492 };
it('keeps a capsule inside its pane and above the selected text', () => {
  const result = selectionToolbarPosition(
    [{ left: 650, top: 230, right: 688, bottom: 250 }],
    pane,
    260,
    42,
  )!;
  expect(result.x).toBe(432);
  expect(result.y + 42).toBeLessThan(230);
  expect(result.x).toBeGreaterThanOrEqual(pane.left);
  expect(result.x + 260).toBeLessThanOrEqual(pane.right);
});
it('places the capsule below a selection at the top of a scrolled pane', () => {
  const result = selectionToolbarPosition(
    [{ left: 350, top: 90, right: 480, bottom: 135 }],
    pane,
    260,
    42,
  )!;
  expect(result.y).toBe(143);
  expect(result.menuSide).toBe('below');
});
it('does not obscure a selection covering the pane or follow an offscreen selection', () => {
  expect(
    selectionToolbarPosition([{ left: 350, top: 70, right: 480, bottom: 510 }], pane, 260, 42),
  ).toBeNull();
  expect(
    selectionToolbarPosition([{ left: 350, top: 20, right: 480, bottom: 80 }], pane, 260, 42),
  ).toBeNull();
  expect(
    selectionToolbarPosition([{ left: 20, top: 230, right: 280, bottom: 250 }], pane, 260, 42),
  ).toBeNull();
});
it('uses the full visible multiline selection when avoiding overlap', () => {
  const result = selectionToolbarPosition(
    [
      { left: 350, top: 120, right: 680, bottom: 144 },
      { left: 350, top: 150, right: 420, bottom: 174 },
    ],
    pane,
    260,
    42,
  )!;
  expect(result.y).toBe(182);
});

it('opens secondary menus upward for a selection near the pane bottom', () => {
  const result = selectionToolbarPosition(
    [{ left: 350, top: 450, right: 620, bottom: 475 }],
    pane,
    260,
    42,
  )!;
  expect(result.menuSide).toBe('above');
  expect(result.y).toBe(400);
});
