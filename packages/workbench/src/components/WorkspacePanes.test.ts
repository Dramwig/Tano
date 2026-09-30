// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import WorkspacePanes from './WorkspacePanes.vue';
import { dockLayout, layoutPanes, mapLayout, newPane } from '../pane-layout';
import { paneDropAt } from '../pane-docking';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
let app: App | undefined;
let root: HTMLElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); });

async function mountPanes(side: 'right' | 'bottom' = 'right') {
  const layout = newPane(['a', 'b', 'c']);
  fixture.store = reactive({
    layout: dockLayout(layout, 'c', { paneId: layout.id, side }),
    get panes() { return layoutPanes(this.layout); },
    activePaneId: layout.id, paneDrop: undefined,
    documents: [{ id: 'a' }, { id: 'b' }, { id: 'c' }], focusPane: vi.fn(),
  });
  const mounted = vi.fn();
  const editor = defineComponent({ setup() { mounted(); return () => h('textarea', { value: 'unsaved draft' }); } });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ render: () => h(WorkspacePanes, {}, {
    default: () => [h('div', { class: 'workspace-tabbar' }), h('header', { class: 'topbar' }), h(editor)],
  }) });
  app.mount(root);
  await nextTick();
  return { id: layout.id, mounted };
}

it('makes room for a preview without remounting editors or persisting a split, and restores on cancel', async () => {
  const { id, mounted } = await mountPanes();
  const before = JSON.stringify(fixture.store.layout);
  const pane = root.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
  const editor = pane.querySelector('textarea');
  const neighbor = root.querySelectorAll<HTMLElement>('.workspace-pane')[1];
  const neighborStyle = neighbor.style.cssText;
  fixture.store.paneDrop = { paneId: id, side: 'right' };
  await nextTick();
  expect(pane.style.width).toBe('25%');
  const preview = root.querySelector<HTMLElement>('.pane-dock-preview')!;
  expect(preview.parentElement).toBe(pane.parentElement);
  expect(preview.style.left).toBe('25%');
  expect(preview.style.width).toBe('25%');
  expect(neighbor.style.cssText).toBe(neighborStyle);
  expect(JSON.stringify(fixture.store.layout)).toBe(before);
  fixture.store.paneDrop = { paneId: id, side: 'top' };
  await nextTick();
  expect(pane.style.top).toBe('50%');
  expect(pane.style.height).toBe('50%');
  fixture.store.paneDrop = undefined;
  await nextTick();
  expect(pane.style.top).toBe('0%');
  expect(pane.style.width).toBe('50%');
  expect(pane.style.height).toBe('100%');
  expect(pane.querySelector('textarea')).toBe(editor);
  expect(mounted).toHaveBeenCalledTimes(2);
  expect(root.querySelector('.pane-dock-preview')).toBeNull();
});

it.each(['right', 'bottom'] as const)('fills a departing %s pane immediately, retaining editors until acknowledgement or rollback', async side => {
  const { mounted } = await mountPanes(side);
  const original = JSON.stringify(fixture.store.layout);
  const [kept, outgoing] = [...root.querySelectorAll<HTMLElement>('.workspace-pane')];
  const originalStyle = kept.style.cssText;
  const keptEditor = kept.querySelector('textarea'), outgoingEditor = outgoing.querySelector('textarea');
  fixture.store.activePaneId = outgoing.dataset.paneId;
  fixture.store.detachingTabId = 'c';
  await nextTick();
  expect(kept.style.width).toBe('100%');
  expect(kept.style.height).toBe('100%');
  expect(outgoing.style.display).toBe('none');
  expect(outgoing.hasAttribute('inert')).toBe(true);
  expect(kept.classList.contains('workspace-pane-active')).toBe(true);
  expect(root.querySelector('.workspace-panes-multiple, .pane-divider')).toBeNull();
  expect(root.querySelectorAll('.pane-dock-region')).toHaveLength(1);
  expect(JSON.stringify(fixture.store.layout)).toBe(original);
  expect(outgoingEditor?.isConnected).toBe(true);
  fixture.store.detachingTabId = ''; // Opening the new window failed.
  await nextTick();
  expect(kept.style.cssText).toBe(originalStyle);
  expect(outgoing.style.display).toBe('');
  expect(outgoing.querySelector('textarea')).toBe(outgoingEditor);
  fixture.store.detachingTabId = 'c';
  await nextTick();
  const expandedStyle = kept.style.cssText;
  fixture.store.layout = mapLayout(fixture.store.layout, pane => pane.tabs.includes('c') ? null : pane);
  fixture.store.detachingTabId = ''; // Successful acknowledgement closes the original tab.
  await nextTick();
  expect(kept.style.cssText).toBe(expandedStyle);
  expect(kept.querySelector('textarea')).toBe(keptEditor);
  expect(root.querySelectorAll('.workspace-pane')).toHaveLength(1);
  expect(mounted).toHaveBeenCalledTimes(2);
});

