// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, type App } from 'vue';
import PdfPreview from './PdfPreview.vue';

const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist', () => ({ GlobalWorkerOptions: {}, getDocument: mocks.getDocument }));
vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/pdf-worker.mjs' }));
let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); vi.resetAllMocks(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function mount() { const root = document.createElement('div'); document.body.append(root); app = createApp(() => h(PdfPreview, { bytes: new Uint8Array([1]) })); app.mount(root); return root; }

it('lays out all PDF pages with independent loading states and preserves mixed page sizes', async () => {
  const document = deferred<unknown>(), first = deferred<void>(), second = deferred<void>();
  const render = vi.fn().mockReturnValueOnce({ promise: first.promise, cancel: vi.fn() }).mockReturnValueOnce({ promise: second.promise, cancel: vi.fn() });
  const task = { promise: document.promise, destroy: vi.fn() }; mocks.getDocument.mockReturnValue(task);
  const root = mount();
  expect(root.querySelector('[data-preview-kind="pdf"]')).not.toBeNull();
  expect(root.querySelector('nav')).toBeNull();
  await vi.waitFor(() => expect(mocks.getDocument).toHaveBeenCalled());
  document.resolve({ numPages: 2, getPage: async (page: number) => ({ getViewport: () => ({ width: page === 1 ? 600 : 800, height: page === 1 ? 800 : 600 }), render }) });
  await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2));
  expect(root.querySelectorAll('[data-reader-page]')).toHaveLength(2);
  expect(root.querySelectorAll('canvas')[1].style.width).toBe('800px');
  expect(root.querySelector('[data-preview-kind="pdf"]')).not.toBeNull();
  expect(root.querySelector<HTMLCanvasElement>('canvas')!.style.display).toBe('none');
  first.resolve();
  await vi.waitFor(() => expect(root.querySelectorAll('[data-preview-kind]')).toHaveLength(1));
  expect(root.querySelectorAll('canvas')[0].style.display).not.toBe('none');
  expect(root.querySelector('section')?.getAttribute('aria-busy')).toBe('false');
  root.querySelectorAll<HTMLButtonElement>('nav button')[1].click(); await nextTick();
  expect(render).toHaveBeenCalledTimes(2);
  expect(root.querySelector('[data-preview-kind="pdf"]')).not.toBeNull();
  second.resolve();
  await vi.waitFor(() => expect(root.querySelector('[data-preview-kind]')).toBeNull());
  expect(root.querySelector('nav')?.textContent).toContain('2 / 2');
  app!.unmount(); app = undefined; expect(task.destroy).toHaveBeenCalled();
});
it('replaces the PDF skeleton with an error when loading fails', async () => {
  mocks.getDocument.mockReturnValue({ promise: Promise.reject(new Error('Invalid PDF')), destroy: vi.fn() });
  const root = mount();
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('Invalid PDF'));
  expect(root.querySelector('[data-preview-kind]')).toBeNull();
  expect(root.querySelector('section')?.getAttribute('aria-busy')).toBe('false');
});
