// @vitest-environment jsdom
import { expect, it } from 'vitest';
import { isElement, isHTMLElement, isNode, ownerWindow } from './dom-realm';

it('recognizes foreign and adopted DOM nodes without depending on their prototypes', () => {
  const frame = document.createElement('iframe');
  document.body.append(frame);
  try {
    const foreign = frame.contentDocument!;
    const element = foreign.createElement('div');
    const text = foreign.createTextNode('text');
    expect(element instanceof HTMLElement).toBe(false);
    expect(isHTMLElement(element)).toBe(true);
    expect(isElement(element)).toBe(true);
    expect(isNode(text)).toBe(true);
    expect(isElement(text)).toBe(false);
    expect(ownerWindow(element)).toBe(frame.contentWindow);
    document.body.append(element);
    expect(isHTMLElement(element)).toBe(true);
    expect(ownerWindow(element)).toBe(window);
    element.remove();
    expect(isHTMLElement(foreign.createElementNS('http://www.w3.org/2000/svg', 'svg'))).toBe(false);
    expect(isNode(null)).toBe(false);
    expect(isNode({})).toBe(false);
  } finally {
    frame.remove();
  }
});
