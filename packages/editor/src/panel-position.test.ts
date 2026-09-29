// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { floatingPanelPosition, positionAnchoredPanel } from './panel-position';

const elements: HTMLElement[] = [];
afterEach(() => {
  elements.splice(0).forEach((element) => element.remove());
});

function rect(element: HTMLElement, x: number, y: number, width: number, height: number) {
  element.getBoundingClientRect = () => new DOMRect(x, y, width, height);
}

it('flips a panel above its anchor and keeps it inside the right edge', () => {
  const anchor = document.createElement('div');
  const panel = document.createElement('div');
  anchor.append(panel);
  document.body.append(anchor);
  elements.push(anchor);
  rect(anchor, window.innerWidth - 120, window.innerHeight - 110, 80, 30);
  rect(panel, 0, 0, 240, 140);
  positionAnchoredPanel(anchor, panel);
  expect(panel.style.left).toBe('-128px');
  expect(panel.style.top).toBe('-146px');
});

it('uses a scroll container as the visible boundary', () => {
  const scroller = document.createElement('div');
  scroller.style.overflow = 'auto';
  const anchor = document.createElement('div');
  const panel = document.createElement('div');
  scroller.append(anchor);
  anchor.append(panel);
  document.body.append(scroller);
  elements.push(scroller);
  rect(scroller, 100, 100, 500, 300);
  expect(window.getComputedStyle(scroller).overflow).toBe('auto');
  rect(anchor, 500, 300, 50, 30);
  rect(panel, 0, 0, 180, 120);
  expect(floatingPanelPosition(anchor, panel)).toEqual({ x: 412, y: 174, side: 'above' });
  expect(panel.style.getPropertyValue('--tano-panel-available-height')).toBe('284px');
});

it('clamps a panel into view when neither side has enough room', () => {
  const scroller = document.createElement('div');
  scroller.style.overflow = 'auto';
  const anchor = document.createElement('div');
  const panel = document.createElement('div');
  scroller.append(anchor);
  anchor.append(panel);
  document.body.append(scroller);
  elements.push(scroller);
  rect(scroller, 0, 0, 300, 200);
  rect(anchor, 200, 80, 50, 30);
  rect(panel, 0, 0, 250, 160);
  expect(floatingPanelPosition(anchor, panel)).toEqual({ x: 42, y: 32, side: 'below' });
});

it('follows document scrolling without flipping sides or leaving the visible area', () => {
  const scroller = document.createElement('div');
  scroller.style.overflow = 'auto';
  const anchor = document.createElement('div');
  const panel = document.createElement('div');
  scroller.append(anchor);
  anchor.append(panel);
  document.body.append(scroller);
  elements.push(scroller);
  rect(scroller, 100, 100, 500, 300);
  let top = 300;
  anchor.getBoundingClientRect = () => new DOMRect(500, top, 50, 30);
  rect(panel, 0, 0, 180, 120);
  const side = positionAnchoredPanel(anchor, panel);
  expect(side).toBe('above');
  expect(top + Number.parseFloat(panel.style.top)).toBe(174);
  top = 250;
  positionAnchoredPanel(anchor, panel, 0, side);
  expect(top + Number.parseFloat(panel.style.top)).toBe(124);
  top = 200;
  positionAnchoredPanel(anchor, panel, 0, side);
  expect(top + Number.parseFloat(panel.style.top)).toBe(108);
});
