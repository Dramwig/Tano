// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { AuxWindowError, nativeLabelOf, openAuxWindow } from './aux-window';

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
  const aux = openAuxWindow({ name: 'lab', title: '辅助窗口', width: 900, height: 600, left: 10, top: 20 }, opener);

  expect(opener.open).toHaveBeenCalledWith('about:blank', 'lab', 'width=900,height=600,left=10,top=20,popup=yes');
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
  expect(() => openAuxWindow({ name: 'lab', title: 'x', width: 1, height: 1 }, opener)).toThrow(AuxWindowError);
});

it('rejects a cross-origin popup it cannot script', () => {
  const { opener } = fakePopup();
  const close = vi.fn();
  opener.open.mockReturnValueOnce({ get document(): Document { throw new Error('SecurityError'); }, close });
  expect(() => openAuxWindow({ name: 'lab', title: 'x', width: 1, height: 1 }, opener)).toThrow(/不同源/);
  expect(close).toHaveBeenCalled();
});

it('reads the popup WebView label from its own Tauri bridge', () => {
  expect(nativeLabelOf({ __TAURI_INTERNALS__: { metadata: { currentWindow: { label: 'auxlab-popup-1' } } } } as unknown as Window))
    .toBe('auxlab-popup-1');
  expect(nativeLabelOf({} as Window)).toBeNull();
});
