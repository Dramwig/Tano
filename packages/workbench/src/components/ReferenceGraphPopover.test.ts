// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { ReferenceContext } from '../content-references';
import ReferenceGraphPopover from './ReferenceGraphPopover.vue';
import * as referenceGraphLayout from '../reference-graph-layout';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));

let app: App | undefined;
let root: HTMLDivElement;

afterEach(() => {
  app?.unmount();
  root?.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  'renders one curve per pair with reciprocal references: %s',
  async (reciprocal) => {
    const open = vi.fn();
    fixture.store = reactive({
      workspace: { id: 'workspace', path: 'demo' },
      referenceRevision: 'revision-1',
      getReferenceContext: vi.fn(async () => ({
        outgoing: [
          {
            source: {
              workspace: 'workspace',
              type: 'document',
              id: 'a00001',
              name: '当前页',
              path: '当前页.md',
            },
            target: { type: 'document', id: 'b00002' },
            name: '被引用页',
            excerpt: '出链片段',
            missing: false,
            archived: false,
          },
        ],
        incoming: [
          ...(reciprocal
            ? [
                {
                  source: {
                    workspace: 'workspace',
                    type: 'document',
                    id: 'b00002',
                    name: '被引用页',
                    path: '被引用页.md',
                  },
                  target: { type: 'document', id: 'a00001' },
                  name: '当前页',
                  excerpt: '双向引用',
                  missing: false,
                  archived: false,
                },
              ]
            : []),
          {
            source: {
              workspace: 'workspace',
              type: 'document',
              id: 'c00003',
              name: '引用页',
              path: '引用页.md',
            },
            target: { type: 'document', id: 'a00001' },
            name: '当前页',
            excerpt: '反链片段',
            missing: false,
            archived: false,
          },
        ],
        errors: [],
      })),
    });
    root = document.createElement('div');
    document.body.append(root);
    app = createApp(() =>
      h(ReferenceGraphPopover, {
        identity: { type: 'document', id: 'a00001' },
        label: '当前页',
        onOpen: open,
      }),
    );
    app.mount(root);

    (document.querySelector('button[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
    await vi.waitFor(() =>
      expect(document.querySelector('.reference-graph-canvas')).not.toBeNull(),
    );
    await nextTick();
    expect(fixture.store.getReferenceContext).toHaveBeenCalledExactlyOnceWith({
      type: 'document',
      id: 'a00001',
    });
    expect(document.querySelector('.reference-graph-center')?.textContent).toContain('当前页');
    expect(document.querySelectorAll('.reference-graph-node')).toHaveLength(3);
    const edges = [...document.querySelectorAll('.reference-graph-edges path')];
    expect(edges).toHaveLength(2);
    expect(
      edges
        .map((edge) => `${edge.getAttribute('data-source')}->${edge.getAttribute('data-target')}`)
        .sort(),
    ).toEqual([
      reciprocal ? 'document/b00002->document/a00001' : 'document/a00001->document/b00002',
      'document/c00003->document/a00001',
    ]);
    expect(
      edges.every(
        (edge) =>
          edge.getAttribute('marker-end') === `url(#${document.querySelector('marker')!.id})`,
      ),
    ).toBe(true);
    const marker = document.querySelector('marker')!;
    expect(marker.getAttribute('orient')).toBe('auto-start-reverse');
    const mutualEdges = edges.filter((edge) => edge.hasAttribute('marker-start'));
    expect(mutualEdges).toHaveLength(reciprocal ? 1 : 0);
    if (reciprocal) {
      expect(mutualEdges[0].getAttribute('data-source')).toBe('document/b00002');
      expect(mutualEdges[0].getAttribute('data-target')).toBe('document/a00001');
      expect(mutualEdges[0].getAttribute('marker-start')).toBe(`url(#${marker.id})`);
    }
    expect(edges.every((edge) => edge.getAttribute('d')?.includes(' C '))).toBe(true);

    (document.querySelector('[data-node="document/b00002"]') as SVGGElement).dispatchEvent(
      new MouseEvent('click', { bubbles: true }),
    );
    expect(open).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ type: 'document', id: 'b00002' }),
    );
  },
);

