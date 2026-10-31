// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, ref, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import type { FileEntry, WorkspaceAdapter } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import AttachmentPreview from './AttachmentPreview.vue';
import { nativeAttachments } from '../attachments';
vi.mock('../attachments', () => ({ nativeAttachments: { readAttachment: vi.fn() } }));
vi.mock('./PdfPreview.vue', () => ({ default: { props: ['bytes'], render(this: { bytes: Uint8Array }) { return h('section', { 'data-rendered-pdf': '' }, new TextDecoder().decode(this.bytes)); } } }));
vi.mock('./OfficePreview.vue', () => ({ __esModule: true, default: { props: ['bytes', 'path'], render(this: { bytes: Uint8Array; path: string }) { return h('section', { 'data-office-path': this.path }, Array.from(this.bytes).join(',')); } } }));

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); });
it('keeps a writable spreadsheet mounted when its own save updates file metadata', async () => {
  const readAttachment = vi.fn().mockResolvedValue(new Uint8Array([80, 75, 3, 4]));
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo' } as WorkspaceAdapter,
    attachments: { readAttachment, writeSpreadsheet: vi.fn() } as unknown as typeof nativeAttachments, native: false, mobile: false });
  const file = ref<FileEntry>({ id: 'book', path: 'book.xlsx', name: 'book.xlsx', kind: 'file', size: 4, modified: 1 });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file: file.value, url: null, workspaceId: 'ws' })); app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('[data-office-path]')).not.toBeNull());
  const editor = root.querySelector('[data-office-path]');
  file.value = { ...file.value, modified: 2, size: 500, contentHash: 'saved' };
  await nextTick(); await nextTick();
  expect(root.querySelector('[data-office-path]')).toBe(editor);
  expect(readAttachment).toHaveBeenCalledTimes(1);
  file.value = { ...file.value, id: 'other', path: 'other.xlsx' };
  await vi.waitFor(() => expect(readAttachment).toHaveBeenCalledTimes(2));
});
it('adapts pending attachment reads immediately when switching between file types', async () => {
  const readAttachment = vi.fn(() => new Promise<Uint8Array>(() => {}));
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo' } as WorkspaceAdapter,
    attachments: { readAttachment } as unknown as typeof nativeAttachments, native: false, mobile: false });
  const file = ref<FileEntry>({ id: 'abcdef', path: 'book.xlsx', name: 'book.xlsx', kind: 'file', size: 20, modified: 1 });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file: file.value, url: null, workspaceId: 'ws' })); app.use(pinia).mount(root);
  for (const [path, kind] of [['book.xlsx', 'spreadsheet'], ['paper.pdf', 'pdf'], ['data.csv', 'spreadsheet'], ['main.ts', 'code'], ['note.txt', 'text'], ['picture.png', 'image']]) {
    file.value = { ...file.value, path, name: path };
    await vi.waitFor(() => expect(root.querySelector('[data-preview-kind]')?.getAttribute('data-preview-kind')).toBe(kind));
    expect(root.querySelector('[data-preview-kind]')?.getAttribute('aria-busy')).toBe('true');
  }
});
it.each(['mp4', 'mp3'])('keeps the %s skeleton until media metadata is ready and clears it on error', async extension => {
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo' } as WorkspaceAdapter, native: false, mobile: false });
  const file: FileEntry = { id: 'abcdef', path: `media.${extension}`, name: 'media', kind: 'file', size: 20, modified: 1 };
  const root = document.createElement('div'); document.body.append(root);
  const url = ref('https://example.invalid/media');
  app = createApp(() => h(AttachmentPreview, { file, url: url.value })); app.use(pinia).mount(root);
  const tag = extension === 'mp4' ? 'video' : 'audio';
  expect(root.querySelector('[data-preview-kind]')?.getAttribute('data-preview-kind')).toBe(tag);
  root.querySelector(tag)!.dispatchEvent(new Event('loadedmetadata')); await nextTick();
  expect(root.querySelector('[data-preview-kind]')).toBeNull();
  expect((root.querySelector(tag) as HTMLElement).style.display).not.toBe('none');
  url.value += '?changed'; await nextTick();
  expect(root.querySelector('[data-preview-kind]')).not.toBeNull();
  root.querySelector(tag)!.dispatchEvent(new Event('error')); await nextTick();
  expect(root.querySelector('[data-preview-kind]')).toBeNull();
  expect(root.textContent).toContain('附件暂不可用');
});
it('keeps the picture skeleton through image decoding after the byte read completes', async () => {
  const createUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview-image');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo' } as WorkspaceAdapter,
    attachments: { readAttachment: async () => Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) } as unknown as typeof nativeAttachments, native: false, mobile: false });
  const file: FileEntry = { id: 'abcdef', path: 'picture.png', name: 'picture.png', kind: 'file', size: 8, modified: 1 };
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file, url: null, workspaceId: 'ws' })); app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('img')).not.toBeNull());
  expect(root.querySelector('[data-preview-kind="image"]')).not.toBeNull();
  root.querySelector('img')!.dispatchEvent(new Event('load')); await nextTick();
  expect(root.querySelector('[data-preview-kind]')).toBeNull();
  app.unmount(); app = undefined;
  expect(revoke).toHaveBeenCalledWith('blob:preview-image');
  createUrl.mockRestore(); revoke.mockRestore();
});
it('reads desktop non-image previews through native bytes rather than the image-only asset URL', async () => {
  vi.mocked(nativeAttachments.readAttachment!).mockResolvedValue(new TextEncoder().encode('name,value\nlocal,42'));
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'desktop' } as WorkspaceAdapter, native: true, mobile: false });
  const file: FileEntry = { id: 'abcdef', path: 'data.csv', name: 'data.csv', kind: 'file', size: 19, modified: 1 };
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file, url: 'http://tano-asset.localhost/ws/data.csv', workspaceId: 'ws' }));
  app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('table')?.textContent).toContain('local'));
  expect(nativeAttachments.readAttachment).toHaveBeenCalledWith('ws', 'data.csv');
});
it.each(['xls', 'xlsx'])('loads %s through the host attachment service without text conversion or writes', async extension => {
  const bytes = new Uint8Array([0, 255, 128, 13]);
  const readAttachment = vi.fn().mockResolvedValue(bytes), read = vi.fn(), write = vi.fn();
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo', read, write } as unknown as WorkspaceAdapter,
    attachments: { readAttachment } as unknown as typeof nativeAttachments, native: false, mobile: false });
  const file: FileEntry = { id: 'abcdef', path: `附件.${extension}`, name: `附件.${extension}`, kind: 'file', size: bytes.length, modified: 1 };
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file, url: null, workspaceId: 'cloud' })); app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('[data-office-path]')?.textContent).toBe('0,255,128,13'));
  expect(readAttachment).toHaveBeenCalledWith('cloud', file.path);
  expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
});
it.each(['ppt', 'pptx', 'doc', 'docx'])('requires the format plugin for %s instead of a native converter or reflowed text', async extension => {
  const readAttachment = vi.fn();
  const pinia = configureWorkbench(createPinia(), { adapter: { mode: 'demo' } as WorkspaceAdapter,
    attachments: { readAttachment } as unknown as typeof nativeAttachments, native: false, mobile: false });
  const file: FileEntry = { id: 'slides', path: 'slides.' + extension, name: 'slides', kind: 'file', size: 20, modified: 1 };
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file, url: null, workspaceId: 'ws' })); app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.textContent).toContain(extension.startsWith('doc') ? '启用系统插件「Word 文档预览」' : '启用系统插件「演示文稿预览」'));
  expect(readAttachment).not.toHaveBeenCalled();
  expect(root.querySelector('[data-office-path], [data-rendered-pdf]')).toBeNull();
});

