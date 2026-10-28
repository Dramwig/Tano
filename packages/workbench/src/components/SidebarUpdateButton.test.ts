// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive } from 'vue';
import type { App } from 'vue';
import type { SettingsSnapshot } from '../settings-window';
import SidebarUpdateButton from './SidebarUpdateButton.vue';

let app: App;
let root: HTMLDivElement;
const download = vi.fn(), install = vi.fn();
const props = reactive({ enabled: true, state: {} as SettingsSnapshot['updates'] });
beforeEach(() => {
  vi.clearAllMocks();
  props.enabled = true;
  props.state = { phase: 'idle', status: { configured: true, currentVersion: '0.9.0', reason: null },
    candidate: undefined, progress: { downloaded: 0 }, error: '', busy: false };
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(SidebarUpdateButton, { ...props, onDownload: download, onInstall: install },
    { default: () => h('button', { 'aria-label': '帮助与上手' }, '?') }) });
  app.mount(root);
});
afterEach(() => { app.unmount(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function available() {
  props.state.candidate = { id: 'verified-candidate', version: '0.9.1', notes: '更新内容' };
  props.state.phase = 'available'; await nextTick();
}
const button = () => root.querySelector<HTMLButtonElement>('.sidebar-update')!;

it('preserves help when no update is available, on non-desktop surfaces or without a pinned feed', async () => {
  expect(root.querySelector('[aria-label="帮助与上手"]')).not.toBeNull();
  await available(); props.enabled = false; await nextTick();
  expect(button()).toBeNull();
  expect(root.querySelector('[aria-label="帮助与上手"]')).not.toBeNull();
  props.enabled = true; props.state.status!.configured = false; await nextTick();
  expect(button()).toBeNull();
});
it('replaces help with a version-labelled download action and restores help when current', async () => {
  await available();
  expect(root.querySelector('[aria-label="帮助与上手"]')).toBeNull();
  expect(button().getAttribute('aria-label')).toBe('下载更新 0.9.1');
  button().click(); expect(download).toHaveBeenCalledOnce(); expect(install).not.toHaveBeenCalled();
  props.state.phase = 'current'; props.state.candidate = undefined; await nextTick();
  expect(button()).toBeNull(); expect(root.querySelector('[aria-label="帮助与上手"]')).not.toBeNull();
});

it('announces a Local release with a manual view action', async () => {
  props.state.status!.configured = false;
  props.state.status!.manual = true;
  await available();
  props.state.candidate!.manualUrl = 'https://github.com/Dramwig/Tano/releases/tag/core-v0.9.1';
  await nextTick();
  expect(button().getAttribute('aria-label')).toBe('查看发行版 0.9.1');
  button().click();
  expect(download).toHaveBeenCalledOnce();
  expect(install).not.toHaveBeenCalled();
});
it('announces bounded download progress and blocks duplicate download/install actions while busy', async () => {
  await available(); props.state.phase = 'downloading'; props.state.busy = true;
  props.state.progress = { downloaded: 2, total: 4 }; await nextTick();
  expect(button().getAttribute('aria-label')).toBe('正在下载更新 50%');
  expect(button().disabled).toBe(true); button().click(); expect(download).not.toHaveBeenCalled();
  props.state.progress.downloaded = 8; await nextTick();
  expect(button().getAttribute('aria-label')).toBe('正在下载更新 100%');
  props.state.phase = 'installing'; await nextTick();
  expect(button().getAttribute('aria-label')).toBe('正在安装更新');
  button().click(); expect(install).not.toHaveBeenCalled();
});
it('keeps failed downloads visible for retry and uses the existing save/install action only when ready', async () => {
  await available(); props.state.error = '更新签名验证失败'; await nextTick();
  expect(button().dataset.tooltip).toContain('签名验证失败');
  button().click(); expect(download).toHaveBeenCalledOnce(); expect(install).not.toHaveBeenCalled();
  props.state.phase = 'ready'; props.state.error = ''; await nextTick();
  expect(button().getAttribute('aria-label')).toBe('保存并安装 0.9.1');
  expect(button().dataset.tooltip).toContain('先保存文档');
  button().click(); expect(install).toHaveBeenCalledOnce();
});

it('morphs the same line from its current frame, celebrates once, and cancels animation when hidden', async () => {
  let now = 0, frameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback); return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  function advance(time: number) {
    now = time;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(now));
  }
  await available();
  const path = root.querySelector('.sidebar-update-line')!;
  const stemShape = path.getAttribute('d');
  const head = root.querySelector('.sidebar-update-arrowhead')!;
  function expectConnectedHead() {
    const stem = path.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
    const wings = head.getAttribute('d')!.match(/-?\d+(?:\.\d+)?(?:e[+-]?\d+)?/g)!.map(Number);
    expect(wings.slice(2, 4)).toEqual(stem.slice(-2));
  }
  props.state.phase = 'downloading'; props.state.busy = true; await nextTick();
  expect(root.querySelector('.sidebar-update-line')).toBe(path);
  expect(path.getAttribute('d')).toBe(stemShape);
  advance(80);
  expect(head.getAttribute('opacity')).toBe('1');
  expectConnectedHead();
  expect(path.getAttribute('d')).not.toBe(stemShape);
  expect(path.parentElement!.getAttribute('transform')).toBe('rotate(0 12 12)');
  // Progress/tooltip renders must preserve the current handoff frame.
  const bending = path.getAttribute('d');
  props.state.progress = { downloaded: 50, total: 100 }; await nextTick();
  expect(path.getAttribute('d')).toBe(bending);
  advance(250);
  const arc = path.getAttribute('d');
  const rotation = path.parentElement!.getAttribute('transform');
  expect(arc).not.toBe(stemShape);
  expect(arc).not.toBe(bending);
  expectConnectedHead();
  props.state.phase = 'ready'; props.state.busy = false; await nextTick();
  expect(path.getAttribute('d')).toBe(arc);
  expect(path.parentElement!.getAttribute('transform')).toBe(rotation);
  expect(button().classList.contains('is-celebrating')).toBe(true);
  advance(480);
  expect(path.getAttribute('d')).not.toBe(arc);
  advance(710);
  expect(frames.size).toBe(0);
  props.state.progress.downloaded += 1; await nextTick();
  expect(button().classList.contains('is-celebrating')).toBe(true);
  props.state.phase = 'installing'; props.state.busy = true; await nextTick();
  expect(root.querySelector('.sidebar-update-line')).toBe(path);
  expect(button().classList.contains('is-celebrating')).toBe(false);
  expect(frames.size).toBe(1);
  props.enabled = false; await nextTick();
  expect(frames.size).toBe(0);
});

it('does not replay completion fireworks when an already ready update becomes visible', async () => {
  props.state.phase = 'ready';
  props.state.candidate = { id: 'verified-candidate', version: '0.9.1', notes: '' };
  await nextTick();
  expect(button().dataset.state).toBe('ready');
  expect(button().classList.contains('is-celebrating')).toBe(false);
  props.enabled = false; await nextTick();
  props.enabled = true; await nextTick();
  expect(button().classList.contains('is-celebrating')).toBe(false);
});