it('shows outgoing and incoming excerpts while hovering a node', async () => {
  fixture.store = reactive({
    workspace: { id: 'workspace', path: 'demo' },
    referenceRevision: 'revision-1',
    getReferenceContext: vi.fn(async (): Promise<ReferenceContext> => ({
      outgoing: [{
        source: { workspace: 'workspace', type: 'document', id: 'a00001', name: '当前页', path: '当前页.md' },
        target: { type: 'document', id: 'b00002' },
        name: '被引用页', excerpt: '出链上下文', missing: false, archived: false,
      }],
      incoming: [{
        source: { workspace: 'workspace', type: 'document', id: 'c00003', name: '引用页', path: '引用页.md' },
        target: { type: 'document', id: 'a00001' },
        name: '当前页', excerpt: '反链上下文', missing: false, archived: false,
      }],
      errors: [],
    })),
  });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(() => h(ReferenceGraphPopover, {
    identity: { type: 'document', id: 'a00001' }, label: '当前页',
  }));
  app.mount(root);
  (document.querySelector('button[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(document.querySelector('.reference-graph-center')).not.toBeNull());
  document.querySelector('.reference-graph-center')!.dispatchEvent(
    new Event('pointerenter', { bubbles: true }),
  );
  await nextTick();
  const preview = document.querySelector('.reference-graph-context-preview');
  expect(preview?.textContent).toContain('引用');
  expect(preview?.textContent).toContain('被引用');
  expect(preview?.textContent).toContain('出链上下文');
  expect(preview?.textContent).toContain('反链上下文');
});

function pointer(target: Element, type: string, x: number, y: number) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: 0,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, { pointerId: { value: 1 }, isPrimary: { value: true } });
  target.dispatchEvent(event);
}

async function mountDraggableGraph(targetIds = ['b00002'], withMenu = false) {
  const layoutSpy = vi.spyOn(referenceGraphLayout, 'createReferenceGraphLayout');
  const open = vi.fn();
  fixture.store = reactive({
    workspace: { id: 'workspace', path: 'demo' },
    referenceRevision: 'revision-1',
    getReferenceContext: vi.fn(async () => ({
      outgoing: targetIds.map((id) => ({
        source: { type: 'document', id: 'a00001', name: '当前页' },
        target: { type: 'document', id },
        name: '被引用页',
        missing: false,
        archived: false,
      })),
      incoming: [],
      errors: [],
    })),
  });
  root = document.createElement('div');
  document.body.append(root);
  root.getBoundingClientRect = () => ({ left: 180, top: 80, width: 800, height: 600 }) as DOMRect;
  const state = reactive({ opened: false, menu: true });
  const documentProps = reactive({
    identity: { type: 'document', id: 'a00001' },
    label: '当前页',
  });
  app = createApp(() => {
    const props = {
      ...documentProps,
      onOpen: open,
    };
    if (!withMenu) return h(ReferenceGraphPopover, props);
    return [
      state.menu &&
        h('div', { class: 'test-menu' }, [
          h(
            'button',
            {
              'aria-label': '查看关系图谱',
              onClick: () => {
                state.opened = true;
                state.menu = false;
              },
            },
            '查看关系图谱',
          ),
        ]),
      h(ReferenceGraphPopover, {
        ...props,
        variant: 'panel',
        anchor: root,
        opened: state.opened,
        'onUpdate:opened': (value: boolean) => {
          state.opened = value;
        },
      }),
    ];
  });
  app.mount(root);
  (document.querySelector('[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(document.querySelectorAll('.reference-graph-node')).toHaveLength(targetIds.length + 1),
  );
  const svg = document.querySelector<SVGSVGElement>('.reference-graph-viewport')!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 680, height: 360 }) as DOMRect;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => true;
  svg.releasePointerCapture = vi.fn(() => svg.dispatchEvent(new Event('lostpointercapture')));
  const getLayout = () => {
    const layout = layoutSpy.mock.results.at(-1)!.value as ReturnType<
      typeof referenceGraphLayout.createReferenceGraphLayout
    >;
    layout.simulation.stop();
    return layout;
  };
  getLayout();
  return { svg, open, getLayout, documentProps, state };
}

