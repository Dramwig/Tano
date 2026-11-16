// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { CARET_SPRING, Spring } from './spring';
import { TypedReveal } from './typed-reveal';
import { EraseGhosts, type GhostCapture } from './erase-ghosts';

afterEach(() => {
  delete (HTMLElement.prototype as Partial<HTMLElement>).animate;
  document.body.innerHTML = '';
});

const rect = (left: number, width: number, top = 0, height = 20) =>
  ({ x: left, y: top, left, top, right: left + width, bottom: top + height, width, height, toJSON() {} }) as DOMRect;
type Fake = { currentTime: number; playbackRate: number; cancelled: boolean; finished: boolean; onfinish: null | (() => void) };
function fakeAnimations() {
  const made: { element: HTMLElement; animation: Fake }[] = [];
  Object.defineProperty(HTMLElement.prototype, 'animate', { configurable: true, value(this: HTMLElement) {
    const animation = {
      currentTime: 0, playbackRate: 1, cancelled: false, finished: false, onfinish: null as null | (() => void), oncancel: null,
      pause() {}, cancel() { this.cancelled = true; }, finish() { this.finished = true; this.onfinish?.(); },
    };
    made.push({ element: this, animation });
    return animation as unknown as Animation;
  } });
  return made;
}

it('keeps velocity when the target moves mid-glide', () => {
  const spring = new Spring(0, CARET_SPRING);
  spring.retarget(10);
  for (let frame = 0; frame < 3; frame++) spring.step(1 / 60);
  const velocity = spring.velocity;
  expect(velocity).toBeGreaterThan(0);
  spring.retarget(20);
  expect(spring.velocity).toBe(velocity);
});

it('settles exactly on its target and reports rest', () => {
  const spring = new Spring(0);
  spring.retarget(10);
  let frames = 0;
  while (spring.step(1 / 60) && frames < 200) frames++;
  expect(spring.value).toBe(10);
  expect(frames).toBeLessThan(40);
});

function typedSpan(at: number) {
  const element = document.createElement('span');
  element.className = 'tano-typed';
  element.dataset.typedAt = String(at);
  return element;
}

it('fades a keystroke in on its own clock and a redrawn span keeps its progress', () => {
  const made = fakeAnimations();
  const root = document.createElement('div');
  document.body.append(root);
  const first = typedSpan(1000);
  root.append(first);
  const reveal = new TypedReveal();
  reveal.sync(root, 1000);
  expect(reveal.frame(1060)).toBe(true);
  const progress = made[0]!.animation.currentTime;
  expect(progress).toBeGreaterThan(300);
  expect(progress).toBeLessThan(900);
  // ProseMirror redraws the span on the next keystroke: no restart.
  first.replaceWith(typedSpan(1000));
  reveal.sync(root, 1070);
  expect(made[0]!.animation.cancelled).toBe(true);
  expect(made[1]!.animation.currentTime).toBe(progress);
  expect(reveal.frame(1400)).toBe(false);
  expect(made[1]!.animation.cancelled).toBe(true);
});

it('does not animate text that is already old when it is first seen', () => {
  const made = fakeAnimations();
  const root = document.createElement('div');
  root.append(typedSpan(0));
  new TypedReveal().sync(root, 1000);
  expect(made).toEqual([]);
});

it('hands over: a new deletion hurries the previous ghost, a held key clears them', () => {
  const made = fakeAnimations();
  const layer = document.createElement('div');
  document.body.append(layer);
  const capture = (): GhostCapture => ({ rect: rect(100, 10), content: document.createRange().createContextualFragment('x'), style: getComputedStyle(layer), collapse: 'start' });
  const ghosts = new EraseGhosts();
  ghosts.play(layer, capture());
  ghosts.play(layer, capture());
  expect(made[0]!.animation.playbackRate).toBeGreaterThan(1);
  expect(layer.querySelectorAll('.tano-type-ghost')).toHaveLength(2);
  ghosts.finish();
  expect(layer.querySelectorAll('.tano-type-ghost')).toHaveLength(0);
});