it('previews text without interpreting markup and never writes the attachment', async () => {
  const read = vi.fn().mockResolvedValue({ content: '<script>alert(1)</script>\n文本附件', hash: 'base', modified: 1 });
  const write = vi.fn();
  const pinia = configureWorkbench(createPinia(), { adapter: { read, write } as unknown as WorkspaceAdapter, native: false, mobile: false });
  const file = ref<FileEntry | undefined>({ id: 'text-id', kind: 'file', name: 'notes.txt', path: 'assets/notes.txt', size: 40, modified: 1 });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file: file.value, url: null }));
  app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('pre')?.textContent).toContain('文本附件'));
  expect(root.querySelector('script')).toBeNull();
  expect(root.querySelector('header, h1, button')).toBeNull();
  expect(read).toHaveBeenCalledWith('assets/notes.txt');
  expect(write).not.toHaveBeenCalled();
  file.value = undefined;
  await vi.waitFor(() => expect(root.textContent).toContain('文件已移动或删除'));
});

it('refreshes changed hashes even at identical size/mtime and ignores unchanged scans and stale reads', async () => {
  let finish!: (snapshot: { content: string }) => void;
  const read = vi.fn().mockResolvedValueOnce({ content: 'first' })
    .mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
    .mockResolvedValueOnce({ content: 'third' });
  const pinia = configureWorkbench(createPinia(), { adapter: { read } as unknown as WorkspaceAdapter, native: false, mobile: false });
  const file = ref<FileEntry>({ id: 'abcdef', path: 'file.txt', name: 'file.txt', kind: 'file', modified: 1, size: 5, contentHash: 'one' });
  const root = document.createElement('div'); document.body.append(root);
  app = createApp(() => h(AttachmentPreview, { file: file.value, url: null, workspaceId: 'first-workspace' }));
  app.use(pinia).mount(root);
  await vi.waitFor(() => expect(root.querySelector('pre')?.textContent).toBe('first'));
  file.value = { ...file.value }; await nextTick();
  expect(read).toHaveBeenCalledTimes(1);
  file.value = { ...file.value, contentHash: 'two' };
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  file.value = { ...file.value, contentHash: 'three' };
  await vi.waitFor(() => expect(root.querySelector('pre')?.textContent).toBe('third'));
  finish({ content: 'stale' }); await nextTick();
  expect(root.querySelector('pre')?.textContent).toBe('third');
});