it('survives menu dismissal, outside clicks, Escape, navigation and repeated opening until explicitly closed', async () => {
  const { svg, open, documentProps, state } = await mountDraggableGraph(['b00002'], true);
  const panel = document.querySelector<HTMLElement>('[aria-label="当前文档关系图谱"]')!;
  expect(document.querySelector('.test-menu')).toBeNull();
  expect(root.contains(panel)).toBe(false);
  expect(panel.style.left).toBe('192px');
  expect(panel.style.top).toBe('92px');
  pointer(document.body, 'pointerdown', 900, 650);
  document.body.click();
  svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await nextTick();
  expect(state.opened).toBe(true);
  expect(panel.isConnected).toBe(true);

  document
    .querySelector('[data-node="document/b00002"]')!
    .dispatchEvent(new MouseEvent('click', { bubbles: true }));
  expect(open).toHaveBeenCalledOnce();
  documentProps.identity = { type: 'document', id: 'b00002' };
  documentProps.label = '被引用页';
  await nextTick();
  await nextTick();
  expect(panel.isConnected).toBe(true);
  expect(panel.getAttribute('aria-description')).toBe('被引用页');
  expect(state.opened).toBe(true);

  state.menu = true;
  await nextTick();
  (document.querySelector('[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
  await nextTick();
  expect(document.querySelector('.test-menu')).toBeNull();
  expect(document.querySelectorAll('[aria-label="当前文档关系图谱"]')).toHaveLength(1);
  expect(panel.isConnected).toBe(true);
  (panel.querySelector('[aria-label="关闭关系图谱"]') as HTMLButtonElement).click();
  await nextTick();
  expect(state.opened).toBe(false);
  expect(panel.isConnected).toBe(false);
});

it('drags only the panel handle, preserves the graph view, and keeps the close button reachable', async () => {
  const { svg, getLayout } = await mountDraggableGraph();
  const panel = document.querySelector<HTMLElement>('.reference-graph-popover')!;
  const header = panel.querySelector<HTMLElement>('[aria-label="移动关系图谱面板"]')!;
  panel.getBoundingClientRect = () => ({ width: 700, height: 480 }) as DOMRect;
  header.setPointerCapture = vi.fn();
  header.hasPointerCapture = () => true;
  header.releasePointerCapture = vi.fn();
  const camera = await panAndZoom(svg);
  const nodes = getLayout().nodes.map(({ x, y }) => ({ x, y }));
  const start = { x: Number.parseFloat(panel.style.left), y: Number.parseFloat(panel.style.top) };
  pointer(header, 'pointerdown', 100, 100);
  pointer(header, 'pointermove', 200, 180);
  pointer(header, 'pointerup', 200, 180);
  await nextTick();
  expect(panel.style.left).toBe(`${start.x + 100}px`);
  expect(panel.style.top).toBe(`${start.y + 80}px`);
  expect(header.releasePointerCapture).toHaveBeenCalledWith(1);
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
  expect(getLayout().nodes.map(({ x, y }) => ({ x, y }))).toEqual(nodes);
  const position = panel.getAttribute('style');
  await panAndZoom(svg);
  expect(panel.getAttribute('style')).toBe(position);
  fixture.store.referenceRevision = 'refresh';
  await nextTick();
  await nextTick();
  expect(panel.getAttribute('style')).toBe(position);

  pointer(header, 'pointerdown', 200, 180);
  pointer(header, 'pointermove', 5000, 5000);
  pointer(header, 'pointercancel', 5000, 5000);
  await nextTick();
  expect(panel.style.left).toBe(`${window.innerWidth - 712}px`);
  expect(panel.style.top).toBe(`${window.innerHeight - 492}px`);
  expect(panel.classList.contains('is-moving')).toBe(false);
  vi.stubGlobal('innerWidth', 800);
  vi.stubGlobal('innerHeight', 600);
  window.dispatchEvent(new Event('resize'));
  await nextTick();
  expect(panel.style.left).toBe('88px');
  expect(panel.style.top).toBe('108px');
  pointer(header, 'pointerdown', 200, 180);
  pointer(header, 'pointermove', -5000, -5000);
  pointer(header, 'pointerup', -5000, -5000);
  await nextTick();
  expect(panel.style.left).toBe('12px');
  expect(panel.style.top).toBe('12px');

  const close = panel.querySelector<HTMLButtonElement>('[aria-label="关闭关系图谱"]')!;
  vi.mocked(header.setPointerCapture).mockClear();
  pointer(close, 'pointerdown', 680, 30);
  expect(header.setPointerCapture).not.toHaveBeenCalled();
  close.click();
  await nextTick();
  (document.querySelector('[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
  await nextTick();
  const reopened = document.querySelector<HTMLElement>('.reference-graph-popover')!;
  expect(reopened.style.left).toBe('12px');
  expect(reopened.style.top).toBe('12px');
});

it.each(['a00001', 'b00002'])(
  'freely drags node %s and releases it smoothly to the forces',
  async (id) => {
    const { svg, open, getLayout } = await mountDraggableGraph();
    const element = document.querySelector(`[data-node="document/${id}"]`)!;
    const group = svg.querySelector(':scope > g')!;
    const camera = group.getAttribute('transform');
    const layout = getLayout();
    const node = layout.nodes.find((node) => node.id === `document/${id}`)!;
    const neighbour = layout.nodes.find((other) => other !== node)!;
    const original = { x: node.x, y: node.y };
    const neighbourBefore = { x: neighbour.x, y: neighbour.y };
    layout.simulation.alpha(0);
    pointer(element, 'pointerdown', 340, 180);
    pointer(svg, 'pointermove', 400, 260);
    await nextTick();
    expect({ x: node.x, y: node.y }).not.toEqual(original);
    expect(group.getAttribute('transform')).toBe(camera);
    expect(layout.simulation.alpha()).toBeGreaterThan(0);
    const held = { x: node.x, y: node.y };
    layout.simulation.stop().tick(30);
    expect({ x: node.x, y: node.y }).toEqual(held);
    expect({ x: neighbour.x, y: neighbour.y }).not.toEqual(neighbourBefore);
    const dropped = { x: node.x, y: node.y };
    pointer(svg, 'pointerup', 400, 260);
    // Pointer-up does not teleport the node or leave a permanent constraint behind.
    expect({ x: node.x, y: node.y }).toEqual(dropped);
    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
    expect(node.vx).toBe(0);
    expect(node.vy).toBe(0);
    expect(open).not.toHaveBeenCalled();
    layout.simulation.tick();
    const firstStep = Math.hypot(node.x - dropped.x, node.y - dropped.y);
    expect(firstStep).toBeGreaterThan(0);
    expect(firstStep).toBeLessThan(10);
    layout.simulation.tick(300);
    expect({ x: node.x, y: node.y }).not.toEqual(dropped);
    expect(layout.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);

    pointer(element, 'pointerdown', 340, 180);
    pointer(svg, 'pointermove', 400, 260);
    const cancelled = { x: node.x, y: node.y };
    pointer(svg, 'pointercancel', 400, 260);
    expect({ x: node.x, y: node.y }).toEqual(cancelled);
    expect(node.fx).toBeNull();
    expect(node.fy).toBeNull();
  },
);

it('keeps nodes free after changing physics or restoring the default layout', async () => {
  const { getLayout } = await mountDraggableGraph();
  let layout = getLayout();
  layout.nodes[0].x = 180;
  layout.nodes[0].y = 90;
  const positions = layout.nodes.map(({ x, y }) => ({ x, y }));
  (document.querySelector('[aria-label="布局设置"]') as HTMLButtonElement).click();
  await nextTick();
  const repulsion = document.querySelectorAll<HTMLInputElement>('input[type="range"]')[2];
  repulsion.value = '500';
  repulsion.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
  layout = getLayout();
  expect(layout.nodes.map(({ x, y }) => ({ x, y }))).toEqual(positions);
  expect(layout.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);

  (document.querySelector('.reference-graph-reset') as HTMLButtonElement).click();
  await nextTick();
  await nextTick();
  layout = getLayout();
  expect(layout.nodes.every((node) => node.fx == null && node.fy == null)).toBe(true);
  expect(layout.nodes.map(({ x, y }) => ({ x, y }))).not.toEqual(positions);
});

it('pans only when dragging the background', async () => {
  const { svg, open, getLayout } = await mountDraggableGraph();
  const group = svg.querySelector(':scope > g')!;
  const original = group.getAttribute('transform');
  const positions = getLayout().nodes.map(({ x, y }) => ({ x, y }));
  pointer(svg, 'pointerdown', 340, 180);
  pointer(svg, 'pointermove', 420, 240);
  await nextTick();
  const moved = group.getAttribute('transform');
  expect(moved).not.toBe(original);
  pointer(svg, 'pointerup', 420, 240);
  await nextTick();
  expect(group.getAttribute('transform')).toBe(moved);
  expect(getLayout().nodes.map(({ x, y }) => ({ x, y }))).toEqual(positions);
  expect(open).not.toHaveBeenCalled();
});

async function panAndZoom(svg: SVGSVGElement) {
  pointer(svg, 'pointerdown', 340, 180);
  pointer(svg, 'pointermove', 120, 210);
  pointer(svg, 'pointerup', 120, 210);
  svg.dispatchEvent(
    new WheelEvent('wheel', {
      deltaY: -120,
      clientX: 120,
      clientY: 210,
      cancelable: true,
    }),
  );
  await nextTick();
  return svg.querySelector(':scope > g')!.getAttribute('transform');
}

it('preserves the canvas, camera and simulation through unchanged background refreshes', async () => {
  const { svg, getLayout } = await mountDraggableGraph(['b00002', 'c00003']);
  const camera = await panAndZoom(svg);
  const layout = getLayout();
  layout.simulation.alpha(0);
  const positions = layout.nodes.map(({ x, y }) => ({ x, y }));
  const value: ReferenceContext = await fixture.store.getReferenceContext();
  let resolveRefresh!: (result: ReferenceContext) => void;
  fixture.store.getReferenceContext.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveRefresh = resolve;
      }),
  );
  fixture.store.referenceRevision = 'revision-2';
  await nextTick();
  expect(document.querySelector('.reference-graph-viewport')).toBe(svg);
  expect(document.querySelector('[role="status"]')).toBeNull();
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
  expect(getLayout()).toBe(layout);

  // A different reference order/excerpt does not change the graph.
  resolveRefresh({
    ...value,
    outgoing: [...value.outgoing].reverse().map((edge) => ({ ...edge, excerpt: '更新的文章内容' })),
  });
  await nextTick();
  await nextTick();
  expect(document.querySelector('.reference-graph-viewport')).toBe(svg);
  expect(getLayout()).toBe(layout);
  expect(layout.simulation.alpha()).toBe(0);
  expect(layout.nodes.map(({ x, y }) => ({ x, y }))).toEqual(positions);
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
});

it('updates actual reference changes from existing positions without recentering', async () => {
  const { svg, getLayout } = await mountDraggableGraph();
  const camera = await panAndZoom(svg);
  const layout = getLayout();
  layout.simulation.alpha(0);
  const positions = layout.nodes.map(({ id, x, y }) => ({ id, x, y }));
  const value: ReferenceContext = await fixture.store.getReferenceContext();
  fixture.store.getReferenceContext.mockResolvedValueOnce({
    ...value,
    outgoing: [
      ...value.outgoing,
      { ...value.outgoing[0], target: { type: 'document', id: 'c00003' }, name: '新增引用' },
    ],
  });
  fixture.store.referenceRevision = 'revision-2';
  await nextTick();
  await nextTick();
  const updated = getLayout();
  expect(updated.nodes).toHaveLength(3);
  expect(
    updated.nodes
      .filter(({ id }) => id !== 'document/c00003')
      .map(({ id, x, y }) => ({ id, x, y })),
  ).toEqual(positions);
  expect(document.querySelector('.reference-graph-viewport')).toBe(svg);
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
});

it('does not refit on resize notifications or when reopening the same graph', async () => {
  let resize!: (width: number, height: number) => void;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: ResizeObserverCallback) {
        resize = (width, height) =>
          callback(
            [{ contentRect: { width, height } } as ResizeObserverEntry],
            this as unknown as ResizeObserver,
          );
      }
      observe() {
        resize(680, 360);
      }
      disconnect() {}
    },
  );
  const { svg, getLayout } = await mountDraggableGraph();
  const layout = getLayout();
  layout.simulation.alpha(0);
  const camera = await panAndZoom(svg);
  resize(680, 360);
  await nextTick();
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
  resize(800, 420);
  await nextTick();
  const changed = svg.querySelector(':scope > g')!.getAttribute('transform')!;
  const before = camera!.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  const after = changed.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
  expect(after[0] - before[0]).toBeCloseTo(60);
  expect(after[1] - before[1]).toBeCloseTo(30);
  expect(after[2]).toBe(before[2]);
  resize(680, 360);
  (document.querySelector('[aria-label="关闭关系图谱"]') as HTMLButtonElement).click();
  await nextTick();
  (document.querySelector('[aria-label="查看关系图谱"]') as HTMLButtonElement).click();
  await nextTick();
  await nextTick();
  expect(getLayout()).toBe(layout);
  expect(document.querySelector('.reference-graph-viewport > g')!.getAttribute('transform')).toBe(
    camera,
  );
});

