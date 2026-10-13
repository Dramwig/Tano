// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createApp, h, nextTick, reactive, type App } from 'vue';
import type { PluginOAuthHost, PluginOAuthInput } from '@tano/protocol';
import PluginOAuthConnection from './PluginOAuthConnection.vue';

let store: { workspace: { id: string }; startPluginOAuth: ReturnType<typeof vi.fn> };
let oauth: PluginOAuthHost;
vi.mock('../runtime', () => ({ useWorkbenchRuntime: () => ({ native: false, plugins: { connections: { oauth } } }) }));
vi.mock('../stores/workspace', () => ({ useWorkspaceStore: () => store }));
vi.mock('../attachments', () => ({ openExternalUrl: vi.fn() }));
let app: App | undefined, root: HTMLDivElement;
afterEach(() => { app?.unmount(); root?.remove(); vi.useRealTimers(); });
async function mount(status: PluginOAuthHost['status'] = vi.fn<PluginOAuthHost['status']>(async () => ({ status: 'pending' }))) {
  const flow = { id: 'f'.repeat(43), authorizationUrl: 'https://login.example.com/authorize?state=synthetic', expiresAt: new Date(Date.now() + 600000).toISOString() };
  oauth = { providers: vi.fn(async () => [{ id: 'service', label: '示例服务', origin: 'https://api.example.com', scopes: ['read'] }]),
    start: vi.fn(), cancel: vi.fn(async () => {}), status };
  store = reactive({ workspace: { id: 'workspace-one' }, startPluginOAuth: vi.fn(async () => flow) });
  const input = reactive<Omit<PluginOAuthInput, 'providerId'>>({ pluginId: 'test', origin: 'https://api.example.com', integrity: 'a'.repeat(64), methods: ['GET'], pathPrefix: '/v1/' });
  const connected = vi.fn();
  root = document.createElement('div'); document.body.append(root);
  app = createApp({ render: () => h(PluginOAuthConnection, { input, enabled: true, onConnected: connected }) }); app.mount(root);
  await vi.waitFor(() => expect(root.textContent).toContain('使用账号登录'));
  await nextTick(); return { input, connected, flow };
}
it('starts login only on user action, shows a separate safe navigation link and polls completion', async () => {
  const status = vi.fn<PluginOAuthHost['status']>().mockResolvedValueOnce({ status: 'pending' }).mockResolvedValueOnce({ status: 'completed' });
  const t = await mount(status);
  expect(store.startPluginOAuth).not.toHaveBeenCalled(); expect(root.querySelector('a')).toBeNull();
  root.querySelector('button')!.click(); await vi.waitFor(() => expect(root.querySelector('a')).not.toBeNull());
  expect(store.startPluginOAuth).toHaveBeenCalledWith('workspace-one', expect.objectContaining({ providerId: 'service', integrity: 'a'.repeat(64), methods: ['GET'] }), expect.any(AbortSignal));
  expect(root.querySelector('a')!.rel).toBe('noopener noreferrer'); expect(root.querySelector('a')!.target).toBe('_blank');
  await vi.waitFor(() => expect(t.connected).toHaveBeenCalledOnce(), { timeout: 3000 });
  expect(root.querySelector('a')).toBeNull(); expect(oauth.cancel).not.toHaveBeenCalled();
});
it('cancels the old workspace flow and ignores its late completion', async () => {
  let finish!: (value: { status: 'completed' }) => void;
  const status = vi.fn<PluginOAuthHost['status']>(() => new Promise(resolve => { finish = resolve; }));
  const t = await mount(status); root.querySelector('button')!.click(); await vi.waitFor(() => expect(finish).toBeDefined());
  const signal = status.mock.calls[0]![2];
  store.workspace = { id: 'workspace-two' }; await nextTick();
  expect(signal.aborted).toBe(true); expect(oauth.cancel).toHaveBeenCalledWith('workspace-one', t.flow.id, expect.any(AbortSignal));
  finish({ status: 'completed' }); await nextTick(); expect(t.connected).not.toHaveBeenCalled(); expect(root.querySelector('a')).toBeNull();
});
it('revokes a pending flow when the plugin version or requested scope changes', async () => {
  const t = await mount(); root.querySelector('button')!.click(); await vi.waitFor(() => expect(root.querySelector('a')).not.toBeNull());
  t.input.integrity = 'b'.repeat(64); await nextTick();
  expect(oauth.cancel).toHaveBeenCalledWith('workspace-one', t.flow.id, expect.any(AbortSignal)); expect(root.querySelector('a')).toBeNull();
});
it('keeps loading providers while the connection form changes and cancels on workspace changes', async () => {
  const t = await mount();
  let finish!: (value: Awaited<ReturnType<PluginOAuthHost['providers']>>) => void;
  oauth.providers = vi.fn<PluginOAuthHost['providers']>(() => new Promise(resolve => { finish = resolve; }));
  store.workspace = { id: 'workspace-two' }; await nextTick();
  const signal = vi.mocked(oauth.providers).mock.calls[0]![1];
  t.input.pathPrefix = '/v2/'; await nextTick();
  expect(signal.aborted).toBe(false);
  finish([{ id: 'service', label: '示例服务', origin: 'https://api.example.com', scopes: ['read'] }]);
  await vi.waitFor(() => expect(root.textContent).toContain('使用账号登录'));
  store.workspace = { id: 'workspace-three' }; await nextTick();
  expect(signal.aborted).toBe(true);
  app!.unmount(); app = undefined;
  expect(vi.mocked(oauth.providers).mock.calls[1]![1].aborted).toBe(true);
});
