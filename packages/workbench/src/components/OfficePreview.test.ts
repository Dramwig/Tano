// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, ref, nextTick, type App } from 'vue';
import OfficePreview from './OfficePreview.vue';
import { readOffice } from '../office-preview/client';
import { officeErrors, type OfficePreview as Preview } from '../office-preview/model';
import type { AttachmentStatusUpdate } from '../attachment-status';

vi.mock('../office-preview/client', () => ({ readOffice: vi.fn() }));
let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); vi.resetAllMocks(); });
it('forwards file-scoped spreadsheet status to the header and clears only its own source on close', async () => {
  vi.mocked(readOffice).mockResolvedValue({ kind: 'spreadsheet', sheets: [{ name: '预算', rows: [['项目']], columns: 1, truncated: false }] });
  const updates: AttachmentStatusUpdate[] = [];
  const root = document.createElement('div'); document.body.append(root);
  const bytes = new Uint8Array([1]);
  app = createApp(() => h(OfficePreview, { bytes, path: 'book.xlsx', draftKey: 'ws:book', statusManaged: true, onStatus: (update: AttachmentStatusUpdate) => updates.push(update) }));
  app.mount(root);
  await vi.waitFor(() => expect(updates.at(-1)?.state?.items[0].kind).toBe('preview'));
  expect(updates.at(-1)?.documentKey).toBe('ws:book');
  expect(root.querySelector('.document-status-trigger')).toBeNull();
  const source = updates.at(-1)!.source;
  app.unmount(); app = undefined;
  expect(updates.at(-1)).toEqual({ source, documentKey: 'ws:book', state: null });
});
function mount(path = 'book.xlsx') {
  const root = document.createElement('div'); document.body.append(root);
  const file = ref({ path, bytes: new Uint8Array([1]) });
  app = createApp(() => h(OfficePreview, file.value)); app.mount(root);
  return { root, file };
}
it.each([['file.xls', 'spreadsheet'], ['file.xlsx', 'spreadsheet'], ['file.doc', 'word'], ['file.docx', 'word'], ['file.ppt', 'presentation'], ['file.pptx', 'presentation']])('keeps the %s layout during worker parsing and removes it after success', async (path, kind) => {
  let finish!: (result: Preview) => void;
  vi.mocked(readOffice).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const { root } = mount(path);
  expect(root.querySelector('[data-preview-kind]')?.getAttribute('data-preview-kind')).toBe(kind);
  expect(root.querySelector('[role="status"]')?.getAttribute('aria-label')).toMatch(/^正在加载/);
  finish({ kind: 'document', legacy: false, pages: [{ name: '', blocks: [] }] });
  await vi.waitFor(() => expect(root.querySelector('[data-preview-kind]')).toBeNull());
});

it.each(['book.xls', 'book.xlsx'])('reads %s sheets continuously, resets scroll on sheet changes, and escapes cell HTML', async (path) => {
  vi.mocked(readOffice).mockResolvedValue({ kind: 'spreadsheet', sheets: [
    { name: '收入', columns: 1, rows: Array.from({ length: 102 }, (_, index) => [`行${index + 1}`]), truncated: false },
    { name: '说明', columns: 1, rows: [['<img src=x onerror=alert(1)>']], truncated: true },
  ] });
  const { root } = mount(path);
  await vi.waitFor(() => expect(root.querySelector('table')?.textContent).toContain('行100'));
  expect(root.querySelectorAll('tbody tr')).toHaveLength(102);
  expect(root.querySelector('tbody tr:last-child')?.textContent).toBe('102行102');
  expect(root.querySelector('[aria-label="预览翻页"]')).toBeNull();
  expect(root.querySelector('[aria-label="预览缩放"]')).not.toBeNull();
  const viewport = root.querySelector<HTMLElement>('.reader-viewport')!;
  viewport.scrollTop = 1000; viewport.scrollLeft = 100;
  for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
    const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
    viewport.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  const tabs = root.querySelectorAll<HTMLButtonElement>('[role="tab"]');
  expect(root.querySelector('select[aria-label="工作表"]')).toBeNull();
  tabs[1].click(); await nextTick(); await nextTick();
  expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  expect(viewport.scrollTop).toBe(0); expect(viewport.scrollLeft).toBe(0);
  expect(root.querySelector('tbody')?.textContent).toContain('<img src=x onerror=alert(1)>');
  expect(root.querySelector('img')).toBeNull();
  expect(root.textContent).toContain('10000 行、200 列');
  expect(root.querySelector('[aria-label="下一页"]')).toBeNull();
  expect(root.querySelector('[contenteditable], input, textarea')).toBeNull();
  tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
  await nextTick(); await nextTick();
  expect(tabs[0].getAttribute('aria-selected')).toBe('true');
  expect(document.activeElement).toBe(tabs[0]);
  expect(root.querySelectorAll('tbody tr')).toHaveLength(102);
});

