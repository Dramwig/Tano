// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, KeepAlive, nextTick, reactive, ref } from 'vue';
import type { App } from 'vue';
import RelationGraph from './RelationGraph.vue';

const fixture = vi.hoisted(() => ({ store: null as any }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => fixture.store }));
let app: App;
let root: HTMLDivElement;
let svg: SVGSVGElement;
const active = ref(true);
const controlsTarget = ref<string>();
const content: Record<string, string> = {
  'Start.md': '[[Target]]',
  'Target.md': '',
  'Alone.md': '',
};

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
async function ready() {
  await vi.waitFor(() => expect(root.querySelectorAll('.graph-node')).toHaveLength(3));
  svg = root.querySelector('svg.graph-viewport')!;
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
  svg.setPointerCapture = vi.fn();
  svg.hasPointerCapture = () => true;
  svg.releasePointerCapture = vi.fn();
}
beforeEach(async () => {
  active.value = true;
  controlsTarget.value = undefined;
  fixture.store = reactive({
    workspace: {
      id: 'workspace',
      path: 'workspace',
      files: Object.keys(content).map((path, i) => ({
        id: String(i),
        path,
        name: path,
        size: 0,
        modified: 0,
        kind: 'file',
      })),
    },
    documents: [],
    relations: [],
    relationError: '',
    readGraphDocument: vi.fn(async (_workspace, file) => content[file.path]),
    openFileInNewTab: vi.fn(),
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({
    render: () => h(KeepAlive, () =>
      active.value ? h(RelationGraph, { controlsTarget: controlsTarget.value }) : null),
  });
  app.mount(root);
  await ready();
});
afterEach(() => {
  app.unmount();
  root.remove();
  vi.unstubAllGlobals();
});

it('highlights only the hovered node and its connections, and supports keyboard activation', async () => {
  const node = root.querySelector('[data-node="0"]')!;
  node.dispatchEvent(new MouseEvent('pointerenter'));
  await nextTick();
  expect(node.classList.contains('highlighted')).toBe(true);
  expect(root.querySelectorAll('line.highlighted')).toHaveLength(1);
  const connected = root.querySelector('[data-node="1"]')!;
  expect(connected.classList.contains('neighbour')).toBe(true);
  expect(connected.classList.contains('highlighted')).toBe(false);
  expect(connected.classList.contains('dimmed')).toBe(false);
  expect(root.querySelector('[data-node="2"]')!.classList.contains('dimmed')).toBe(true);
  node.dispatchEvent(new MouseEvent('pointerleave'));
  await nextTick();
  expect(root.querySelector('line.highlighted')).toBeNull();
  node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  expect(fixture.store.openFileInNewTab).toHaveBeenCalledExactlyOnceWith(
    fixture.store.workspace.files[0],
  );
});

it('moves a node without opening it, releases it on cancellation and opens on a subsequent click', async () => {
  const node = root.querySelector('[data-node="0"]')!;
  const position = node.getAttribute('transform');
  pointer(node, 'pointerdown', 400, 300);
  pointer(svg, 'pointermove', 560, 320);
  await nextTick();
  expect(node.getAttribute('transform')).not.toBe(position);
  expect(svg.classList.contains('is-dragging')).toBe(true);
  pointer(svg, 'pointerup', 560, 320);
  node.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
  expect(fixture.store.openFileInNewTab).not.toHaveBeenCalled();
  pointer(node, 'pointerdown', 400, 300);
  pointer(svg, 'pointercancel', 400, 300);
  expect(fixture.store.openFileInNewTab).not.toHaveBeenCalled();
  pointer(node, 'pointerdown', 400, 300);
  pointer(svg, 'pointerup', 402, 301);
  expect(fixture.store.openFileInNewTab).toHaveBeenCalledTimes(1);
});

it('pans and zooms the viewport and preserves the camera while switching tabs', async () => {
  const group = svg.firstElementChild!;
  const original = group.getAttribute('transform');
  pointer(svg, 'pointerdown', 200, 100);
  pointer(svg, 'pointermove', 320, 180);
  pointer(svg, 'pointerup', 320, 180);
  await nextTick();
  expect(group.getAttribute('transform')).not.toBe(original);
  svg.dispatchEvent(
    new WheelEvent('wheel', { deltaY: -100, clientX: 400, clientY: 300, cancelable: true }),
  );
  await nextTick();
  const moved = group.getAttribute('transform');
  active.value = false;
  await nextTick();
  active.value = true;
  await nextTick();
  expect(root.querySelector('.graph-viewport > g')?.getAttribute('transform')).toBe(moved);
  expect(fixture.store.readGraphDocument).toHaveBeenCalledTimes(3);
  expect(fixture.store.openFileInNewTab).not.toHaveBeenCalled();
});

it('keeps toolbar controls in the shared header only while the graph tab is active', async () => {
  const target = document.createElement('div');
  target.id = 'graph-toolbar-test';
  document.body.append(target);
  try {
    controlsTarget.value = '#graph-toolbar-test';
    await nextTick();
    expect(root.querySelector('.graph-controls')).toBeNull();
    expect(target.querySelectorAll('.graph-controls')).toHaveLength(1);
    const original = svg.firstElementChild!.getAttribute('transform');
    (target.querySelector('[aria-label="放大图谱"]') as HTMLButtonElement).click();
    await nextTick();
    expect(svg.firstElementChild!.getAttribute('transform')).not.toBe(original);
    active.value = false;
    await nextTick();
    expect(target.querySelector('.graph-controls')).toBeNull();
    active.value = true;
    await nextTick();
    expect(target.querySelectorAll('.graph-controls')).toHaveLength(1);
  } finally {
    controlsTarget.value = undefined;
    await nextTick();
    target.remove();
  }
});

it('updates edges from unsaved drafts and removes deleted documents', async () => {
  fixture.store.documents = [{ id: '0', content: '[[Alone]] [[Target]]' }];
  await vi.waitFor(() => expect(root.querySelectorAll('line')).toHaveLength(2));
  fixture.store.workspace.files = fixture.store.workspace.files.filter(
    (file: any) => file.id !== '1',
  );
  await vi.waitFor(() => expect(root.querySelectorAll('.graph-node')).toHaveLength(2));
  expect(root.querySelectorAll('line')).toHaveLength(1);
});

it('reports unreadable documents while preserving the rest of the graph', async () => {
  fixture.store.readGraphDocument.mockRejectedValueOnce(new Error('unreadable'));
  fixture.store.workspace.files[0].modified = 1;
  await vi.waitFor(() =>
    expect(root.querySelector('.graph-warning')?.textContent).toContain('1 篇文档未能读取'),
  );
  expect(root.querySelectorAll('.graph-node')).toHaveLength(3);
  expect(root.querySelector('[aria-label="刷新图谱"]')).toBeNull();
  (root.querySelector('.graph-warning button') as HTMLButtonElement).click();
  await vi.waitFor(() => expect(root.querySelector('.graph-warning')).toBeNull());
});
