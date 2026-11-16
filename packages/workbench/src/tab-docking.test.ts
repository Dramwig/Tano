import { expect, it } from 'vitest';
import { tabDragMetaType, parseTabDragMeta, tabDockIndex } from './tab-docking';

it('round-trips tab drag metadata and inserts by tab centers', () => {
  const meta = { sourceLabel: 'detached-1', workspaceId: '工作区', tabId: '文档-1', width: 184, centerOffset: -12 };
  expect(parseTabDragMeta([tabDragMetaType(meta)])).toEqual(meta);
  const landing = { ...meta, height: 32, grabY: 12 };
  expect(parseTabDragMeta([tabDragMetaType(landing)])).toEqual(landing);
  expect(parseTabDragMeta([tabDragMetaType({ ...landing, grabY: NaN })])).toBeNull();
  expect(parseTabDragMeta(['application/x-tano-tab-meta-not-hex'])).toBeNull();
  expect(tabDockIndex(90, [100, 300])).toBe(0);
  expect(tabDockIndex(180, [100, 300])).toBe(1);
  expect(tabDockIndex(420, [100, 300])).toBe(2);
});
