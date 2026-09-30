import { describe, expect, it } from 'vitest';
import { dockLayout, dockSideAt, layoutGeometry, layoutPanes, newPane, panePreviewRects, reconcileLayout, restoreLayout } from './pane-layout';
import type { WorkspaceLayout } from '@tano/protocol';

describe('nested workspace layout', () => {
  it.each(['left', 'right', 'top', 'bottom'] as const)('reserves %s preview space matching a committed split inside a nested pane', side => {
    const root = newPane(['a', 'b', 'c', 'd']);
    const columns = dockLayout(root, 'b', { paneId: root.id, side: 'right' });
    const nested = dockLayout(columns, 'c', { paneId: root.id, side: 'bottom' });
    const original = JSON.stringify(nested);
    const rect = layoutGeometry(nested).panes.find(item => item.pane.id === root.id)!.rect;
    const preview = panePreviewRects(rect, side)!;
    const committed = layoutGeometry(dockLayout(nested, 'd', { paneId: root.id, side }));
    expect(preview.content).toEqual(committed.panes.find(item => item.pane.id === root.id)!.rect);
    expect(preview.preview).toEqual(committed.panes.find(item => item.pane.tabs.includes('d'))!.rect);
    expect(JSON.stringify(nested)).toBe(original);
    expect(panePreviewRects(rect, 'center')).toBeUndefined();
  });
  it('combines columns and rows, moves tabs between groups, and collapses empty branches', () => {
    let root: WorkspaceLayout = newPane(['a', 'b', 'c', 'd']);
    const left = root.id;
    root = dockLayout(root, 'b', { paneId: left, side: 'right' });
    root = dockLayout(root, 'c', { paneId: left, side: 'bottom' });
    const bottom = layoutPanes(root).find(pane => pane.tabs.includes('c'))!;
    root = dockLayout(root, 'd', { paneId: bottom.id, side: 'right' });
    expect(layoutPanes(root).map(pane => pane.tabs)).toEqual([['a'], ['c'], ['d'], ['b']]);
    const geometry = layoutGeometry(root);
    expect(geometry.dividers).toHaveLength(3);
    expect(geometry.panes.map(pane => pane.rect)).toEqual([
      { left: 0, top: 0, width: .5, height: .5 },
      { left: 0, top: .5, width: .25, height: .5 },
      { left: .25, top: .5, width: .25, height: .5 },
      { left: .5, top: 0, width: .5, height: 1 },
    ]);
    root = dockLayout(root, 'd', { paneId: bottom.id, side: 'center', index: 0 });
    expect(layoutPanes(root).map(pane => pane.tabs)).toEqual([['a'], ['d', 'c'], ['b']]);
    expect(layoutGeometry(root).dividers).toHaveLength(2);
  });

  it('does not split the only tab out of its own pane, and reorders inside a group', () => {
    const root = newPane(['a']);
    expect(dockLayout(root, 'a', { paneId: root.id, side: 'left' })).toBe(root);
    const group = newPane(['a', 'b', 'c']);
    const moved = dockLayout(group, 'a', { paneId: group.id, side: 'center', index: 3 });
    expect(layoutPanes(moved)[0].tabs).toEqual(['b', 'c', 'a']);
  });

  it('keeps a replaced document in its original group and adds tabs to the focused group', () => {
    const initial = newPane(['a', 'b', 'c']);
    let root = dockLayout(initial, 'b', { paneId: initial.id, side: 'right' });
    const right = layoutPanes(root)[1].id;
    root = reconcileLayout(root, ['a', 'c', 'new'], ['a', 'c', 'b'], right);
    expect(layoutPanes(root)[1]).toMatchObject({ id: right, tabs: ['new'], activeId: 'new' });
    root = reconcileLayout(root, ['a', 'c', 'new', 'extra'], ['a', 'c', 'new'], right);
    expect(layoutPanes(root)[1].tabs).toEqual(['new', 'extra']);
    root = reconcileLayout(root, [], ['a', 'c', 'new', 'extra'], right);
    expect(root).toMatchObject({ kind: 'pane', tabs: [], activeId: '' });
  });

  it('restores valid branches while repairing duplicate, stale and remapped tab IDs', () => {
    const restored = restoreLayout({ kind: 'split', id: 'root', axis: 'vertical', ratio: Infinity,
      first: { kind: 'pane', id: 'p1', tabs: ['old', 'missing'], activeId: 'old' },
      second: { kind: 'pane', id: 'p2', tabs: ['old', 'b'], activeId: 'missing' },
    }, ['new', 'b', 'c'], new Map([['old', 'new']]));
    expect(restored).toMatchObject({ ratio: .5 });
    expect(layoutPanes(restored).map(pane => [pane.tabs, pane.activeId])).toEqual([[['new', 'c'], 'new'], [['b'], 'b']]);
    expect(layoutPanes(restoreLayout({ kind: 'invalid' }, ['draft']))[0].tabs).toEqual(['draft']);
  });

  it.each([
    [5, 200, 'left'], [595, 200, 'right'], [300, 5, 'top'], [300, 395, 'bottom'], [300, 200, undefined],
  ] as const)('previews %s,%s as %s relative to the target pane', (x, y, side) => {
    expect(dockSideAt(x, y, 600, 400)).toBe(side);
  });

  it('only activates within 32 pixels of the edge, regardless of pane size', () => {
    for (const [width, height] of [[600, 400], [1800, 1000]]) {
      expect(dockSideAt(width - 32, height / 2, width, height)).toBe('right');
      expect(dockSideAt(width - 33, height / 2, width, height)).toBeUndefined();
      expect(dockSideAt(width * .8, height / 2, width, height)).toBeUndefined();
      expect(dockSideAt(33, height / 2, width, height)).toBeUndefined();
      expect(dockSideAt(width / 2, 33, width, height)).toBeUndefined();
      expect(dockSideAt(width / 2, height - 33, width, height)).toBeUndefined();
    }
    expect(dockSideAt(20, 10, 1800, 400)).toBe('top');
    expect(dockSideAt(20, 30, 1800, 400)).toBe('left');
    expect(dockSideAt(-1, 200, 600, 400)).toBeUndefined();
  });
});