it('renders document tables and styled text without interpreting document markup', async () => {
  vi.mocked(readOffice).mockResolvedValue({ kind: 'document', legacy: false, pages: [{ name: '', blocks: [
    { kind: 'paragraph', heading: 1, runs: [{ text: '标题', bold: true }] },
    { kind: 'table', rows: [[{ colspan: 2, blocks: [{ kind: 'paragraph', runs: [{ text: '<script>evil()</script>' }] }] }]] },
  ] }] });
  const { root } = mount('阅读.docx');
  await vi.waitFor(() => expect(root.querySelector('article h1')?.textContent).toBe('标题'));
  expect(root.querySelector('td')?.colSpan).toBe(2);
  expect(root.querySelector('td')?.textContent).toBe('<script>evil()</script>');
  expect(root.querySelector('script, iframe, object, embed, [contenteditable]')).toBeNull();
});

it('renders all slides together and exposes empty/image-only slide limitations', async () => {
  vi.mocked(readOffice).mockResolvedValue({ kind: 'presentation', legacy: true, pages: [
    { name: '', blocks: [{ kind: 'paragraph', runs: [{ text: '第一页正文' }] }] }, { name: '', blocks: [] },
  ] });
  const { root } = mount('slides.ppt');
  await vi.waitFor(() => expect(root.querySelector('article')?.textContent).toContain('第一页正文'));
  root.querySelector<HTMLButtonElement>('[aria-label="下一页"]')!.click(); await nextTick();
  expect(root.querySelectorAll('article')).toHaveLength(2);
  expect(root.querySelectorAll('article')[1]?.getAttribute('aria-label')).toBe('幻灯片 2 / 2');
  expect(root.querySelectorAll('article')[1]?.textContent).toContain('没有可提取的文字');
  expect(root.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(true);
});

it('aborts old parsers on attachment switches/unmount and ignores late results', async () => {
  let finish!: (result: Preview) => void;
  vi.mocked(readOffice).mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ kind: 'document', legacy: false, pages: [{ name: '', blocks: [{ kind: 'paragraph', runs: [{ text: '新文件' }] }] }] });
  const { root, file } = mount('first.docx');
  const oldSignal = vi.mocked(readOffice).mock.calls[0][2];
  file.value = { path: 'second.docx', bytes: new Uint8Array([2]) };
  await vi.waitFor(() => expect(root.querySelector('article')?.textContent).toContain('新文件'));
  expect(oldSignal.aborted).toBe(true);
  finish({ kind: 'document', legacy: true, pages: [{ name: '', blocks: [{ kind: 'paragraph', runs: [{ text: '过期文件' }] }] }] }); await nextTick();
  expect(root.textContent).not.toContain('过期文件');
  const newSignal = vi.mocked(readOffice).mock.calls[1][2]; app!.unmount(); app = undefined;
  expect(newSignal.aborted).toBe(true);
});

it('offers a retry after parsing errors without masking the encryption limitation', async () => {
  vi.mocked(readOffice).mockRejectedValueOnce(new Error(officeErrors.encrypted))
    .mockResolvedValueOnce({ kind: 'document', pages: [{ name: '', blocks: [] }], legacy: false });
  const { root } = mount('locked.docx');
  await vi.waitFor(() => expect(root.querySelector('[role="alert"]')?.textContent).toContain('受密码保护'));
  root.querySelector<HTMLButtonElement>('button')!.click();
  await vi.waitFor(() => expect(root.querySelector('article')).not.toBeNull());
  expect(root.querySelector('[role="alert"]')).toBeNull();
});
