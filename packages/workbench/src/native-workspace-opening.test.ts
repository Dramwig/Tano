import { beforeEach, expect, it, vi } from 'vitest';
import { NativeAdapter } from './adapter';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), chooseDirectory: vi.fn(), mobile: false }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: mocks.chooseDirectory }));
vi.mock('./platform', () => ({ get mobile() { return mocks.mobile; } }));
beforeEach(() => { mocks.invoke.mockReset(); mocks.chooseDirectory.mockReset(); mocks.mobile = false; });

it('selects the native folder without opening it, then opens the confirmed path without a second dialog', async () => {
  const path = 'C:\\我的工作区';
  mocks.chooseDirectory.mockResolvedValue(path);
  const adapter = new NativeAdapter();
  expect(await adapter.selectWorkspacePath!()).toBe(path);
  expect(mocks.chooseDirectory).toHaveBeenCalledExactlyOnceWith({ directory: true, multiple: false, title: '选择 Tano 工作文件夹' });
  expect(mocks.invoke).not.toHaveBeenCalled();
  mocks.invoke.mockResolvedValue({ id: 'local', path, files: [] });
  await adapter.open(path);
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('open_workspace', { path });
  expect(mocks.chooseDirectory).toHaveBeenCalledOnce();
});

it('does not invoke native workspace loading when folder selection is cancelled', async () => {
  mocks.chooseDirectory.mockResolvedValue(null);
  const adapter = new NativeAdapter();
  expect(await adapter.selectWorkspacePath!()).toBeNull();
  expect(mocks.invoke).not.toHaveBeenCalled();
});

it('preserves direct open callers that still ask the adapter to select a folder', async () => {
  mocks.chooseDirectory.mockResolvedValue('C:/Notes');
  mocks.invoke.mockResolvedValue({ id: 'local', path: 'C:/Notes', files: [] });
  await new NativeAdapter().open();
  expect(mocks.chooseDirectory).toHaveBeenCalledOnce();
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('open_workspace', { path: 'C:/Notes' });
});

it('keeps mobile default-workspace opening free of a desktop folder picker', async () => {
  mocks.mobile = true;
  const adapter = new NativeAdapter();
  expect(adapter.selectWorkspacePath).toBeUndefined();
  await adapter.open();
  expect(mocks.chooseDirectory).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledExactlyOnceWith('open_mobile_workspace', { name: null });
});
