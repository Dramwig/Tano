import { beforeEach, expect, it, vi } from 'vitest';
import { findTabDockTarget, parseTabDragMeta, requestTabTransfer, tabDockIndex, tabDragMetaType } from './tab-docking';

const bus = vi.hoisted(() => ({
  handlers: new Map<string, Set<(event: { payload: any }) => void>>(),
  emitted: [] as Array<{ target?: string; name: string; payload: any }>,
}));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ label: 'main' }) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (name: string, handler: (event: { payload: any }) => void) => {
    const handlers = bus.handlers.get(name) ?? new Set();
    handlers.add(handler);
    bus.handlers.set(name, handlers);
    return () => handlers.delete(handler);
  }),
  emit: vi.fn(async (name: string, payload: any) => {
    bus.emitted.push({ name, payload });
    for (const handler of bus.handlers.get(name) ?? []) handler({ payload });
  }),
  emitTo: vi.fn(async (target: string, name: string, payload: any) => {
    bus.emitted.push({ target, name, payload });
    for (const handler of bus.handlers.get(name) ?? []) handler({ payload });
  }),
}));

beforeEach(() => { bus.handlers.clear(); bus.emitted.length = 0; });

it('round-trips tab drag metadata and inserts by tab centers', () => {
  const meta = { sourceLabel: 'detached-1', workspaceId: '工作区', tabId: '文档-1', width: 184, centerOffset: -12 };
  expect(parseTabDragMeta([tabDragMetaType(meta)])).toEqual(meta);
  expect(parseTabDragMeta(['application/x-tano-tab-meta-not-hex'])).toBeNull();
  expect(tabDockIndex(90, [100, 300])).toBe(0);
  expect(tabDockIndex(180, [100, 300])).toBe(1);
  expect(tabDockIndex(420, [100, 300])).toBe(2);
});

it('prefers the hovered target and leaves tabs in place over another window outside its track', async () => {
  bus.handlers.set('tano-tab-dock-probe', new Set([({ payload }) => {
    for (const reply of [
      { targetLabel: 'behind', insideWindow: true, index: 2, hovered: false },
      { targetLabel: 'front', insideWindow: true, index: 1, hovered: true },
    ]) for (const handler of bus.handlers.get('tano-tab-dock-reply') ?? [])
      handler({ payload: { requestId: payload.requestId, ...reply } });
  }]));
  expect(await findTabDockTarget('workspace', 'tab', { x: 400, y: 200, centerOffset: 0 }))
    .toEqual({ targetLabel: 'front', index: 1 });
  bus.handlers.set('tano-tab-dock-probe', new Set([({ payload }) => {
    for (const handler of bus.handlers.get('tano-tab-dock-reply') ?? [])
      handler({ payload: { requestId: payload.requestId, targetLabel: 'front', insideWindow: true } });
  }]));
  expect(await findTabDockTarget('workspace', 'tab', { x: 400, y: 200, centerOffset: 0 }))
    .toBe('inside-window');
});

it('waits for target acknowledgement before the source may close its tab', async () => {
  bus.handlers.set('tano-tab-transfer-request', new Set([({ payload }) => {
    for (const handler of bus.handlers.get('tano-tab-transfer-result') ?? []) handler({ payload: {
      requestId: payload.requestId, targetLabel: 'detached-2', tabId: payload.tabId, created: true,
    } });
  }]));
  const result = await requestTabTransfer('detached-2', {
    workspaceId: 'workspace', tabId: 'document', index: 2,
  });
  expect(result).toMatchObject({ targetLabel: 'detached-2', tabId: 'document', created: true });
  expect(bus.emitted.find((event) => event.name === 'tano-tab-transfer-request'))
    .toMatchObject({ target: 'detached-2', payload: { sourceLabel: 'main', index: 2 } });
});
