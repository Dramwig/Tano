// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, ref, nextTick, type App } from 'vue';
import { createPinia } from 'pinia';
import type { FileEntry, WorkspaceAdapter } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import AttachmentPreview from './AttachmentPreview.vue';
import { nativeAttachments } from '../attachments';
vi.mock('../attachments', () => ({ nativeAttachments: { readAttachment: vi.fn() } }));

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); });
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
