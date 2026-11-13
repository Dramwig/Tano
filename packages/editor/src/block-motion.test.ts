// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Schema } from '@milkdown/kit/prose/model';
import { EditorState } from '@milkdown/kit/prose/state';
import { EditorView } from '@milkdown/kit/prose/view';
import { blockMotion } from './block-motion';

const schema = new Schema({ nodes: {
  doc: { content: 'paragraph+' }, paragraph: { content: 'text*', toDOM: () => ['p', 0] }, text: {},
} });
type Call = { element: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions };
let calls: Call[] = [];
let reduced = false;
const row = 30;
beforeEach(() => {
  calls = []; reduced = false;
  vi.stubGlobal('matchMedia', () => ({ get matches() { return reduced; }, addEventListener() {} }));
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    calls.push({ element: this, frames, options });
    return { cancel() {}, onfinish: null, oncancel: null } as unknown as Animation;
  } });
  // One block per 30px row; the editor itself spans the viewport.
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function(this: HTMLElement) {
    const parent = this.parentElement;
    const index = this.matches('.ProseMirror') || !parent ? -1 : [...parent.children].indexOf(this);
    const top = index < 0 ? 0 : index * row;
    const height = index < 0 ? 600 : row;
    return { x: 0, y: top, left: 0, top, right: 600, bottom: top + height, width: 600, height, toJSON() {} } as DOMRect;
  });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.unstubAllGlobals();
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  document.body.innerHTML = '';
});
function editor(...texts: string[]) {
  const root = document.createElement('div'); document.body.append(root);
  const doc = schema.node('doc', null, texts.map(text => schema.node('paragraph', null, text ? [schema.text(text)] : [])));
  return new EditorView(root, { state: EditorState.create({ doc, plugins: [blockMotion()] }) });
}
const translated = (element: Element) => calls.some(call => call.element === element && 'translate' in call.frames[0]! && !('opacity' in call.frames[0]!));
const risen = (element: Element) => calls.some(call => call.element === element && call.frames[0]!.opacity === 0);

it('keeps plain typing on the fast path', () => {
  const view = editor('alpha', 'beta');
  view.dispatch(view.state.tr.insertText('!', 6));
  expect(calls).toEqual([]);
  view.destroy();
});
it('rises a split paragraph in and glides the blocks below it', () => {
  const view = editor('alpha', 'beta');
  view.dispatch(view.state.tr.split(3));
  const blocks = [...view.dom.children];
  expect(blocks).toHaveLength(3);
  expect(risen(blocks[1]!)).toBe(true);
  expect(translated(blocks[2]!)).toBe(true);
  expect(risen(blocks[0]!)).toBe(false);
  view.destroy();
});
it('ghosts a removed block outside the ProseMirror DOM and closes the gap', () => {
  const view = editor('alpha', 'beta', 'gamma');
  view.dispatch(view.state.tr.delete(7, 13));
  const ghost = document.querySelector<HTMLElement>('[data-motion-ghost]');
  expect(ghost?.textContent).toBe('beta');
  expect(view.dom.contains(ghost)).toBe(false);
  expect(ghost!.closest('.tano-block-ghost-layer')).not.toBeNull();
  expect(translated(view.dom.children[1]!)).toBe(true);
  expect(view.state.doc.textContent).toBe('alphagamma');
  view.destroy();
});
it('does nothing when the user prefers reduced motion', () => {
  reduced = true;
  const view = editor('alpha', 'beta');
  view.dispatch(view.state.tr.split(3));
  view.dispatch(view.state.tr.delete(0, 7));
  expect(calls).toEqual([]);
  expect(document.querySelector('[data-motion-ghost]')).toBeNull();
  view.destroy();
});
