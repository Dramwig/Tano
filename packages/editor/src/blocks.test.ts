// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState, NodeSelection } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { blockControls } from './blocks';

const schema = new Schema({ nodes: {
  doc: { content: 'block+' },
  paragraph: { content: 'text*', group: 'block', toDOM: () => ['p', 0] },
  heading: { content: 'text*', group: 'block', attrs: { level: { default: 1 } }, toDOM: () => ['h1', 0] },
  text: { group: 'inline' },
} });
let view: EditorView;
let root: HTMLDivElement;
let frames: Map<number, FrameRequestCallback>;
let nextFrame: number;
let readsAfterWrites: string[];
let observer: MutationObserver;
let measuring = false;
const rangeRects = Object.getOwnPropertyDescriptor(Range.prototype, 'getClientRects');

beforeEach(() => {
  frames = new Map(); nextFrame = 0; readsAfterWrites = []; measuring = false;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback); return nextFrame;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  const checkReads = () => {
    if (measuring) readsAfterWrites.push(...observer.takeRecords()
      .filter(record => record.attributeName === 'style').map(record => (record.target as Element).className));
  };
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    checkReads();
    return new DOMRect(100, 100, this.matches('button') ? 18 : 400, 24);
  });
  Object.defineProperty(Range.prototype, 'getClientRects', { configurable: true, value: () => {
    checkReads(); return [new DOMRect(100, 100, 10, 24)];
  } });
  root = document.createElement('div'); document.body.append(root);
  const host = document.createElement('div'); root.append(host);
  const doc = schema.node('doc', null, [schema.node('heading', null, schema.text('Title')),
    schema.node('paragraph', null, schema.text('First')), schema.node('paragraph', null, schema.text('Second'))]);
  view = new EditorView(host, { state: EditorState.create({ schema, doc, plugins: [blockControls(() => false)] }) });
  observer = new MutationObserver(() => {});
  observer.observe(root.querySelector('.tano-block-controls')!, { subtree: true, attributes: true });
});

afterEach(() => {
  view.destroy(); observer.disconnect(); root.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  if (rangeRects) Object.defineProperty(Range.prototype, 'getClientRects', rangeRects);
  else Reflect.deleteProperty(Range.prototype, 'getClientRects');
});

function paint() {
  const pending = [...frames.values()]; frames.clear();
  observer.takeRecords(); measuring = true;
  try { pending.forEach(callback => callback(0)); }
  finally { measuring = false; }
}

it('coalesces edits, resize and node-view layout events without interleaving geometry reads and style writes', () => {
  const heading = root.querySelector('h1')!, handle = root.querySelector('.tano-block-handle')!;
  const read = vi.fn(() => Element.prototype.getBoundingClientRect.call(heading));
  const controlRead = vi.fn(() => Element.prototype.getBoundingClientRect.call(handle));
  Object.defineProperty(heading, 'getBoundingClientRect', { value: read });
  Object.defineProperty(handle, 'getBoundingClientRect', { value: controlRead });
  view.dispatch(view.state.tr.insertText('A', 1));
  view.dispatch(view.state.tr.insertText('B', 2));
  window.dispatchEvent(new Event('resize'));
  view.dom.dispatchEvent(new Event('tano-block-layout'));
  view.dom.dispatchEvent(new Event('tano-table-layout'));
  expect(controlRead).not.toHaveBeenCalled();
  expect(frames.size).toBe(1);
  read.mockClear(); // ProseMirror itself can measure the caret during a transaction.
  paint();
  expect(read).toHaveBeenCalledTimes(1); // Heading handle and fold button share the read.
  expect(readsAfterWrites).toEqual([]);
  expect(frames.size).toBe(0);
  expect(view.state.doc.firstChild!.textContent).toBe('ABTitle');
});

it('selects the current block when clicked before the pending layout frame', () => {
  view.dispatch(view.state.tr.insertText('Inserted ', 1));
  const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[2]!;
  const position = view.state.doc.child(0).nodeSize + view.state.doc.child(1).nodeSize;
  expect(Number(handle.dataset.blockPos)).toBe(position);
  handle.click();
  expect(view.state.selection).toBeInstanceOf(NodeSelection);
  expect(view.state.selection.from).toBe(position);
  expect((view.state.selection as NodeSelection).node.textContent).toBe('Second');
});

it('keeps folding correct across consecutive clicks before a frame is painted', () => {
  const button = root.querySelector<HTMLButtonElement>('.tano-fold-toggle')!;
  button.click();
  expect(view.dom.querySelectorAll('.tano-folded-heading-content')).toHaveLength(2);
  button.click();
  expect(view.dom.querySelector('.tano-folded-heading-content')).toBeNull();
  paint();
  expect(root.querySelector<HTMLButtonElement>('.tano-block-handle')!.hidden).toBe(false);
  expect(view.state.doc.textContent).toBe('TitleFirstSecond');
});

it('skips offscreen control measurements and restores controls on scrolling into view', () => {
  const paragraph = root.querySelectorAll('p')[1]!;
  const handle = root.querySelectorAll<HTMLButtonElement>('.tano-block-handle')[2]!;
  let top = 5000;
  vi.spyOn(paragraph, 'getBoundingClientRect').mockImplementation(() => new DOMRect(100, top, 400, 24));
  const measured = vi.fn(() => new DOMRect(100, top, 18, 24));
  Object.defineProperty(handle, 'getBoundingClientRect', { value: measured });
  window.dispatchEvent(new Event('resize'));
  paint();
  expect(handle.hidden).toBe(true);
  expect(measured).not.toHaveBeenCalled();
  top = 110;
  root.dispatchEvent(new Event('scroll'));
  paint();
  expect(measured).toHaveBeenCalledOnce();
  expect(handle.hidden).toBe(false);
  expect(readsAfterWrites).toEqual([]);
});

it('cancels queued layout work when the editor is destroyed', () => {
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(1);
  view.destroy();
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(0);
});
