// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { UpdateCandidate, UpdatePhase } from '../updates/controller';
import UpdatePanel from './UpdatePanel.vue';

const openExternalUrl = vi.hoisted(() => vi.fn(async (_url: string) => {}));
vi.mock('../attachments', () => ({ openExternalUrl }));
const mocks = vi.hoisted(() => ({ check: vi.fn(), download: vi.fn(), install: vi.fn() }));
const state = reactive({
  status: { configured: false, currentVersion: '1.2.3', reason: '未配置更新服务' },
  phase: 'idle' as UpdatePhase,
  candidate: undefined as UpdateCandidate | undefined,
  progress: { downloaded: 0 },
  error: '',
  busy: false,
});
vi.mock('../stores/updates', () => ({ useUpdatesStore: () => ({ state, ...mocks }) }));

let app: App;
let root: HTMLDivElement;
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(state, {
    status: { configured: true, currentVersion: '1.2.3', reason: null },
    phase: 'idle', candidate: undefined, progress: { downloaded: 0 }, error: '', busy: false,
  });
  root = document.createElement('div');
  document.body.append(root);
  app = createApp(UpdatePanel);
  app.mount(root);
});
afterEach(() => {
  app.unmount();
  root.remove();
});

it('explains missing update configuration and links to the official installer without checking an unpinned feed', async () => {
  state.status.configured = false;
  state.status.reason = '此安装包未配置更新源';
  await nextTick();
  const buttons = root.querySelectorAll('button');
  expect(buttons).toHaveLength(1);
  expect(mocks.check).not.toHaveBeenCalled();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('未配置更新源');
  buttons[0].click();
  await nextTick();
  expect(openExternalUrl).toHaveBeenCalledWith('https://tano.page/zh-cn/download/');
});

it('keeps status failures visible with a working retry action', async () => {
  Object.assign(state, { status: undefined, error: 'status IPC unavailable' });
  await nextTick();
  const button = root.querySelector('button')!;
  expect(button.disabled).toBe(false);
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('status IPC unavailable');
  button.click(); expect(mocks.check).toHaveBeenCalledOnce();
});

it('keeps Local manual downloads on the Local channel', async () => {
  state.status.configured = false;
  Object.assign(state.status, { downloadUrl: 'https://tano.page/zh-cn/download/#local' });
  await nextTick();
  root.querySelector('button')!.click();
  await nextTick();
  expect(openExternalUrl).toHaveBeenCalledWith('https://tano.page/zh-cn/download/#local');
  expect(mocks.check).not.toHaveBeenCalled();
});

it('opens the Local release announcement without requesting a native download', async () => {
  Object.assign(state.status, { configured: false, manual: true, downloadUrl: 'https://tano.page/zh-cn/download/#local' });
  state.phase = 'available';
  state.candidate = { id: 'core-v1.2.4', version: '1.2.4', notes: '', manualUrl: 'https://github.com/Dramwig/Tano/releases/tag/core-v1.2.4' };
  await nextTick();
  const action = root.querySelector<HTMLButtonElement>('.update-button')!;
  expect(action.textContent).toContain('查看发行版');
  expect(root.textContent).toContain('手动下载安装');
  action.click(); await nextTick();
  expect(openExternalUrl).toHaveBeenCalledWith(state.candidate.manualUrl);
  expect(mocks.download).not.toHaveBeenCalled();
  expect(mocks.install).not.toHaveBeenCalled();
});

it('shows fallback guidance and reports a failed attempt to open the download page', async () => {
  state.status.configured = false;
  state.status.reason = '';
  openExternalUrl.mockRejectedValueOnce(new Error('browser unavailable'));
  await nextTick();
  expect(root.textContent).toContain('此安装包未配置更新源，请从官网下载新版安装包。');
  root.querySelector('button')!.click();
  await nextTick(); await nextTick();
  expect(root.textContent).toContain('browser unavailable');
});

it('checks, downloads, and installs through the compact control and blocks clicks while busy', async () => {
  const button = () => root.querySelector<HTMLButtonElement>('button')!;
  expect(button().textContent).toContain('检查更新');
  button().click();
  expect(mocks.check).toHaveBeenCalledOnce();

  state.candidate = { id: 'update', version: '1.2.4', notes: '修复与改进' };
  state.phase = 'available';
  await nextTick();
  expect(button().textContent).toContain('下载更新 1.2.4');
  expect(button().dataset.tooltip).toContain('修复与改进');
  button().click();
  expect(mocks.download).toHaveBeenCalledOnce();

  state.phase = 'downloading';
  state.busy = true;
  state.progress.downloaded = 2 * 1024 * 1024;
  await nextTick();
  expect(button().disabled).toBe(true);
  expect(root.textContent).toContain('2.0 MiB');
  button().click();
  expect(mocks.download).toHaveBeenCalledOnce();

  state.phase = 'ready';
  state.busy = false;
  await nextTick();
  expect(button().textContent).toContain('保存并安装 1.2.4');
  expect(button().dataset.tooltip).toContain('先保存文档');
  button().click();
  expect(mocks.install).toHaveBeenCalledOnce();

  state.error = '还有未保存内容或冲突，请先保存或另存副本。';
  await nextTick();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('冲突');
});