it('collapses only an emptied branch and leaves populated panes and the final pane intact', async () => {
  const { id } = await mountPanes();
  fixture.store.detachingTabId = 'a';
  await nextTick();
  expect(root.querySelectorAll('.pane-dock-region')).toHaveLength(2); // a still shares its group with b.
  fixture.store.detachingTabId = '';
  fixture.store.layout = dockLayout(fixture.store.layout, 'b', { paneId: id, side: 'bottom' });
  await nextTick();
  const neighbor = root.querySelectorAll<HTMLElement>('.workspace-pane')[2];
  const neighborStyle = neighbor.style.cssText;
  fixture.store.detachingTabId = 'b';
  await nextTick();
  expect(root.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!.style.height).toBe('100%');
  expect(neighbor.style.cssText).toBe(neighborStyle);
  expect(root.querySelectorAll('.pane-divider')).toHaveLength(1);
  fixture.store.layout = newPane(['b']);
  await nextTick();
  expect(root.querySelector<HTMLElement>('.workspace-pane')!.style.display).toBe('');
  expect(root.querySelectorAll('.pane-dock-region')).toHaveLength(1);
});

it('keeps the original narrow edge active while its visible pane is squeezed away from the pointer', async () => {
  const { id } = await mountPanes();
  const bounds = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height }) as DOMRect;
  const region = root.querySelector<HTMLElement>(`[data-dock-pane-id="${id}"]`)!;
  region.getBoundingClientRect = () => bounds(100, 0, 800, 600);
  const pane = root.querySelector<HTMLElement>(`[data-pane-id="${id}"]`)!;
  pane.querySelector<HTMLElement>('.workspace-tabbar')!.getBoundingClientRect = () => bounds(100, 0, 400, 36);
  const hit = vi.fn((): Element => root.querySelector('.workspace-panes')!);
  // jsdom has no hit-testing implementation.
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: hit });
  try {
    fixture.store.paneDrop = { paneId: id, side: 'right' };
    await nextTick();
    pane.getBoundingClientRect = () => bounds(100, 0, 400, 600);
    for (let i = 0; i < 5; i++) expect(paneDropAt(890, 300)).toEqual({ paneId: id, side: 'right' });
    expect(paneDropAt(850, 300)).toBeUndefined(); // Interior of the green preview.
    hit.mockReturnValue(pane);
    expect(paneDropAt(495, 300)).toBeUndefined(); // The temporarily resized edge is not a new target.
    expect(paneDropAt(500, 45)).toEqual({ paneId: id, side: 'top' });
    expect(paneDropAt(500, 80)).toBeUndefined();
    expect(paneDropAt(110, 300)).toEqual({ paneId: id, side: 'left' });
    const strip = pane.querySelector<HTMLElement>('.workspace-tabbar')!;
    strip.dataset.tabPaneId = id;
    hit.mockReturnValue(strip);
    expect(paneDropAt(300, 18)).toEqual({ paneId: id, side: 'center', index: 0 });
  } finally {
    delete (document as Partial<Document>).elementFromPoint;
  }
});
