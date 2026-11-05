// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { basename, type FileEntry } from '@tano/protocol';
import FolderView from './FolderView.vue';
import type { FolderHomeFileName } from '../folder-home';
let app: App;
let root: HTMLDivElement;
afterEach(() => { app.unmount(); root.remove(); });
it('lists only direct visible children, opens entries and updates empty or missing folders', async () => {
  const entry = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({ id: path, path, name: basename(path), kind, modified: 0, size: 12 });
  const props = reactive({ directory: { path: '', name: '工作区', missing: false }, entries: [entry('文档.md'), entry('项目', 'directory'), entry('项目/README.md'), entry('.tano', 'directory'), entry('.tano/config.json')] });
  const open = vi.fn(), up = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FolderView, { ...props, onOpen: open, onUp: up }) }); app.mount(root);
  const rows = () => [...root.querySelectorAll<HTMLButtonElement>('.folder-view-entry')];
  expect(rows().map(row => row.dataset.path)).toEqual(['项目', '文档.md']);
  rows()[0].click(); expect(open).toHaveBeenCalledWith(props.entries[1]);
  props.directory.path = '项目'; await nextTick();
  expect(rows().map(row => row.dataset.path)).toEqual(['项目/README.md']);
  root.querySelector<HTMLButtonElement>('header button')!.click(); expect(up).toHaveBeenCalled();
  props.entries = []; await nextTick(); expect(root.textContent).toContain('此目录为空');
  props.directory.missing = true; await nextTick(); expect(root.textContent).toContain('文件夹不可用');
  expect(root.textContent).not.toContain('此目录为空');
});

it('uses folder-home and document icons and reacts to icon and home-setting changes', async () => {
  const entry = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({ id: path, path, name: basename(path), kind, modified: 0, size: 0 });
  const props = reactive({
    directory: { path: '', name: '工作区', missing: false },
    entries: [entry('项目', 'directory'), entry('项目/README.md'), entry('项目/_index.md'), entry('记录.table.json')],
    folderHomeFileName: 'README.md' as FolderHomeFileName,
    documentIcons: {} as Record<string, string>,
  });
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(FolderView, { ...props }) }); app.mount(root);
  const folder = () => root.querySelector('[data-path="项目"]')!;
  expect(folder().querySelector('[data-file-icon="folder-home"]')).not.toBeNull();
  expect(root.querySelector('[data-path="记录.table.json"] [data-file-icon="table"]')).not.toBeNull();
  props.documentIcons['项目/README.md'] = '🚀'; await nextTick();
  expect(folder().innerHTML).toContain('data-emoji="🚀"');
  props.documentIcons['项目/README.md'] = '🌟'; await nextTick();
  expect(folder().innerHTML).toContain('data-emoji="🌟"');
  props.folderHomeFileName = '_index.md'; await nextTick();
  expect(folder().querySelector('[data-file-icon="folder-home"]')).not.toBeNull();
  props.folderHomeFileName = ''; await nextTick();
  expect(folder().querySelector('[data-file-icon="folder-home"]')).toBeNull();
  expect(folder().querySelector('[data-file-icon="folder"]')).not.toBeNull();
});
