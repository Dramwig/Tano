/** DOM nodes keep their original prototypes when adopted by another document. */
export function isNode(value: unknown): value is Node {
  return value !== null && typeof value === 'object'
    && typeof (value as Node).nodeType === 'number'
    && typeof (value as Node).nodeName === 'string';
}

export function isElement(value: unknown): value is Element {
  return isNode(value) && value.nodeType === 1;
}

export function isHTMLElement(value: unknown): value is HTMLElement {
  return isElement(value) && value.namespaceURI === 'http://www.w3.org/1999/xhtml';
}

export function ownerWindow(node: Node): Window & typeof globalThis {
  const document = node.nodeType === 9 ? node as Document : node.ownerDocument;
  return document?.defaultView ?? window;
}

export function isMouseEvent(value: unknown): value is MouseEvent {
  return !!value && typeof (value as MouseEvent).clientX === 'number' && typeof (value as MouseEvent).clientY === 'number';
}

export function isKeyboardEvent(value: unknown): value is KeyboardEvent {
  return !!value && typeof (value as KeyboardEvent).key === 'string';
}

export function isButtonElement(value: unknown): value is HTMLButtonElement {
  return isHTMLElement(value) && value.tagName === 'BUTTON';
}
