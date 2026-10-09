import { afterEach, expect, it, vi } from 'vitest';
import { parsePluginPackage, type PluginPackage } from '@tano/protocol';
import { PluginDevelopmentRunner, type DevelopmentAccess, type DevelopmentSnapshot, type PluginDevelopmentState } from './development';
import { documentOverviewPlugin } from './example';
import { pluginIntegrity } from './packages';

const address = `http://127.0.0.1:4173/${'a'.repeat(48)}/package.json`;
const id = documentOverviewPlugin.manifest.id;
function executable(pkg: PluginPackage) {
  const parsed = parsePluginPackage(JSON.stringify(pkg));
  if (parsed.manifest.manifestVersion !== 2) throw new Error('Expected executable fixture');
  return { ...parsed, manifest: parsed.manifest };
}
const initialPackage = executable(documentOverviewPlugin);
const nextPackage = (source = '// changed') => executable({ ...initialPackage, source });
const response = (pkg: PluginPackage) => new Response(JSON.stringify(pkg), { headers: { ETag: '"build"' } });
const runners: PluginDevelopmentRunner[] = [];
afterEach(() => { for (const runner of runners.splice(0)) runner.stop(); vi.restoreAllMocks(); });
async function setup(request: typeof fetch, beforeAuthorize?: () => Promise<void>) {
  let snapshot: DevelopmentSnapshot = { workspaceId: 'workspace', manifest: initialPackage.manifest,
    integrity: await pluginIntegrity(initialPackage), authorized: true, enabled: true, canManage: true };
  let state: PluginDevelopmentState = { pluginId: '', active: false, message: '' };
  const authorize = vi.fn();
  const apply = vi.fn<DevelopmentAccess['apply']>(async (pkg, integrity, previous, guards) => {
    guards.beforeInstall();
    if (pkg.manifest.manifestVersion !== 2) throw new Error('Expected executable build');
    expect(previous.integrity).toBe(snapshot.integrity);
    snapshot = { ...snapshot, manifest: pkg.manifest, integrity, authorized: false };
    await beforeAuthorize?.();
    guards.beforeAuthorize(); authorize(integrity);
    snapshot = { ...snapshot, authorized: true };
  });
  const runner = new PluginDevelopmentRunner({ snapshot: () => snapshot, apply }, value => { state = value; }, request, 10);
  runners.push(runner);
  return { runner, apply, authorize, get state() { return state; }, get snapshot() { return snapshot; },
    change: (patch: Partial<DevelopmentSnapshot>) => { snapshot = { ...snapshot, ...patch }; } };
}

it('applies a changed build once, trusts its exact digest and polls conditionally', async () => {
  const pkg = nextPackage();
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(response(pkg)).mockImplementation(async () => new Response(null, { status: 304 }));
  const host = await setup(request); host.runner.start(id, address);
  await vi.waitFor(() => expect(request.mock.calls.length).toBeGreaterThanOrEqual(2));
  expect(host.apply).toHaveBeenCalledTimes(1);
  expect(host.authorize).toHaveBeenCalledWith(await pluginIntegrity(pkg));
  expect(request.mock.calls[1]![1]).toMatchObject({ credentials: 'omit', redirect: 'error', headers: { 'If-None-Match': '"build"' } });
  expect(host.state.active).toBe(true); expect(host.state.updatedAt).toBeDefined();
});

it('keeps the running build during compilation/network failures and recovers', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('compile failed', { status: 503 }))
    .mockRejectedValueOnce(new TypeError('offline')).mockImplementation(async () => response(nextPackage()));
  const host = await setup(request); host.runner.start(id, address);
  await vi.waitFor(() => expect(host.authorize).toHaveBeenCalledTimes(1));
  expect(request.mock.calls.length).toBeGreaterThanOrEqual(3); expect(host.state.active).toBe(true);
});

it.each(['id', 'permissions', 'networkOrigins', 'nativeCommands'] as const)('requires manual review when %s changes', async field => {
  const pkg = nextPackage();
  if (field === 'id') pkg.manifest.id = 'other-plugin';
  else if (field === 'permissions') pkg.manifest.permissions = [...pkg.manifest.permissions, 'storage'];
  else if (field === 'networkOrigins') { pkg.manifest.permissions = ['network']; pkg.manifest.networkOrigins = ['https://example.com']; }
  else { pkg.manifest.permissions = ['native']; pkg.manifest.nativeCommands = ['git.status']; }
  const host = await setup(vi.fn<typeof fetch>().mockResolvedValue(response(pkg))); host.runner.start(id, address);
  await vi.waitFor(() => expect(host.state.active).toBe(false));
  expect(host.apply).not.toHaveBeenCalled(); expect(host.state.message).toContain('手动导入');
});

it.each([{ workspaceId: 'other' }, { integrity: 'b'.repeat(64) }, { authorized: false }, { enabled: false }, { canManage: false }])('revokes the session when current authority changes: %j', async patch => {
  let release!: (value: Response) => void;
  const host = await setup(() => new Promise(resolve => { release = resolve; })); host.runner.start(id, address);
  host.change(patch); release(response(nextPackage()));
  await vi.waitFor(() => expect(host.state.active).toBe(false)); expect(host.apply).not.toHaveBeenCalled();
});

it('does not apply a fetch that completes after stop, even if the transport ignores cancellation', async () => {
  let release!: (value: Response) => void;
  const host = await setup(() => new Promise(resolve => { release = resolve; })); host.runner.start(id, address);
  host.runner.stop(); release(response(nextPackage()));
  await new Promise(resolve => setTimeout(resolve, 30)); expect(host.apply).not.toHaveBeenCalled();
});

it.each(['stop', 'workspace', 'role', 'replacement'] as const)('rechecks %s immediately before authorizing an installed build', async change => {
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const paused = new Promise<void>(resolve => { release = resolve; });
  const host = await setup(async () => response(nextPackage()), async () => { entered(); await paused; });
  host.runner.start(id, address); await waiting;
  if (change === 'stop') host.runner.stop();
  else if (change === 'workspace') host.change({ workspaceId: 'other' });
  else if (change === 'role') host.change({ canManage: false });
  else host.change({ integrity: 'c'.repeat(64) });
  release(); await vi.waitFor(() => expect(host.state.active).toBe(false));
  expect(host.authorize).not.toHaveBeenCalled(); expect(host.snapshot.authorized).toBe(false);
});

it('accepts only explicit loopback watch URLs and requires an authorized enabled administrator', async () => {
  const request = vi.fn<typeof fetch>(); const host = await setup(request);
  for (const url of ['https://example.com/package.json', address.replace('127.0.0.1', 'localhost'), address + '?x=1', address.replace('a'.repeat(48), 'short')])
    expect(() => host.runner.start(id, url)).toThrow('本机');
  for (const patch of [{ canManage: false }, { authorized: false }, { enabled: false }]) {
    host.change({ canManage: true, authorized: true, enabled: true, ...patch });
    expect(() => host.runner.start(id, address)).toThrow('授权');
  }
  expect(request).not.toHaveBeenCalled();
});
