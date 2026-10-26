// @vitest-environment jsdom
import { createApp, defineComponent, h, nextTick } from 'vue';
import { afterEach, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({
  gate: undefined as Promise<void> | undefined,
  requests: [] as ({ path?: string; error?: string } | null)[],
  pending: undefined as (() => void) | undefined,
  ready: undefined as (() => void) | undefined,
  initial: undefined as string | undefined,
  open: vi.fn(), report: vi.fn(), unlisten: vi.fn(),
}));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async () => { await mock.gate; return mock.requests.shift() ?? null; },
}));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, listener: () => void) => { mock.pending = listener; return mock.unlisten; },
}));
vi.mock('@tano/workbench/stores/workspace', () => ({
  useWorkspaceStore: () => ({ busy: false, workspace: { path: 'old' }, openWorkspace: mock.open, report: mock.report }),
}));
vi.mock('@tano/workbench', () => ({
  default: defineComponent({
    props: ['resolveInitialWorkspace'],
    emits: ['ready'],
    setup(props, { emit }) { void props.resolveInitialWorkspace().then((path: string | undefined) => { mock.initial = path; }); mock.ready = () => emit('ready'); return () => h('button', '真实工作台'); },
  }),
}));
import WorkspaceShell from './WorkspaceShell.vue';
let app: ReturnType<typeof createApp>;
afterEach(() => { app?.unmount(); vi.clearAllMocks(); mock.requests = []; mock.gate = undefined; document.body.replaceChildren(); });
it('mounts the actual workbench while the native folder request is pending', async () => {
  let release!: () => void;
  mock.gate = new Promise<void>(resolve => { release = resolve; });
  mock.requests = [{ path: 'slow folder' }];
  const host = document.createElement('div'); document.body.append(host);
  app = createApp(WorkspaceShell); app.mount(host);
  const control = host.querySelector('button');
  expect(control?.textContent).toBe('真实工作台');
  release();
  await vi.waitFor(() => expect(mock.initial).toBe('slow folder'));
  expect(host.querySelector('button')).toBe(control);
});
it('prioritizes the shell folder on startup and queues later requests until the workbench is ready', async () => {
  mock.requests = [{ path: 'selected 中文' }, { path: 'next folder' }];
  const host = document.createElement('div'); document.body.append(host);
  app = createApp(WorkspaceShell); app.mount(host);
  await vi.waitFor(() => expect(mock.initial).toBe('selected 中文'));
  mock.pending!();
  await nextTick();
  expect(mock.open).not.toHaveBeenCalled();
  mock.ready!();
  await vi.waitFor(() => expect(mock.open).toHaveBeenCalledExactlyOnceWith('next folder'));
  mock.requests.push({ error: 'file missing' });
  mock.pending!();
  await vi.waitFor(() => expect(mock.report).toHaveBeenCalledWith('file missing'));
  app.unmount();
  expect(mock.unlisten).toHaveBeenCalledOnce();
});
