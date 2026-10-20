// @vitest-environment jsdom
import { expect, it, vi, beforeEach } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createLocalExtensions } from './runtime';
import { createWorkspaceSync } from './workspace-sync';
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
const initial = { backend: 'git', lastSynced: null, message: '', conflicts: [] };
beforeEach(() => { vi.mocked(invoke).mockReset().mockResolvedValue(initial); });
function setup() {
  const store = { workspace: { id: 'first' }, isWeb: false, isDemo: false, busy: false, flush: vi.fn().mockResolvedValue(true), refresh: vi.fn().mockResolvedValue(undefined) };
  const extensions = createLocalExtensions();
  const controller = createWorkspaceSync(store as never, extensions);
  return { store, extensions, controller };
}
it('saves before Git writes and refreshes only after host completion', async () => {
  const {store,controller}=setup(); await controller.action('run');
  expect(store.flush).toHaveBeenCalledOnce(); expect(invoke).toHaveBeenCalledWith('workspace_sync', {request:{workspaceId:'first',action:'run'}});
  expect(store.refresh).toHaveBeenCalledOnce();
  store.flush.mockResolvedValue(false); vi.mocked(invoke).mockClear(); await controller.action('run');
  expect(invoke).not.toHaveBeenCalled(); expect(controller.error.value).toContain('未保存');
});
it('blocks Git during cloud sync and waits for disconnect before disabling', async () => {
  const {controller,extensions}=setup(); extensions.sync={enabled:true,open:vi.fn(),disconnect:vi.fn().mockResolvedValue(undefined)};
  await controller.action('run'); expect(invoke).not.toHaveBeenCalled();
  await controller.action('disable'); expect(extensions.sync.disconnect).toHaveBeenCalledOnce();
  expect(invoke).toHaveBeenCalledWith('workspace_sync',{request:{workspaceId:'first',action:'disable'}});
});
it('does not send an old action after switching workspace during save', async () => {
  const {store,controller}=setup(); let done!: (value:boolean)=>void;
  store.flush.mockReturnValue(new Promise(resolve=>{done=resolve;}));
  const pending=controller.action('run'); store.workspace={id:'second'};controller.reset();done(true);await pending;
  expect(invoke).not.toHaveBeenCalled();expect(store.refresh).not.toHaveBeenCalled();
});
it('does not replace a new workspace status with a late native result', async () => {
  const {store,controller}=setup(); let done!: (value:unknown)=>void;
  vi.mocked(invoke).mockImplementationOnce(()=>new Promise(resolve=>{done=resolve;}));
  const pending=controller.action('status');store.workspace={id:'second'};controller.reset();done(initial);await pending;
  expect(controller.state.value.backend).toBeNull();
});
it('pauses automatic retries for unresolved conflicts', async () => {
  const {controller}=setup();vi.mocked(invoke).mockResolvedValue({...initial,conflicts:['note.md']});await controller.tick();
  expect(invoke).toHaveBeenCalledTimes(1);
});
