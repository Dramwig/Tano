import { beforeEach, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  flush: vi.fn(),
  disconnect: vi.fn(),
  documents: [] as { conflict?: unknown }[],
}));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, Channel: class {} }));
vi.mock('./workspace', () => ({
  useWorkspaceStore: () => ({ flush: mocks.flush, documents: mocks.documents }),
}));
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({ extensions: () => ({ disconnect: mocks.disconnect }) }) }));
import { useUpdatesStore } from './updates';
beforeEach(() => {
  vi.clearAllMocks();
  mocks.documents.length = 0;
  mocks.flush.mockResolvedValue(true);
  mocks.disconnect.mockResolvedValue(undefined);
  mocks.invoke.mockImplementation(async (command: string) => {
    if (command === 'update_status') return { currentVersion: '0.1.0', configured: true };
    if (command === 'update_check') return { id: 'candidate', version: '0.2.0', notes: '' };
  });
  setActivePinia(createPinia());
});
it('requires conflict resolution even when workspace flush safely journals a conflict', async () => {
  mocks.documents.push({ conflict: { ours: 'unsaved text' } });
  const updates = useUpdatesStore();
  await updates.initialize();
  await updates.download();
  await updates.install();
  expect(updates.state.phase).toBe('ready');
  expect(updates.state.error).toContain('冲突');
  expect(mocks.disconnect).not.toHaveBeenCalled();
  expect(mocks.invoke.mock.calls.some(([command]) => command === 'update_install')).toBe(false);
});
