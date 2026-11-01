// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import { basename, defaultFileDatabaseQuery, type FileEntry, type WorkspaceViewDefinition } from '@tano/protocol';
import WorkspaceBreadcrumb from './WorkspaceBreadcrumb.vue';

const entry = (path: string, kind: FileEntry['kind'] = 'file'): FileEntry => ({
  id: path, path, name: basename(path), kind, size: 0, modified: 0,
});
let app: App;
let root: HTMLDivElement;
let props: { workspaceId: string; workspaceName: string; path: string; entries: FileEntry[]; workspaceView?: WorkspaceViewDefinition };
const onOpen = vi.fn();
const onOpenDirectory = vi.fn();
const menu = () => document.querySelector<HTMLElement>('.breadcrumb-menu');
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.breadcrumb-menu-entry')];
const trigger = (label: string) => root.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
const item = (path: string) => rows().find(row => row.dataset.path === path)!;
async function click(button: HTMLButtonElement) { button.click(); await nextTick(); await nextTick(); }
async function key(target: HTMLElement, value: string) {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true }));
  await nextTick();
  await nextTick();
}
beforeEach(async () => {
  onOpen.mockClear();
  onOpenDirectory.mockClear();
  props = reactive({
    workspaceId: 'workspace', workspaceName: '我的工作区', path: '项目/当前.md',
    entries: [entry('开始.md'), entry('项目', 'directory'), entry('项目/当前.md'),
      entry('项目/同级.markdown'), entry('项目/图片.png'), entry('项目/子目录', 'directory'),
      entry('项目/子目录/深入.md'), entry('空目录', 'directory'), entry('.tano', 'directory'), entry('.tano/config.json')],
  });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp({ render: () => h(WorkspaceBreadcrumb, { ...props, onOpen, onOpenDirectory }) });
  app.mount(root);
  await nextTick();
});
afterEach(() => { app.unmount(); root.remove(); vi.restoreAllMocks(); });

it('shows the database logical directory and view name without exposing its internal path', async () => {
  props.path = '.tano/views/files-22eedb78-5ba9-4448-ac1f-4c1e8b059206.tano.json';
  props.workspaceView = {
    version: 1, layer: 'view', workspaceId: 'workspace', id: 'files-22eedb78',
    name: '项目资料库', kind: 'files', sources: [],
    database: { ...defaultFileDatabaseQuery(), directory: '项目/子目录' },
  };
  await nextTick();
  expect([...root.querySelectorAll('.breadcrumb-trigger')].map(node => node.textContent?.trim()))
    .toEqual(['我的工作区', '项目', '子目录', '项目资料库']);
  expect(root.innerHTML).not.toMatch(/\.tano|22eedb78|\.json/);
  expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  expect(root.querySelector('[aria-current="page"] .lucide-database-icon')).not.toBeNull();
  await click(trigger('浏览目录：项目/子目录'));
  expect(item('项目/子目录/深入.md')).toBeDefined();
  await click(item('项目/子目录/深入.md'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: '项目/子目录/深入.md' }));

  props.workspaceView.name = '重命名后的资料库';
  props.workspaceView.database!.directory = '';
  await nextTick();
  expect([...root.querySelectorAll('.breadcrumb-trigger')].map(node => node.textContent?.trim()))
    .toEqual(['我的工作区', '重命名后的资料库']);
  expect(root.innerHTML).not.toMatch(/\.tano|22eedb78|\.json/);

  delete props.workspaceView;
  props.path = '项目/当前.md';
  await nextTick();
  expect(trigger('当前.md')).not.toBeNull();
});

it('opens the directory for a folder-home breadcrumb and keeps its menu on the separator', async () => {
  const home = entry('项目/README.md');
  props.entries.push(home); await nextTick();
  await click(trigger('打开文件夹：项目'));
  expect(onOpenDirectory).toHaveBeenCalledWith('项目');
  expect(menu()).toBeNull();
  expect(root.querySelector('.breadcrumb-folder-menu')).toBeNull();
  expect(root.querySelector('.lucide-chevron-down-icon')).toBeNull();
  expect([...root.querySelectorAll('.breadcrumb-trigger')].map(node => node.textContent?.trim()))
    .toEqual(['我的工作区', '项目', '当前']);
  await click(trigger('浏览目录：项目'));
  expect(item(home.path)).toBeDefined();
  await key(menu()!, 'Escape');
  props.path = home.path; await nextTick();
  expect(trigger('打开文件夹：项目').getAttribute('aria-current')).toBe('page');
  expect(root.querySelector('[aria-label="切换文件：README.md"]')).toBeNull();
  expect(root.querySelector('.breadcrumb-folder-menu')).toBeNull();
  expect(root.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  await click(trigger('浏览目录：项目'));
  await click(item('项目/当前.md'));
  expect(onOpen).toHaveBeenLastCalledWith(expect.objectContaining({ path: '项目/当前.md' }));
  props.entries = props.entries.filter(file => file.path !== home.path);
  props.path = '项目/当前.md'; await nextTick();
  expect(trigger('打开文件夹：项目')).not.toBeNull();
  await click(trigger('浏览目录：项目'));
  expect(menu()).not.toBeNull();
});

it('browses root children, enters folders and returns to the previous directory', async () => {
  const workspace = trigger('浏览目录：我的工作区');
  await click(workspace);
  expect(workspace.getAttribute('aria-expanded')).toBe('true');
  expect(rows().map(row => row.dataset.path)).toEqual(['空目录', '项目', '开始.md']);
  expect(menu()?.querySelector('.breadcrumb-menu-heading')).toBeNull();
  item('项目').focus(); await key(menu()!, 'ArrowRight');
  expect(menu()?.getAttribute('aria-label')).toBe('浏览目录：项目');
  expect(menu()?.querySelector('.breadcrumb-menu-heading')).toBeNull();
  expect(menu()?.querySelector('[aria-label="返回上级目录"]')).toBeNull();
  expect(rows().map(row => row.dataset.path)).toEqual(['项目/子目录', '项目/当前.md', '项目/同级.markdown', '项目/图片.png']);
  item('项目/子目录').focus(); await key(menu()!, 'ArrowRight');
  expect(rows().map(row => row.dataset.path)).toEqual(['项目/子目录/深入.md']);
  await key(menu()!, 'ArrowLeft');
  expect(document.activeElement).toBe(item('项目/子目录'));
  await click(item('项目/同级.markdown'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: '项目/同级.markdown' }));
  expect(menu()).toBeNull();
});

