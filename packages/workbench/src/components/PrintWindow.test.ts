// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App } from 'vue';
import PrintWindow from './PrintWindow.vue';
const state = vi.hoisted(() => ({ receive: undefined as undefined | ((event: any) => void), invoke: vi.fn(), close: vi.fn(), save: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }));
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ close: state.close, startDragging: vi.fn() }) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async (_, handler) => { state.receive = handler; return () => {}; }), emitTo: vi.fn(async () => {}) }));
vi.mock('../print-window', () => ({ printWindowRequest: () => ({ label: 'print-test', opener: 'main' }), PRINT_CONTENT: 'content', PRINT_LOADED: 'loaded', PRINT_READY: 'ready' }));
vi.mock('../native-document-export', () => ({ saveDocumentExport: state.save }));
vi.mock('./PdfPreview.vue', () => ({ default: { props: ['bytes'], template: '<div data-print-pdf>PDF 预览</div>' } }));
let app: App;
beforeEach(() => {
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: Promise.resolve() } });
  state.invoke.mockImplementation(async command => command === 'document_print_printers' ? { nativeSettings: true, defaultPrinter: '办公打印机', printers: ['办公打印机'] } : btoa('%PDF-test'));
  state.save.mockResolvedValue(false);
});
afterEach(() => { app?.unmount(); document.body.replaceChildren(); vi.clearAllMocks(); });
async function mount() {
  const host = document.createElement('div'); document.body.append(host); app = createApp(PrintWindow); app.mount(host);
  await vi.waitFor(() => expect(state.receive).toBeDefined());
  state.receive!({ payload: { title: '测试文档', html: '<main class="document-export-content"><p>完整正文</p></main>', lang: 'zh-CN', css: [], stylesheets: [] } });
  await vi.waitFor(() => expect(host.querySelector('[data-print-pdf]')).not.toBeNull());
  return host;
}
it('shows the custom settings panel and preview without automatically opening system print UI', async () => {
  const system = vi.spyOn(window, 'print').mockImplementation(() => {});
  const host = await mount();
  expect(host.querySelector('[role="dialog"]')).not.toBeNull();
  expect(host.querySelector('.document-print-close')?.getAttribute('aria-label')).toBe('关闭');
  expect(host.textContent).toContain('打印机');
  expect(system).not.toHaveBeenCalled(); system.mockRestore();
  expect(state.invoke.mock.calls.some(([command]) => command === 'document_print_submit')).toBe(false);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', ctrlKey: true, repeat: true }));
  await nextTick();
  expect(state.invoke.mock.calls.some(([command]) => command === 'document_print_submit')).toBe(false);
});
it('uses the selected settings when the user explicitly submits a print job', async () => {
  const host = await mount();
  const copies = host.querySelector<HTMLInputElement>('input[type="number"]')!; copies.value = '3'; copies.dispatchEvent(new Event('input')); await nextTick();
  host.querySelector<HTMLButtonElement>('.document-print-submit')!.click();
  await vi.waitFor(() => expect(state.invoke).toHaveBeenCalledWith('document_print_submit', { settings: expect.objectContaining({ printer: '办公打印机', copies: 3, paper: 'a4' }) }));
  expect(state.close).toHaveBeenCalledOnce();
});
it('keeps the panel open when PDF saving is cancelled and never submits to a printer', async () => {
  const host = await mount();
  const destination = host.querySelector('select')!; destination.value = 'pdf'; destination.dispatchEvent(new Event('change')); await nextTick();
  host.querySelector<HTMLButtonElement>('.document-print-submit')!.click();
  await vi.waitFor(() => expect(state.save).toHaveBeenCalledOnce());
  expect(state.close).not.toHaveBeenCalled();
  expect(state.invoke.mock.calls.some(([command]) => command === 'document_print_submit')).toBe(false);
});
