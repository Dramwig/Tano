// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { UpdateCandidate, UpdatePhase } from '../updates/controller';
import UpdatePanel from './UpdatePanel.vue';

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

it('hides the update control when no update service is configured', async () => {
  state.status.configured = false;
  await nextTick();
  expect(root.querySelector('button')).toBeNull();
  expect(root.textContent).toBe('');
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
  expect(button().title).toContain('修复与改进');
  button().click();
  expect(mocks.download).toHaveBeenCalledOnce();

  state.phase = 'downloading';
  state.busy = true;
  state.progress.downloaded = 2 * 1024 * 1024;
  await nextTick();
  expect(button().disabled).toBe(true);
  expect(root.querySelector('[role="status"]')?.textContent).toContain('2.0 MiB');
  button().click();
  expect(mocks.download).toHaveBeenCalledOnce();

  state.phase = 'ready';
  state.busy = false;
  await nextTick();
  expect(button().textContent).toContain('保存并安装 1.2.4');
  expect(button().title).toContain('先保存文档');
  button().click();
  expect(mocks.install).toHaveBeenCalledOnce();

  state.error = '还有未保存内容或冲突，请先保存或另存副本。';
  await nextTick();
  expect(root.querySelector('[role="alert"]')?.textContent).toContain('冲突');
});