it('keeps the existing graph visible when a background refresh fails', async () => {
  const { svg, getLayout } = await mountDraggableGraph();
  const camera = await panAndZoom(svg);
  const layout = getLayout();
  fixture.store.getReferenceContext.mockRejectedValueOnce(new Error('暂时无法读取'));
  fixture.store.referenceRevision = 'revision-2';
  await nextTick();
  await nextTick();
  expect(document.querySelector('.reference-graph-warning')?.textContent).toContain('暂时无法读取');
  expect(document.querySelector('.reference-graph-viewport')).toBe(svg);
  expect(getLayout()).toBe(layout);
  expect(svg.querySelector(':scope > g')!.getAttribute('transform')).toBe(camera);
});

it.each(['document', 'workspace'])(
  'starts a fresh graph on a %s switch and ignores the old response',
  async (scope) => {
    const { svg, getLayout, documentProps } = await mountDraggableGraph();
    const camera = await panAndZoom(svg);
    const layout = getLayout();
    const value: ReferenceContext = await fixture.store.getReferenceContext();
    let resolveOld!: (result: ReferenceContext) => void;
    fixture.store.getReferenceContext.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    fixture.store.referenceRevision = 'revision-2';
    await nextTick();
    if (scope === 'document') {
      documentProps.identity = { type: 'document', id: 'd00004' };
      documentProps.label = '另一篇文章';
    } else fixture.store.workspace = { id: 'other-workspace', path: 'other' };
    await nextTick();
    await nextTick();
    expect(getLayout()).not.toBe(layout);
    expect(
      document.querySelector('.reference-graph-viewport > g')!.getAttribute('transform'),
    ).not.toBe(camera);
    resolveOld({
      ...value,
      outgoing: [{ ...value.outgoing[0], target: { type: 'document', id: 'stale' } }],
    });
    await nextTick();
    await nextTick();
    expect(document.querySelector('[data-node="document/stale"]')).toBeNull();
    expect(document.querySelector('.reference-graph-center')!.getAttribute('data-node')).toBe(
      `document/${documentProps.identity.id}`,
    );
  },
);
