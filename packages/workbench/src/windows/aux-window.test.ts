// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AuxWindowError, openAuxWindow } from './aux-window';

/** jsdom has no window.open; emulate a same-origin popup with a second document. */
function fakePopup() {
  const listeners = new Map<string, () => void>();
  const popupDocument = document.implementation.createHTMLDocument('');
  const popup = {
    document: popupDocument,
    closed: false,
    opener: window,
    addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
    close() { this.closed = true; listeners.get('pagehide')?.(); },
  };
  const opener = Object.assign(Object.create(window), {
    document,
    open: vi.fn(() => popup),
    setInterval: window.setInterval.bind(window),
    clearInterval: window.clearInterval.bind(window),
    addEventListener: window.addEventListener.bind(window),
    removeEventListener: window.removeEventListener.bind(window),
  }) as Window & { open: ReturnType<typeof vi.fn> };
  return { popup, opener };
}

afterEach(() => {
  document.head.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

it('opens a same-origin popup, mirrors stylesheets and theme, and follows later changes', async () => {
  document.head.innerHTML = '<style id="base">.a{color:red}</style><link rel="stylesheet" href="/x.css"><link rel="icon" href="/i.svg">';
  document.documentElement.setAttribute('data-theme', 'dark');
  const { popup, opener } = fakePopup();
  const aux = openAuxWindow({ name: 'lab', kind: 'tab', title: '辅助窗口', width: 900, height: 600, left: 10, top: 20 }, opener);

  expect(opener.open).toHaveBeenCalledWith('about:blank#tano-aux=lab&kind=tab', 'lab', 'width=900,height=600,left=10,top=20,popup=yes');
  expect(aux.document.title).toBe('辅助窗口');
  expect(aux.styles()).toBe(2);
  expect(aux.document.head.querySelectorAll('style, link[rel="stylesheet"]')).toHaveLength(2);
  expect(aux.document.head.querySelector('link[rel="icon"]')).toBeNull();
  expect(aux.document.documentElement.getAttribute('data-theme')).toBe('dark');
  expect(aux.mount.ownerDocument).toBe(aux.document);

  // Vite injects component styles lazily; theme switches rewrite <html> attributes.
  const late = document.createElement('style');
  late.textContent = '.late{}';
  document.head.append(late);
  document.documentElement.setAttribute('data-theme', 'light');
  document.getElementById('base')!.textContent = '.a{color:blue}';
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(aux.styles()).toBe(3);
  expect(aux.document.documentElement.getAttribute('data-theme')).toBe('light');
  expect([...aux.document.head.querySelectorAll('style')].map((style) => style.textContent)).toEqual(['.a{color:blue}', '.late{}']);

  late.remove();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(aux.styles()).toBe(2);

  let closed = false;
  void aux.closed.then(() => { closed = true; });
  popup.close();
  await Promise.resolve();
  expect(closed).toBe(true);
});

it('reports a host that refused the request instead of returning a dead handle', () => {
  const { opener } = fakePopup();
  opener.open.mockReturnValueOnce(null);
  expect(() => openAuxWindow({ name: 'lab', kind: 'tab', title: 'x', width: 1, height: 1 }, opener)).toThrow(AuxWindowError);
});

it('rejects a cross-origin popup it cannot script', () => {
  const { opener } = fakePopup();
  const close = vi.fn();
  opener.open.mockReturnValueOnce({ get document(): Document { throw new Error('SecurityError'); }, close });
  expect(() => openAuxWindow({ name: 'lab', kind: 'tab', title: 'x', width: 1, height: 1 }, opener)).toThrow(/不同源/);
  expect(close).toHaveBeenCalled();
});

it('uses the validated native URL contract', () => {
  const { opener } = fakePopup();
  const aux = openAuxWindow({ name: 'test-1', kind: 'tab', title: 'x', width: 900, height: 600 }, opener);
  expect(opener.open).toHaveBeenCalledWith('about:blank#tano-aux=test-1&kind=tab', 'test-1', expect.any(String));
  aux.close();
  expect(() => openAuxWindow({ name: '../bad', kind: 'settings', title: 'x', width: 900, height: 600 }, opener)).toThrow(AuxWindowError);
});

it('resolves release assets and mirrors stylesheet ordering and attribute changes', async () => {
  document.head.innerHTML = '<base href="https://tano.local/app/"><link rel="stylesheet" href="assets/main.css"><style>.last{}</style>';
  const { opener } = fakePopup();
  const aux = openAuxWindow({ name: 'assets', kind: 'tab', title: 'x', width: 900, height: 600 }, opener);
  try {
    expect(aux.document.querySelector('base')!.href).toBe('https://tano.local/app/');
    const source = document.querySelector('link')!;
    const copy = aux.document.querySelector('link')!;
    expect(copy.href).toBe('https://tano.local/app/assets/main.css');
    source.href = 'assets/updated.css';
    source.media = 'screen';
    const first = document.createElement('style');
    first.textContent = '.first{}';
    document.head.insertBefore(first, source);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(copy.href).toBe('https://tano.local/app/assets/updated.css');
    expect(copy.media).toBe('screen');
    expect([...aux.document.querySelectorAll('style,link')].map(node => node.nodeName)).toEqual(['STYLE', 'LINK', 'STYLE']);
    source.rel = 'icon';
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(aux.document.querySelector('link')).toBeNull();
  } finally {
    aux.close();
  }
});
