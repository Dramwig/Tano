// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, ref, type App } from 'vue';
import { createPinia } from 'pinia';
import type { FileEntry, WorkspaceAdapter } from '@tano/protocol';
import { configureWorkbench } from '../runtime';
import AttachmentPreview from './AttachmentPreview.vue';

let app: App | undefined;
afterEach(() => { app?.unmount(); app = undefined; document.body.replaceChildren(); });
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
