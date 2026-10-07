import { beforeEach, expect, it, vi } from 'vitest';
import { NativeAdapter } from './adapter';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: () => true }));
vi.mock('./platform', () => ({ mobile: false }));
beforeEach(() => mocks.invoke.mockReset());

it('exposes local registration removal and invokes only the unregister command', async () => {
  const workspace = { id: 'local-id', name: '本地', path: 'C:/Notes', files: [] };
  mocks.invoke.mockResolvedValue(workspace);
  const adapter = new NativeAdapter();
  expect((await adapter.open('C:/Notes'))?.canDelete).toBe(true);
  expect((await adapter.refresh()).canDelete).toBe(true);
  mocks.invoke.mockClear();
  await adapter.deleteWorkspace('local-id');
  expect(mocks.invoke.mock.calls).toEqual([['unregister_workspace', { workspaceId: 'local-id' }]]);
});