it('opens siblings from the separator before the current filename and marks the current file', async () => {
  await click(trigger('浏览目录：项目'));
  expect(item('项目/当前.md').getAttribute('aria-current')).toBe('page');
  expect(document.activeElement).toBe(item('项目/当前.md'));
  expect(item('项目/同级.markdown').textContent?.trim()).toBe('同级');
  expect(item('项目/图片.png').textContent?.trim()).toBe('图片.png');
  await click(item('项目/图片.png'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: '项目/图片.png' }));
});

it('supports keyboard folder navigation, wrapping selection and Escape focus restoration', async () => {
  const workspace = trigger('浏览目录：我的工作区');
  workspace.focus();
  await key(workspace, 'ArrowDown');
  expect(document.activeElement).toBe(item('空目录'));
  await key(menu()!, 'ArrowDown');
  expect(document.activeElement).toBe(item('项目'));
  await key(menu()!, 'ArrowRight');
  expect(menu()?.getAttribute('aria-label')).toBe('浏览目录：项目');
  await key(menu()!, 'End');
  expect(document.activeElement).toBe(item('项目/图片.png'));
  await key(menu()!, 'ArrowLeft');
  expect(document.activeElement).toBe(item('项目'));
  await key(menu()!, 'Home');
  await key(menu()!, 'ArrowUp');
  expect(document.activeElement).toBe(item('开始.md'));
  await key(menu()!, 'Escape');
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(workspace);
});

it('shows empty folders and closes on repeated trigger clicks or outside interactions', async () => {
  const workspace = trigger('浏览目录：我的工作区');
  await click(workspace);
  item('空目录').focus(); await key(menu()!, 'ArrowRight');
  expect(menu()?.textContent).toContain('此目录为空');
  await click(workspace);
  expect(menu()).toBeNull();
  await click(trigger('浏览目录：项目'));
  document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  await nextTick();
  expect(menu()).toBeNull();
  await click(workspace);
  await key(menu()!, 'Tab');
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(workspace);
});

it('refreshes entries and dismisses stale menus when files, paths or workspaces change', async () => {
  await click(trigger('浏览目录：项目'));
  props.entries.push(entry('项目/外部新增.md'));
  await nextTick();
  expect(item('项目/外部新增.md')).toBeDefined();
  props.entries = props.entries.filter(file => !file.path.startsWith('项目/子目录'));
  await nextTick();
  expect(item('项目/子目录')).toBeUndefined();
  props.path = '开始.md';
  await nextTick();
  expect(menu()).toBeNull();
  await click(trigger('浏览目录：我的工作区'));
  props.workspaceId = 'another-workspace';
  await nextTick();
  expect(menu()).toBeNull();
  await click(trigger('浏览目录：我的工作区'));
  item('空目录').focus(); await key(menu()!, 'ArrowRight');
  props.entries = props.entries.filter(file => file.path !== '空目录');
  await nextTick();
  expect(menu()).toBeNull();
});

it('opens folder labels directly and reserves the separator for directory menus', async () => {
  await click(trigger('打开文件夹：项目'));
  expect(onOpenDirectory).toHaveBeenCalledWith('项目');
  expect(menu()).toBeNull();
  const separator = trigger('浏览目录：项目');
  expect(separator.classList.contains('breadcrumb-separator')).toBe(true);
  await key(separator, 'ArrowDown');
  expect(item('项目/当前.md')).toBeDefined();
  await key(menu()!, 'Escape');
  expect(document.activeElement).toBe(separator);
  await click(trigger('当前.md'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: '项目/当前.md' }));
  expect(menu()).toBeNull();
});

it('shows the workspace before nested and root files and browses root entries from its separator', async () => {
  expect(root.querySelector('.breadcrumb-trigger')?.textContent?.trim()).toBe('我的工作区');
  const separator = trigger('浏览目录：我的工作区');
  expect(separator.previousElementSibling?.classList.contains('breadcrumb-workspace')).toBe(true);
  await click(separator);
  expect(rows().map(row => row.dataset.path)).toEqual(['空目录', '项目', '开始.md']);
  await key(menu()!, 'Escape');
  expect(document.activeElement).toBe(separator);
  props.path = '开始.md';
  await nextTick();
  expect([...root.querySelectorAll('.breadcrumb-trigger')].map(node => node.textContent?.trim()))
    .toEqual(['我的工作区', '开始']);
  await click(trigger('浏览目录：我的工作区'));
  await click(item('开始.md'));
  expect(onOpen).toHaveBeenCalledWith(expect.objectContaining({ path: '开始.md' }));
});

it('opens a folder view when choosing a folder from the separator menu', async () => {
  await click(trigger('浏览目录：我的工作区'));
  expect(item('项目').querySelector('.breadcrumb-menu-trailing')).toBeNull();
  await click(item('项目'));
  expect(onOpenDirectory).toHaveBeenCalledWith('项目');
  expect(menu()).toBeNull();
});
